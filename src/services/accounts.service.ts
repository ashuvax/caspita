import { Op } from 'sequelize';
import { Account, type AccountKind, type LinkSource } from '../models/account.model';
import { BankConfig } from '../models/bank-config.model';
import { CARD_BANK_KEYWORDS } from '../config/companies.config';
import { TransactionRecord } from '../models/transaction.model';
import { addMonths, currentMonth, diffDays, today } from '../utils/dates';
import { round2 } from '../utils/text';

export interface AccountDto {
  id: number;
  bankConfigId: number;
  bankName: string;
  companyId: string;
  accountNumber: string;
  kind: AccountKind;
  label: string | null;
  displayName: string;
  balance: number | null;
  balanceUpdatedAt: Date | null;
  paysFromAccountId: number | null;
  paysFromSource: LinkSource | null;
  chargeDay: number | null;
  isHidden: boolean;
}

export function accountDisplayName(account: Account, config?: BankConfig): string {
  if (account.label) return account.label;
  const suffix = account.kind === 'card' ? `כרטיס ${account.accountNumber}` : account.accountNumber;
  return config ? `${config.displayName} · ${suffix}` : suffix;
}

async function getAll(): Promise<AccountDto[]> {
  const [accounts, configs] = await Promise.all([Account.findAll({ order: [['kind', 'ASC'], ['id', 'ASC']] }), BankConfig.findAll()]);
  const byId = new Map(configs.map((c) => [c.id, c]));
  return accounts
    .filter((a) => byId.has(a.bankConfigId))
    .map((a) => {
      const config = byId.get(a.bankConfigId)!;
      return {
        id: a.id,
        bankConfigId: a.bankConfigId,
        bankName: config.displayName,
        companyId: config.companyId,
        accountNumber: a.accountNumber,
        kind: a.kind,
        label: a.label,
        displayName: accountDisplayName(a, config),
        balance: a.balance,
        balanceUpdatedAt: a.balanceUpdatedAt,
        paysFromAccountId: a.paysFromAccountId,
        paysFromSource: a.paysFromSource,
        chargeDay: a.chargeDay,
        isHidden: a.isHidden,
      };
    });
}

export interface AccountUpdate {
  label?: string | null;
  paysFromAccountId?: number | null;
  chargeDay?: number | null;
  isHidden?: boolean;
}

async function update(id: number, data: AccountUpdate): Promise<boolean> {
  const account = await Account.findByPk(id);
  if (!account) return false;
  const changes: Partial<Account> = {};
  if (data.label !== undefined) changes.label = data.label?.trim() || null;
  if (data.isHidden !== undefined) changes.isHidden = data.isHidden;
  if (data.chargeDay !== undefined) changes.chargeDay = data.chargeDay;
  if (data.paysFromAccountId !== undefined) {
    changes.paysFromAccountId = data.paysFromAccountId;
    // בחירה ידנית נשמרת; ניקוי מחזיר לזיהוי אוטומטי
    changes.paysFromSource = data.paysFromAccountId === null ? null : 'manual';
  }
  await account.update(changes);
  await detectCardLinks();
  return true;
}

interface CardCharge {
  date: string;
  /** סכום חיובי */
  amount: number;
}

/** סכומי החיוב החודשי של כרטיס, לפי תאריך החיוב */
function chargesOf(txns: TransactionRecord[]): CardCharge[] {
  const map = new Map<string, number>();
  for (const t of txns) map.set(t.processedDate, (map.get(t.processedDate) ?? 0) + t.chargedAmount);
  return [...map.entries()]
    .map(([date, sum]) => ({ date, amount: round2(-sum) }))
    .filter((c) => c.amount > 0);
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, a * 0.005);
}

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * מזהה מאיזה חשבון בנק יורד כל כרטיס: משווה את סכום החיוב החודשי של הכרטיס
 * לחיובים בחשבונות הבנק סביב תאריך החיוב. עסקאות הבנק שזוהו מסומנות כ"תשלום כרטיס"
 * כדי שלא ייספרו פעמיים בהוצאות.
 */
