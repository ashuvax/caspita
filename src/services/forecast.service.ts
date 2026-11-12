import { Op } from 'sequelize';
import { Account } from '../models/account.model';
import { BankConfig } from '../models/bank-config.model';
import { TransactionRecord } from '../models/transaction.model';
import { RecurringItem } from '../models/recurring-item.model';
import { addDays, addMonths, currentMonth, dateInMonth, diffDays, endOfMonth, monthOf, monthsBetween, toLocalDate, today } from '../utils/dates';
import { descriptionKey, median, round2 } from '../utils/text';
import { accountDisplayName } from './accounts.service';

/** הוראת קבע שהיום שלה עבר לפני כמה ימים ועדיין לא ירדה — עדיין צפויה */
const LATE_GRACE_DAYS = 5;
/** כמה אחורה מסתכלים כדי להעריך חיוב כרטיס טיפוסי */
const HISTORY_DAYS = 100;

export type ForecastEventKind = 'card' | 'recurring';

export interface ForecastEvent {
  date: string;
  /** שלילי = חיוב, חיובי = זיכוי */
  amount: number;
  label: string;
  kind: ForecastEventKind;
  /** לכרטיס: הסכום עלול לגדול (מחזור החיוב עוד פתוח). להוראת קבע: הסכום משתנה מחודש לחודש */
  estimated: boolean;
  late: boolean;
  /** לכרטיס: הסכום שכבר ידוע (עסקאות שנקלטו). amount יכול להיות גדול יותר — הערכה לפי חודשים קודמים */
  knownAmount: number | null;
  balanceAfter: number;
  sourceId: number;
}

export interface MonthTotals {
  month: string;
  debits: number;
  credits: number;
}

export interface AccountForecast {
  accountId: number;
  accountName: string;
  bankName: string;
  balance: number | null;
  balanceDate: string | null;
  events: ForecastEvent[];
  months: MonthTotals[];
  endBalance: number | null;
  minBalance: number | null;
  minBalanceDate: string | null;
  willGoNegative: boolean;
  linkedCards: string[];
}

export interface ForecastResult {
  from: string;
  until: string;
  accounts: AccountForecast[];
  unlinkedCards: string[];
}

