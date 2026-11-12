import { Op } from 'sequelize';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { BankConfig } from '../models/bank-config.model';
import { TransactionSplit } from '../models/split.model';
import { Loan, LoanPayment } from '../models/loan.model';
import { addMonths, currentMonth, diffDays } from '../utils/dates';
import { round2 } from '../utils/text';

/** משיכת מזומן מכספומט / בסניף */
export const CASH_WITHDRAWAL = /כספומט|משיכת מזומן|משיכה במזומן|מש' מזומן/;
/** הוצאה במזומן "יורדת" ממשיכה שנעשתה עד כך וכך ימים לפניה */
const COVER_WINDOW_DAYS = 60;
/** כמה חודשים אחורה מציגים במסך הארנק */
const WALLET_MONTHS = 6;

export interface CashCoverage {
  /** משיכה → כמה ממנה כוסה בהוצאות מזומן שנרשמו */
  byWithdrawal: Map<number, number>;
  /** הוצאת מזומן → כמה ממנה ירד ממשיכות */
  byExpense: Map<number, number>;
}

async function cashAccountIds(): Promise<Set<number>> {
  return new Set((await Account.findAll({ where: { kind: 'cash' } })).map((a) => a.id));
}

async function loadWithdrawals(cashIds: Set<number>): Promise<TransactionRecord[]> {
  const rows = await TransactionRecord.findAll({
    where: {
      chargedAmount: { [Op.lt]: 0 },
      cardPaymentForAccountId: null,
      internalTransfer: false,
      loanId: null,
      savingsId: null,
      [Op.or]: [{ description: { [Op.like]: '%כספומט%' } }, { description: { [Op.like]: '%מזומן%' } }],
    },
    order: [['date', 'ASC'], ['id', 'ASC']],
  });
  return rows.filter((t) => !cashIds.has(t.accountId) && CASH_WITHDRAWAL.test(t.description));
}

/**
 * הוצאות מזומן שנרשמו "יורדות" ממשיכות הכספומט (הקרובה לפניהן קודם), כדי שלא ייספרו פעמיים.
 * מה שנשאר במשיכה בלי פירוט — נספר כהוצאה אחת בלי קטגוריה.
 */
async function coverage(): Promise<CashCoverage> {
  const cashIds = await cashAccountIds();
  const byWithdrawal = new Map<number, number>();
  const byExpense = new Map<number, number>();
  if (!cashIds.size) return { byWithdrawal, byExpense };
  const [withdrawals, expenses] = await Promise.all([
    loadWithdrawals(cashIds),
    TransactionRecord.findAll({
      where: { accountId: { [Op.in]: [...cashIds] }, chargedAmount: { [Op.lt]: 0 }, loanId: null, savingsId: null },
      order: [['date', 'ASC'], ['id', 'ASC']],
    }),
  ]);
  if (!withdrawals.length || !expenses.length) return { byWithdrawal, byExpense };
  const splits = await TransactionSplit.findAll({ where: { transactionId: { [Op.in]: withdrawals.map((w) => w.id) } } });
  const splitSum = new Map<number, number>();
  for (const s of splits) splitSum.set(s.transactionId, (splitSum.get(s.transactionId) ?? 0) + s.amount);

  const pool = withdrawals.map((w) => ({ id: w.id, date: w.date, left: Math.max(0, -w.chargedAmount - (splitSum.get(w.id) ?? 0)) }));
  for (const e of expenses) {
    let need = -e.chargedAmount;
    // קודם המשיכה הקרובה ביותר לפני ההוצאה
    for (const w of [...pool].reverse()) {
      if (need <= 0.005) break;
      if (w.left <= 0.005 || w.date > e.date || diffDays(e.date, w.date) > COVER_WINDOW_DAYS) continue;
      const take = Math.min(w.left, need);
      w.left -= take;
      need -= take;
      byWithdrawal.set(w.id, round2((byWithdrawal.get(w.id) ?? 0) + take));
      byExpense.set(e.id, round2((byExpense.get(e.id) ?? 0) + take));
    }
  }
  return { byWithdrawal, byExpense };
}

