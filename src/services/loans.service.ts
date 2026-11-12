import { Op } from 'sequelize';
import { Loan, LoanPayment, type LoanDirection } from '../models/loan.model';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { RecurringItem } from '../models/recurring-item.model';
import { addDays, diffDays, monthOf, today } from '../utils/dates';
import { descriptionKey, median, merchantName, normalizeText, round2 } from '../utils/text';

export type LoanStatus = 'open' | 'overdue' | 'repaid';

export interface LoanEntry {
  /** מזהה עסקה (bank) או תשלום ידני (manual) */
  id: number;
  source: 'bank' | 'manual';
  date: string;
  /** מנקודת המבט שלי: + נכנס, − יצא */
  amount: number;
  label: string;
  /** principal = ההלוואה עצמה, payment = החזר/תשלום */
  kind: 'principal' | 'payment';
}

export interface LoanDto {
  id: number;
  direction: LoanDirection;
  counterparty: string;
  amount: number;
  startDate: string | null;
  dueDate: string | null;
  note: string | null;
  closed: boolean;
  remainingOverride: number | null;
  /** כמה הוחזר לי / כמה שילמתי עד היום */
  paid: number;
  remaining: number;
  status: LoanStatus;
  /** ימים מאז מועד ההחזר (באיחור) או עד מועד ההחזר (שלילי) */
  daysFromDue: number | null;
  /** תשלום חודשי טיפוסי (הלוואה שלקחתי) */
  monthlyPayment: number | null;
  /** תשלומים חדשים משויכים אוטומטית */
  autoMatch: boolean;
  entries: LoanEntry[];
}

export interface LoanInput {
  direction: LoanDirection;
  counterparty: string;
  amount: number;
  startDate?: string | null;
  dueDate?: string | null;
  note?: string | null;
  remainingOverride?: number | null;
  closed?: boolean;
  /** עסקת ההלוואה עצמה (מתוך ההצעות) — מקושרת מיד */
  principalTransactionId?: number | null;
  /** תיאור התשלום הקבוע בבנק — תשלומים כאלה משויכים אוטומטית */
  matchDescription?: string | null;
  matchAmount?: number | null;
}

export interface LoanCandidate {
  id: number;
  date: string;
  amount: number;
  name: string;
  accountName: string;
  /** למה הוצע */
  reason: string;
}

export interface LoanSuggestion {
  /** עסקת הקרן (null כשההצעה היא מתשלום חודשי קבוע) */
  transactionId: number | null;
  counterparty: string;
  amount: number;
  date: string;
  /** תשלום חודשי קבוע שזוהה (משכנתא, גמ"ח) */
  monthly: number | null;
  /** תיאור התשלום בבנק — לשיוך אוטומטי */
  matchDescription?: string;
}

const LOAN_WORD = /הלוא|הלווא/;
/** חיובים שהם תשלום על הלוואה שלקחתי, לא הלוואה שנתתי */
const OWN_LOAN_DEBIT = /הו"?ק|קרן|רבית|ריבית|גמ"?ח|משכנ|טפחות/;
/** השוואת שמות: בלי גרשיים, ש/ס ו-ו/וו מתאחדים (מוסקוביץ = מושקוביץ) */
function nameKey(value: string): string {
  return normalizeText(value).replace(/ש/g, 'ס').replace(/וו/g, 'ו').replace(/[^\p{L}\p{N} ]/gu, ' ');
}

function nameTokens(counterparty: string): string[] {
  return [...new Set(nameKey(counterparty).split(/\s+/).filter((w) => w.length >= 3))];
}

/** עסקה תואמת לשם: שם המשפחה (המילה הארוכה) או לפחות שתי מילים מהשם */
function matchesName(tokens: string[], text: string): boolean {
  if (!tokens.length) return false;
  const key = nameKey(text);
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  if (longest.length >= 5 && key.includes(longest)) return true;
  return tokens.filter((t) => key.includes(t)).length >= 2;
}

function signForMe(direction: LoanDirection, kind: LoanEntry['kind'], amount: number): number {
  // הלוואה שנתתי: הקרן יוצאת, ההחזרים נכנסים. הלוואה שלקחתי: הפוך
  const out = direction === 'given' ? kind === 'principal' : kind === 'payment';
  return out ? -Math.abs(amount) : Math.abs(amount);
}

