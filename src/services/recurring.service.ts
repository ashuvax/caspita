import { Op } from 'sequelize';
import { Account } from '../models/account.model';
import { BankConfig } from '../models/bank-config.model';
import { TransactionRecord } from '../models/transaction.model';
import { RecurringItem, type RecurringDirection, type RecurringStatus } from '../models/recurring-item.model';
import { addMonths, currentMonth, diffDays, monthOf } from '../utils/dates';
import { descriptionKey, median, round2 } from '../utils/text';
import { accountDisplayName } from './accounts.service';

/** כמה חודשים אחורה בודקים */
const LOOKBACK_MONTHS = 6;
/** מינימום חודשים שונים שבהם החיוב הופיע */
const MIN_MONTHS = 3;
/** סטיית תקן מקסימלית של היום בחודש */
const MAX_DAY_SPREAD = 5;

interface MonthBucket {
  month: string;
  amount: number;
  days: number[];
  lastDate: string;
}

interface Candidate {
  accountId: number;
  matchKey: string;
  direction: RecurringDirection;
  displayName: string;
  dayOfMonth: number;
  expectedAmount: number;
  amountVaries: boolean;
  occurrences: number;
  firstSeenDate: string;
  lastSeenDate: string;
  lastMonth: string;
}

function stdDev(values: number[]): number {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
}

