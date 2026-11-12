import { Op } from 'sequelize';
import { SavingsAccount, SavingsEntry, type SavingsKind } from '../models/savings.model';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { monthOf } from '../utils/dates';
import { descriptionKey, median, merchantName, round2 } from '../utils/text';

export interface SavingsMovement {
  id: number;
  source: 'bank' | 'manual';
  date: string;
  /** + הפקדה (נכנס לחיסכון), − משיכה */
  amount: number;
  label: string;
}

export interface SavingsDto {
  id: number;
  kind: SavingsKind;
  name: string;
  balance: number | null;
  balanceDate: string | null;
  penaltyPct: number | null;
  liquidDate: string | null;
  note: string | null;
  autoMatch: boolean;
  /** שווי משוער היום: יתרה ידועה + הפקדות שאחריה (או סכום כל ההפקדות) */
  value: number;
  /** כמה אפשר למשוך בפועל אחרי ניכוי */
  withdrawable: number;
  /** הפקדה חודשית טיפוסית מהבנק */
  monthlyDeposit: number | null;
  /** האם השווי מבוסס על יתרה שהוזנה (או רק על סכום ההפקדות שנרשמו) */
  basedOnBalance: boolean;
  movements: SavingsMovement[];
}

export interface SavingsInput {
  kind: SavingsKind;
  name: string;
  balance?: number | null;
  balanceDate?: string | null;
  penaltyPct?: number | null;
  liquidDate?: string | null;
  note?: string | null;
  matchDescription?: string | null;
  matchAmount?: number | null;
}

export interface SavingsCandidate {
  id: number;
  date: string;
  amount: number;
  name: string;
  accountName: string;
}

async function toDtos(list: SavingsAccount[]): Promise<SavingsDto[]> {
  const ids = list.map((s) => s.id);
  const [linked, entries] = await Promise.all([
    ids.length ? TransactionRecord.findAll({ where: { savingsId: { [Op.in]: ids } } }) : [],
    ids.length ? SavingsEntry.findAll({ where: { savingsId: { [Op.in]: ids } } }) : [],
  ]);
  return list.map((s) => {
    const movements: SavingsMovement[] = [
      // חיוב בבנק = הפקדה לחיסכון; זיכוי = משיכה
      ...linked.filter((t) => t.savingsId === s.id).map((t) => ({ id: t.id, source: 'bank' as const, date: t.date, amount: round2(-t.chargedAmount), label: merchantName(t.description, t.memo) })),
      ...entries.filter((e) => e.savingsId === s.id).map((e) => ({ id: e.id, source: 'manual' as const, date: e.date, amount: round2(e.amount), label: e.note || (e.amount >= 0 ? 'הפקדה' : 'משיכה') })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    const basedOnBalance = s.balance !== null && s.balance !== undefined;
    const after = basedOnBalance && s.balanceDate ? movements.filter((m) => m.date > (s.balanceDate ?? '')) : basedOnBalance ? [] : movements;
    const value = round2((basedOnBalance ? s.balance ?? 0 : 0) + after.reduce((sum, m) => sum + m.amount, 0));
    const withdrawable = round2(value * (1 - (s.penaltyPct ?? 0) / 100));

    const byMonth = new Map<string, number>();
    for (const m of movements.filter((x) => x.source === 'bank' && x.amount > 0)) byMonth.set(monthOf(m.date), (byMonth.get(monthOf(m.date)) ?? 0) + m.amount);
    const recent = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3).map(([, v]) => v);

    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      balance: s.balance ?? null,
      balanceDate: s.balanceDate ?? null,
      penaltyPct: s.penaltyPct ?? null,
      liquidDate: s.liquidDate ?? null,
      note: s.note ?? null,
      autoMatch: !!s.matchKey,
      value,
      withdrawable,
      monthlyDeposit: recent.length >= 2 ? round2(median(recent)) : null,
      basedOnBalance,
      movements,
    };
  });
}

async function list(): Promise<SavingsDto[]> {
  return toDtos(await SavingsAccount.findAll({ order: [['kind', 'ASC'], ['createdAt', 'ASC']] }));
}

async function get(id: number): Promise<SavingsDto | null> {
  const s = await SavingsAccount.findByPk(id);
  return s ? (await toDtos([s]))[0] : null;
}

async function create(input: SavingsInput): Promise<SavingsDto> {
  const s = await SavingsAccount.create({
    kind: input.kind,
    name: input.name.trim(),
    balance: input.balance ?? null,
    balanceDate: input.balanceDate ?? null,
    penaltyPct: input.penaltyPct ?? null,
    liquidDate: input.liquidDate ?? null,
    note: input.note?.trim() || null,
    matchKey: input.matchDescription ? descriptionKey(input.matchDescription) : null,
    matchAmount: input.matchAmount ?? null,
  });
  await autoLink();
  return (await get(s.id))!;
}