async function detectCardLinks(): Promise<void> {
  const accounts = await Account.findAll();
  const cards = accounts.filter((a) => a.kind === 'card');
  const banks = accounts.filter((a) => a.kind === 'bank');
  if (cards.length === 0) return;

  const from = `${addMonths(currentMonth(), -12)}-01`;
  const now = today();
  const bankTxns = banks.length
    ? await TransactionRecord.findAll({
        where: { accountId: { [Op.in]: banks.map((b) => b.id) }, date: { [Op.gte]: from }, chargedAmount: { [Op.lt]: 0 } },
      })
    : [];

  await TransactionRecord.update({ cardPaymentForAccountId: null }, { where: { cardPaymentForAccountId: { [Op.ne]: null } } });

  const cardTxns = await TransactionRecord.findAll({
    where: { accountId: { [Op.in]: cards.map((c) => c.id) }, processedDate: { [Op.gte]: from, [Op.lte]: now } },
  });
  const chargesByCard = new Map<number, CardCharge[]>();
  for (const card of cards) chargesByCard.set(card.id, chargesOf(cardTxns.filter((t) => t.accountId === card.id)));

  // חיוב מאוחד לכמה כרטיסים מאותה חברה (חלק מהחברות מחייבות סכום אחד)
  const aggregatedByConfig = new Map<number, CardCharge[]>();
  for (const configId of new Set(cards.map((c) => c.bankConfigId))) {
    const ids = new Set(cards.filter((c) => c.bankConfigId === configId).map((c) => c.id));
    aggregatedByConfig.set(configId, chargesOf(cardTxns.filter((t) => ids.has(t.accountId))));
  }

  const used = new Set<number>();
  const markings = new Map<number, number>(); // bankTxnId -> cardId

  for (const card of cards) {
    const charges = chargesByCard.get(card.id) ?? [];
    const aggregated = aggregatedByConfig.get(card.bankConfigId) ?? [];
    const candidates = card.paysFromAccountId && card.paysFromSource === 'manual' ? banks.filter((b) => b.id === card.paysFromAccountId) : banks;
    const votes = new Map<number, number>();
    const matchedDays: number[] = [];

    for (const charge of [...charges, ...aggregated]) {
      const match = bankTxns.find(
        (t) =>
          !used.has(t.id) &&
          candidates.some((b) => b.id === t.accountId) &&
          Math.abs(diffDays(t.date, charge.date)) <= 3 &&
          amountsMatch(-t.chargedAmount, charge.amount)
      );
      if (!match) continue;
      used.add(match.id);
      markings.set(match.id, card.id);
      votes.set(match.accountId, (votes.get(match.accountId) ?? 0) + 1);
      matchedDays.push(Number(charge.date.slice(8, 10)));
    }

    const changes: Partial<Account> = {};
    if (card.paysFromSource !== 'manual') {
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) {
        changes.paysFromAccountId = best[0];
        changes.paysFromSource = 'auto';
      } else if (banks.length === 1) {
        // חשבון בנק יחיד — סביר שממנו
        changes.paysFromAccountId = banks[0].id;
        changes.paysFromSource = 'auto';
      }
    }
    if (!card.chargeDay) {
      const day = mode(matchedDays) ?? mode(charges.map((c) => Number(c.date.slice(8, 10))));
      if (day) changes.chargeDay = day;
    }
    if (Object.keys(changes).length) await card.update(changes);
  }

  // מעבר שני: כרטיס מקושר — חיוב בבנק סביב תאריך החיוב ששמו תואם לחברת האשראי, גם אם הסכום שונה מעט
  // (עסקאות ממתינות, הפרשי שער, עמלות)
  const configs = await BankConfig.findAll();
  const companyOf = new Map(configs.map((c) => [c.id, c.companyId]));
  const refreshed = await Account.findAll({ where: { kind: 'card' } });
  for (const card of refreshed) {
    const keyword = CARD_BANK_KEYWORDS[companyOf.get(card.bankConfigId) ?? ''];
    if (!keyword || !card.paysFromAccountId) continue;
    for (const charge of chargesByCard.get(card.id) ?? []) {
      const near = bankTxns
        .filter(
          (t) =>
            !used.has(t.id) &&
            t.accountId === card.paysFromAccountId &&
            Math.abs(diffDays(t.date, charge.date)) <= 3 &&
            keyword.test(t.description) &&
            Math.abs(-t.chargedAmount - charge.amount) <= Math.max(50, charge.amount * 0.15)
        )
        .sort((a, b) => Math.abs(-a.chargedAmount - charge.amount) - Math.abs(-b.chargedAmount - charge.amount))[0];
      if (!near) continue;
      used.add(near.id);
      markings.set(near.id, card.id);
    }
  }

  for (const [txnId, cardId] of markings) {
    await TransactionRecord.update({ cardPaymentForAccountId: cardId }, { where: { id: txnId } });
  }
}

