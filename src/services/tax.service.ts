import { Setting } from '../models/setting.model';
import { merchantName, round2 } from '../utils/text';
import { merchantKey } from './categories.service';
import { transactionsService } from './transactions.service';

/** ספקים שכל התרומות אליהם מזכות */
const PAYEES_KEY = 'section46.payees';
/** תרומות בודדות שמזכות (למשל לפי דוח התרומות של רשות המסים) — גם כשלספק יש תשלומים שלא מזכים */
const TXNS_KEY = 'section46.transactions';
/** זיכוי ממס על תרומה למוסד עם אישור סעיף 46 */
const CREDIT_RATE = 0.35;

export interface Section46Payee {
  name: string;
  total: number;
  count: number;
  /** כל התרומות לספק מזכות */
  eligible: boolean;
  /** כמה מתוך הסכום מזכה (כשרק חלק מהתרומות סומנו) */
  eligibleAmount: number;
  eligibleCount: number;
}

export interface Section46Summary {
  year: number;
  payees: Section46Payee[];
  donationsTotal: number;
  eligibleTotal: number;
  creditRate: number;
  expectedCredit: number;
}

async function readSet(key: string): Promise<Set<string>> {
  const row = await Setting.findByPk(key);
  return new Set(row ? (JSON.parse(row.value) as (string | number)[]).map(String) : []);
}

async function writeSet(key: string, set: Set<string>): Promise<void> {
  await Setting.upsert({ key, value: JSON.stringify([...set]) });
}

/** תרומות השנה לפי מקבל, ואיזה מהן מזכות בזיכוי ממס */
async function summary(year: number): Promise<Section46Summary> {
  const [txns, payeeKeys, txnIds] = await Promise.all([
    transactionsService.getRangeTransactions(`${year}-01`, `${year}-12`),
    readSet(PAYEES_KEY),
    readSet(TXNS_KEY),
  ]);
  const byPayee = new Map<string, Section46Payee>();
  for (const t of txns) {
    const marked = txnIds.has(String(t.id));
    // תרומה = נספרת במעשרות, או סומנה כתרומה מוכרת (גם אם לא נספרת במעשרות)
    if (t.maaserRole !== 'donation' && !marked) continue;
    const name = merchantName(t.description, t.memo);
    const key = merchantKey(t.description, t.memo);
    const e = byPayee.get(key) ?? { name, total: 0, count: 0, eligible: payeeKeys.has(key), eligibleAmount: 0, eligibleCount: 0 };
    const amount = -t.chargedAmount;
    e.total = round2(e.total + amount);
    e.count++;
    if (e.eligible || marked) {
      e.eligibleAmount = round2(e.eligibleAmount + amount);
      e.eligibleCount++;
    }
    byPayee.set(key, e);
  }
  const payees = [...byPayee.values()].filter((p) => p.total > 0).sort((a, b) => b.eligibleAmount - a.eligibleAmount || b.total - a.total);
  const eligibleTotal = round2(payees.reduce((s, p) => s + p.eligibleAmount, 0));
  return {
    year,
    payees,
    donationsTotal: round2(payees.reduce((s, p) => s + p.total, 0)),
    eligibleTotal,
    creditRate: CREDIT_RATE,
    expectedCredit: round2(eligibleTotal * CREDIT_RATE),
  };
}

/** כל התרומות לספק מזכות / לא. כיבוי מסיר גם סימונים של תרומות בודדות לספק בשנה הזו */
async function setPayee(name: string, eligible: boolean, year?: number): Promise<void> {
  const keys = await readSet(PAYEES_KEY);
  const key = merchantKey(name);
  if (eligible) keys.add(key);
  else {
    keys.delete(key);
    if (year) {
      const ids = await readSet(TXNS_KEY);
      const txns = await transactionsService.getRangeTransactions(`${year}-01`, `${year}-12`);
      for (const t of txns) if (merchantKey(t.description, t.memo) === key) ids.delete(String(t.id));
      await writeSet(TXNS_KEY, ids);
    }
  }
  await writeSet(PAYEES_KEY, keys);
}

/** סימון תרומות בודדות כמזכות (או ביטול) */
async function setTransactions(ids: number[], eligible: boolean): Promise<void> {
  const set = await readSet(TXNS_KEY);
  for (const id of ids) {
    if (eligible) set.add(String(id));
    else set.delete(String(id));
  }
  await writeSet(TXNS_KEY, set);
}

export const taxService = { summary, setPayee, setTransactions };
