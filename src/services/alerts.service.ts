import { Op } from 'sequelize';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { Loan } from '../models/loan.model';
import { Setting } from '../models/setting.model';
import { addMonths, currentMonth, diffDays, monthOf, today } from '../utils/dates';
import { descriptionKey, merchantName, round2 } from '../utils/text';
import { transactionsService } from './transactions.service';
import { installmentsService } from './installments.service';

export type AlertTone = 'good' | 'bad' | 'info';

export interface AlertDto {
  /** מזהה יציב — לסגירה */
  key: string;
  kind: 'price_up' | 'price_down' | 'budget' | 'installment_done' | 'installment_last';
  tone: AlertTone;
  title: string;
  text: string;
  /** לאן לקחת בלחיצה */
  link: string;
  date: string;
}

const DISMISSED_KEY = 'alerts.dismissed';
/** חיוב קבוע "יציב" — החודשים הקודמים קרובים זה לזה בטווח הזה */
const STABLE_RATIO = 0.02;
/** שינוי שמתריעים עליו */
const CHANGE_RATIO = 0.03;
const CHANGE_MIN = 2;
/** שינוי במחיר שקרה לפני יותר מזה — כבר לא חדשות */
const FRESH_DAYS = 45;

function fmt(n: number): string {
  const v = Math.abs(n);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return v.toLocaleString('he-IL', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

function priceAlert(groupKey: string, name: string, prev: number, last: number, date: string, link: string, monthly: boolean): AlertDto {
  const diff = round2(last - prev);
  const cheaper = diff < 0;
  const per = monthly ? ' בחודש' : '';
  return {
    key: `price:${groupKey}:${date}`,
    kind: cheaper ? 'price_down' : 'price_up',
    tone: cheaper ? 'good' : 'bad',
    title: cheaper ? `${name} — ירד המחיר` : `${name} — התייקר`,
    text: `מ-${fmt(prev)} ל-${fmt(last)} ₪ (${cheaper ? 'חיסכון של' : 'עוד'} ${fmt(diff)} ₪${per})`,
    link,
    date,
  };
}

/** שינוי מחיר בחיוב קבוע (ביטוח, מנוי, ארנונה) — גם התייקרות וגם הוזלה */
async function priceChanges(): Promise<AlertDto[]> {
  const from = `${addMonths(currentMonth(), -6)}-01`;
  const [txns, accounts] = await Promise.all([
    TransactionRecord.findAll({ where: { date: { [Op.gte]: from }, cardPaymentForAccountId: null, internalTransfer: false, savingsId: null } }),
    Account.findAll({ where: { isHidden: false } }),
  ]);
  const visible = new Set(accounts.map((a) => a.id));
  const now = today();
  const groups = new Map<string, TransactionRecord[]>();
  for (const t of txns) {
    if (!visible.has(t.accountId) || t.loanId || (t.installmentTotal ?? 0) > 1 || t.chargedAmount === 0) continue;
    const k = `${t.accountId}|${t.chargedAmount < 0 ? 'd' : 'c'}|${descriptionKey(t.description)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  const alerts: AlertDto[] = [];
  for (const [k, list] of groups) {
    const byMonth = new Map<string, TransactionRecord[]>();
    for (const t of list) byMonth.set(monthOf(t.date), [...(byMonth.get(monthOf(t.date)) ?? []), t]);
    const months = [...byMonth.keys()].sort().slice(-4);
    if (months.length < 3) continue;
    // רק חיוב אחד בחודש, בחודשים רצופים — אחרת זה לא חיוב קבוע (סופר, דלק)
    if (months.some((m) => byMonth.get(m)!.length !== 1)) continue;
    if (months.some((m, i) => i > 0 && addMonths(months[i - 1], 1) !== m)) continue;
    const amounts = months.map((m) => Math.abs(byMonth.get(m)![0].chargedAmount));
    const last = amounts[amounts.length - 1];
    const before = amounts.slice(0, -1);
    const prev = before[before.length - 1];
    const stable = Math.max(...before) - Math.min(...before) <= Math.max(...before) * STABLE_RATIO;
    const diff = Math.abs(last - prev);
    if (!stable || diff < CHANGE_MIN || diff / prev < CHANGE_RATIO) continue;
    const lastTxn = byMonth.get(months[months.length - 1])![0];
    if (diffDays(now, lastTxn.date) > FRESH_DAYS) continue;
    alerts.push(priceAlert(k, merchantName(lastTxn.description, lastTxn.memo), prev, last, lastTxn.date, '/recurring', true));
  }

  // הלוואות שלקחתי (משכנתא): התשלום החודשי השתנה — למשל ירידת ריבית
  const loans = await Loan.findAll({ where: { direction: 'taken', closed: false } });
  for (const loan of loans) {
    const paid = txns.filter((t) => t.loanId === loan.id && t.chargedAmount < 0);
    const byMonth = new Map<string, { amount: number; date: string }>();
    for (const t of paid) {
      const m = monthOf(t.date);
      const e = byMonth.get(m) ?? { amount: 0, date: t.date };
      byMonth.set(m, { amount: e.amount - t.chargedAmount, date: t.date > e.date ? t.date : e.date });
    }
    const months = [...byMonth.keys()].sort().slice(-3);
    if (months.length < 2) continue;
    const amounts = months.map((m) => byMonth.get(m)!.amount);
    const last = amounts[amounts.length - 1];
    const prev = amounts[amounts.length - 2];
    const diff = Math.abs(last - prev);
    const date = byMonth.get(months[months.length - 1])!.date;
    if (diff < CHANGE_MIN || diff / prev < 0.01 || diffDays(now, date) > FRESH_DAYS) continue;
    alerts.push(priceAlert(`loan${loan.id}`, loan.counterparty, prev, last, date, '/loans/taken', true));
  }
  return alerts;
}

async function budgetAlerts(): Promise<AlertDto[]> {
  const month = currentMonth();
  const grouped = await transactionsService.getGrouped(month);
  return grouped.insights
    .filter((i) => i.kind === 'budget')
    .map((i) => ({
      key: `budget:${i.categoryId}:${month}:${i.text.includes('עברת') ? 'over' : 'pace'}`,
      kind: 'budget' as const,
      tone: 'bad' as const,
      title: 'תקציב',
      text: i.text,
      link: '/transactions',
      date: today(),
    }));
}

async function installmentAlerts(): Promise<AlertDto[]> {
  const { plans } = await installmentsService.list();
  const month = currentMonth();
  const out: AlertDto[] = [];
  for (const p of plans) {
    if (p.done && p.endMonth >= addMonths(month, -1)) {
      out.push({
        key: `inst-done:${p.key}`,
        kind: 'installment_done',
        tone: 'good',
        title: `${p.name} — התשלומים הסתיימו`,
        text: `מהחודש הבא מתפנים ${fmt(p.perPayment)} ₪ בחודש`,
        link: '/installments',
        date: `${p.endMonth}-01`,
      });
    } else if (!p.done && p.remainingPayments === 1) {
      out.push({
        key: `inst-last:${p.key}`,
        kind: 'installment_last',
        tone: 'info',
        title: `${p.name} — נשאר תשלום אחרון`,
        text: `${fmt(p.perPayment)} ₪, ואחריו זה נגמר`,
        link: '/installments',
        date: p.nextChargeDate ?? today(),
      });
    }
  }
  return out;
}

async function dismissed(): Promise<Set<string>> {
  const row = await Setting.findByPk(DISMISSED_KEY);
  return new Set(row ? (JSON.parse(row.value) as string[]) : []);
}

async function list(): Promise<AlertDto[]> {
  const [prices, budgets, installments, hidden] = await Promise.all([priceChanges(), budgetAlerts(), installmentAlerts(), dismissed()]);
  return [...budgets, ...prices, ...installments].filter((a) => !hidden.has(a.key)).sort((a, b) => b.date.localeCompare(a.date));
}

async function dismiss(key: string): Promise<void> {
  const set = await dismissed();
  set.add(key);
  // שומרים רק את האחרונים — מפתחות ישנים כבר לא יחזרו
  await Setting.upsert({ key: DISMISSED_KEY, value: JSON.stringify([...set].slice(-500)) });
}

export const alertsService = { list, dismiss };