async function toDtos(loans: Loan[]): Promise<LoanDto[]> {
  const ids = loans.map((l) => l.id);
  const [linked, payments] = await Promise.all([
    ids.length ? TransactionRecord.findAll({ where: { loanId: { [Op.in]: ids } }, order: [['date', 'ASC']] }) : [],
    ids.length ? LoanPayment.findAll({ where: { loanId: { [Op.in]: ids } }, order: [['date', 'ASC']] }) : [],
  ]);
  const now = today();

  return loans.map((l) => {
    const entries: LoanEntry[] = [];
    for (const t of linked.filter((x) => x.loanId === l.id)) {
      // כיוון התנועה קובע: בהלוואה שנתתי חיוב = הקרן, זיכוי = החזר
      const kind: LoanEntry['kind'] = (l.direction === 'given') === t.chargedAmount < 0 ? 'principal' : 'payment';
      entries.push({ id: t.id, source: 'bank', date: t.date, amount: round2(t.chargedAmount), label: merchantName(t.description, t.memo), kind });
    }
    for (const p of payments.filter((x) => x.loanId === l.id)) {
      entries.push({ id: p.id, source: 'manual', date: p.date, amount: signForMe(l.direction, 'payment', p.amount), label: p.note || 'תשלום ידני', kind: 'payment' });
    }
    entries.sort((a, b) => b.date.localeCompare(a.date));

    const paid = round2(entries.filter((e) => e.kind === 'payment').reduce((s, e) => s + Math.abs(e.amount), 0));
    const computed = round2(Math.max(0, l.amount - paid));
    const remaining = l.closed ? 0 : l.remainingOverride ?? computed;
    const status: LoanStatus = remaining <= 0.5 ? 'repaid' : l.dueDate && l.dueDate < now ? 'overdue' : 'open';

    let monthlyPayment: number | null = null;
    if (l.direction === 'taken') {
      const byMonth = new Map<string, number>();
      for (const e of entries.filter((x) => x.kind === 'payment' && x.source === 'bank')) {
        byMonth.set(monthOf(e.date), (byMonth.get(monthOf(e.date)) ?? 0) + Math.abs(e.amount));
      }
      const recent = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3).map(([, v]) => v);
      monthlyPayment = recent.length >= 2 ? round2(median(recent)) : null;
    }

    return {
      id: l.id,
      direction: l.direction,
      counterparty: l.counterparty,
      amount: l.amount,
      startDate: l.startDate ?? null,
      dueDate: l.dueDate ?? null,
      note: l.note ?? null,
      closed: l.closed,
      remainingOverride: l.remainingOverride ?? null,
      paid,
      remaining: round2(remaining),
      status,
      daysFromDue: l.dueDate ? diffDays(now, l.dueDate) : null,
      monthlyPayment,
      autoMatch: !!l.matchKey,
      entries,
    };
  });
}

