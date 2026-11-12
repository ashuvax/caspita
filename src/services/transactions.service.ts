import { Op, type WhereOptions } from 'sequelize';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { BankConfig } from '../models/bank-config.model';
import { type GroupedMerchant, type GroupedResult, type Insight, type TransactionDto } from '../types/transaction.types';
import { addMonths, currentMonth, daysInMonth, today } from '../utils/dates';
import { descriptionKey, median, merchantName, round2 } from '../utils/text';
import { maaserService } from './maaser.service';
import { syncService } from './sync.service';
import { categoriesService, merchantKey } from './categories.service';
import { loansService } from './loans.service';
import { savingsService } from './savings.service';
import { TransactionSplit } from '../models/split.model';
import { TransactionTag } from '../models/tag.model';
import { rulesService } from './rules.service';
import { CASH_WITHDRAWAL, walletService } from './wallet.service';

/** זיכוי שמזכיר הלוואה: הלוואה שלקחתי או החזר של הלוואה שנתתי. כסף שצריך להחזיר / שחזר — לא הכנסה */
const LOAN_CREDIT = /הלוא|הלווא/;

async function getMonthTransactions(month: string): Promise<TransactionDto[]> {
  return loadTransactions({ date: { [Op.like]: `${month}-%` } });
}

/** כל העסקאות מחודש from עד חודש to (כולל) — לגרפים לאורך זמן */
async function getRangeTransactions(fromMonth: string, toMonth: string): Promise<TransactionDto[]> {
  return loadTransactions({ date: { [Op.gte]: `${fromMonth}-01`, [Op.lt]: `${addMonths(toMonth, 1)}-01` } });
}

/** עסקאות לפי מזהים (תגית, חיפוש) */
async function getByIds(ids: number[]): Promise<TransactionDto[]> {
  if (!ids.length) return [];
  return loadTransactions({ id: { [Op.in]: ids } });
}

