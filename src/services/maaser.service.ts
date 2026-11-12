import { Op } from 'sequelize';
import { MaaserRule, type MaaserRuleKind } from '../models/maaser-rule.model';
import { TransactionRecord, type MaaserOverride } from '../models/transaction.model';
import { Account, type AccountKind } from '../models/account.model';
import { type MaaserRole } from '../types/transaction.types';
import { currentMonth, diffDays, monthOf, monthsBetween } from '../utils/dates';
import { Setting } from '../models/setting.model';
import { INVESTMENT_PATTERN } from './accounts.service';
import { CARD_BANK_KEYWORDS } from '../config/companies.config';
import { merchantName, normalizeText, round2 } from '../utils/text';
import { settingsService, type MaaserSettings } from './settings.service';

export interface MaaserContext {
  donationPatterns: string[];
  incomeExcludePatterns: string[];
  accountKinds: Map<number, AccountKind>;
  /** זיכויים שיש מולם חיוב באותו סכום (החזר הלוואה, כסף שעבר דרכי) — פטורים. ערך = הסבר */
  offsetCredits: Map<number, string>;
  /** החיוב שמולו קוזז כל זיכוי — יחד הם זוג שלא נספר כהכנסה/הוצאה */
  offsetDebits: Map<number, string>;
}

/** חלון הזמן לחיפוש חיוב תואם לזיכוי (לפני או אחרי) */
const OFFSET_WINDOW_DAYS = 60;
/** סכומים קטנים מזה לא מקוזזים — יותר מדי צירופים מקריים */
const OFFSET_MIN_AMOUNT = 50;
/** חיוב בכרטיס נחשב "כסף שהוצאתי עבור מישהו" רק מסכום כזה (לדוגמה תשלום לעורך דין עבור חבר) */
const OFFSET_MIN_CARD_AMOUNT = 1000;

/** חיוב שיכול להיות הלוואה/כסף שעבר דרכי: העברה, הפקדה, שיק, ביט */
const LENDING_DEBIT = /העברה|העב'|הפקדה|שיק|המחאה|ביט|bit|paybox|פייבוקס/i;
/** חיובים שלעולם אינם הלוואה למישהו */
const NEVER_LENDING = /כספומט|מש' מ|משיכ|משכנ|טפחות|גמ"?ח|הלוא|הלווא|חיוב$|הו"?ק/;
/** זיכויים שהם תמיד הכנסה אמיתית ולא החזר: סליקה מחברות אשראי, משכורת */
const NEVER_REPAYMENT = new RegExp(
  [...Object.values(CARD_BANK_KEYWORDS).map((r) => r.source), 'משכורת', 'שכר'].join('|')
);

/**
 * זיכוי שיש מולו חיוב באותו סכום בדיוק פטור ממעשר: הלוויתי ואז קיבלתי החזר, או קיבלתי והעברתי הלאה.
 * כדי לא לקזז במקרה, החיוב חייב להיות העברה/שיק (או חיוב כרטיס גדול), והזיכוי לא סליקה/משכורת.
 * כל חיוב מקוזז מול זיכוי אחד בלבד (הקרוב ביותר בזמן). העברות פנימיות, תשלומי כרטיס ותרומות לא משתתפים.
 */
