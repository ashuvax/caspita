import { TransactionRecord } from '../models/transaction.model';
import { type TransactionDto } from '../types/transaction.types';
import { currentMonth, monthOf } from '../utils/dates';
import { merchantName } from '../utils/text';
import { categoriesService } from './categories.service';
import { isCounted, transactionsService } from './transactions.service';
import { loansService } from './loans.service';
import { savingsService } from './savings.service';
import { investmentsService } from './investments.service';
import { recurringService } from './recurring.service';
import { maaserService } from './maaser.service';
import { installmentsService } from './installments.service';
import { fundsService } from './funds.service';
import { Tag } from '../models/tag.model';

type Row = Record<string, string | number | null>;

export interface AssistantDataset {
  tables: Record<string, Row[]>;
}

function hiddenReason(t: TransactionDto): string | null {
  if (t.isCardPayment) return 'תשלום כרטיס אשראי (הרכישות עצמן מופיעות בנפרד)';
  if (t.isInternalTransfer) return 'העברה בין החשבונות שלי';
  if (t.savingsNote) return t.savingsNote;
  if (t.loanExcluded && t.loanNote) return t.loanNote;
  if (t.offsetNote) return t.offsetNote;
  if (t.isLoanCredit) return 'זיכוי של הלוואה';
  return null;
}

/** כל הנתונים בטבלאות שטוחות — לעוזר (שאלות בשפה חופשית), דרך שרת ה-MCP המקומי */
async function build(): Promise<AssistantDataset> {
  const first = (await TransactionRecord.min<string, TransactionRecord>('date')) ?? `${currentMonth()}-01`;
  const [txns, cats] = await Promise.all([transactionsService.getRangeTransactions(monthOf(first), currentMonth()), categoriesService.list()]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const name = (id: number | null) => (id === null ? null : catName.get(id) ?? null);

  const tagName = new Map((await Tag.findAll()).map((t) => [t.id, t.name]));
  const [given, taken, savings, investments, recurring, maaser, installments, funds] = await Promise.all([
    loansService.list('given'),
    loansService.list('taken'),
    savingsService.list(),
    investmentsService.list(false),
    recurringService.getAll(),
    maaserService.summary(),
    installmentsService.list(),
    fundsService.list(),
  ]);

  return {
    tables: {
      transactions: txns.map((t) => ({
        id: t.id,
        date: t.date,
        month: monthOf(t.date),
        charge_date: t.processedDate,
        merchant: merchantName(t.description, t.memo),
        description: t.description,
        memo: t.memo,
        amount: t.chargedAmount,
        original_amount: t.originalAmount,
        original_currency: t.originalCurrency,
        account: `${t.bankName} ${t.accountNumber}`,
        account_kind: t.accountKind,
        category: name(t.categoryId),
        counted: isCounted(t) ? 1 : 0,
        not_counted_reason: hiddenReason(t),
        maaser_role: t.maaserRole,
        installment: t.installmentTotal ? `${t.installmentNumber}/${t.installmentTotal}` : null,
        status: t.status,
        cash_withdrawal: t.isCashWithdrawal ? 1 : 0,
        cash_recorded: t.cashCovered || null,
      })),
      transaction_tags: txns.flatMap((t) => t.tagIds.map((id) => ({ transaction_id: t.id, tag: tagName.get(id) ?? null }))),
      transaction_splits: txns.flatMap((t) => t.splits.map((s) => ({ transaction_id: t.id, category: name(s.categoryId), amount: s.amount, note: s.note }))),
      categories: cats.map((c) => ({ name: c.name, monthly_budget: c.monthlyBudget })),
      loans: [...given, ...taken].map((l) => ({
        direction: l.direction === 'given' ? 'נתתי' : 'לקחתי',
        counterparty: l.counterparty,
        amount: l.amount,
        paid: l.paid,
        remaining: l.remaining,
        monthly_payment: l.monthlyPayment,
        start_date: l.startDate,
        due_date: l.dueDate,
        status: l.status,
        note: l.note,
      })),
      savings: savings.map((s) => ({ name: s.name, kind: s.kind, value: s.value, withdrawable: s.withdrawable, monthly_deposit: s.monthlyDeposit, note: s.note })),
      holdings: investments.holdings.map((h) => ({ account: h.account, name: h.name, symbol: h.symbol, quantity: h.quantity, currency: h.currency, price: h.price, value_ils: h.valueIls, cost: h.costBasis, gain: h.gain })),
      recurring: recurring.map((r) => ({ name: r.displayName, account: r.accountName, direction: r.direction === 'debit' ? 'חיוב' : 'זיכוי', day_of_month: r.dayOfMonth, amount: r.amount, status: r.status })),
      maaser_months: maaser.months.map((m) => ({ month: m.month, income: m.income, due: m.due, paid: m.paid, balance: m.balance })),
      installments: installments.plans.map((p) => ({ name: p.name, account: p.accountName, total_amount: p.totalAmount, per_payment: p.perPayment, total_payments: p.totalPayments, paid_payments: p.paidPayments, remaining_amount: p.remainingAmount, end_month: p.endMonth, loan: p.loanName })),
      funds: funds.map((f) => ({ name: f.name, monthly_amount: f.monthlyAmount, target_amount: f.targetAmount, target_date: f.targetDate, balance: f.balance, category: name(f.categoryId) })),
    },
  };
}

export const assistantDataService = { build };
