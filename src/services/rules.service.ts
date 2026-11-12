import { Op } from 'sequelize';
import { CategoryRule, type RuleDirection } from '../models/category-rule.model';
import { Category } from '../models/category.model';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { addMonths, currentMonth } from '../utils/dates';
import { merchantName, normalizeText, round2 } from '../utils/text';

export interface RuleDto {
  id: number;
  categoryId: number;
  text: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  direction: RuleDirection | null;
  accountId: number | null;
}

export type RuleInput = Omit<RuleDto, 'id'>;

export class RuleError extends Error {}

type RuleTxn = Pick<TransactionRecord, 'description' | 'memo' | 'chargedAmount' | 'accountId'>;

function toDto(r: CategoryRule): RuleDto {
  return {
    id: r.id,
    categoryId: r.categoryId,
    text: r.text ?? null,
    minAmount: r.minAmount ?? null,
    maxAmount: r.maxAmount ?? null,
    direction: r.direction ?? null,
    accountId: r.accountId ?? null,
  };
}

function conditions(r: RuleInput): number {
  return [r.text, r.minAmount, r.maxAmount, r.direction, r.accountId].filter((v) => v !== null && v !== '').length;
}

export function ruleMatches(r: RuleInput, t: RuleTxn): boolean {
  const amount = Math.abs(t.chargedAmount);
  if (r.text) {
    const hay = normalizeText(`${t.description} ${t.memo ?? ''} ${merchantName(t.description, t.memo)}`);
    if (!hay.includes(normalizeText(r.text))) return false;
  }
  if (r.minAmount !== null && amount < r.minAmount - 0.005) return false;
  if (r.maxAmount !== null && amount > r.maxAmount + 0.005) return false;
  if (r.direction === 'expense' && t.chargedAmount >= 0) return false;
  if (r.direction === 'income' && t.chargedAmount <= 0) return false;
  if (r.accountId !== null && t.accountId !== r.accountId) return false;
  return true;
}

/** סדר עדיפות: כלל עם יותר תנאים קודם (ספציפי יותר); בשוויון — החדש */
function ordered(rules: RuleDto[]): RuleDto[] {
  return [...rules].sort((a, b) => conditions(b) - conditions(a) || b.id - a.id);
}

async function list(): Promise<RuleDto[]> {
  return ordered((await CategoryRule.findAll()).map(toDto));
}

/** פונקציית התאמה לטעינת עסקאות: הכלל הראשון שמתאים, או null */
async function matcher(): Promise<(t: RuleTxn) => RuleDto | null> {
  const rules = await list();
  if (!rules.length) return () => null;
  return (t) => rules.find((r) => ruleMatches(r, t)) ?? null;
}

function validate(input: RuleInput): void {
  if (conditions(input) === 0) throw new RuleError('צריך לפחות תנאי אחד');
  if (input.text !== null && normalizeText(input.text).length < 2) throw new RuleError('הטקסט קצר מדי');
  if (input.minAmount !== null && input.maxAmount !== null && input.minAmount > input.maxAmount) {
    throw new RuleError('הסכום המינימלי גדול מהמקסימלי');
  }
}

async function create(input: RuleInput): Promise<RuleDto> {
  validate(input);
  if (!(await Category.findByPk(input.categoryId))) throw new RuleError('קטגוריה לא קיימת');
  return toDto(await CategoryRule.create({ ...input, text: input.text?.trim() || null }));
}

async function update(id: number, input: RuleInput): Promise<RuleDto | null> {
  const rule = await CategoryRule.findByPk(id);
  if (!rule) return null;
  validate(input);
  if (!(await Category.findByPk(input.categoryId))) throw new RuleError('קטגוריה לא קיימת');
  await rule.update({ ...input, text: input.text?.trim() || null });
  return toDto(rule);
}

async function remove(id: number): Promise<boolean> {
  return (await CategoryRule.destroy({ where: { id } })) > 0;
}

export interface RulePreview {
  count: number;
  total: number;
  samples: { date: string; name: string; amount: number }[];
}

/** אילו עסקאות מ-12 החודשים האחרונים הכלל היה תופס — לפני השמירה */
async function preview(input: RuleInput): Promise<RulePreview> {
  if (conditions(input) === 0) return { count: 0, total: 0, samples: [] };
  const [txns, accounts] = await Promise.all([
    TransactionRecord.findAll({
      where: { date: { [Op.gte]: `${addMonths(currentMonth(), -12)}-01` }, cardPaymentForAccountId: null, internalTransfer: false },
      order: [['date', 'DESC']],
    }),
    Account.findAll({ where: { isHidden: false } }),
  ]);
  const visible = new Set(accounts.map((a) => a.id));
  const hits = txns.filter((t) => visible.has(t.accountId) && ruleMatches(input, t));
  return {
    count: hits.length,
    total: round2(hits.reduce((s, t) => s + t.chargedAmount, 0)),
    samples: hits.slice(0, 5).map((t) => ({ date: t.date, name: merchantName(t.description, t.memo), amount: t.chargedAmount })),
  };
}

async function removeForCategory(categoryId: number): Promise<void> {
  await CategoryRule.destroy({ where: { categoryId } });
}

export const rulesService = { list, matcher, create, update, remove, preview, removeForCategory };
