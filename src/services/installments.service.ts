import { Op } from 'sequelize';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { BankConfig } from '../models/bank-config.model';
import { Loan, type LoanDirection } from '../models/loan.model';
import { addMonths, currentMonth, monthOf, today } from '../utils/dates';
import { descriptionKey, merchantName, round2 } from '../utils/text';
import { accountDisplayName } from './accounts.service';
import { categoriesService, merchantKey } from './categories.service';
import { loansService, type LoanDto } from './loans.service';

export interface InstallmentPlan {
  /** מזהה העסקה בתשלומים (חשבון + אסמכתא) */
  key: string;
  name: string;
  accountName: string;
  categoryId: number | null;
  /** סכום העסקה המלא */
  totalAmount: number;
  perPayment: number;
  totalPayments: number;
  /** כמה תשלומים כבר ירדו */
  paidPayments: number;
  remainingPayments: number;
  remainingAmount: number;
  firstDate: string;
  nextChargeDate: string | null;
  /** החודש של התשלום האחרון */
  endMonth: string;
  done: boolean;
  loanId: number | null;
  loanName: string | null;
}

export interface InstallmentsResult {
  plans: InstallmentPlan[];
  /** כמה כבר "תפוס" בכל אחד מהחודשים הבאים */
  upcoming: { month: string; amount: number }[];
  totalRemaining: number;
  monthlyNow: number;
}

/** כמה חודשים אחורה מציגים עסקה שהסתיימה ("התפנו 200 ₪ בחודש") */
const SHOW_DONE_MONTHS = 2;

function planKey(t: TransactionRecord): string {
  const base = t.identifier ? t.identifier.replace(/_\d+$/, '') : `${descriptionKey(t.description)}|${Math.abs(t.originalAmount)}|${t.installmentTotal}`;
  return `${t.accountId}:${base}`;
}

async function loadGroups(): Promise<Map<string, TransactionRecord[]>> {
  const rows = await TransactionRecord.findAll({ where: { installmentTotal: { [Op.gt]: 1 } }, order: [['processedDate', 'ASC']] });
  const groups = new Map<string, TransactionRecord[]>();
  for (const t of rows) {
    const k = planKey(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return groups;
}

async function list(): Promise<InstallmentsResult> {
  const [groups, accounts, configs, catMap] = await Promise.all([loadGroups(), Account.findAll(), BankConfig.findAll(), categoriesService.merchantMap()]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const configById = new Map(configs.map((c) => [c.id, c]));
  const loanIds = [...new Set([...groups.values()].flat().map((t) => t.loanId).filter((id): id is number => id !== null))];
  const loans = loanIds.length ? await Loan.findAll({ where: { id: { [Op.in]: loanIds } } }) : [];
  const loanName = new Map(loans.map((l) => [l.id, l.counterparty]));
  const now = today();
  const thisMonth = currentMonth();
  const upcoming = new Map<string, number>();
  const plans: InstallmentPlan[] = [];

  for (const [key, rows] of groups) {
    const acc = accountById.get(rows[0].accountId);
    if (!acc || acc.isHidden) continue;
    const latest = rows.reduce((a, b) => ((b.installmentNumber ?? 0) > (a.installmentNumber ?? 0) ? b : a));
    const total = latest.installmentTotal ?? rows.length;
    const latestNo = latest.installmentNumber ?? rows.length;
    const perPayment = round2(Math.abs(latest.chargedAmount));
    const charged = rows.filter((t) => t.processedDate <= now);
    const paid = charged.length ? Math.max(...charged.map((t) => t.installmentNumber ?? 0)) : 0;
    const remaining = Math.max(0, total - paid);
    const latestMonth = monthOf(latest.processedDate);
    const endMonth = addMonths(latestMonth, total - latestNo);
    const done = remaining === 0;
    if (done && endMonth < addMonths(thisMonth, -SHOW_DONE_MONTHS)) continue;

    // תשלומים עתידיים: מה שכבר מופיע בנתונים + הקרנה לפי החודש של האחרון
    for (let n = paid + 1; n <= total; n++) {
      const row = rows.find((t) => t.installmentNumber === n);
      const month = row ? monthOf(row.processedDate) : addMonths(latestMonth, n - latestNo);
      upcoming.set(month, (upcoming.get(month) ?? 0) + (row ? Math.abs(row.chargedAmount) : perPayment));
    }
    const future = rows.filter((t) => t.processedDate > now).map((t) => t.processedDate).sort()[0];
    const loanId = rows.find((t) => t.loanId)?.loanId ?? null;
    plans.push({
      key,
      name: merchantName(latest.description, latest.memo),
      accountName: accountDisplayName(acc, configById.get(acc.bankConfigId)),
      categoryId: catMap.get(merchantKey(latest.description, latest.memo)) ?? null,
      totalAmount: round2(Math.abs(latest.originalAmount) > perPayment ? Math.abs(latest.originalAmount) : perPayment * total),
      perPayment,
      totalPayments: total,
      paidPayments: paid,
      remainingPayments: remaining,
      remainingAmount: round2(remaining * perPayment),
      firstDate: rows[0].date,
      nextChargeDate: done ? null : future ?? `${addMonths(latestMonth, paid + 1 - latestNo)}-${latest.processedDate.slice(8, 10)}`,
      endMonth,
      done,
      loanId,
      loanName: loanId ? loanName.get(loanId) ?? null : null,
    });
  }

  plans.sort((a, b) => Number(a.done) - Number(b.done) || b.remainingAmount - a.remainingAmount);
  const months = [...upcoming.entries()].filter(([m]) => m >= thisMonth).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 12);
  return {
    plans,
    upcoming: months.map(([month, amount]) => ({ month, amount: round2(amount) })),
    totalRemaining: round2(plans.reduce((s, p) => s + p.remainingAmount, 0)),
    monthlyNow: round2(upcoming.get(thisMonth) ?? 0),
  };
}

/** עסקה בתשלומים שכולה הלוואה (שילמתי עבור מישהו בתשלומים, או הלוואה מחברת האשראי) */
async function markAsLoan(key: string, direction: LoanDirection, counterparty: string): Promise<LoanDto | null> {
  const rows = (await loadGroups()).get(key);
  if (!rows?.length) return null;
  const latest = rows[rows.length - 1];
  const total = latest.installmentTotal ?? rows.length;
  const perPayment = Math.abs(latest.chargedAmount);
  const amount = Math.abs(latest.originalAmount) > perPayment ? Math.abs(latest.originalAmount) : perPayment * total;
  const name = merchantName(latest.description, latest.memo);
  const loan = await loansService.create({
    direction,
    counterparty,
    amount: round2(amount),
    startDate: rows[0].date,
    note: `עסקה בתשלומים: ${name}, ${total} תשלומים של ${round2(perPayment)} ₪`,
  });
  await TransactionRecord.update({ loanId: loan.id }, { where: { id: { [Op.in]: rows.map((t) => t.id) } } });
  return loansService.get(loan.id);
}

/** תשלומים חדשים של עסקה שסומנה כהלוואה — משויכים לאותה הלוואה */
async function autoLink(): Promise<number> {
  let linked = 0;
  for (const rows of (await loadGroups()).values()) {
    const loanId = rows.find((t) => t.loanId)?.loanId;
    if (!loanId) continue;
    const missing = rows.filter((t) => !t.loanId).map((t) => t.id);
    if (!missing.length) continue;
    await TransactionRecord.update({ loanId }, { where: { id: { [Op.in]: missing } } });
    linked += missing.length;
  }
  return linked;
}

export const installmentsService = { list, markAsLoan, autoLink };
