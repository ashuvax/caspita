import { type Request, type Response } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { loansService, type LoanInput } from '../services/loans.service';
import { savingsService, type SavingsInput } from '../services/savings.service';
import { investmentsService, type HoldingInput } from '../services/investments.service';
import { networthService } from '../services/networth.service';
import { type SavingsKind } from '../models/savings.model';
import { type LoanDirection } from '../models/loan.model';
import { transactionsService } from '../services/transactions.service';
import { syncService } from '../services/sync.service';
import { otpService } from '../services/otp.service';
import { accountsService, type AccountUpdate } from '../services/accounts.service';
import { maaserService } from '../services/maaser.service';
import { recurringService, type RecurringInput, type RecurringUpdate } from '../services/recurring.service';
import { forecastService } from '../services/forecast.service';
import { categoriesService } from '../services/categories.service';
import { categoryAutoService } from '../services/category-auto.service';
import { cashService } from '../services/cash.service';
import { type MaaserSettings } from '../services/settings.service';
import { type MaaserOverride } from '../models/transaction.model';
import { type MaaserRuleKind } from '../models/maaser-rule.model';
import { type RecurringStatus } from '../models/recurring-item.model';
import { badRequest, notFound, parseId, parseMonth } from '../utils/http';

// ---------- עסקאות וסנכרון ----------

export async function getGrouped(req: Request, res: Response): Promise<void> {
  res.json(await transactionsService.getGrouped(parseMonth(req.query.month)));
}

/** מתחיל סנכרון ברקע ומחזיר מיד — הלקוח עוקב דרך /sync/status (סנכרון עם קוד SMS יכול לקחת דקות) */
export function startSync(_req: Request, res: Response): void {
  syncService.syncAll().catch((err) => console.error('[SYNC] נכשל:', err));
  res.status(202).json(syncService.getStatus());
}

export function getSyncStatus(_req: Request, res: Response): void {
  res.json(syncService.getStatus());
}

export async function setMaaserOverride(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const { override } = req.body as { override?: MaaserOverride | null };
  if (override !== null && override !== 'include' && override !== 'exclude') throw badRequest('ערך סימון לא תקין');
  if (!(await maaserService.setOverride(id, override))) throw notFound('העסקה לא נמצאה');
  res.status(204).end();
}

// ---------- OTP ----------

export function getOtpStatus(_req: Request, res: Response): void {
  res.json(otpService.getStatus());
}

export function submitOtp(req: Request, res: Response): void {
  const { code, id } = req.body as { code?: string; id?: number };
  if (!code?.trim()) throw badRequest('יש להזין קוד');
  res.json({ ok: otpService.submitOtp(code.trim(), id) });
}

export function cancelOtp(req: Request, res: Response): void {
  const { id } = req.body as { id?: number };
  otpService.cancel(id);
  res.json({ ok: true });
}

// ---------- חשבונות ----------

export async function getAccounts(_req: Request, res: Response): Promise<void> {
  res.json(await accountsService.getAll());
}

export async function updateAccount(req: Request, res: Response): Promise<void> {
  const body = req.body as AccountUpdate;
  if (body.chargeDay !== undefined && body.chargeDay !== null && (body.chargeDay < 1 || body.chargeDay > 31)) {
    throw badRequest('יום חיוב חייב להיות בין 1 ל-31');
  }
  if (!(await accountsService.update(parseId(req.params.id), body))) throw notFound('החשבון לא נמצא');
  res.status(204).end();
}

// ---------- מעשרות ----------

export async function getMaaserSummary(_req: Request, res: Response): Promise<void> {
  res.json(await maaserService.summary());
}

export async function updateMaaserSettings(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<MaaserSettings>;
  if (body.startMonth) parseMonth(body.startMonth);
  res.json(await maaserService.updateSettings(body));
}

export async function getMaaserRules(_req: Request, res: Response): Promise<void> {
  res.json(await maaserService.getRules());
}

export async function addMaaserRule(req: Request, res: Response): Promise<void> {
  const { kind, pattern } = req.body as { kind?: MaaserRuleKind; pattern?: string };
  if (kind !== 'donation' && kind !== 'income_exclude') throw badRequest('סוג כלל לא תקין');
  if (!pattern?.trim()) throw badRequest('יש להזין שם ספק');
  res.status(201).json(await maaserService.addRule(kind, pattern));
}

