import { randomUUID } from 'crypto';
import { BankConfig } from '../models/bank-config.model';
import { Account } from '../models/account.model';
import { TransactionRecord } from '../models/transaction.model';
import { MerchantCategory } from '../models/category.model';
import { round2 } from '../utils/text';
import { merchantKey } from './categories.service';

/** חיבור "וירטואלי" למזומן — לא מסונכרן ולא מוצג ברשימת הבנקים */
export const CASH_COMPANY_ID = 'cash';

async function ensureCashAccount(): Promise<Account> {
  const [config] = await BankConfig.findOrCreate({
    where: { companyId: CASH_COMPANY_ID },
    defaults: { companyId: CASH_COMPANY_ID, displayName: 'מזומן', credentialsEncrypted: '', isActive: false },
  });
  const [account] = await Account.findOrCreate({
    where: { bankConfigId: config.id, accountNumber: 'ארנק' },
    defaults: { bankConfigId: config.id, accountNumber: 'ארנק', kind: 'cash', label: 'מזומן' },
  });
  return account;
}

export interface CashInput {
  date: string;
  /** חיובי = הכנסה, שלילי = הוצאה */
  amount: number;
  description: string;
  categoryId: number | null;
  note: string | null;
}

async function add(input: CashInput): Promise<TransactionRecord> {
  const account = await ensureCashAccount();
  const amount = round2(input.amount);
  const description = input.description.trim();
  const record = await TransactionRecord.create({
    hash: `cash|${randomUUID()}`,
    bankConfigId: account.bankConfigId,
    accountId: account.id,
    date: input.date,
    processedDate: input.date,
    originalAmount: amount,
    originalCurrency: 'ILS',
    chargedAmount: amount,
    chargedCurrency: 'ILS',
    description,
    memo: input.note?.trim() || null,
    type: 'normal',
    status: 'completed',
    categoryOverrideId: null,
  });
  if (input.categoryId) {
    // ספק חדש — הקטגוריה נקבעת לו גלובלית; ספק קיים עם קטגוריה אחרת — רק לעסקה הזו
    const existing = await MerchantCategory.findByPk(merchantKey(description));
    if (!existing) await MerchantCategory.create({ merchantKey: merchantKey(description), categoryId: input.categoryId });
    else if (existing.categoryId !== input.categoryId) await record.update({ categoryOverrideId: input.categoryId });
  }
  return record;
}

/** מוחק רק עסקאות מזומן (עסקאות שנשלפו מהבנק לא נמחקות ידנית) */
async function remove(id: number): Promise<boolean> {
  const record = await TransactionRecord.findByPk(id);
  if (!record) return false;
  const account = await Account.findByPk(record.accountId);
  if (account?.kind !== 'cash') return false;
  await record.destroy();
  return true;
}

export const cashService = { ensureCashAccount, add, remove };
