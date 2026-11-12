import { Fund } from '../models/fund.model';
import { addMonths, currentMonth, monthOf, monthsBetween, today } from '../utils/dates';
import { merchantName, round2 } from '../utils/text';
import { categoryPortions, isCounted, transactionsService } from './transactions.service';

export interface FundDto {
  id: number;
  name: string;
  icon: string;
  monthlyAmount: number;
  targetAmount: number | null;
  targetDate: string | null;
  categoryId: number | null;
  startMonth: string;
  openingBalance: number;
  note: string | null;
  /** כמה הופרש עד היום (כולל החודש הנוכחי) */
  contributed: number;
  /** כמה יצא מהקופה (הוצאות בקטגוריה המשויכת) */
  spent: number;
  balance: number;
  /** הוצאות אחרונות שירדו מהקופה */
  recent: { date: string; name: string; amount: number }[];
  /** כמה צריך להפריש בחודש כדי להגיע ליעד בזמן (null כשאין יעד) */
  neededMonthly: number | null;
  /** האם בקצב הנוכחי מגיעים ליעד בזמן */
  onTrack: boolean | null;
}

export interface FundInput {
  name: string;
  icon?: string;
  monthlyAmount: number;
  targetAmount?: number | null;
  targetDate?: string | null;
  categoryId?: number | null;
  startMonth?: string;
  openingBalance?: number;
  note?: string | null;
}

async function toDto(f: Fund): Promise<FundDto> {
  const month = currentMonth();
  const months = f.startMonth <= month ? monthsBetween(f.startMonth, month).length : 0;
  const contributed = round2(months * f.monthlyAmount);
  const spending: { date: string; name: string; amount: number }[] = [];
  if (f.categoryId !== null && f.startMonth <= month) {
    const txns = (await transactionsService.getRangeTransactions(f.startMonth, month)).filter(isCounted);
    for (const t of txns) {
      if (t.chargedAmount > 0 && t.accountKind !== 'card') continue;
      for (const p of categoryPortions(t)) {
        if (p.categoryId === f.categoryId) spending.push({ date: t.date, name: merchantName(t.description, t.memo), amount: round2(-p.amount) });
      }
    }
  }
  const spent = round2(spending.reduce((s, x) => s + x.amount, 0));
  const balance = round2((f.openingBalance ?? 0) + contributed - spent);

  let neededMonthly: number | null = null;
  let onTrack: boolean | null = null;
  if (f.targetAmount) {
    const targetMonth = f.targetDate ? monthOf(f.targetDate) : null;
    const left = targetMonth && targetMonth > month ? monthsBetween(addMonths(month, 1), targetMonth).length : 0;
    const missing = Math.max(0, f.targetAmount - balance);
    neededMonthly = left > 0 ? round2(missing / left) : missing > 0 ? round2(missing) : 0;
    onTrack = missing <= 0 || (left > 0 && f.monthlyAmount * left >= missing - 0.5);
  }

  return {
    id: f.id,
    name: f.name,
    icon: f.icon,
    monthlyAmount: f.monthlyAmount,
    targetAmount: f.targetAmount ?? null,
    targetDate: f.targetDate ?? null,
    categoryId: f.categoryId ?? null,
    startMonth: f.startMonth,
    openingBalance: f.openingBalance ?? 0,
    note: f.note ?? null,
    contributed,
    spent,
    balance,
    recent: spending.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    neededMonthly,
    onTrack,
  };
}

async function list(): Promise<FundDto[]> {
  const funds = await Fund.findAll({ order: [['createdAt', 'ASC']] });
  return Promise.all(funds.map(toDto));
}

function clean(input: Partial<FundInput>): Partial<Fund> {
  const out: Partial<Fund> = {};
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.icon !== undefined) out.icon = input.icon || 'savings';
  if (input.monthlyAmount !== undefined) out.monthlyAmount = Math.abs(input.monthlyAmount);
  if (input.targetAmount !== undefined) out.targetAmount = input.targetAmount ? Math.abs(input.targetAmount) : null;
  if (input.targetDate !== undefined) out.targetDate = input.targetDate || null;
  if (input.categoryId !== undefined) out.categoryId = input.categoryId ?? null;
  if (input.startMonth !== undefined) out.startMonth = input.startMonth;
  if (input.openingBalance !== undefined) out.openingBalance = input.openingBalance;
  if (input.note !== undefined) out.note = input.note?.trim() || null;
  return out;
}

async function create(input: FundInput): Promise<FundDto> {
  const data = clean(input);
  const f = await Fund.create({
    name: input.name.trim(),
    icon: data.icon,
    monthlyAmount: Math.abs(input.monthlyAmount),
    targetAmount: data.targetAmount ?? null,
    targetDate: data.targetDate ?? null,
    categoryId: data.categoryId ?? null,
    startMonth: input.startMonth || monthOf(today()),
    openingBalance: data.openingBalance ?? 0,
    note: data.note ?? null,
  });
  return toDto(f);
}

async function update(id: number, input: Partial<FundInput>): Promise<FundDto | null> {
  const f = await Fund.findByPk(id);
  if (!f) return null;
  await f.update(clean(input));
  return toDto(f);
}

async function remove(id: number): Promise<boolean> {
  return (await Fund.destroy({ where: { id } })) > 0;
}

export const fundsService = { list, create, update, remove };
