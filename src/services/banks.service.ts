import { Op } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { BankConfig } from '../models/bank-config.model';
import { Account, type AccountKind } from '../models/account.model';
import { TransactionRecord } from '../models/transaction.model';
import { RecurringItem } from '../models/recurring-item.model';
import { companyKind } from '../config/companies.config';
import { encrypt, decrypt } from '../utils/crypto';

export interface BankConfigDto {
  id: number;
  companyId: string;
  displayName: string;
  kind: AccountKind;
  isActive: boolean;
  createdAt: Date;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}

async function getAll(): Promise<BankConfigDto[]> {
  const configs = await BankConfig.findAll({ order: [['createdAt', 'ASC']] });
  // ארנק המזומן הוא חיבור וירטואלי — לא מוצג ברשימת הבנקים
  return configs.filter((c) => c.companyId !== 'cash').map(toDto);
}

async function create(companyId: string, displayName: string, credentials: Record<string, string>): Promise<BankConfigDto> {
  const credentialsEncrypted = encrypt(JSON.stringify(credentials));
  const config = await BankConfig.create({ companyId, displayName, credentialsEncrypted });
  return toDto(config);
}

async function update(
  id: number,
  displayName: string,
  credentials: Record<string, string> | null,
  isActive: boolean
): Promise<BankConfigDto | null> {
  const config = await BankConfig.findByPk(id);
  if (!config) return null;
  const updates: Partial<BankConfig> = { displayName, isActive };
  if (credentials !== null) {
    // עדכון חלקי — שדות שלא מולאו נשארים כמו שהיו
    const merged = { ...getDecryptedCredentials(config), ...credentials };
    updates.credentialsEncrypted = encrypt(JSON.stringify(merged));
    updates.lastSyncError = null;
  }
  await config.update(updates);
  return toDto(config);
}

/** מחיקת חיבור כולל כל הנתונים שנשלפו ממנו ופרופיל הדפדפן */
async function remove(id: number): Promise<boolean> {
  const accounts = await Account.findAll({ where: { bankConfigId: id } });
  const accountIds = accounts.map((a) => a.id);
  if (accountIds.length) {
    await RecurringItem.destroy({ where: { accountId: { [Op.in]: accountIds } } });
    await Account.update({ paysFromAccountId: null, paysFromSource: null }, { where: { paysFromAccountId: { [Op.in]: accountIds } } });
    await TransactionRecord.update({ cardPaymentForAccountId: null }, { where: { cardPaymentForAccountId: { [Op.in]: accountIds } } });
  }
  await TransactionRecord.destroy({ where: { bankConfigId: id } });
  await Account.destroy({ where: { bankConfigId: id } });
  const deleted = await BankConfig.destroy({ where: { id } });
  fs.rmSync(path.join(process.cwd(), 'data', 'browser-profiles', `bank-${id}`), { recursive: true, force: true });
  return deleted > 0;
}

function getDecryptedCredentials(config: BankConfig): Record<string, string> {
  return JSON.parse(decrypt(config.credentialsEncrypted)) as Record<string, string>;
}

function toDto(config: BankConfig): BankConfigDto {
  return {
    id: config.id,
    companyId: config.companyId,
    displayName: config.displayName,
    kind: companyKind(config.companyId),
    isActive: config.isActive,
    createdAt: config.createdAt,
    lastSyncAt: config.lastSyncAt ?? null,
    lastSyncError: config.lastSyncError ?? null,
  };
}

export const banksService = { getAll, create, update, remove, getDecryptedCredentials };