function findOffsetPairs(txns: TransactionRecord[], donationPatterns: string[], kinds: Map<number, AccountKind>): { credits: Map<number, string>; debits: Map<number, string> } {
  // עסקאות שמשויכות להלוואה מטופלות דרך ההלוואה, לא בקיזוז אוטומטי
  const eligible = txns.filter((t) => !t.internalTransfer && !t.cardPaymentForAccountId && !t.loanId && !t.savingsId && Math.abs(t.chargedAmount) >= OFFSET_MIN_AMOUNT);
  const debits = eligible.filter((t) => {
    if (t.chargedAmount >= 0 || matches(donationPatterns, t)) return false;
    if (NEVER_LENDING.test(t.description)) return false;
    if (kinds.get(t.accountId) === 'card') return -t.chargedAmount >= OFFSET_MIN_CARD_AMOUNT;
    return LENDING_DEBIT.test(t.description) || kinds.get(t.accountId) === 'cash';
  });
  const credits = eligible
    .filter((t) => t.chargedAmount > 0 && kinds.get(t.accountId) !== 'card' && !NEVER_REPAYMENT.test(t.description))
    .sort((a, b) => a.date.localeCompare(b.date));
  const usedDebits = new Set<number>();
  const result = new Map<number, string>();
  const debitNotes = new Map<number, string>();

  // ביטול חיוב: זיכוי עם אותו שם בדיוק ואותו סכום הפוך כמו חיוב קודם (החזר עמלה, ביטול הוראה) — בכל סכום
  const bankSide = txns.filter((t) => !t.internalTransfer && !t.cardPaymentForAccountId && !t.loanId && !t.savingsId && kinds.get(t.accountId) !== 'card');
  const reversalDebits = bankSide.filter((t) => t.chargedAmount < 0 && !matches(donationPatterns, t));
  for (const c of bankSide.filter((t) => t.chargedAmount > 0).sort((a, b) => a.date.localeCompare(b.date))) {
    const name = normalizeText(merchantName(c.description, c.memo));
    const match = reversalDebits
      .filter(
        (d) =>
          !usedDebits.has(d.id) &&
          d.accountId === c.accountId &&
          d.date <= c.date &&
          diffDays(c.date, d.date) <= OFFSET_WINDOW_DAYS &&
          Math.abs(d.chargedAmount + c.chargedAmount) < 0.005 &&
          normalizeText(merchantName(d.description, d.memo)) === name
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!match) continue;
    usedDebits.add(match.id);
    const [cy, cm, cd] = c.date.split('-');
    const [y, m, d] = match.date.split('-');
    debitNotes.set(match.id, `בוטל — הסכום הוחזר ב-${cd}/${cm}/${cy.slice(2)}`);
    result.set(c.id, `ביטול של החיוב מ-${d}/${m}/${y.slice(2)} — לא הכנסה`);
  }

  for (const c of credits) {
    if (result.has(c.id)) continue;
    const match = debits
      .filter((d) => !usedDebits.has(d.id) && Math.abs(d.chargedAmount + c.chargedAmount) < 0.005 && Math.abs(diffDays(d.date, c.date)) <= OFFSET_WINDOW_DAYS)
      .sort((a, b) => Math.abs(diffDays(a.date, c.date)) - Math.abs(diffDays(b.date, c.date)))[0];
    if (!match) continue;
    usedDebits.add(match.id);
    const [cy, cm, cd] = c.date.split('-');
    debitNotes.set(match.id, `חזר באותו סכום ב-${cd}/${cm}/${cy.slice(2)} (${merchantName(c.description, c.memo)})`);
    const [y, m, d] = match.date.split('-');
    result.set(c.id, `מקוזז מול חיוב באותו סכום ב-${d}/${m}/${y.slice(2)} (${merchantName(match.description, match.memo)})`);
  }
  return { credits: result, debits: debitNotes };
}

function offsetMaps(pairs: { credits: Map<number, string>; debits: Map<number, string> }): Pick<MaaserContext, 'offsetCredits' | 'offsetDebits'> {
  return { offsetCredits: pairs.credits, offsetDebits: pairs.debits };
}

async function loadContext(): Promise<MaaserContext> {
  const [rules, accounts] = await Promise.all([MaaserRule.findAll(), Account.findAll()]);
  const donationPatterns = rules.filter((r) => r.kind === 'donation').map((r) => normalizeText(r.pattern)).filter(Boolean);
  // קיזוז: חיוב מכל חשבון (גם כרטיס — למשל תשלום לעורך דין עבור חבר) מול זיכוי בבנק או במזומן
  const allTxns = await TransactionRecord.findAll();
  const kinds = new Map(accounts.map((a) => [a.id, a.kind]));
  const offsetPool = allTxns.filter((t) => t.chargedAmount < 0 || kinds.get(t.accountId) !== 'card');
  return {
    donationPatterns,
    incomeExcludePatterns: rules.filter((r) => r.kind === 'income_exclude').map((r) => normalizeText(r.pattern)).filter(Boolean),
    accountKinds: new Map(accounts.map((a) => [a.id, a.kind])),
    ...offsetMaps(findOffsetPairs(offsetPool, donationPatterns, kinds)),
  };
}

