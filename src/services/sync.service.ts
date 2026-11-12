import { Op } from 'sequelize';
import { type Transaction, type TransactionsAccount } from 'israeli-bank-scrapers/lib/transactions';
import { BankConfig } from '../models/bank-config.model';
import { Account } from '../models/account.model';
import { TransactionRecord, type MaaserOverride } from '../models/transaction.model';
import { TransactionSplit } from '../models/split.model';
import { TransactionTag } from '../models/tag.model';
import { installmentsService } from './installments.service';
import { companyKind } from '../config/companies.config';
import { addDays, localDateToDate, toLocalDate, today } from '../utils/dates';
import { normalizeText, round2 } from '../utils/text';
import { type SyncError } from '../types/transaction.types';
import { scraperService } from './scraper.service';
import { accountsService } from './accounts.service';
import { recurringService } from './recurring.service';
import { categoryAutoService } from './category-auto.service';
import { loansService } from './loans.service';
import { savingsService } from './savings.service';
import { IS_DEMO } from '../utils/db';

/** בסנכרון ראשון — שנה אחורה (המקסימום שרוב הבנקים מאפשרים) */
const FULL_HISTORY_DAYS = 364;
/** בסנכרון מצטבר — חוזרים חודשיים אחורה כדי לתפוס עסקאות שהתעדכנו */
const OVERLAP_DAYS = 60;

export interface SyncStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  banks: { bankId: number; displayName: string; state: 'pending' | 'running' | 'done' | 'error'; error?: string; added?: number }[];
}

const status: SyncStatus = { running: false, startedAt: null, finishedAt: null, banks: [] };
let current: Promise<SyncError[]> | null = null;

function log(...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}] [SYNC]`, ...args);
}

type RecordInput = {
  hash: string;
  bankConfigId: number;
  accountId: number;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string | null;
  description: string;
  memo: string | null;
  type: string;
  status: string;
  identifier: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  category: string | null;
};

function toRecord(t: Transaction, config: BankConfig, account: Account): Omit<RecordInput, 'hash'> {
  const date = toLocalDate(t.date);
  return {
    bankConfigId: config.id,
    accountId: account.id,
    date,
    processedDate: t.processedDate ? toLocalDate(t.processedDate) : date,
    originalAmount: round2(t.originalAmount),
    originalCurrency: t.originalCurrency || 'ILS',
    chargedAmount: round2(t.chargedAmount ?? t.originalAmount),
    chargedCurrency: t.chargedCurrency ?? null,
    description: (t.description || 'לא ידוע').trim(),
    memo: t.memo?.trim() || null,
    type: t.type,
    status: t.status,
    identifier: t.identifier !== undefined && t.identifier !== null ? String(t.identifier) : null,
    installmentNumber: t.installments?.number ?? null,
    installmentTotal: t.installments?.total ?? null,
    category: t.category ?? null,
  };
}

/** מפתח ייחודי ויציב לעסקה; עסקאות זהות באותו יום מקבלות מספר רץ */
function withHashes(records: Omit<RecordInput, 'hash'>[], config: BankConfig, account: Account): RecordInput[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const base = [
      config.id,
      account.accountNumber,
      r.date,
      r.chargedAmount,
      normalizeText(r.description),
      r.installmentNumber ?? '',
      r.identifier ?? '',
      r.status === 'pending' ? 'p' : 'c',
    ].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, hash: `${base}#${n}` };
  });
}

function overrideKey(r: { description: string; chargedAmount: number; date: string }): string {
  return `${normalizeText(r.description)}|${r.chargedAmount}|${r.date}`;
}

