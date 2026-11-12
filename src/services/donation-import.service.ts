import { Op } from 'sequelize';
import { PDFParse } from 'pdf-parse';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { Category } from '../models/category.model';
import { addDays, diffDays } from '../utils/dates';
import { merchantName, normalizeText, round2 } from '../utils/text';
import { cashService } from './cash.service';
import { taxService } from './tax.service';

/**
 * ייבוא "ריכוז תרומות" (PDF) מהאזור האישי ברשות המסים:
 * קורא את הטבלה, מתאים כל תרומה לעסקה (שם העמותה + סכום + תאריך), ומציע ליצור את תרומות המזומן.
 */

export type DonationMethod = 'card' | 'cash' | 'other';

export interface ReportEntry {
  date: string;
  org: string;
  amount: number;
  method: DonationMethod;
  methodLabel: string;
  receipt: string | null;
  /** ביטול תרומה (סכום שלילי בדוח) */
  cancelled: boolean;
}

export type EntryStatus = 'matched' | 'cash_new' | 'unmatched';

export interface PreviewEntry extends ReportEntry {
  index: number;
  status: EntryStatus;
  transaction: { id: number; date: string; name: string; amount: number; accountKind: string } | null;
}

export interface DonationPreview {
  year: number | null;
  reportTotal: number | null;
  entries: PreviewEntry[];
  counts: Record<EntryStatus, number>;
  totals: Record<EntryStatus, number>;
}

export interface ApplyEntry {
  date: string;
  org: string;
  amount: number;
  receipt: string | null;
  transactionId: number | null;
  createCash: boolean;
}

export interface ApplyResult {
  marked: number;
  created: number;
  payees: number;
}

export class DonationImportError extends Error {}

/** שורות כותרת/תחתית שחוזרות בכל עמוד */
const BOILERPLATE = [/^מדינת ישראל/, /^רשות המסים בישראל/, /^בדוח זה מוצגים/, /^B\d+\/\d+$/, /^-- \d+ of \d+ --$/, /^מעודכן ליום/];
const DATE_PAIR = /(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2})\/(\d{2})\/(\d{4})/g;
const ORG_NUMBER = /(?<!\d)(5\d{8})(?!\d)/;
const METHOD = /(תרומה|ביטול)?\s*(כרטיס\s*אשראי|מזומן|העברה\s*בנקאית|הוראת\s*קבע|צ'?ק|שיק|ביט|פייבוקס|אחר)\s*(-?[\d,]+(?:\.\d{1,2})?)/;

function cleanOrg(raw: string): string {
  return raw
    .replace(/[()]\s*(ע"ר|ע''ר|חל"צ|חל''צ|ע״ר|חל״צ)\s*[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function methodOf(label: string): DonationMethod {
  if (/כרטיס/.test(label)) return 'card';
  if (/מזומן/.test(label)) return 'cash';
  return 'other';
}

export function parseReportText(text: string): { year: number | null; reportTotal: number | null; entries: ReportEntry[] } {
  const lines = text.split(/\r?\n/).filter((l) => !BOILERPLATE.some((re) => re.test(l.trim())));
  // מספר שנשבר בין שתי שורות (מספר קבלה ארוך) מתחבר בחזרה
  const flat = lines
    .reduce((acc, l) => (/\d$/.test(acc) && /^\d/.test(l) ? acc + l : `${acc} ${l}`), '')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ');
  const year = Number(/ריכוז תרומות לשנת מס\s*(\d{4})/.exec(text)?.[1]) || null;
  const totalMatch = /נטו\s*([\d,.]+)\s*₪\s*([\d,.]+)\s*₪\s*([\d,.]+)\s*₪/.exec(flat);
  const reportTotal = totalMatch ? Number(totalMatch[3].replace(/,/g, '')) : null;

  const starts = [...flat.matchAll(DATE_PAIR)];
  const entries: ReportEntry[] = [];
  starts.forEach((m, i) => {
    const chunk = flat.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1].index : flat.length);
    const orgNo = ORG_NUMBER.exec(chunk);
    const method = METHOD.exec(chunk);
    if (!orgNo || !method) return;
    const org = cleanOrg(chunk.slice(0, orgNo.index));
    // בין מספר העמותה לסוג התרומה: שם התורם, מספר הקצאה, מספר קבלה
    const middle = chunk.slice(orgNo.index + orgNo[0].length, method.index);
    const numbers = middle.match(/\d+/g) ?? [];
    const amount = Number(method[3].replace(/,/g, ''));
    if (!org || !Number.isFinite(amount) || amount === 0) return;
    entries.push({
      date: `${m[3]}-${m[2]}-${m[1]}`,
      org,
      amount: Math.abs(amount),
      method: methodOf(method[2]),
      methodLabel: method[2].replace(/\s+/g, ' '),
      receipt: numbers.length === 2 ? numbers[1] : null,
      cancelled: method[1] === 'ביטול' || amount < 0,
    });
  });
  return { year, reportTotal, entries };
}

async function readPdf(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    return (await parser.getText()).text;
  } catch {
    throw new DonationImportError('לא הצלחתי לקרוא את הקובץ — האם זה PDF של ריכוז התרומות מרשות המסים?');
  } finally {
    await parser.destroy();
  }
}

/** מילים משמעותיות בשם (בלי ה' הידיעה) — להשוואה בין שם העמותה בדוח לשם בעסקה */
function tokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => (w.length >= 4 && w.startsWith('ה') ? w.slice(1) : w))
      .filter((w) => w.length >= 3)
  );
}