/** כללי ברירת מחדל — נוספים פעם אחת, ואפשר למחוק אותם מהמסך */
/** כל גרסה רצה פעם אחת בלבד — כלל שהמשתמש מחק לא חוזר */
const DEFAULT_INCOME_EXCLUDES: { version: string; patterns: string[] }[] = [
  { version: 'v1', patterns: ['ני"ע-מכירה', 'הלואה', 'הלוואה'] },
  { version: 'v2', patterns: ['ביטול עסקה'] },
];

async function ensureDefaultRules(): Promise<void> {
  for (const seed of DEFAULT_INCOME_EXCLUDES) {
    const key = `seed.maaserRules.${seed.version}`;
    if (await Setting.findByPk(key)) continue;
    for (const pattern of seed.patterns) {
      const exists = await MaaserRule.findOne({ where: { kind: 'income_exclude', pattern } });
      if (!exists) await MaaserRule.create({ kind: 'income_exclude', pattern });
    }
    await Setting.create({ key, value: 'true' });
  }
}

function matches(patterns: string[], t: Pick<TransactionRecord, 'description' | 'memo'>): boolean {
  const text = `${normalizeText(t.description)} ${normalizeText(t.memo)}`;
  return patterns.some((p) => text.includes(p));
}

type RoleInput = Pick<
  TransactionRecord,
  'id' | 'chargedAmount' | 'description' | 'memo' | 'accountId' | 'maaserOverride' | 'cardPaymentForAccountId' | 'internalTransfer' | 'loanId' | 'savingsId'
>;

/**
 * תפקיד העסקה במעשרות:
 *  - סימון ידני גובר: include → הכנסה (אם זיכוי) או מעשר (אם חיוב); exclude → לא נספר
 *  - חיוב לספק שברשימת ספקי המעשרות → מעשר
 *  - זיכוי בחשבון בנק שלא ברשימת "הכנסות פטורות" → הכנסה
 *  - תשלום כרטיס אשראי מהבנק לא נספר אף פעם (העסקאות עצמן נספרות בכרטיס)
 *  - העברה בין חשבונות של המשתמש לא נספרת
 *  - זיכוי שיש מולו חיוב באותו סכום (קיזוז) לא נספר
 */
function roleOf(t: RoleInput, ctx: MaaserContext): MaaserRole {
  if (t.cardPaymentForAccountId) return null;
  const isCredit = t.chargedAmount > 0;
  if (t.maaserOverride === 'exclude') return null;
  if (t.maaserOverride === 'include') return isCredit ? 'income' : 'donation';
  // העברה בין החשבונות שלי — לא הכנסה ולא מעשר (אלא אם סומנה ידנית)
  if (t.internalTransfer) return null;
  if (!isCredit) return matches(ctx.donationPatterns, t) ? 'donation' : null;
  // החזר מספק מעשרות (ביטול תרומה) — מקטין את המעשרות, לא הכנסה
  if (matches(ctx.donationPatterns, t)) return 'donation';
  // זיכוי בכרטיס הוא החזר על רכישה, לא הכנסה. הכנסה = בנק או מזומן
  if (ctx.accountKinds.get(t.accountId) === 'card') return null;
  // קרן של הלוואה שלקחתי, או החזר של הלוואה שנתתי — לא הכנסה
  if (t.loanId) return null;
  // משיכה מחיסכון (פיקדון, קרן השתלמות) — הכסף שלי שחזר, לא הכנסה
  if (t.savingsId) return null;
  if (ctx.offsetCredits.has(t.id)) return null;
  return matches(ctx.incomeExcludePatterns, t) ? null : 'income';
}