export async function deleteMaaserRule(req: Request, res: Response): Promise<void> {
  if (!(await maaserService.removeRule(parseId(req.params.id)))) throw notFound('הכלל לא נמצא');
  res.status(204).end();
}

// ---------- הוראות קבע ----------

const STATUSES: RecurringStatus[] = ['active', 'ignored', 'ended'];

export async function getRecurring(_req: Request, res: Response): Promise<void> {
  res.json(await recurringService.getAll());
}

export async function detectRecurring(_req: Request, res: Response): Promise<void> {
  await accountsService.detectCardLinks();
  await accountsService.detectInternalTransfers();
  await recurringService.detect();
  res.json(await recurringService.getAll());
}

export async function createRecurring(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<RecurringInput>;
  if (!body.accountId) throw badRequest('יש לבחור חשבון');
  if (!body.displayName?.trim()) throw badRequest('יש להזין שם');
  if (body.direction !== 'debit' && body.direction !== 'credit') throw badRequest('יש לבחור חיוב או זיכוי');
  if (!body.dayOfMonth || body.dayOfMonth < 1 || body.dayOfMonth > 31) throw badRequest('יום בחודש חייב להיות בין 1 ל-31');
  if (!body.amount || !Number.isFinite(body.amount)) throw badRequest('יש להזין סכום');
  await recurringService.create(body as RecurringInput);
  res.status(201).json(await recurringService.getAll());
}

export async function updateRecurring(req: Request, res: Response): Promise<void> {
  const body = req.body as RecurringUpdate;
  if (body.status && !STATUSES.includes(body.status)) throw badRequest('סטטוס לא תקין');
  if (!(await recurringService.update(parseId(req.params.id), body))) throw notFound('הוראת הקבע לא נמצאה');
  res.status(204).end();
}

export async function deleteRecurring(req: Request, res: Response): Promise<void> {
  if (!(await recurringService.remove(parseId(req.params.id)))) throw notFound('הוראת הקבע לא נמצאה');
  res.status(204).end();
}

// ---------- קטגוריות ----------

function parseCategoryId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return parseId(value);
}

export async function getCategories(_req: Request, res: Response): Promise<void> {
  res.json(await categoriesService.list());
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  const { name, icon } = req.body as { name?: string; icon?: string };
  if (!name?.trim()) throw badRequest('יש להזין שם קטגוריה');
  const exists = (await categoriesService.list()).some((c) => c.name === name.trim());
  if (exists) throw badRequest('קטגוריה בשם הזה כבר קיימת');
  await categoriesService.create(name, icon ?? 'label');
  res.status(201).json(await categoriesService.list());
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { name, icon } = req.body as { name?: string; icon?: string };
  if (!(await categoriesService.update(parseId(req.params.id), { name, icon }))) throw notFound('הקטגוריה לא נמצאה');
  res.json(await categoriesService.list());
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  if (!(await categoriesService.remove(parseId(req.params.id)))) throw notFound('הקטגוריה לא נמצאה');
  res.status(204).end();
}

export async function autoAssignCategories(_req: Request, res: Response): Promise<void> {
  res.json(await categoryAutoService.autoAssign());
}

export async function getCategoryMerchants(_req: Request, res: Response): Promise<void> {
  res.json(await categoriesService.merchants());
}

export async function setMerchantCategory(req: Request, res: Response): Promise<void> {
  const { merchant, categoryId } = req.body as { merchant?: string; categoryId?: number | null };
  if (!merchant?.trim()) throw badRequest('חסר שם ספק');
  await categoriesService.setMerchant(merchant, parseCategoryId(categoryId));
  res.status(204).end();
}

export async function setTransactionCategory(req: Request, res: Response): Promise<void> {
  const { categoryId } = req.body as { categoryId?: number | null };
  if (!(await categoriesService.setTransaction(parseId(req.params.id), parseCategoryId(categoryId)))) throw notFound('העסקה לא נמצאה');
  res.status(204).end();
}

// ---------- מזומן ----------