async function forecast(untilParam?: string): Promise<ForecastResult> {
  const now = today();
  const until = untilParam && /^\d{4}-\d{2}-\d{2}$/.test(untilParam) ? untilParam : endOfMonth(addMonths(currentMonth(), 1));

  const [accounts, configs, recurring] = await Promise.all([
    Account.findAll({ where: { isHidden: false } }),
    BankConfig.findAll(),
    RecurringItem.findAll({ where: { status: 'active' } }),
  ]);
  const configById = new Map(configs.map((c) => [c.id, c]));
  const banks = accounts.filter((a) => a.kind === 'bank' && configById.has(a.bankConfigId));
  const cards = accounts.filter((a) => a.kind === 'card' && configById.has(a.bankConfigId));

  const cardTxns = cards.length
    ? await TransactionRecord.findAll({
        where: { accountId: { [Op.in]: cards.map((c) => c.id) }, processedDate: { [Op.gt]: addDays(now, -HISTORY_DAYS) } },
      })
    : [];
  const fromMonth = monthOf(addDays(now, -LATE_GRACE_DAYS));
  const recentBankTxns = banks.length
    ? await TransactionRecord.findAll({ where: { accountId: { [Op.in]: banks.map((b) => b.id) }, date: { [Op.gte]: `${fromMonth}-01` } } })
    : [];

  const result: AccountForecast[] = banks.map((bank) => {
    const config = configById.get(bank.bankConfigId)!;
    const balanceDate = bank.balanceUpdatedAt ? toLocalDate(bank.balanceUpdatedAt) : null;
    const base = balanceDate ?? now;
    const events: Omit<ForecastEvent, 'balanceAfter'>[] = [];

    // 1. חיובי כרטיסי אשראי שיורדים מהחשבון הזה
    const linked = cards.filter((c) => c.paysFromAccountId === bank.id);
    const bankTxnsHere = recentBankTxns.filter((t) => t.accountId === bank.id);
    for (const card of linked) {
      const name = `חיוב ${accountDisplayName(card, configById.get(card.bankConfigId))}`;
      const txns = cardTxns.filter((x) => x.accountId === card.id);
      const chargeDay = card.chargeDay;
      /** תאריך החיוב הבא אחרי תאריך נתון */
      const nextChargeAfter = (d: string): string | null => {
        if (!chargeDay) return null;
        const thisMonth = dateInMonth(monthOf(d), chargeDay);
        return thisMonth > d ? thisMonth : dateInMonth(addMonths(monthOf(d), 1), chargeDay);
      };

      // היסטוריה: החיוב העיקרי בכל חודש (בלי חיובים מיידיים קטנים), לחישוב סכום טיפוסי
      const pastByDate = new Map<string, number>();
      for (const t of txns) {
        if (t.status !== 'completed' || t.processedDate > now) continue;
        pastByDate.set(t.processedDate, (pastByDate.get(t.processedDate) ?? 0) - t.chargedAmount);
      }
      const mainPerMonth = new Map<string, number>();
      for (const [date, sum] of pastByDate) {
        const m = monthOf(date);
        if (sum > (mainPerMonth.get(m) ?? 0)) mainPerMonth.set(m, sum);
      }
      const recentMains = [...mainPerMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3).map(([, v]) => v);
      const typical = recentMains.length ? round2(median(recentMains)) : 0;

      // עתיד: עסקאות לפי תאריך חיוב. עסקה ממתינה שתאריך החיוב שלה כבר עבר — תיכנס לחיוב הבא
      const upcoming = new Map<string, number>();
      for (const t of txns) {
        let date = t.processedDate;
        if (t.status === 'pending' && date <= now) date = nextChargeAfter(now) ?? date;
        if (date <= addDays(base, -LATE_GRACE_DAYS) || date > until) continue;
        const amount = t.chargedAmount !== 0 ? t.chargedAmount : t.originalCurrency === 'ILS' ? t.originalAmount : 0;
        upcoming.set(date, (upcoming.get(date) ?? 0) - amount);
      }
      // מחזורי חיוב עתידיים שעוד אין בהם עסקאות — עדיין צפוי חיוב
      if (chargeDay && typical > 0) {
        for (let d = nextChargeAfter(now); d && d <= until; d = nextChargeAfter(d)) {
          if (!upcoming.has(d)) upcoming.set(d, 0);
        }
      }

      for (const [date, known] of upcoming) {
        const alreadyCharged = bankTxnsHere.some((t) => t.cardPaymentForAccountId === card.id && Math.abs(diffDays(t.date, date)) <= 3);
        if (alreadyCharged && date <= now) continue;
        if (date <= base && diffDays(base, date) > LATE_GRACE_DAYS) continue;
        const isMainCycle = chargeDay !== null && date === dateInMonth(monthOf(date), chargeDay) && date > now;
        const expected = isMainCycle ? Math.max(known, typical) : known;
        if (expected <= 0) continue;
        const late = date <= base;
        events.push({
          date: late ? addDays(base, 1) : date,
          amount: -round2(expected),
          label: name,
          kind: 'card',
          estimated: date > now,
          late,
          knownAmount: round2(known),
          sourceId: card.id,
        });
      }
    }

    // 2. הוראות קבע והכנסות קבועות
    for (const item of recurring.filter((r) => r.accountId === bank.id)) {
      const amount = item.userAmount ?? item.expectedAmount;
      for (const month of monthsBetween(monthOf(base), monthOf(until))) {
        const date = dateInMonth(month, item.dayOfMonth);
        if (date > until) continue;
        const happened = bankTxnsHere.some(
          (t) =>
            monthOf(t.date) === month &&
            descriptionKey(t.description) === item.matchKey &&
            (item.direction === 'debit' ? t.chargedAmount < 0 : t.chargedAmount > 0)
        );
        if (happened) continue;
        const late = date <= base;
        if (late && diffDays(base, date) > LATE_GRACE_DAYS) continue;
        // התאריך כבר עבר והבנק כבר עיבד את היום הזה (יש עסקאות מאותו יום ואילך) — החיוב לא ירד החודש, לא לצפות לו
        if (date < base && bankTxnsHere.some((t) => t.date >= date)) continue;
        events.push({
          date: late ? addDays(base, 1) : date,
          amount: item.direction === 'debit' ? -amount : amount,
          label: item.displayName,
          kind: 'recurring',
          estimated: item.amountVaries && item.userAmount === null,
          late,
          knownAmount: null,
          sourceId: item.id,
        });
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

    let running = bank.balance;
    let minBalance = bank.balance;
    let minBalanceDate: string | null = bank.balance !== null ? base : null;
    const withBalance: ForecastEvent[] = events.map((e) => {
      if (running !== null) {
        running = round2(running + e.amount);
        if (minBalance === null || running < minBalance) {
          minBalance = running;
          minBalanceDate = e.date;
        }
      }
      return { ...e, balanceAfter: running ?? 0 };
    });

    const monthMap = new Map<string, MonthTotals>();
    for (const e of events) {
      const m = monthOf(e.date);
      const entry = monthMap.get(m) ?? { month: m, debits: 0, credits: 0 };
      if (e.amount < 0) entry.debits = round2(entry.debits - e.amount);
      else entry.credits = round2(entry.credits + e.amount);
      monthMap.set(m, entry);
    }

    return {
      accountId: bank.id,
      accountName: accountDisplayName(bank, config),
      bankName: config.displayName,
      balance: bank.balance,
      balanceDate,
      events: withBalance,
      months: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
      endBalance: running,
      minBalance,
      minBalanceDate,
      willGoNegative: minBalance !== null && minBalance < 0,
      linkedCards: linked.map((c) => accountDisplayName(c, configById.get(c.bankConfigId))),
    };
  });

  return {
    from: now,
    until,
    accounts: result,
    unlinkedCards: cards.filter((c) => !c.paysFromAccountId).map((c) => accountDisplayName(c, configById.get(c.bankConfigId))),
  };
}

export const forecastService = { forecast };