async function saveAccount(config: BankConfig, scraped: TransactionsAccount, fromDate: string): Promise<number> {
  const kind = companyKind(config.companyId);
  const [account] = await Account.findOrCreate({
    where: { bankConfigId: config.id, accountNumber: scraped.accountNumber },
    defaults: { bankConfigId: config.id, accountNumber: scraped.accountNumber, kind },
  });
  if (typeof scraped.balance === 'number') {
    await account.update({ balance: scraped.balance, balanceUpdatedAt: new Date() });
  }

  const records = withHashes(
    scraped.txns.map((t) => toRecord(t, config, account)),
    config,
    account
  );

  // עסקאות ממתינות מתחלפות בכל סנכרון — שומרים את הסימון הידני שלהן ומעבירים לעסקה החדשה
  const oldPending = await TransactionRecord.findAll({
    where: { accountId: account.id, status: 'pending', date: { [Op.gte]: fromDate } },
  });
  const carriedOverrides = new Map<string, MaaserOverride>();
  for (const p of oldPending) if (p.maaserOverride) carriedOverrides.set(overrideKey(p), p.maaserOverride);
  const carriedLoans = new Map<string, number>();
  for (const p of oldPending) if (p.loanId) carriedLoans.set(overrideKey(p), p.loanId);
  const carriedSavings = new Map<string, number>();
  for (const p of oldPending) if (p.savingsId) carriedSavings.set(overrideKey(p), p.savingsId);
  const carriedCategories = new Map<string, number>();
  for (const p of oldPending) if (p.categoryOverrideId) carriedCategories.set(overrideKey(p), p.categoryOverrideId);
  // פיצולים של עסקה ממתינה עוברים לעסקה החדשה
  const oldSplits = oldPending.length ? await TransactionSplit.findAll({ where: { transactionId: { [Op.in]: oldPending.map((p) => p.id) } } }) : [];
  const pendingKeyById = new Map(oldPending.map((p) => [p.id, overrideKey(p)]));
  const carriedSplits = new Map<string, TransactionSplit[]>();
  for (const s of oldSplits) {
    const key = pendingKeyById.get(s.transactionId)!;
    carriedSplits.set(key, [...(carriedSplits.get(key) ?? []), s]);
  }
  const oldTags = oldPending.length ? await TransactionTag.findAll({ where: { transactionId: { [Op.in]: oldPending.map((p) => p.id) } } }) : [];
  const carriedTags = new Map<string, TransactionTag[]>();
  for (const l of oldTags) {
    const key = pendingKeyById.get(l.transactionId)!;
    carriedTags.set(key, [...(carriedTags.get(key) ?? []), l]);
  }
  if (oldPending.length) await TransactionRecord.destroy({ where: { id: { [Op.in]: oldPending.map((p) => p.id) } } });

  const existing = await TransactionRecord.findAll({
    where: { hash: { [Op.in]: records.map((r) => r.hash) } },
  });
  const existingByHash = new Map(existing.map((e) => [e.hash, e]));

  let added = 0;
  for (const r of records) {
    const prev = existingByHash.get(r.hash);
    if (prev) {
      await prev.update({ processedDate: r.processedDate, memo: r.memo, category: r.category, status: r.status });
    } else {
      const key = overrideKey(r);
      const created = await TransactionRecord.create({
        ...r,
        maaserOverride: carriedOverrides.get(key) ?? null,
        loanId: carriedLoans.get(key) ?? null,
        savingsId: carriedSavings.get(key) ?? null,
        categoryOverrideId: carriedCategories.get(key) ?? null,
      });
      for (const s of carriedSplits.get(key) ?? []) await s.update({ transactionId: created.id });
      carriedSplits.delete(key);
      for (const l of carriedTags.get(key) ?? []) await l.update({ transactionId: created.id });
      carriedTags.delete(key);
      added++;
    }
  }
  // פיצולים של עסקה ממתינה שנעלמה — נמחקים
  for (const list of carriedSplits.values()) for (const s of list) await s.destroy();
  for (const list of carriedTags.values()) for (const l of list) await l.destroy();
  return added;
}

