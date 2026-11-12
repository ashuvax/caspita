import { Setting } from '../models/setting.model';
import { merchantName, round2 } from '../utils/text';
import { merchantKey } from './categories.service';
import { transactionsService } from './transactions.service';

const PAYEES_KEY = 'section46.payees';
/** זיכוי ממס על תרומה למוסד עם אישור סעיף 46 */
const CREDIT_RATE = 0.35;

export interface Section46Payee {
  name: string;
  total: number;
  count: number;
  eligible: boolean;
}

export interface Section46Summary {
  year: number;
  payees: Section46Payee[];
  donationsTotal: number;
  eligibleTotal: number;
  creditRate: number;
  expectedCredit: number;
}

async function eligibleKeys(): Promise<Set<string>> {
  const row = await Setting.findByPk(PAYEES_KEY);
  return new Set(row ? (JSON.parse(row.value) as string[]) : []);
}

/** תרומות השנה לפי מקבל, ואיזה מהן מזכות בזיכוי ממס (המשתמש מסמן את המוסדות עם אישור 46) */
async function summary(year: number): Promise<Section46Summary> {
  const [txns, keys] = await Promise.all([transactionsService.getRangeTransactions(`${year}-01`, `${year}-12`), eligibleKeys()]);
  const byPayee = new Map<string, Section46Payee>();
  for (const t of txns) {
    if (t.maaserRole !== 'donation') continue;
    const name = merchantName(t.description, t.memo);
    const key = merchantKey(t.description, t.memo);
    const e = byPayee.get(key) ?? { name, total: 0, count: 0, eligible: keys.has(key) };
    e.total = round2(e.total - t.chargedAmount);
    e.count++;
    byPayee.set(key, e);
  }
  const payees = [...byPayee.values()].filter((p) => p.total > 0).sort((a, b) => b.total - a.total);
  const eligibleTotal = round2(payees.filter((p) => p.eligible).reduce((s, p) => s + p.total, 0));
  return {
    year,
    payees,
    donationsTotal: round2(payees.reduce((s, p) => s + p.total, 0)),
    eligibleTotal,
    creditRate: CREDIT_RATE,
    expectedCredit: round2(eligibleTotal * CREDIT_RATE),
  };
}

async function setPayee(name: string, eligible: boolean): Promise<void> {
  const keys = await eligibleKeys();
  const key = merchantKey(name);
  if (eligible) keys.add(key);
  else keys.delete(key);
  await Setting.upsert({ key: PAYEES_KEY, value: JSON.stringify([...keys]) });
}

export const taxService = { summary, setPayee };
