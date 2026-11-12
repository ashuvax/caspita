import { TransactionRecord } from '../models/transaction.model';
import { TransactionSplit } from '../models/split.model';
import { Category } from '../models/category.model';
import { round2 } from '../utils/text';

export interface SplitPart {
  categoryId: number;
  amount: number;
  note?: string | null;
}

export class SplitError extends Error {}

/**
 * מחליף את כל הפיצולים של עסקה. רשימה ריקה = ביטול הפיצול.
 * סכום החלקים חייב להיות קטן מסכום העסקה — השארית נשארת בקטגוריה של העסקה.
 */
async function set(transactionId: number, parts: SplitPart[]): Promise<boolean> {
  const txn = await TransactionRecord.findByPk(transactionId);
  if (!txn) return false;
  const clean = parts
    .filter((p) => p.amount > 0)
    .map((p) => ({ categoryId: p.categoryId, amount: round2(p.amount), note: p.note?.trim() || null }));
  const total = clean.reduce((s, p) => s + p.amount, 0);
  if (total > Math.abs(txn.chargedAmount) + 0.005) throw new SplitError('סכום החלקים גדול מסכום העסקה');
  const ids = [...new Set(clean.map((p) => p.categoryId))];
  if (ids.length && (await Category.count({ where: { id: ids } })) !== ids.length) throw new SplitError('קטגוריה לא קיימת');
  await TransactionSplit.destroy({ where: { transactionId } });
  if (clean.length) await TransactionSplit.bulkCreate(clean.map((p) => ({ ...p, transactionId })));
  return true;
}

export const splitsService = { set };
