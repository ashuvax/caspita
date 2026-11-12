import { TransactionRecord } from '../models/transaction.model';
import { Tag } from '../models/tag.model';
import { currentMonth, monthOf, monthsBetween, today } from '../utils/dates';
import { merchantName, round2 } from '../utils/text';
import { type TransactionDto } from '../types/transaction.types';
import { categoryMap, isCounted, sumExpenses, sumIncome, transactionsService } from './transactions.service';
import { maaserService } from './maaser.service';
import { taxService } from './tax.service';
import { FEE } from './alerts.service';

export interface YearSummary {
  year: number;
  /** השנה עוד לא נגמרה — הנתונים עד היום */
  partial: boolean;
  throughDate: string;
  firstDate: string | null;
  totals: { income: number; expenses: number; net: number; savings: number; avgMonthlyExpenses: number; transactionCount: number };
  /** אותה תקופה בשנה שעברה — רק כשיש נתונים מלאים עליה */
  previous: { income: number; expenses: number } | null;
  months: { month: string; income: number; expenses: number; net: number }[];
  byCategory: { categoryId: number | null; amount: number; prevAmount: number | null }[];
  topMerchants: { name: string; amount: number; count: number }[];
  largest: { name: string; date: string; amount: number }[];
  maaser: { income: number; due: number; paid: number };
  donations: { total: number; eligible: number; credit: number };
  fees: { total: number; count: number };
  cashWithdrawn: number;
  tags: { id: number; name: string; color: string; amount: number }[];
}

function expenseOf(t: TransactionDto): number {
  return -t.chargedAmount - t.cashCovered;
}

async function summary(year: number): Promise<YearSummary> {
  const now = today();
  const thisYear = Number(now.slice(0, 4));
  const partial = year === thisYear;
  const lastMonth = partial ? currentMonth() : `${year}-12`;
  const throughDate = partial ? now : `${year}-12-31`;
  const [txns, prevAll, first, maaser, s46, tags] = await Promise.all([
    transactionsService.getRangeTransactions(`${year}-01`, lastMonth),
    transactionsService.getRangeTransactions(`${year - 1}-01`, `${year - 1}-12`),
    TransactionRecord.min<string, TransactionRecord>('date'),
    maaserService.summary(),
    taxService.summary(year),
    Tag.findAll(),
  ]);
  const counted = txns.filter(isCounted);
  const prevCut = `${year - 1}${throughDate.slice(4)}`;
  const prev = prevAll.filter((t) => t.date <= prevCut).filter(isCounted);
  // השוואה רק כשיש נתונים מתחילת השנה הקודמת
  const hasPrev = !!first && first <= `${year - 1}-01-15`;

  const months = monthsBetween(`${year}-01`, lastMonth).map((month) => {
    const list = counted.filter((t) => monthOf(t.date) === month);
    const income = sumIncome(list);
    const expenses = sumExpenses(list);
    return { month, income, expenses, net: round2(income - expenses) };
  });
  const activeMonths = months.filter((m) => m.income > 0 || m.expenses > 0);
  const income = sumIncome(counted);
  const expenses = sumExpenses(counted);

  const cur = categoryMap(counted);
  const prevCats = hasPrev ? categoryMap(prev) : null;
  const byCategory = [...cur.entries()]
    .map(([categoryId, e]) => ({ categoryId, amount: round2(e.expenses), prevAmount: prevCats ? round2(prevCats.get(categoryId)?.expenses ?? 0) : null }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const merchants = new Map<string, { amount: number; count: number }>();
  for (const t of counted) {
    if (t.chargedAmount >= 0) continue;
    const name = merchantName(t.description, t.memo);
    const e = merchants.get(name) ?? { amount: 0, count: 0 };
    e.amount += expenseOf(t);
    e.count++;
    merchants.set(name, e);
  }
  const topMerchants = [...merchants.entries()]
    .map(([name, e]) => ({ name, amount: round2(e.amount), count: e.count }))
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  const seen = new Set<string>();
  const largest = counted
    .filter((t) => t.chargedAmount < 0 && !t.isCashWithdrawal)
    .sort((a, b) => a.chargedAmount - b.chargedAmount)
    .filter((t) => {
      // הוצאה גדולה אחת לכל ספק — אחרת חיוב קבוע (משכנתא) ממלא את כל הרשימה
      const name = merchantName(t.description, t.memo);
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, 5)
    .map((t) => ({ name: merchantName(t.description, t.memo), date: t.date, amount: round2(-t.chargedAmount) }));

  const maaserMonths = maaser.months.filter((m) => m.month.startsWith(`${year}-`));
  const fees = counted.filter((t) => t.chargedAmount < 0 && FEE.test(t.description));

  const tagTotals = new Map<number, number>();
  for (const t of txns) for (const id of t.tagIds) tagTotals.set(id, (tagTotals.get(id) ?? 0) - t.chargedAmount);
  const tagList = tags
    .filter((tag) => tagTotals.has(tag.id))
    .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, amount: round2(tagTotals.get(tag.id) ?? 0) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    year,
    partial,
    throughDate,
    firstDate: first ?? null,
    totals: {
      income,
      expenses,
      net: round2(income - expenses),
      savings: round2(txns.filter((t) => t.savingsNote && t.chargedAmount < 0).reduce((s, t) => s - t.chargedAmount, 0)),
      avgMonthlyExpenses: activeMonths.length ? round2(expenses / activeMonths.length) : 0,
      transactionCount: counted.length,
    },
    previous: hasPrev ? { income: sumIncome(prev), expenses: sumExpenses(prev) } : null,
    months,
    byCategory,
    topMerchants,
    largest,
    maaser: {
      income: round2(maaserMonths.reduce((s, m) => s + m.income, 0)),
      due: round2(maaserMonths.reduce((s, m) => s + m.due, 0)),
      paid: round2(maaserMonths.reduce((s, m) => s + m.paid, 0)),
    },
    donations: { total: s46.donationsTotal, eligible: s46.eligibleTotal, credit: s46.expectedCredit },
    fees: { total: round2(fees.reduce((s, t) => s - t.chargedAmount, 0)), count: fees.length },
    cashWithdrawn: round2(txns.filter((t) => t.isCashWithdrawal).reduce((s, t) => s - t.chargedAmount, 0)),
    tags: tagList,
  };
}

export const yearService = { summary };
