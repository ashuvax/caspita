import { Op } from 'sequelize';
import { Category, MerchantCategory, DEFAULT_CATEGORIES } from '../models/category.model';
import { TransactionRecord } from '../models/transaction.model';
import { Account } from '../models/account.model';
import { Setting } from '../models/setting.model';
import { addMonths, currentMonth } from '../utils/dates';
import { merchantName, normalizeText, round2 } from '../utils/text';

export function merchantKey(description: string, memo?: string | null): string {
  return normalizeText(merchantName(description, memo)) || 'לא ידוע';
}

export interface CategoryDto {
  id: number;
  name: string;
  icon: string;
  merchantCount: number;
  monthlyBudget: number | null;
}

async function ensureDefaults(): Promise<void> {
  if (await Setting.findByPk('seed.categories.v1')) return;
  if ((await Category.count()) === 0) {
    await Category.bulkCreate(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })));
  }
  await Setting.create({ key: 'seed.categories.v1', value: 'true' });
}

async function list(): Promise<CategoryDto[]> {
  const [cats, maps] = await Promise.all([Category.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC']] }), MerchantCategory.findAll()]);
  const counts = new Map<number, number>();
  for (const m of maps) counts.set(m.categoryId, (counts.get(m.categoryId) ?? 0) + 1);
  return cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon, merchantCount: counts.get(c.id) ?? 0, monthlyBudget: c.monthlyBudget ?? null }));
}

async function create(name: string, icon: string): Promise<Category> {
  const max = (await Category.max<number, Category>('sortOrder')) ?? 0;
  return Category.create({ name: name.trim(), icon: icon || 'label', sortOrder: max + 1 });
}

async function update(id: number, data: { name?: string; icon?: string; monthlyBudget?: number | null }): Promise<boolean> {
  const cat = await Category.findByPk(id);
  if (!cat) return false;
  await cat.update({
    ...(data.name?.trim() ? { name: data.name.trim() } : {}),
    ...(data.icon ? { icon: data.icon } : {}),
    ...(data.monthlyBudget !== undefined ? { monthlyBudget: data.monthlyBudget } : {}),
  });
  return true;
}

async function remove(id: number): Promise<boolean> {
  await MerchantCategory.destroy({ where: { categoryId: id } });
  await TransactionRecord.update({ categoryOverrideId: null }, { where: { categoryOverrideId: id } });
  return (await Category.destroy({ where: { id } })) > 0;
}

/** קטגוריה גלובלית לספק. null = הסרה */
async function setMerchant(merchant: string, categoryId: number | null): Promise<void> {
  const key = merchantKey(merchant);
  if (categoryId === null) await MerchantCategory.destroy({ where: { merchantKey: key } });
  else await MerchantCategory.upsert({ merchantKey: key, categoryId });
}

/** קטגוריה לעסקה בודדת (גוברת על הספק). null = כמו הספק */
async function setTransaction(id: number, categoryId: number | null): Promise<boolean> {
  const [count] = await TransactionRecord.update({ categoryOverrideId: categoryId }, { where: { id } });
  return count > 0;
}

async function merchantMap(): Promise<Map<string, number>> {
  const maps = await MerchantCategory.findAll();
  return new Map(maps.map((m) => [m.merchantKey, m.categoryId]));
}

export interface MerchantSummary {
  merchant: string;
  count: number;
  total: number;
  lastDate: string;
  categoryId: number | null;
  /** הקטגוריה שחברת האשראי נתנה (רמז) */
  sourceCategory: string | null;
}

/** כל הספקים מ-12 החודשים האחרונים, לשיוך קטגוריות */
async function merchants(): Promise<MerchantSummary[]> {
  const from = `${addMonths(currentMonth(), -12)}-01`;
  const [txns, accounts, map] = await Promise.all([
    TransactionRecord.findAll({ where: { date: { [Op.gte]: from }, cardPaymentForAccountId: null, internalTransfer: false } }),
    Account.findAll({ where: { isHidden: false } }),
    merchantMap(),
  ]);
  const visible = new Set(accounts.map((a) => a.id));
  const byKey = new Map<string, MerchantSummary>();
  for (const t of txns) {
    if (!visible.has(t.accountId)) continue;
    const key = merchantKey(t.description, t.memo);
    const entry = byKey.get(key) ?? { merchant: merchantName(t.description, t.memo), count: 0, total: 0, lastDate: t.date, categoryId: map.get(key) ?? null, sourceCategory: null };
    entry.count++;
    entry.total = round2(entry.total + t.chargedAmount);
    if (t.date > entry.lastDate) entry.lastDate = t.date;
    if (!entry.sourceCategory && t.category) entry.sourceCategory = t.category;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export const categoriesService = { ensureDefaults, list, create, update, remove, setMerchant, setTransaction, merchantMap, merchants };