export async function addCash(req: Request, res: Response): Promise<void> {
  const body = req.body as { date?: string; amount?: number; description?: string; categoryId?: number | null; note?: string | null };
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw badRequest('תאריך לא תקין');
  if (!body.amount || !Number.isFinite(body.amount)) throw badRequest('יש להזין סכום');
  if (!body.description?.trim()) throw badRequest('יש להזין תיאור');
  const record = await cashService.add({
    date: body.date,
    amount: body.amount,
    description: body.description,
    categoryId: body.categoryId ? parseId(body.categoryId) : null,
    note: body.note ?? null,
  });
  res.status(201).json({ id: record.id });
}

export async function deleteCash(req: Request, res: Response): Promise<void> {
  if (!(await cashService.remove(parseId(req.params.id)))) throw notFound('עסקת המזומן לא נמצאה');
  res.status(204).end();
}

// ---------- תחזית ----------

export async function getDashboard(req: Request, res: Response): Promise<void> {
  const months = Number(req.query.months);
  res.json(await dashboardService.get(Number.isInteger(months) && months >= 3 && months <= 24 ? months : 12));
}

export async function getForecast(req: Request, res: Response): Promise<void> {
  const until = typeof req.query.until === 'string' ? req.query.until : undefined;
  res.json(await forecastService.forecast(until));
}

// ---------- הלוואות ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDirection(value: unknown): LoanDirection {
  if (value !== 'given' && value !== 'taken') throw badRequest('סוג הלוואה לא תקין');
  return value;
}

function parseOptionalDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw badRequest(`${label} לא תקין`);
  return value;
}

function parseLoanInput(body: Record<string, unknown>, partial: boolean): Partial<LoanInput> {
  const out: Partial<LoanInput> = {};
  if (!partial || body.direction !== undefined) out.direction = parseDirection(body.direction);
  if (!partial || body.counterparty !== undefined) {
    if (typeof body.counterparty !== 'string' || !body.counterparty.trim()) throw badRequest('יש להזין שם');
    out.counterparty = body.counterparty;
  }
  if (!partial || body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('יש להזין סכום');
    out.amount = amount;
  }
  const start = parseOptionalDate(body.startDate, 'תאריך ההלוואה');
  if (start !== undefined) out.startDate = start;
  const due = parseOptionalDate(body.dueDate, 'מועד ההחזר');
  if (due !== undefined) out.dueDate = due;
  if (body.note !== undefined) out.note = typeof body.note === 'string' ? body.note : null;
  if (body.remainingOverride !== undefined) {
    const r = body.remainingOverride === null || body.remainingOverride === '' ? null : Number(body.remainingOverride);
    if (r !== null && (!Number.isFinite(r) || r < 0)) throw badRequest('יתרה לא תקינה');
    out.remainingOverride = r;
  }
  if (body.closed !== undefined) out.closed = body.closed === true;
  if (body.principalTransactionId !== undefined && body.principalTransactionId !== null) out.principalTransactionId = parseId(body.principalTransactionId);
  if (typeof body.matchDescription === 'string' && body.matchDescription.trim()) out.matchDescription = body.matchDescription;
  if (body.matchAmount !== undefined && body.matchAmount !== null) {
    const m = Number(body.matchAmount);
    if (!Number.isFinite(m) || m <= 0) throw badRequest('סכום התשלום לא תקין');
    out.matchAmount = m;
  }
  return out;
}

export async function getLoans(req: Request, res: Response): Promise<void> {
  res.json(await loansService.list(parseDirection(req.query.direction)));
}

export async function createLoan(req: Request, res: Response): Promise<void> {
  res.status(201).json(await loansService.create(parseLoanInput(req.body as Record<string, unknown>, false) as LoanInput));
}

export async function updateLoan(req: Request, res: Response): Promise<void> {
  const input = parseLoanInput(req.body as Record<string, unknown>, true);
  delete input.direction;
  const loan = await loansService.update(parseId(req.params.id), input);
  if (!loan) throw notFound('ההלוואה לא נמצאה');
  res.json(loan);
}

export async function deleteLoan(req: Request, res: Response): Promise<void> {
  if (!(await loansService.remove(parseId(req.params.id)))) throw notFound('ההלוואה לא נמצאה');
  res.status(204).end();
}

