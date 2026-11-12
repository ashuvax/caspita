import { Op } from 'sequelize';
import { Tag, TransactionTag } from '../models/tag.model';
import { TransactionRecord } from '../models/transaction.model';
import { monthOf } from '../utils/dates';
import { merchantName, round2 } from '../utils/text';
import { type TransactionDto } from '../types/transaction.types';
import { categoryPortions, transactionsService } from './transactions.service';

export const TAG_COLORS = ['pine', 'gold', 'brick', 'leaf', 'sky', 'plum'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export interface TagDto {
  id: number;
  name: string;
  color: string;
  count: number;
  /** הוצאות נטו (זיכויים מקטינים) */
  total: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface TagDetail extends TagDto {
  byCategory: { categoryId: number | null; amount: number }[];
  byMonth: { month: string; amount: number }[];
  transactions: (TransactionDto & { merchant: string })[];
}

export class TagError extends Error {}

async function list(): Promise<TagDto[]> {
  const [tags, links] = await Promise.all([Tag.findAll({ order: [['name', 'ASC']] }), TransactionTag.findAll()]);
  const txns = links.length
    ? await TransactionRecord.findAll({ attributes: ['id', 'date', 'chargedAmount'], where: { id: { [Op.in]: [...new Set(links.map((l) => l.transactionId))] } } })
    : [];
  const txnById = new Map(txns.map((t) => [t.id, t]));
  return tags
    .map((tag) => {
      const mine = links.filter((l) => l.tagId === tag.id).map((l) => txnById.get(l.transactionId)).filter((t): t is TransactionRecord => !!t);
      const dates = mine.map((t) => t.date).sort();
      return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        count: mine.length,
        total: round2(mine.reduce((s, t) => s - t.chargedAmount, 0)),
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
      };
    })
    .sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.name.localeCompare(b.name));
}

async function detail(id: number): Promise<TagDetail | null> {
  const tag = await Tag.findByPk(id);
  if (!tag) return null;
  const links = await TransactionTag.findAll({ where: { tagId: id } });
  const transactions = await transactionsService.getByIds(links.map((l) => l.transactionId));
  const cats = new Map<number | null, number>();
  const months = new Map<string, number>();
  for (const t of transactions) {
    for (const p of categoryPortions(t)) cats.set(p.categoryId, (cats.get(p.categoryId) ?? 0) - p.amount);
    months.set(monthOf(t.date), (months.get(monthOf(t.date)) ?? 0) - t.chargedAmount);
  }
  const dates = transactions.map((t) => t.date).sort();
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    count: transactions.length,
    total: round2(transactions.reduce((s, t) => s - t.chargedAmount, 0)),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    byCategory: [...cats.entries()].map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) })).filter((c) => Math.abs(c.amount) > 0.005).sort((a, b) => b.amount - a.amount),
    byMonth: [...months.entries()].map(([month, amount]) => ({ month, amount: round2(amount) })).sort((a, b) => a.month.localeCompare(b.month)),
    transactions: transactions.map((t) => ({ ...t, merchant: merchantName(t.description, t.memo) })),
  };
}

function cleanColor(color: string | undefined): TagColor {
  return TAG_COLORS.find((c) => c === color) ?? 'pine';
}

async function create(name: string, color?: string): Promise<TagDto> {
  const clean = name.trim();
  if (!clean) throw new TagError('יש להזין שם');
  if (await Tag.findOne({ where: { name: clean } })) throw new TagError('כבר יש תגית בשם הזה');
  const tag = await Tag.create({ name: clean, color: cleanColor(color) });
  return { id: tag.id, name: tag.name, color: tag.color, count: 0, total: 0, firstDate: null, lastDate: null };
}

async function update(id: number, data: { name?: string; color?: string }): Promise<boolean> {
  const tag = await Tag.findByPk(id);
  if (!tag) return false;
  const name = data.name?.trim();
  if (name && name !== tag.name && (await Tag.findOne({ where: { name } }))) throw new TagError('כבר יש תגית בשם הזה');
  await tag.update({ ...(name ? { name } : {}), ...(data.color ? { color: cleanColor(data.color) } : {}) });
  return true;
}

async function remove(id: number): Promise<boolean> {
  await TransactionTag.destroy({ where: { tagId: id } });
  return (await Tag.destroy({ where: { id } })) > 0;
}

/** מחליף את התגיות של עסקה */
async function setForTransaction(transactionId: number, tagIds: number[]): Promise<boolean> {
  if (!(await TransactionRecord.findByPk(transactionId))) return false;
  const ids = [...new Set(tagIds)];
  if (ids.length && (await Tag.count({ where: { id: { [Op.in]: ids } } })) !== ids.length) throw new TagError('תגית לא קיימת');
  await TransactionTag.destroy({ where: { transactionId } });
  if (ids.length) await TransactionTag.bulkCreate(ids.map((tagId) => ({ transactionId, tagId })));
  return true;
}

/** מוסיף תגית לכמה עסקאות בבת אחת (למשל כל העסקאות של ספק בחודש) */
async function addToTransactions(tagId: number, transactionIds: number[]): Promise<number> {
  if (!(await Tag.findByPk(tagId))) throw new TagError('תגית לא קיימת');
  const existing = new Set((await TransactionTag.findAll({ where: { tagId } })).map((l) => l.transactionId));
  const valid = (await TransactionRecord.findAll({ attributes: ['id'], where: { id: { [Op.in]: transactionIds } } })).map((t) => t.id);
  const add = valid.filter((id) => !existing.has(id));
  if (add.length) await TransactionTag.bulkCreate(add.map((transactionId) => ({ transactionId, tagId })));
  return add.length;
}

export const tagsService = { list, detail, create, update, remove, setForTransaction, addToTransactions };