async function syncBank(config: BankConfig, entry: SyncStatus['banks'][number]): Promise<void> {
  entry.state = 'running';
  const now = today();
  const fromDate = config.syncedFrom ? addDays(now, -OVERLAP_DAYS) : addDays(now, -FULL_HISTORY_DAYS);
  try {
    const accounts = await scraperService.scrapeBank(config, localDateToDate(fromDate));
    let added = 0;
    for (const acc of accounts) added += await saveAccount(config, acc, fromDate);
    const syncedFrom = config.syncedFrom && config.syncedFrom < fromDate ? config.syncedFrom : fromDate;
    await config.update({ lastSyncAt: new Date(), lastSyncError: null, syncedFrom });
    entry.state = 'done';
    entry.added = added;
    log(`${config.displayName}: ${accounts.length} חשבונות, ${added} עסקאות חדשות`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await config.update({ lastSyncError: message });
    entry.state = 'error';
    entry.error = message;
    log(`${config.displayName}: שגיאה — ${message}`);
  }
}

/** מצב הדגמה: אין פרטי התחברות אמיתיים — רק מדמים סנכרון מוצלח */
async function runDemoSync(): Promise<SyncError[]> {
  const configs = await BankConfig.findAll({ where: { isActive: true } });
  status.banks = configs.map((c) => ({ bankId: c.id, displayName: c.displayName, state: 'running' }));
  await new Promise((r) => setTimeout(r, 2500));
  for (const c of configs) await c.update({ lastSyncAt: new Date(), lastSyncError: null });
  status.banks = status.banks.map((b) => ({ ...b, state: 'done', added: 0 }));
  status.running = false;
  status.finishedAt = Date.now();
  return [];
}

async function runSync(): Promise<SyncError[]> {
  if (IS_DEMO) return runDemoSync();
  const configs = await BankConfig.findAll({ where: { isActive: true } });
  status.running = true;
  status.startedAt = Date.now();
  status.finishedAt = null;
  status.banks = configs.map((c) => ({ bankId: c.id, displayName: c.displayName, state: 'pending' }));

  try {
    await Promise.all(configs.map((c, i) => syncBank(c, status.banks[i])));
    await accountsService.detectCardLinks();
    await accountsService.detectInternalTransfers();
    await recurringService.detect();
    // ספקים חדשים מקבלים קטגוריה אוטומטית (ספקים שכבר שויכו לא נוגעים בהם)
    await categoryAutoService.autoAssign();
    await loansService.autoLink();
    await installmentsService.autoLink();
    await savingsService.autoLink();
  } finally {
    status.running = false;
    status.finishedAt = Date.now();
  }

  return status.banks
    .filter((b) => b.state === 'error')
    .map((b) => ({ bankId: b.bankId, displayName: b.displayName, error: b.error ?? 'שגיאה' }));
}

/** סנכרון כל הבנקים הפעילים. קריאה בזמן שסנכרון רץ מצטרפת לסנכרון הקיים */
function syncAll(): Promise<SyncError[]> {
  if (!current) {
    // מסמנים מיד, כדי שתשובת POST /sync כבר תראה שהסנכרון רץ
    status.running = true;
    status.startedAt = Date.now();
    status.finishedAt = null;
    status.banks = [];
    current = runSync().finally(() => {
      current = null;
    });
  }
  return current;
}

function getStatus(): SyncStatus {
  return status;
}

/** שגיאות אחרונות שנשמרו לכל בנק (להצגה גם בלי סנכרון פעיל) */
async function lastErrors(): Promise<SyncError[]> {
  const configs = await BankConfig.findAll({ where: { isActive: true } });
  return configs
    .filter((c) => c.lastSyncError)
    .map((c) => ({ bankId: c.id, displayName: c.displayName, error: c.lastSyncError ?? '' }));
}

async function lastSyncAt(): Promise<number | null> {
  const configs = await BankConfig.findAll({ where: { isActive: true } });
  const times = configs.map((c) => c.lastSyncAt?.getTime() ?? 0).filter((t) => t > 0);
  return times.length ? Math.max(...times) : null;
}

export const syncService = { syncAll, getStatus, lastErrors, lastSyncAt };