async function update(id: number, input: Partial<SavingsInput>): Promise<SavingsDto | null> {
  const s = await SavingsAccount.findByPk(id);
  if (!s) return null;
  if (input.kind !== undefined) s.kind = input.kind;
  if (input.name !== undefined) s.name = input.name.trim();
  if (input.balance !== undefined) s.balance = input.balance;
  if (input.balanceDate !== undefined) s.balanceDate = input.balanceDate;
  if (input.penaltyPct !== undefined) s.penaltyPct = input.penaltyPct;
  if (input.liquidDate !== undefined) s.liquidDate = input.liquidDate;
  if (input.note !== undefined) s.note = input.note?.trim() || null;
  await s.save();
  return get(id);
}

async function remove(id: number): Promise<boolean> {
  await TransactionRecord.update({ savingsId: null }, { where: { savingsId: id } });
  await SavingsEntry.destroy({ where: { savingsId: id } });
  return (await SavingsAccount.destroy({ where: { id } })) > 0;
}

async function addEntry(savingsId: number, date: string, amount: number, note: string | null): Promise<boolean> {
  if (!(await SavingsAccount.findByPk(savingsId))) return false;
  await SavingsEntry.create({ savingsId, date, amount, note: note?.trim() || null });
  return true;
}

async function removeEntry(entryId: number): Promise<boolean> {
  return (await SavingsEntry.destroy({ where: { id: entryId } })) > 0;
}

async function link(savingsId: number, transactionId: number): Promise<boolean> {
  if (!(await SavingsAccount.findByPk(savingsId))) return false;
  const [count] = await TransactionRecord.update({ savingsId, loanId: null }, { where: { id: transactionId } });
  return count > 0;
}

async function unlink(transactionId: number): Promise<boolean> {
  const [count] = await TransactionRecord.update({ savingsId: null }, { where: { id: transactionId } });
  return count > 0;
}

/** שיוך אוטומטי של הפקדות קבועות (רץ אחרי ההלוואות, כך שתשלומי הלוואה לא נתפסים כהפקדה) */
async function autoLink(): Promise<number> {
  const list = await SavingsAccount.findAll({ where: { matchKey: { [Op.ne]: null } } });
  if (!list.length) return 0;
  const txns = await TransactionRecord.findAll({ where: { savingsId: null, loanId: null, internalTransfer: false, cardPaymentForAccountId: null, chargedAmount: { [Op.lt]: 0 } } });
  let linked = 0;
  for (const s of list) {
    const ids = txns
      .filter((t) => descriptionKey(t.description) === s.matchKey)
      .filter((t) => s.matchAmount === null || Math.abs(-t.chargedAmount - s.matchAmount) < 1)
      .map((t) => t.id);
    if (!ids.length) continue;
    await TransactionRecord.update({ savingsId: s.id }, { where: { id: { [Op.in]: ids }, savingsId: null } });
    linked += ids.length;
  }
  return linked;
}

/** חיובים שאולי הם הפקדות לחיסכון הזה: אותו תיאור כמו הפקדה שכבר משויכת */
async function candidates(savingsId: number): Promise<SavingsCandidate[]> {
  const s = await SavingsAccount.findByPk(savingsId);
  if (!s) return [];
  const linked = await TransactionRecord.findAll({ attributes: ['description'], where: { savingsId } });
  const keys = new Set([...linked.map((t) => descriptionKey(t.description)), ...(s.matchKey ? [s.matchKey] : [])]);
  const nameKey = descriptionKey(s.name);
  const [txns, accounts] = await Promise.all([
    TransactionRecord.findAll({ where: { savingsId: null, loanId: null, internalTransfer: false, cardPaymentForAccountId: null }, order: [['date', 'DESC']], limit: 2000 }),
    Account.findAll(),
  ]);
  const accName = new Map(accounts.map((a) => [a.id, a.label || a.accountNumber]));
  return txns
    .filter((t) => {
      const key = descriptionKey(t.description);
      return keys.has(key) || (nameKey.length >= 4 && key.includes(nameKey));
    })
    .slice(0, 20)
    .map((t) => ({ id: t.id, date: t.date, amount: round2(t.chargedAmount), name: merchantName(t.description, t.memo), accountName: accName.get(t.accountId) ?? '' }));
}

async function linkedMap(): Promise<Map<number, string>> {
  const list = await SavingsAccount.findAll({ attributes: ['id', 'name'] });
  if (!list.length) return new Map();
  const names = new Map(list.map((s) => [s.id, s.name]));
  const txns = await TransactionRecord.findAll({ attributes: ['id', 'savingsId'], where: { savingsId: { [Op.ne]: null } } });
  return new Map(txns.filter((t) => t.savingsId !== null && names.has(t.savingsId)).map((t) => [t.id, names.get(t.savingsId!)!]));
}

export const savingsService = { list, get, create, update, remove, addEntry, removeEntry, link, unlink, autoLink, candidates, linkedMap };