/** הסבר קצר למה עסקה לא נספרת (להצגה) */
function reasonOf(t: RoleInput, ctx: MaaserContext): string | null {
  if (t.cardPaymentForAccountId) return 'תשלום כרטיס אשראי';
  if (t.maaserOverride) return 'סומן ידנית';
  if (t.internalTransfer) return INVESTMENT_PATTERN.test(t.description) ? 'קניה/מכירה של ניירות ערך' : 'העברה בין החשבונות שלך';
  if (t.chargedAmount <= 0) return null;
  if (ctx.accountKinds.get(t.accountId) === 'card') return 'זיכוי בכרטיס (החזר)';
  if (t.loanId) return 'הלוואה';
  if (t.savingsId) return 'משיכה מחיסכון';
  const offset = ctx.offsetCredits.get(t.id);
  if (offset) return offset;
  if (matches(ctx.incomeExcludePatterns, t)) return 'ברשימת ההכנסות הפטורות';
  return null;
}

export interface MaaserMonth {
  month: string;
  income: number;
  due: number;
  paid: number;
  /** יתרה מצטברת בסוף החודש: חיובי = עוד חייב, שלילי = נתן יותר */
  balance: number;
}

export interface MaaserSummary {
  settings: MaaserSettings;
  months: MaaserMonth[];
  totals: { income: number; due: number; paid: number; balance: number };
}

async function summary(): Promise<MaaserSummary> {
  const settings = await settingsService.get('maaser');
  const ctx = await loadContext();
  const where = settings.startMonth ? { date: { [Op.gte]: `${settings.startMonth}-01` } } : {};
  const txns = await TransactionRecord.findAll({ where, order: [['date', 'ASC']] });

  const byMonth = new Map<string, { income: number; paid: number }>();
  for (const t of txns) {
    const role = roleOf(t, ctx);
    if (!role) continue;
    const m = monthOf(t.date);
    const entry = byMonth.get(m) ?? { income: 0, paid: 0 };
    if (role === 'income') entry.income += t.chargedAmount;
    else entry.paid += -t.chargedAmount;
    byMonth.set(m, entry);
  }

  const first = settings.startMonth ?? (txns[0] ? monthOf(txns[0].date) : currentMonth());
  let balance = settings.openingBalance;
  const months: MaaserMonth[] = monthsBetween(first, currentMonth()).map((month) => {
    const e = byMonth.get(month) ?? { income: 0, paid: 0 };
    const due = (e.income * settings.percent) / 100;
    balance += due - e.paid;
    return { month, income: round2(e.income), due: round2(due), paid: round2(e.paid), balance: round2(balance) };
  });

  const totals = months.reduce(
    (acc, m) => ({ income: acc.income + m.income, due: acc.due + m.due, paid: acc.paid + m.paid }),
    { income: 0, due: 0, paid: 0 }
  );
  return {
    settings,
    months: months.reverse(),
    totals: { income: round2(totals.income), due: round2(totals.due), paid: round2(totals.paid), balance: round2(balance) },
  };
}

async function setOverride(transactionId: number, override: MaaserOverride | null): Promise<boolean> {
  const [count] = await TransactionRecord.update({ maaserOverride: override }, { where: { id: transactionId } });
  return count > 0;
}

async function getRules(): Promise<MaaserRule[]> {
  return MaaserRule.findAll({ order: [['kind', 'ASC'], ['pattern', 'ASC']] });
}

async function addRule(kind: MaaserRuleKind, pattern: string): Promise<MaaserRule> {
  const clean = pattern.trim();
  const existing = await MaaserRule.findOne({ where: { kind, pattern: clean } });
  return existing ?? MaaserRule.create({ kind, pattern: clean });
}

async function removeRule(id: number): Promise<boolean> {
  return (await MaaserRule.destroy({ where: { id } })) > 0;
}

async function updateSettings(data: Partial<MaaserSettings>): Promise<MaaserSettings> {
  const current = await settingsService.get('maaser');
  const next: MaaserSettings = {
    percent: data.percent !== undefined && data.percent > 0 && data.percent <= 100 ? data.percent : current.percent,
    startMonth: data.startMonth !== undefined ? data.startMonth || null : current.startMonth,
    openingBalance: data.openingBalance !== undefined && Number.isFinite(data.openingBalance) ? data.openingBalance : current.openingBalance,
  };
  return settingsService.set('maaser', next);
}

export const maaserService = { loadContext, ensureDefaultRules, roleOf, reasonOf, summary, setOverride, getRules, addRule, removeRule, updateSettings };