/** מספר החשבון בלי אפסים מובילים, מהקטע האחרון (12-345-678901 → 678901) */
function accountCore(accountNumber: string): string | null {
  const last = accountNumber.split(/[^0-9]+/).filter(Boolean).pop() ?? '';
  const core = last.replace(/^0+/, '');
  return core.length >= 6 ? core : null;
}

/**
 * מזהה העברות בין חשבונות הבנק של המשתמש:
 *  - התיאור/הפרטים מזכירים מספר של חשבון אחר שלו, או
 *  - "העברה" באותו סכום בדיוק שיצאה מחשבון אחד ונכנסה לשני תוך יומיים.
 * העברות כאלה לא נספרות כהכנסה (מעשרות) ולא כהוצאה, אבל כן נשארות בתחזית של כל חשבון.
 */
export const INVESTMENT_PATTERN = /ני"?ע-?\s*(קני|מכיר)|קניית ני"?ע|מכירת ני"?ע/;

async function detectInternalTransfers(): Promise<void> {
  const banks = await Account.findAll({ where: { kind: 'bank' } });
  await TransactionRecord.update({ internalTransfer: false }, { where: { internalTransfer: true } });
  if (banks.length === 0) return;

  const cores = banks.map((b) => ({ id: b.id, core: accountCore(b.accountNumber) }));
  const txns = await TransactionRecord.findAll({ where: { accountId: { [Op.in]: banks.map((b) => b.id) } } });
  const internal = new Set<number>();

  // קניה/מכירה של ניירות ערך — כסף שעובר להשקעה ובחזרה, לא הוצאה ולא הכנסה (דיבידנד כן הכנסה)
  for (const t of txns) {
    if (INVESTMENT_PATTERN.test(t.description)) internal.add(t.id);
  }

  for (const t of txns) {
    const digits = `${t.description} ${t.memo ?? ''}`.replace(/[^0-9]+/g, ' ');
    const mentionsOther = cores.some((c) => c.id !== t.accountId && c.core && digits.split(' ').some((d) => d.endsWith(c.core!)));
    if (mentionsOther) internal.add(t.id);
  }

  const isTransfer = (t: TransactionRecord): boolean => /העברה|הפקדה|העב/.test(`${t.description} ${t.memo ?? ''}`);
  const debits = txns.filter((t) => t.chargedAmount < 0);
  const credits = txns.filter((t) => t.chargedAmount > 0);
  const pairedCredits = new Set<number>();
  for (const d of debits) {
    const match = credits.find(
      (c) =>
        !pairedCredits.has(c.id) &&
        c.accountId !== d.accountId &&
        Math.abs(c.chargedAmount + d.chargedAmount) < 0.01 &&
        Math.abs(diffDays(c.date, d.date)) <= 2 &&
        (isTransfer(c) || isTransfer(d) || internal.has(c.id) || internal.has(d.id))
    );
    if (!match) continue;
    pairedCredits.add(match.id);
    internal.add(d.id);
    internal.add(match.id);
  }

  if (internal.size) await TransactionRecord.update({ internalTransfer: true }, { where: { id: { [Op.in]: [...internal] } } });
}

export const accountsService = { getAll, update, detectCardLinks, detectInternalTransfers };