export async function getLoanCandidates(req: Request, res: Response): Promise<void> {
  res.json(await loansService.candidates(parseId(req.params.id)));
}

export async function getLoanSuggestions(req: Request, res: Response): Promise<void> {
  res.json(await loansService.suggestions(parseDirection(req.query.direction)));
}

export async function linkLoanTransaction(req: Request, res: Response): Promise<void> {
  const { transactionId } = req.body as { transactionId?: number };
  if (!(await loansService.link(parseId(req.params.id), parseId(transactionId)))) throw notFound('ההלוואה או העסקה לא נמצאו');
  res.status(204).end();
}

export async function unlinkLoanTransaction(req: Request, res: Response): Promise<void> {
  if (!(await loansService.unlink(parseId(req.params.transactionId)))) throw notFound('העסקה לא נמצאה');
  res.status(204).end();
}

export async function addLoanPayment(req: Request, res: Response): Promise<void> {
  const { date, amount, note } = req.body as { date?: string; amount?: number; note?: string | null };
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw badRequest('תאריך לא תקין');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw badRequest('יש להזין סכום');
  if (!(await loansService.addPayment(parseId(req.params.id), date, value, note ?? null))) throw notFound('ההלוואה לא נמצאה');
  res.status(204).end();
}

export async function deleteLoanPayment(req: Request, res: Response): Promise<void> {
  if (!(await loansService.removePayment(parseId(req.params.paymentId)))) throw notFound('התשלום לא נמצא');
  res.status(204).end();
}

// ---------- חסכונות ----------

