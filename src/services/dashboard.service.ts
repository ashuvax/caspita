import { Op } from 'sequelize';
import { Account } from '../models/account.model';
import { TransactionRecord } from '../models/transaction.model';
import { addMonths, currentMonth, endOfMonth, monthsBetween, today } from '../utils/dates';
import { median, round2 } from '../utils/text';
import { maaserService } from './maaser.service';
import { categoryMap, isCounted, sumExpenses, sumIncome, transactionsService } from './transactions.service';

export interface DashboardMonth {
  month: string;
  /** החודש הנוכחי — עוד לא הסתיים */
  partial: boolean;
  income: number;
  expenses: number;
  net: number;
  /** אחוז מההכנסות שנשאר (null כשאין הכנסות) */
  savingsRate: number | null;
  /** סך היתרות בחשבונות הבנק בסוף החודש (משוחזר מהתנועות) */
  balance: number | null;
  maaserDue: number;
  maaserPaid: number;
  /** יתרת מעשרות מצטברת לתת בסוף החודש */
  maaserBalance: number | null;
}

export interface DashboardCategory {
  categoryId: number | null;
  total: number;
  /** הוצאה בכל חודש, באותו סדר של months */
  series: number[];
  /** חציון החודשים שהסתיימו */
  typical: number;
}

export interface DashboardResult {
  months: DashboardMonth[];
  categories: DashboardCategory[];
  summary: { typicalIncome: number; typicalExpenses: number; typicalSavingsRate: number | null; balance: number | null; balanceChange: number | null };
}

/** כמה קטגוריות להציג בגרפים הקטנים; השאר מתקפלות ל"שאר" */
const TOP_CATEGORIES = 8;

async function get(monthCount: number): Promise<DashboardResult> {
  const last = currentMonth();
  const first = addMonths(last, -(monthCount - 1));
  const months = monthsBetween(first, last);

  const [txns, banks, maaser] = await Promise.all([
    transactionsService.getRangeTransactions(first, last),
    Account.findAll({ where: { kind: 'bank', isHidden: false } }),
    maaserService.summary(),
  ]);
  const counted = txns.filter(isCounted);
  const byMonth = new Map<string, typeof counted>();
  for (const t of counted) {
    const m = t.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
  }

  // יתרה בסוף חודש = יתרה עכשיו פחות כל התנועות שאחרי סוף החודש
  const withBalance = banks.filter((a) => a.balance !== null);
  const bankTxns = withBalance.length
    ? await TransactionRecord.findAll({
        attributes: ['accountId', 'date', 'chargedAmount'],
        where: { accountId: { [Op.in]: withBalance.map((a) => a.id) }, date: { [Op.gt]: endOfMonth(addMonths(first, -1)) } },
      })
    : [];
  const currentBalance = withBalance.reduce((s, a) => s + (a.balance ?? 0), 0);
  const balanceAt = (date: string): number | null => {
    if (!withBalance.length) return null;
    return round2(currentBalance - bankTxns.filter((t) => t.date > date).reduce((s, t) => s + t.chargedAmount, 0));
  };

  const maaserByMonth = new Map(maaser.months.map((m) => [m.month, m]));

  const rows: DashboardMonth[] = months.map((month) => {
    const list = byMonth.get(month) ?? [];
    const income = sumIncome(list);
    const expenses = sumExpenses(list);
    const net = round2(income - expenses);
    const mm = maaserByMonth.get(month);
    const partial = month === last;
    return {
      month,
      partial,
      income,
      expenses,
      net,
      savingsRate: income > 0 ? Math.round((net / income) * 100) : null,
      balance: balanceAt(partial ? today() : endOfMonth(month)),
      maaserDue: mm?.due ?? 0,
      maaserPaid: mm?.paid ?? 0,
      maaserBalance: mm ? mm.balance : null,
    };
  });

  // קטגוריות: סדרה חודשית לכל קטגוריה, ממוינות לפי סך ההוצאה
  const perMonthCats = months.map((m) => categoryMap(byMonth.get(m) ?? []));
  const ids = new Set<number | null>(perMonthCats.flatMap((map) => [...map.keys()]));
  const all = [...ids]
    .map((categoryId) => {
      const series = perMonthCats.map((map) => round2(Math.max(0, map.get(categoryId)?.expenses ?? 0)));
      return { categoryId, series, total: round2(series.reduce((a, b) => a + b, 0)), typical: round2(median(series.slice(0, -1))) };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const complete = rows.filter((r) => !r.partial && (r.income > 0 || r.expenses > 0));
  const rates = complete.map((r) => r.savingsRate).filter((r): r is number => r !== null);
  const firstBalance = rows.find((r) => r.balance !== null)?.balance ?? null;
  const lastBalance = rows[rows.length - 1]?.balance ?? null;

  return {
    months: rows,
    categories: all.slice(0, TOP_CATEGORIES),
    summary: {
      typicalIncome: round2(median(complete.map((r) => r.income))),
      typicalExpenses: round2(median(complete.map((r) => r.expenses))),
      typicalSavingsRate: rates.length ? Math.round(median(rates)) : null,
      balance: lastBalance,
      balanceChange: firstBalance !== null && lastBalance !== null ? round2(lastBalance - firstBalance) : null,
    },
  };
}

export const dashboardService = { get };