async function loadTransactions(where: WhereOptions<TransactionRecord>): Promise<TransactionDto[]> {
  const [txns, accounts, configs, ctx, catMap, loanLinks, savingsLinks, splitRows, tagRows, matchRule, cashCover] = await Promise.all([
    TransactionRecord.findAll({ where, order: [['date', 'DESC']] }),
    Account.findAll(),
    BankConfig.findAll(),
    maaserService.loadContext(),
    categoriesService.merchantMap(),
    loansService.linkedMap(),
    savingsService.linkedMap(),
    TransactionSplit.findAll(),
    TransactionTag.findAll(),
    rulesService.matcher(),
    walletService.coverage(),
  ]);
  const splitsByTxn = new Map<number, TransactionDto['splits']>();
  for (const s of splitRows) {
    splitsByTxn.set(s.transactionId, [...(splitsByTxn.get(s.transactionId) ?? []), { categoryId: s.categoryId, amount: s.amount, note: s.note ?? null }]);
  }
  const tagsByTxn = new Map<number, number[]>();
  for (const l of tagRows) tagsByTxn.set(l.transactionId, [...(tagsByTxn.get(l.transactionId) ?? []), l.tagId]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const configById = new Map(configs.map((c) => [c.id, c]));

  return txns
    .filter((t) => {
      const acc = accountById.get(t.accountId);
      return acc && !acc.isHidden && configById.has(t.bankConfigId);
    })
    .map((t) => {
      const acc = accountById.get(t.accountId)!;
      const isCashWithdrawal = acc.kind !== 'cash' && t.chargedAmount < 0 && CASH_WITHDRAWAL.test(t.description);
      const rule = t.categoryOverrideId === null ? matchRule(t) : null;
      return {
        id: t.id,
        date: t.date,
        processedDate: t.processedDate,
        originalAmount: t.originalAmount,
        originalCurrency: t.originalCurrency,
        chargedAmount: t.chargedAmount,
        description: t.description,
        memo: t.memo,
        type: t.type,
        status: t.status,
        installmentNumber: t.installmentNumber,
        installmentTotal: t.installmentTotal,
        bankName: configById.get(t.bankConfigId)!.displayName,
        accountId: t.accountId,
        accountNumber: acc.accountNumber,
        accountKind: acc.kind,
        isCardPayment: t.cardPaymentForAccountId !== null,
        isInternalTransfer: t.internalTransfer,
        offsetNote: ctx.offsetCredits.get(t.id) ?? ctx.offsetDebits.get(t.id) ?? null,
        ...loanFields(t.chargedAmount, loanLinks.get(t.id)),
        savingsNote: savingsLinks.has(t.id) ? `${t.chargedAmount < 0 ? 'הפקדה ל' : 'משיכה מ'}${savingsLinks.get(t.id)} — חיסכון, לא הוצאה` : null,
        isLoanCredit: t.chargedAmount > 0 && acc.kind !== 'card' && t.maaserOverride !== 'include' && LOAN_CREDIT.test(`${t.description} ${t.memo ?? ''}`),
        maaserOverride: t.maaserOverride,
        maaserRole: maaserService.roleOf(t, ctx),
        maaserNote: maaserService.reasonOf(t, ctx),
        // ידני לעסקה ← כלל ← הספק. משיכת מזומן בלי פירוט נשארת בלי קטגוריה
        categoryId: t.categoryOverrideId ?? rule?.categoryId ?? (isCashWithdrawal ? null : catMap.get(merchantKey(t.description, t.memo)) ?? null),
        categoryOverridden: t.categoryOverrideId !== null,
        ruleId: rule?.id ?? null,
        splits: splitsByTxn.get(t.id) ?? [],
        tagIds: tagsByTxn.get(t.id) ?? [],
        isCashWithdrawal,
        cashCovered: cashCover.byWithdrawal.get(t.id) ?? 0,
        sourceCategory: t.category,
      };
    });
}

/**
 * הלוואה שנתתי: גם הקרן וגם ההחזרים לא נספרים (הכסף יצא וחוזר).
 * הלוואה שלקחתי: הקרן שנכנסה לא נספרת כהכנסה; התשלומים החודשיים כן נספרים כהוצאה (יוצא כסף כל חודש).
 */
function loanFields(amount: number, link: { direction: 'given' | 'taken'; counterparty: string } | undefined): Pick<TransactionDto, 'loanNote' | 'loanExcluded'> {
  if (!link) return { loanNote: null, loanExcluded: false };
  const name = link.counterparty;
  if (link.direction === 'given') {
    return { loanNote: amount < 0 ? `הלוואה ל${name} — לא הוצאה` : `החזר הלוואה מ${name} — לא הכנסה`, loanExcluded: true };
  }
  return amount > 0 ? { loanNote: `הלוואה מ${name} — לא הכנסה`, loanExcluded: true } : { loanNote: `תשלום על הלוואה מ${name}`, loanExcluded: false };
}

function groupByMerchant(transactions: TransactionDto[]): GroupedMerchant[] {
  const map = new Map<string, TransactionDto[]>();
  for (const txn of transactions) {
    const name = merchantName(txn.description, txn.memo) || 'לא ידוע';
    const list = map.get(name) ?? [];
    list.push(txn);
    map.set(name, list);
  }
  return [...map.entries()]
    .map(([name, txns]) => ({
      name,
      totalAmount: round2(txns.reduce((sum, t) => sum + t.chargedAmount, 0)),
      transactionCount: txns.length,
      maaserCount: txns.filter((t) => t.maaserRole === 'donation').length,
      categoryId: txns.find((t) => !t.categoryOverridden)?.categoryId ?? null,
      transactions: txns,
    }))
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
}

/** חלוקת עסקה לקטגוריות: הפיצולים, והשארית בקטגוריה של העסקה. הסכומים בסימן של העסקה */
function categoryPortions(t: Pick<TransactionDto, 'chargedAmount' | 'categoryId' | 'splits' | 'cashCovered'>): { categoryId: number | null; amount: number }[] {
  if (!t.splits.length && !t.cashCovered) return [{ categoryId: t.categoryId, amount: t.chargedAmount }];
  const sign = t.chargedAmount < 0 ? -1 : 1;
  // החלק של משיכת מזומן שכבר נרשם כהוצאות מזומן — נספר שם, לא כאן
  let rest = Math.max(0, Math.abs(t.chargedAmount) - t.cashCovered);
  const out: { categoryId: number | null; amount: number }[] = [];
  for (const s of t.splits) {
    const part = Math.min(s.amount, rest);
    rest -= part;
    out.push({ categoryId: s.categoryId, amount: sign * part });
  }
  if (rest > 0.005) out.push({ categoryId: t.categoryId, amount: sign * rest });
  return out;
}

/** הוצאות נטו לכל קטגוריה (זיכויים בכרטיס כמו החזרים מקטינים את ההוצאה) */
function categoryMap(txns: TransactionDto[]): Map<number | null, { expenses: number; count: number }> {
  const map = new Map<number | null, { expenses: number; count: number }>();
  for (const t of txns) {
    // הכנסות לבנק לא נכנסות לפילוח ההוצאות
    if (t.chargedAmount > 0 && t.accountKind !== 'card') continue;
    for (const p of categoryPortions(t)) {
      const e = map.get(p.categoryId) ?? { expenses: 0, count: 0 };
      e.expenses -= p.amount;
      e.count++;
      map.set(p.categoryId, e);
    }
  }
  return map;
}

function isCounted(t: TransactionDto): boolean {
  // זוג מקוזז הוא לא הוצאה ולא הכנסה — הכסף יצא וחזר (או עבר דרכי)
  return !t.isCardPayment && !t.isInternalTransfer && !t.offsetNote && !t.isLoanCredit && !t.loanExcluded && !t.savingsNote;
}

function sumExpenses(txns: TransactionDto[]): number {
  return round2(txns.filter((t) => t.chargedAmount < 0).reduce((s, t) => s - t.chargedAmount - t.cashCovered, 0));
}

function sumIncome(txns: TransactionDto[]): number {
  return round2(txns.filter((t) => t.chargedAmount > 0 && t.accountKind !== 'card').reduce((s, t) => s + t.chargedAmount, 0));
}

function fmt(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString('he-IL');
}

/** אם הקטגוריה עלתה/ירדה ביחס לממוצע מספיק כדי שיהיה מעניין */
const CHANGE_MIN_AMOUNT = 300;
const CHANGE_MIN_RATIO = 0.3;
const NEW_MERCHANT_MIN = 200;

async function getGrouped(month: string): Promise<GroupedResult> {
  const prevMonths = [1, 2, 3].map((i) => addMonths(month, -i));
  const [txns, ...prevTxns] = await Promise.all([getMonthTransactions(month), ...prevMonths.map((m) => getMonthTransactions(m))]);
  const [cats, olderKeys] = await Promise.all([categoriesService.list(), merchantKeysBefore(month, 6)]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const catBudget = new Map(cats.map((c) => [c.id, c.monthlyBudget]));

  const counted = txns.filter(isCounted);
  const prevCounted = prevTxns.map((list) => list.filter(isCounted));
  // ממוצע רק על חודשים שיש בהם נתונים (בתחילת ההיסטוריה)
  const prevWithData = prevCounted.filter((list) => list.length > 0);

  const cur = categoryMap(counted);
  const prevMaps = prevWithData.map(categoryMap);
  const allCatIds = new Set<number | null>([...cur.keys(), ...prevMaps.flatMap((m) => [...m.keys()])]);
  const byCategory = [...allCatIds]
    .map((categoryId) => {
      const e = cur.get(categoryId) ?? { expenses: 0, count: 0 };
      const prevs = prevMaps.map((m) => m.get(categoryId)?.expenses ?? 0);
      return {
        categoryId,
        expenses: round2(e.expenses),
        count: e.count,
        prevExpenses: round2(prevMaps[0]?.get(categoryId)?.expenses ?? 0),
        // חציון ולא ממוצע — חודש חריג אחד (פירעון הלוואה, קניה גדולה) לא מעוות את ההשוואה
        avgExpenses: prevs.length ? round2(median(prevs)) : 0,
        budget: categoryId === null ? null : catBudget.get(categoryId) ?? null,
      };
    })
    .filter((c) => c.expenses > 0 || c.avgExpenses > 0 || c.budget)
    .sort((a, b) => b.expenses - a.expenses || b.avgExpenses - a.avgExpenses);

  const expenses = sumExpenses(counted);
  const income = sumIncome(counted);
  const isCurrentMonth = month === currentMonth();
  const dim = daysInMonth(month);
  const daysElapsed = isCurrentMonth ? Number(today().slice(8, 10)) : dim;

  const insights: Insight[] = [];
  const net = round2(income - expenses);
  if (!isCurrentMonth && (income > 0 || expenses > 0)) {
    insights.push(
      net >= 0
        ? { kind: 'surplus', amount: net, text: `נשארו ${fmt(net)} ₪ — נכנס יותר ממה שיצא` }
        : { kind: 'deficit', amount: net, text: `יצא ${fmt(net)} ₪ יותר ממה שנכנס החודש` }
    );
  }
  if (prevWithData.length) {
    const avgTotal = median(prevWithData.map(sumExpenses));
    if (isCurrentMonth && avgTotal > 0) {
      const pct = Math.round((expenses / avgTotal) * 100);
      insights.push({
        kind: 'pace',
        amount: expenses,
        text: `עברו ${daysElapsed} מתוך ${dim} ימים, והוצאת ${fmt(expenses)} ₪ — ${pct}% מחודש רגיל (${fmt(avgTotal)} ₪)`,
      });
    }
    // קטגוריות שזזו — בחודש שהסתיים בלבד, אחרת ההשוואה לא הוגנת
    if (!isCurrentMonth) {
      for (const c of byCategory) {
        if (c.categoryId === null || c.avgExpenses <= 0) continue;
        const diff = c.expenses - c.avgExpenses;
        if (Math.abs(diff) < CHANGE_MIN_AMOUNT || Math.abs(diff) / c.avgExpenses < CHANGE_MIN_RATIO) continue;
        const name = catName.get(c.categoryId) ?? '';
        insights.push(
          diff > 0
            ? { kind: 'category_up', categoryId: c.categoryId, amount: diff, text: `${name}: ${fmt(c.expenses)} ₪ — ${fmt(diff)} ₪ יותר מהרגיל` }
            : { kind: 'category_down', categoryId: c.categoryId, amount: diff, text: `${name}: ${fmt(c.expenses)} ₪ — ${fmt(diff)} ₪ פחות מהרגיל` }
        );
      }
    }
  }
  // תקציבים: חריגה, או קצב מהיר מדי בחודש הנוכחי
  for (const c of byCategory) {
    if (!c.budget || c.categoryId === null) continue;
    const name = catName.get(c.categoryId) ?? '';
    if (c.expenses > c.budget) {
      insights.push({ kind: 'budget', categoryId: c.categoryId, amount: c.expenses - c.budget, text: `${name}: עברת את התקציב ב-${fmt(c.expenses - c.budget)} ₪ (${fmt(c.expenses)} מתוך ${fmt(c.budget)})` });
    } else if (isCurrentMonth) {
      const pace = (c.budget * daysElapsed) / dim;
      if (c.expenses > pace * 1.15 && c.expenses > c.budget * 0.25) {
        insights.push({ kind: 'budget', categoryId: c.categoryId, amount: c.expenses - pace, text: `${name}: הוצאת ${Math.round((c.expenses / c.budget) * 100)}% מהתקציב, ועברו רק ${Math.round((daysElapsed / dim) * 100)}% מהחודש` });
      }
    }
  }
  const merchants = groupByMerchant(counted);
  for (const m of merchants) {
    if (m.totalAmount > -NEW_MERCHANT_MIN) continue;
    if (olderKeys.size && !olderKeys.has(looseKey(m.name))) {
      insights.push({ kind: 'new_merchant', merchant: m.name, amount: m.totalAmount, text: `ספק חדש: ${m.name} — ${fmt(m.totalAmount)} ₪` });
    }
  }
  const largest = counted.filter((t) => t.chargedAmount < 0).sort((a, b) => a.chargedAmount - b.chargedAmount)[0];
  if (largest) {
    insights.push({
      kind: 'largest',
      merchant: merchantName(largest.description, largest.memo),
      amount: largest.chargedAmount,
      text: `ההוצאה הגדולה ביותר: ${merchantName(largest.description, largest.memo)} — ${fmt(largest.chargedAmount)} ₪`,
    });
  }
  const order: Record<Insight['kind'], number> = { deficit: 0, budget: 1, pace: 2, surplus: 3, category_up: 4, new_merchant: 5, largest: 6, category_down: 7 };
  insights.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.amount) - Math.abs(a.amount));

  const hiddenTxns = txns.filter((t) => !isCounted(t));
  return {
    merchants,
    hidden: groupByMerchant(hiddenTxns),
    errors: await syncService.lastErrors(),
    scrapedAt: await syncService.lastSyncAt(),
    totals: {
      expenses,
      income,
      net,
      cardPayments: round2(txns.filter((t) => t.isCardPayment).reduce((s, t) => s - t.chargedAmount, 0)),
      internalTransfers: round2(txns.filter((t) => t.isInternalTransfer && t.chargedAmount < 0).reduce((s, t) => s - t.chargedAmount, 0)),
      loans: round2(txns.filter((t) => (t.isLoanCredit || t.loanExcluded) && !t.isInternalTransfer && !t.offsetNote).reduce((s, t) => s + Math.abs(t.chargedAmount), 0)),
      savings: round2(txns.filter((t) => t.savingsNote && t.chargedAmount < 0).reduce((s, t) => s - t.chargedAmount, 0)),
      offsets: round2(txns.filter((t) => t.offsetNote && !t.isInternalTransfer && !t.isCardPayment && t.chargedAmount < 0).reduce((s, t) => s - t.chargedAmount, 0)),
    },
    // בחודש הנוכחי משווים לאותה נקודה בחודש הקודם (עד אותו יום), אחרת ההשוואה תמיד "ירדה"
    previous: (() => {
      const prev = (prevCounted[0] ?? []).filter((t) => !isCurrentMonth || Number(t.date.slice(8, 10)) <= daysElapsed);
      return { expenses: sumExpenses(prev), income: sumIncome(prev) };
    })(),
    byCategory,
    insights: insights.slice(0, 7),
    isCurrentMonth,
    daysElapsed,
    daysInMonth: dim,
  };
}

/** מפתח "רופף" לזיהוי ספק חדש — בלי תאריכים, שעות ומספרי אסמכתא (כספומט 30/10 14:50 = אותו ספק) */
function looseKey(description: string): string {
  return descriptionKey(description.replace(/\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?/g, ' ').replace(/\d{1,2}:\d{2}/g, ' '));
}

/** מפתחות ספקים שהופיעו ב-N החודשים שלפני החודש (לזיהוי ספק חדש) */
async function merchantKeysBefore(month: string, months: number): Promise<Set<string>> {
  const rows = await TransactionRecord.findAll({
    attributes: ['description', 'memo'],
    where: { date: { [Op.gte]: `${addMonths(month, -months)}-01`, [Op.lt]: `${month}-01` } },
  });
  return new Set(rows.map((r) => looseKey(merchantName(r.description, r.memo))));
}

export const transactionsService = { getGrouped, getMonthTransactions, getRangeTransactions, getByIds };
export { isCounted, sumIncome, sumExpenses, categoryMap, categoryPortions };