function parseSavingsInput(body: Record<string, unknown>, partial: boolean): Partial<SavingsInput> {
  const out: Partial<SavingsInput> = {};
  if (!partial || body.kind !== undefined) {
    if (body.kind !== 'gemach_deposit' && body.kind !== 'study_fund' && body.kind !== 'other') throw badRequest('סוג חיסכון לא תקין');
    out.kind = body.kind as SavingsKind;
  }
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw badRequest('יש להזין שם');
    out.name = body.name;
  }
  const num = (v: unknown, label: string): number | null => {
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} לא תקין`);
    return n;
  };
  if (body.balance !== undefined) out.balance = num(body.balance, 'יתרה');
  if (body.penaltyPct !== undefined) {
    const p = num(body.penaltyPct, 'אחוז ניכוי');
    if (p !== null && p > 100) throw badRequest('אחוז ניכוי לא תקין');
    out.penaltyPct = p;
  }
  const bd = parseOptionalDate(body.balanceDate, 'תאריך היתרה');
  if (bd !== undefined) out.balanceDate = bd;
  const ld = parseOptionalDate(body.liquidDate, 'מועד הנזילות');
  if (ld !== undefined) out.liquidDate = ld;
  if (body.note !== undefined) out.note = typeof body.note === 'string' ? body.note : null;
  if (typeof body.matchDescription === 'string' && body.matchDescription.trim()) out.matchDescription = body.matchDescription;
  if (body.matchAmount !== undefined) out.matchAmount = num(body.matchAmount, 'סכום ההפקדה');
  return out;
}

export async function getSavings(_req: Request, res: Response): Promise<void> {
  res.json(await savingsService.list());
}

export async function createSavings(req: Request, res: Response): Promise<void> {
  res.status(201).json(await savingsService.create(parseSavingsInput(req.body as Record<string, unknown>, false) as SavingsInput));
}

export async function updateSavings(req: Request, res: Response): Promise<void> {
  const s = await savingsService.update(parseId(req.params.id), parseSavingsInput(req.body as Record<string, unknown>, true));
  if (!s) throw notFound('החיסכון לא נמצא');
  res.json(s);
}

export async function deleteSavings(req: Request, res: Response): Promise<void> {
  if (!(await savingsService.remove(parseId(req.params.id)))) throw notFound('החיסכון לא נמצא');
  res.status(204).end();
}

export async function getSavingsCandidates(req: Request, res: Response): Promise<void> {
  res.json(await savingsService.candidates(parseId(req.params.id)));
}

export async function linkSavingsTransaction(req: Request, res: Response): Promise<void> {
  const { transactionId } = req.body as { transactionId?: number };
  if (!(await savingsService.link(parseId(req.params.id), parseId(transactionId)))) throw notFound('החיסכון או העסקה לא נמצאו');
  res.status(204).end();
}

export async function unlinkSavingsTransaction(req: Request, res: Response): Promise<void> {
  if (!(await savingsService.unlink(parseId(req.params.transactionId)))) throw notFound('העסקה לא נמצאה');
  res.status(204).end();
}

export async function addSavingsEntry(req: Request, res: Response): Promise<void> {
  const { date, amount, note } = req.body as { date?: string; amount?: number; note?: string | null };
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw badRequest('תאריך לא תקין');
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) throw badRequest('יש להזין סכום');
  if (!(await savingsService.addEntry(parseId(req.params.id), date, value, note ?? null))) throw notFound('החיסכון לא נמצא');
  res.status(204).end();
}

export async function deleteSavingsEntry(req: Request, res: Response): Promise<void> {
  if (!(await savingsService.removeEntry(parseId(req.params.entryId)))) throw notFound('הרישום לא נמצא');
  res.status(204).end();
}

// ---------- השקעות ----------

function parseHoldingInput(body: Record<string, unknown>, partial: boolean): Partial<HoldingInput> {
  const out: Partial<HoldingInput> = {};
  const text = (key: 'account' | 'name', label: string) => {
    if (!partial || body[key] !== undefined) {
      const v = body[key];
      if (typeof v !== 'string' || !v.trim()) throw badRequest(`יש להזין ${label}`);
      out[key] = v;
    }
  };
  text('account', 'היכן מוחזק');
  text('name', 'שם');
  if (body.symbol !== undefined) out.symbol = typeof body.symbol === 'string' ? body.symbol : null;
  if (!partial || body.quantity !== undefined) {
    const q = Number(body.quantity);
    if (!Number.isFinite(q) || q <= 0) throw badRequest('כמות לא תקינה');
    out.quantity = q;
  }
  if (!partial || body.currency !== undefined) {
    if (body.currency !== 'ILS' && body.currency !== 'USD') throw badRequest('מטבע לא תקין');
    out.currency = body.currency;
  }
  if (!partial || body.priceSource !== undefined) {
    if (body.priceSource !== 'yahoo' && body.priceSource !== 'manual') throw badRequest('מקור מחיר לא תקין');
    out.priceSource = body.priceSource;
  }
  const num = (v: unknown, label: string): number | null => {
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} לא תקין`);
    return n;
  };
  if (body.manualPrice !== undefined) out.manualPrice = num(body.manualPrice, 'מחיר');
  if (body.costBasis !== undefined) out.costBasis = num(body.costBasis, 'עלות');
  const d = parseOptionalDate(body.manualPriceDate, 'תאריך המחיר');
  if (d !== undefined) out.manualPriceDate = d;
  if (body.note !== undefined) out.note = typeof body.note === 'string' ? body.note : null;
  if (out.priceSource === 'yahoo' && !partial && !(typeof out.symbol === 'string' && out.symbol.trim())) throw badRequest('למחיר חי צריך סימול');
  return out;
}

export async function getInvestments(req: Request, res: Response): Promise<void> {
  res.json(await investmentsService.list(req.query.refresh === '1'));
}

export async function createHolding(req: Request, res: Response): Promise<void> {
  await investmentsService.create(parseHoldingInput(req.body as Record<string, unknown>, false) as HoldingInput);
  res.status(201).json(await investmentsService.list());
}

export async function updateHolding(req: Request, res: Response): Promise<void> {
  if (!(await investmentsService.update(parseId(req.params.id), parseHoldingInput(req.body as Record<string, unknown>, true)))) throw notFound('הנייר לא נמצא');
  res.json(await investmentsService.list());
}

export async function deleteHolding(req: Request, res: Response): Promise<void> {
  if (!(await investmentsService.remove(parseId(req.params.id)))) throw notFound('הנייר לא נמצא');
  res.status(204).end();
}

export async function getNetWorth(_req: Request, res: Response): Promise<void> {
  res.json(await networthService.get());
}