function nameScore(org: Set<string>, text: string): number {
  const t = tokens(text);
  let score = 0;
  for (const w of org) if (t.has(w)) score++;
  return score;
}

/** חיוב שתואם לסכום בדוח (גם עיגול: 50.01 בכרטיס = 50 בדוח) */
function amountMatches(charged: number, amount: number, exact: boolean): boolean {
  const v = -charged;
  return exact ? Math.abs(v - amount) < 0.01 : Math.round(v) === Math.round(amount) || Math.abs(v - amount) <= 0.6;
}

/** תרומה יכולה להיקלט ברשות המסים הרבה אחרי החיוב (קופות שמדווחות פעם בכמה חודשים) */
const MATCH_WINDOW_DAYS = 200;

async function preview(pdf: Buffer): Promise<DonationPreview> {
  const parsed = parseReportText(await readPdf(pdf));
  if (!parsed.entries.length) throw new DonationImportError('לא נמצאו תרומות בקובץ. צריך את "ריכוז תרומות" מהאזור האישי באתר רשות המסים');
  const dates = parsed.entries.map((e) => e.date).sort();
  const [txns, accounts] = await Promise.all([
    TransactionRecord.findAll({
      where: {
        chargedAmount: { [Op.lt]: 0 },
        cardPaymentForAccountId: null,
        internalTransfer: false,
        date: { [Op.gte]: addDays(dates[0], -MATCH_WINDOW_DAYS), [Op.lte]: addDays(dates[dates.length - 1], 3) },
      },
    }),
    Account.findAll(),
  ]);
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]));
  const hidden = new Set(accounts.filter((a) => a.isHidden).map((a) => a.id));
  const pool = txns.filter((t) => !hidden.has(t.accountId));
  const used = new Set<number>();
  const found = new Map<number, TransactionRecord>();

  // קודם התאמות בסכום מדויק, אחר כך מעוגל — כדי שתרומה של 50 לא "תתפוס" חיוב של 50.01 שמתאים לאחרת
  for (const exact of [true, false]) {
    parsed.entries.forEach((e, i) => {
      if (found.has(i) || e.cancelled) return;
      const org = tokens(e.org);
      const best = pool
        .filter((t) => {
          if (used.has(t.id) || !amountMatches(t.chargedAmount, e.amount, exact)) return false;
          // מזומן — רק מעסקאות המזומן שנרשמו; כרטיס/העברה — לא מהן
          if ((kindOf.get(t.accountId) === 'cash') !== (e.method === 'cash')) return false;
          const days = diffDays(e.date, t.date);
          return days >= -3 && days <= MATCH_WINDOW_DAYS;
        })
        .map((t) => ({ t, score: nameScore(org, `${t.description} ${t.memo ?? ''} ${merchantName(t.description, t.memo)}`) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score || Math.abs(diffDays(e.date, a.t.date)) - Math.abs(diffDays(e.date, b.t.date)))[0];
      if (best) {
        used.add(best.t.id);
        found.set(i, best.t);
      }
    });
  }

  const entries: PreviewEntry[] = parsed.entries.map((e, index) => {
    const t = found.get(index);
    const status: EntryStatus = t ? 'matched' : e.method === 'cash' && !e.cancelled ? 'cash_new' : 'unmatched';
    return {
      ...e,
      index,
      status,
      transaction: t ? { id: t.id, date: t.date, name: merchantName(t.description, t.memo), amount: t.chargedAmount, accountKind: kindOf.get(t.accountId) ?? 'bank' } : null,
    };
  });
  const counts: Record<EntryStatus, number> = { matched: 0, cash_new: 0, unmatched: 0 };
  const totals: Record<EntryStatus, number> = { matched: 0, cash_new: 0, unmatched: 0 };
  for (const e of entries) {
    counts[e.status]++;
    totals[e.status] = round2(totals[e.status] + e.amount);
  }
  return { year: parsed.year, reportTotal: parsed.reportTotal, entries, counts, totals };
}

async function donationCategoryId(): Promise<number | null> {
  const cats = await Category.findAll();
  return cats.find((c) => /מעשר|צדקה|תרומ/.test(c.name))?.id ?? null;
}

/** מסמן את התרומות שאושרו כמזכות, יוצר את תרומות המזומן, ואם ביקשו — מסמן את העמותות כמזכות גם להבא */
async function apply(entries: ApplyEntry[], markPayees: boolean): Promise<ApplyResult> {
  const ids: number[] = [];
  const payeeNames = new Set<string>();
  const existing = entries.filter((e) => e.transactionId).map((e) => e.transactionId as number);
  const rows = existing.length ? await TransactionRecord.findAll({ where: { id: { [Op.in]: existing } } }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  let created = 0;
  const categoryId = entries.some((e) => e.createCash) ? await donationCategoryId() : null;

  for (const e of entries) {
    if (e.transactionId) {
      const t = byId.get(e.transactionId);
      if (!t) continue;
      ids.push(t.id);
      payeeNames.add(merchantName(t.description, t.memo));
    } else if (e.createCash) {
      const record = await cashService.add({
        date: e.date,
        amount: -Math.abs(e.amount),
        description: e.org,
        categoryId,
        note: e.receipt ? `תרומה במזומן — קבלה ${e.receipt}` : 'תרומה במזומן (מדוח רשות המסים)',
      });
      ids.push(record.id);
      payeeNames.add(e.org);
      created++;
    }
  }
  if (ids.length) await taxService.setTransactions(ids, true);
  if (markPayees) for (const name of payeeNames) await taxService.setPayee(name, true);
  return { marked: ids.length, created, payees: markPayees ? payeeNames.size : 0 };
}

export const donationImportService = { preview, apply };