function analyzeGroup(accountId: number, matchKey: string, direction: RecurringDirection, txns: TransactionRecord[]): Candidate | null {
  // לכל חודש: החיוב העיקרי (הגדול) + חיובים נוספים באותו שם בטווח של 3 ימים ממנו
  // (למשל שתי הוראות משכנתא באותו יום). חיובים קטנים בימים אחרים — לא נספרים.
  const byMonth = new Map<string, TransactionRecord[]>();
  for (const t of txns) {
    const m = monthOf(t.date);
    const list = byMonth.get(m) ?? [];
    list.push(t);
    byMonth.set(m, list);
  }
  const buckets = new Map<string, MonthBucket>();
  for (const [m, list] of byMonth) {
    const main = list.reduce((a, b) => (Math.abs(b.chargedAmount) > Math.abs(a.chargedAmount) ? b : a));
    const near = list.filter((t) => Math.abs(diffDays(t.date, main.date)) <= 3);
    buckets.set(m, {
      month: m,
      amount: near.reduce((s, t) => s + Math.abs(t.chargedAmount), 0),
      days: [Number(main.date.slice(8, 10))],
      lastDate: near.reduce((a, t) => (t.date > a ? t.date : a), main.date),
    });
  }
  const months = [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (months.length < MIN_MONTHS) return null;

  // רציפות: מתוך החודשים מהופעה ראשונה ועד אחרונה, לפחות 75% מכוסים
  const first = months[0].month;
  const last = months[months.length - 1].month;
  let span = 1;
  for (let m = first; m < last; m = addMonths(m, 1)) span++;
  if (months.length / span < 0.75) return null;

  const days = months.map((b) => median(b.days));
  if (stdDev(days) > MAX_DAY_SPREAD) return null;

  const recentAmounts = months.slice(-3).map((b) => b.amount);
  const expected = median(recentAmounts);
  const allAmounts = months.map((b) => b.amount);
  const varies = (Math.max(...allAmounts) - Math.min(...allAmounts)) / Math.max(expected, 1) > 0.1;

  const latest = txns.reduce((a, b) => (a.date > b.date ? a : b));
  return {
    accountId,
    matchKey,
    direction,
    displayName: latest.description,
    dayOfMonth: Math.round(median(days)),
    expectedAmount: round2(expected),
    amountVaries: varies,
    occurrences: months.length,
    firstSeenDate: txns.reduce((a, b) => (a.date < b.date ? a : b)).date,
    lastSeenDate: latest.date,
    lastMonth: last,
  };
}

/** פעיל אם הופיע בחודש הנוכחי או הקודם, אחרת — הסתיים */
function statusFor(lastMonth: string): RecurringStatus {
  return lastMonth >= addMonths(currentMonth(), -1) ? 'active' : 'ended';
}

/**
 * זיהוי הוראות קבע מההיסטוריה של חשבונות הבנק.
 * מוסיף הוראות חדשות, מעדכן סכום/יום של קיימות, ומסמן כ"הסתיימה" הוראה שהפסיקה להופיע.
 * הוראות שהמשתמש סימן "התעלם" או הוסיף ידנית לא נדרסות.
 */
async function detect(): Promise<void> {
  const banks = await Account.findAll({ where: { kind: 'bank' } });
  if (banks.length === 0) return;
  const from = `${addMonths(currentMonth(), -LOOKBACK_MONTHS)}-01`;
  const txns = await TransactionRecord.findAll({
    where: {
      accountId: { [Op.in]: banks.map((b) => b.id) },
      date: { [Op.gte]: from },
      cardPaymentForAccountId: null,
    },
  });

  const groups = new Map<string, TransactionRecord[]>();
  for (const t of txns) {
    if (t.chargedAmount === 0) continue;
    const key = descriptionKey(t.description);
    if (!key) continue;
    const direction: RecurringDirection = t.chargedAmount < 0 ? 'debit' : 'credit';
    const groupKey = `${t.accountId}|${direction}|${key}`;
    const list = groups.get(groupKey) ?? [];
    list.push(t);
    groups.set(groupKey, list);
  }

  const candidates: Candidate[] = [];
  for (const [groupKey, list] of groups) {
    const [accountId, direction, ...rest] = groupKey.split('|');
    const c = analyzeGroup(Number(accountId), rest.join('|'), direction as RecurringDirection, list);
    if (c) candidates.push(c);
  }

  const existing = await RecurringItem.findAll({ where: { source: 'auto' } });
  const byKey = new Map(existing.map((e) => [`${e.accountId}|${e.direction}|${e.matchKey}`, e]));
  const seen = new Set<number>();

  for (const c of candidates) {
    const prev = byKey.get(`${c.accountId}|${c.direction}|${c.matchKey}`);
    const nextStatus = statusFor(c.lastMonth);
    const stats = {
      displayName: c.displayName,
      dayOfMonth: c.dayOfMonth,
      expectedAmount: c.expectedAmount,
      amountVaries: c.amountVaries,
      occurrences: c.occurrences,
      firstSeenDate: c.firstSeenDate,
      lastSeenDate: c.lastSeenDate,
    };
    if (prev) {
      seen.add(prev.id);
      await prev.update({ ...stats, status: prev.status === 'ignored' ? 'ignored' : nextStatus });
    } else {
      await RecurringItem.create({ ...stats, accountId: c.accountId, matchKey: c.matchKey, direction: c.direction, source: 'auto', status: nextStatus });
    }
  }

  // אוטומטיות שכבר לא מזוהות בכלל — הסתיימו
  for (const e of existing) {
    if (!seen.has(e.id) && e.status === 'active') await e.update({ status: 'ended' });
  }
}

export interface RecurringDto {
  id: number;
  accountId: number;
  accountName: string;
  displayName: string;
  direction: RecurringDirection;
  dayOfMonth: number;
  expectedAmount: number;
  userAmount: number | null;
  amount: number;
  amountVaries: boolean;
  source: 'auto' | 'manual';
  status: RecurringStatus;
  occurrences: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
}

async function getAll(): Promise<RecurringDto[]> {
  const [items, accounts, configs] = await Promise.all([RecurringItem.findAll(), Account.findAll(), BankConfig.findAll()]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const configById = new Map(configs.map((c) => [c.id, c]));
  return items
    .filter((i) => accountById.has(i.accountId))
    .map((i) => {
      const acc = accountById.get(i.accountId)!;
      return {
        id: i.id,
        accountId: i.accountId,
        accountName: accountDisplayName(acc, configById.get(acc.bankConfigId)),
        displayName: i.displayName,
        direction: i.direction,
        dayOfMonth: i.dayOfMonth,
        expectedAmount: i.expectedAmount,
        userAmount: i.userAmount,
        amount: i.userAmount ?? i.expectedAmount,
        amountVaries: i.amountVaries,
        source: i.source,
        status: i.status,
        occurrences: i.occurrences,
        firstSeenDate: i.firstSeenDate,
        lastSeenDate: i.lastSeenDate,
      };
    })
    .sort((a, b) => (a.status === b.status ? a.dayOfMonth - b.dayOfMonth : a.status.localeCompare(b.status)));
}

export interface RecurringInput {
  accountId: number;
  displayName: string;
  direction: RecurringDirection;
  dayOfMonth: number;
  amount: number;
}

async function create(input: RecurringInput): Promise<void> {
  await RecurringItem.create({
    accountId: input.accountId,
    matchKey: descriptionKey(input.displayName),
    displayName: input.displayName.trim(),
    direction: input.direction,
    dayOfMonth: input.dayOfMonth,
    expectedAmount: Math.abs(input.amount),
    source: 'manual',
    status: 'active',
  });
}

export interface RecurringUpdate {
  status?: RecurringStatus;
  userAmount?: number | null;
  dayOfMonth?: number;
  displayName?: string;
}

async function update(id: number, data: RecurringUpdate): Promise<boolean> {
  const item = await RecurringItem.findByPk(id);
  if (!item) return false;
  const changes: Partial<RecurringItem> = {};
  if (data.status) changes.status = data.status;
  if (data.userAmount !== undefined) changes.userAmount = data.userAmount === null ? null : Math.abs(data.userAmount);
  if (data.dayOfMonth) changes.dayOfMonth = data.dayOfMonth;
  if (data.displayName && item.source === 'manual') {
    changes.displayName = data.displayName.trim();
    changes.matchKey = descriptionKey(data.displayName);
  }
  await item.update(changes);
  return true;
}

async function remove(id: number): Promise<boolean> {
  const item = await RecurringItem.findByPk(id);
  if (!item) return false;
  if (item.source === 'auto') {
    // אוטומטית — לא מוחקים (תזוהה שוב), אלא מסמנים להתעלם
    await item.update({ status: 'ignored' });
  } else {
    await item.destroy();
  }
  return true;
}

export const recurringService = { detect, getAll, create, update, remove };