async function list(direction: LoanDirection): Promise<LoanDto[]> {
  const loans = await Loan.findAll({ where: { direction }, order: [['createdAt', 'DESC']] });
  const dtos = await toDtos(loans);
  const order: Record<LoanStatus, number> = { overdue: 0, open: 1, repaid: 2 };
  return dtos.sort((a, b) => order[a.status] - order[b.status] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}

async function get(id: number): Promise<LoanDto | null> {
  const loan = await Loan.findByPk(id);
  return loan ? (await toDtos([loan]))[0] : null;
}

async function create(input: LoanInput): Promise<LoanDto> {
  const loan = await Loan.create({
    direction: input.direction,
    counterparty: input.counterparty.trim(),
    amount: Math.abs(input.amount),
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    note: input.note?.trim() || null,
    remainingOverride: input.remainingOverride ?? null,
    closed: input.closed ?? false,
    matchKey: input.matchDescription ? descriptionKey(input.matchDescription) : null,
    matchAmount: input.matchAmount ?? null,
  });
  if (input.principalTransactionId) {
    await TransactionRecord.update({ loanId: loan.id }, { where: { id: input.principalTransactionId, loanId: null } });
  }
  await autoLink();
  return (await get(loan.id))!;
}

async function update(id: number, input: Partial<LoanInput>): Promise<LoanDto | null> {
  const loan = await Loan.findByPk(id);
  if (!loan) return null;
  if (input.counterparty !== undefined) loan.counterparty = input.counterparty.trim();
  if (input.amount !== undefined) loan.amount = Math.abs(input.amount);
  if (input.startDate !== undefined) loan.startDate = input.startDate;
  if (input.dueDate !== undefined) loan.dueDate = input.dueDate;
  if (input.note !== undefined) loan.note = input.note?.trim() || null;
  if (input.remainingOverride !== undefined) loan.remainingOverride = input.remainingOverride;
  if (input.closed !== undefined) loan.closed = input.closed;
  await loan.save();
  return get(id);
}

async function remove(id: number): Promise<boolean> {
  await TransactionRecord.update({ loanId: null }, { where: { loanId: id } });
  await LoanPayment.destroy({ where: { loanId: id } });
  return (await Loan.destroy({ where: { id } })) > 0;
}

/**
 * שיוך אוטומטי של תשלומים קבועים להלוואות שהוגדר להן תיאור תשלום (רץ אחרי כל סנכרון).
 * רק חיובים להלוואה שלקחתי / זיכויים להלוואה שנתתי, מתאריך ההלוואה, ובסכום אם הוגדר.
 */
async function autoLink(): Promise<number> {
  const all = await Loan.findAll({ where: { matchKey: { [Op.ne]: null }, closed: false } });
  if (!all.length) return 0;
  // הלוואות עם סכום מוגדר קודם: כשלשתי הלוואות אותו תיאור (שני תיקי משכנתא), הסכום המדויק מכריע
  const loans = [...all].sort((a, b) => (a.matchAmount === null ? 1 : 0) - (b.matchAmount === null ? 1 : 0));
  const txns = await TransactionRecord.findAll({ where: { loanId: null, savingsId: null, internalTransfer: false, cardPaymentForAccountId: null } });
  const used = new Set<number>();
  let linked = 0;
  for (const loan of loans) {
    const ids = txns
      .filter((t) => !used.has(t.id))
      .filter((t) => (loan.direction === 'taken' ? t.chargedAmount < 0 : t.chargedAmount > 0))
      .filter((t) => !loan.startDate || t.date >= loan.startDate)
      .filter((t) => loan.matchAmount === null || Math.abs(Math.abs(t.chargedAmount) - loan.matchAmount) < 1)
      .filter((t) => descriptionKey(t.description) === loan.matchKey)
      .map((t) => t.id);
    if (!ids.length) continue;
    ids.forEach((id) => used.add(id));
    await TransactionRecord.update({ loanId: loan.id }, { where: { id: { [Op.in]: ids }, loanId: null } });
    linked += ids.length;
  }
  return linked;
}

async function link(loanId: number, transactionId: number): Promise<boolean> {
  if (!(await Loan.findByPk(loanId))) return false;
  const [count] = await TransactionRecord.update({ loanId }, { where: { id: transactionId } });
  return count > 0;
}

async function unlink(transactionId: number): Promise<boolean> {
  const [count] = await TransactionRecord.update({ loanId: null }, { where: { id: transactionId } });
  return count > 0;
}

async function addPayment(loanId: number, date: string, amount: number, note: string | null): Promise<boolean> {
  if (!(await Loan.findByPk(loanId))) return false;
  await LoanPayment.create({ loanId, date, amount: Math.abs(amount), note: note?.trim() || null });
  return true;
}

async function removePayment(paymentId: number): Promise<boolean> {
  return (await LoanPayment.destroy({ where: { id: paymentId } })) > 0;
}

/** עסקאות שאולי שייכות להלוואה: שם הצד השני מופיע בתיאור, מאז תחילת ההלוואה */
async function candidates(loanId: number): Promise<LoanCandidate[]> {
  const loan = await Loan.findByPk(loanId);
  if (!loan) return [];
  const tokens = nameTokens(loan.counterparty);
  const from = loan.startDate ? addDays(loan.startDate, -7) : '0000-00-00';
  const [txns, accounts] = await Promise.all([
    TransactionRecord.findAll({ where: { loanId: null, internalTransfer: false, cardPaymentForAccountId: null, date: { [Op.gte]: from } }, order: [['date', 'DESC']] }),
    Account.findAll(),
  ]);
  const accName = new Map(accounts.map((a) => [a.id, a.label || a.accountNumber]));
  const out: LoanCandidate[] = [];
  for (const t of txns) {
    const text = `${t.description} ${t.memo ?? ''}`;
    const byName = matchesName(tokens, text);
    const sameAmount = Math.abs(Math.abs(t.chargedAmount) - loan.amount) < 0.005 && LOAN_WORD.test(text);
    if (!byName && !sameAmount) continue;
    out.push({
      id: t.id,
      date: t.date,
      amount: round2(t.chargedAmount),
      name: merchantName(t.description, t.memo),
      accountName: accName.get(t.accountId) ?? '',
      reason: byName ? 'השם מופיע בתנועה' : 'אותו סכום ומוזכרת הלוואה',
    });
  }
  return out.slice(0, 20);
}

/** תנועות שנראות כמו הלוואה ועוד לא נרשמו */
async function suggestions(direction: LoanDirection): Promise<LoanSuggestion[]> {
  const [txns, accounts] = await Promise.all([
    TransactionRecord.findAll({ where: { loanId: null, internalTransfer: false, cardPaymentForAccountId: null }, order: [['date', 'DESC']] }),
    Account.findAll(),
  ]);
  const kinds = new Map(accounts.map((a) => [a.id, a.kind]));
  return txns
    .filter((t) => {
      if (kinds.get(t.accountId) === 'card') return false;
      const text = `${t.description} ${t.memo ?? ''}`;
      if (!LOAN_WORD.test(text) || /החזר/.test(text)) return false;
      if (direction === 'taken') return t.chargedAmount >= 1000;
      return t.chargedAmount <= -500 && !OWN_LOAN_DEBIT.test(t.description);
    })
    .map((t): LoanSuggestion => ({ transactionId: t.id, counterparty: payeeOf(t), amount: Math.abs(round2(t.chargedAmount)), date: t.date, monthly: null }))
    .slice(0, 10)
    .concat(direction === 'taken' ? await recurringLoanSuggestions() : []);
}

/** חיובים חודשיים קבועים שנראים כמו החזר הלוואה (משכנתא, גמ"ח, הו"ק הלוואה) ועוד לא רשומים כהלוואה */
async function recurringLoanSuggestions(): Promise<LoanSuggestion[]> {
  const [items, loans] = await Promise.all([
    RecurringItem.findAll({ where: { status: 'active', direction: 'debit' } }),
    Loan.findAll({ where: { direction: 'taken' } }),
  ]);
  const known = loans.map((l) => nameTokens(l.counterparty));
  return items
    .filter((i) => /הלוא|הלווא|גמ"?ח|משכנ|טפחות/.test(i.displayName))
    .filter((i) => !known.some((tokens) => matchesName(tokens, i.displayName)))
    .map((i) => ({ transactionId: null, counterparty: i.displayName, amount: 0, date: i.firstSeenDate ?? '', monthly: round2(i.userAmount ?? i.expectedAmount), matchDescription: i.displayName }));
}

/** שם הצד השני: "העברה לחנה כהן" → "חנה כהן" */
function payeeOf(t: TransactionRecord): string {
  const fromMemo = /(לטובת|המבצע):\s*([^.]+)/.exec(t.memo ?? '');
  if (fromMemo) return fromMemo[2].replace(/\s+/g, ' ').trim();
  return merchantName(t.description, t.memo).replace(/^העברה (ל|מ)/, '').trim();
}

/** מזהי עסקאות שמקושרות להלוואה, עם הכיוון והשם — לסיכומי החודש ולמעשרות */
async function linkedMap(): Promise<Map<number, { direction: LoanDirection; counterparty: string }>> {
  const loans = await Loan.findAll({ attributes: ['id', 'direction', 'counterparty'] });
  if (!loans.length) return new Map();
  const byId = new Map(loans.map((l) => [l.id, l]));
  const txns = await TransactionRecord.findAll({ attributes: ['id', 'loanId'], where: { loanId: { [Op.ne]: null } } });
  const map = new Map<number, { direction: LoanDirection; counterparty: string }>();
  for (const t of txns) {
    const l = t.loanId !== null ? byId.get(t.loanId) : undefined;
    if (l) map.set(t.id, { direction: l.direction, counterparty: l.counterparty });
  }
  return map;
}

export const loansService = { list, get, create, update, remove, link, unlink, addPayment, removePayment, candidates, suggestions, linkedMap, autoLink };