export interface WalletWithdrawal {
  id: number;
  date: string;
  amount: number;
  accountName: string;
  /** קטגוריה שנקבעה לכל המשיכה (אם נקבעה) */
  categoryId: number | null;
  splits: { categoryId: number; amount: number; note: string | null }[];
  splitTotal: number;
  /** ירד בהוצאות מזומן שנרשמו */
  covered: number;
  /** לא פורט — נספר כהוצאה בלי קטגוריה */
  remaining: number;
}

export interface WalletExpense {
  id: number;
  date: string;
  amount: number;
  description: string;
  note: string | null;
  covered: number;
}

export interface WalletSummary {
  fromMonth: string;
  withdrawals: WalletWithdrawal[];
  expenses: WalletExpense[];
  totals: {
    withdrawn: number;
    detailed: number;
    unallocated: number;
    /** החזרים במזומן והכנסות במזומן שנרשמו */
    received: number;
  };
}

async function summary(): Promise<WalletSummary> {
  const fromMonth = addMonths(currentMonth(), -(WALLET_MONTHS - 1));
  const from = `${fromMonth}-01`;
  const cashIds = await cashAccountIds();
  const [allWithdrawals, cov, accounts, configs, cashTxns, givenLoans] = await Promise.all([
    loadWithdrawals(cashIds),
    coverage(),
    Account.findAll(),
    BankConfig.findAll(),
    cashIds.size ? TransactionRecord.findAll({ where: { accountId: { [Op.in]: [...cashIds] }, date: { [Op.gte]: from } }, order: [['date', 'DESC']] }) : [],
    Loan.findAll({ where: { direction: 'given' } }),
  ]);
  const hidden = new Set(accounts.filter((a) => a.isHidden).map((a) => a.id));
  const withdrawals = allWithdrawals.filter((w) => w.date >= from && !hidden.has(w.accountId)).reverse();
  const splits = withdrawals.length ? await TransactionSplit.findAll({ where: { transactionId: { [Op.in]: withdrawals.map((w) => w.id) } } }) : [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const configById = new Map(configs.map((c) => [c.id, c]));
  const loanPayments = givenLoans.length
    ? await LoanPayment.findAll({ where: { loanId: { [Op.in]: givenLoans.map((l) => l.id) }, date: { [Op.gte]: from } } })
    : [];

  const rows: WalletWithdrawal[] = withdrawals.map((w) => {
    const acc = accountById.get(w.accountId);
    const parts = splits.filter((s) => s.transactionId === w.id).map((s) => ({ categoryId: s.categoryId, amount: s.amount, note: s.note ?? null }));
    const splitTotal = round2(parts.reduce((s, p) => s + p.amount, 0));
    const covered = cov.byWithdrawal.get(w.id) ?? 0;
    const amount = round2(-w.chargedAmount);
    return {
      id: w.id,
      date: w.date,
      amount,
      accountName: [configById.get(w.bankConfigId)?.displayName, acc?.label || acc?.accountNumber].filter(Boolean).join(' · '),
      categoryId: w.categoryOverrideId ?? null,
      splits: parts,
      splitTotal,
      covered,
      remaining: round2(Math.max(0, amount - splitTotal - covered)),
    };
  });
  const expenses: WalletExpense[] = cashTxns
    .filter((t) => t.chargedAmount < 0 && !t.loanId && !t.savingsId)
    .map((t) => ({ id: t.id, date: t.date, amount: round2(-t.chargedAmount), description: t.description, note: t.memo ?? null, covered: cov.byExpense.get(t.id) ?? 0 }));

  const withdrawn = round2(rows.reduce((s, r) => s + r.amount, 0));
  const unallocated = round2(rows.filter((r) => r.categoryId === null).reduce((s, r) => s + r.remaining, 0));
  const received = round2(
    cashTxns.filter((t) => t.chargedAmount > 0).reduce((s, t) => s + t.chargedAmount, 0) + loanPayments.reduce((s, p) => s + p.amount, 0)
  );
  return { fromMonth, withdrawals: rows, expenses, totals: { withdrawn, detailed: round2(withdrawn - unallocated), unallocated, received } };
}

export const walletService = { coverage, summary };
