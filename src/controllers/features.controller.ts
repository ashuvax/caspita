import { type Request, type Response } from 'express';
import { splitsService, SplitError, type SplitPart } from '../services/splits.service';
import { installmentsService } from '../services/installments.service';
import { fundsService, type FundInput } from '../services/funds.service';
import { alertsService } from '../services/alerts.service';
import { taxService } from '../services/tax.service';
import { assistantDataService } from '../services/assistant-data.service';
import { assistantService, AssistantError, type AssistantEngine, type AssistantTurn } from '../services/assistant.service';
import { walletService } from '../services/wallet.service';
import { tagsService, TagError } from '../services/tags.service';
import { rulesService, RuleError, type RuleInput } from '../services/rules.service';
import { yearService } from '../services/year.service';
import { donationImportService, DonationImportError, type ApplyEntry } from '../services/donation-import.service';
import { HttpError, badRequest, notFound, parseId } from '../utils/http';

// ---------- פיצול עסקה ----------

export async function setSplits(req: Request, res: Response): Promise<void> {
  const { parts } = req.body as { parts?: unknown };
  if (!Array.isArray(parts)) throw badRequest('חסרים חלקים');
  const clean: SplitPart[] = parts.map((p) => {
    const { categoryId, amount, note } = (p ?? {}) as { categoryId?: unknown; amount?: unknown; note?: unknown };
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) throw badRequest('סכום לא תקין');
    return { categoryId: parseId(categoryId), amount: value, note: typeof note === 'string' ? note : null };
  });
  try {
    if (!(await splitsService.set(parseId(req.params.id), clean))) throw notFound('העסקה לא נמצאה');
  } catch (e) {
    if (e instanceof SplitError) throw badRequest(e.message);
    throw e;
  }
  res.status(204).end();
}

// ---------- תשלומים ----------

export async function getInstallments(_req: Request, res: Response): Promise<void> {
  res.json(await installmentsService.list());
}

export async function markInstallmentLoan(req: Request, res: Response): Promise<void> {
  const { key, direction, counterparty } = req.body as { key?: string; direction?: string; counterparty?: string };
  if (!key) throw badRequest('חסר מזהה עסקה');
  if (direction !== 'given' && direction !== 'taken') throw badRequest('כיוון לא תקין');
  if (!counterparty?.trim()) throw badRequest('יש להזין שם');
  const loan = await installmentsService.markAsLoan(key, direction, counterparty.trim());
  if (!loan) throw notFound('העסקה לא נמצאה');
  res.status(201).json(loan);
}

// ---------- קופות ----------

function parseFundInput(body: Record<string, unknown>, partial: boolean): Partial<FundInput> {
  const out: Partial<FundInput> = {};
  const num = (v: unknown, label: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} לא תקין`);
    return n;
  };
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw badRequest('יש להזין שם');
    out.name = body.name;
  }
  if (!partial || body.monthlyAmount !== undefined) out.monthlyAmount = num(body.monthlyAmount, 'סכום חודשי');
  if (body.icon !== undefined) out.icon = String(body.icon);
  if (body.targetAmount !== undefined) out.targetAmount = body.targetAmount === null || body.targetAmount === '' ? null : num(body.targetAmount, 'יעד');
  if (body.targetDate !== undefined) {
    if (body.targetDate !== null && body.targetDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.targetDate))) throw badRequest('תאריך לא תקין');
    out.targetDate = (body.targetDate as string | null) || null;
  }
  if (body.categoryId !== undefined) out.categoryId = body.categoryId === null || body.categoryId === '' ? null : parseId(body.categoryId);
  if (body.startMonth !== undefined) {
    if (!/^\d{4}-\d{2}$/.test(String(body.startMonth))) throw badRequest('חודש התחלה לא תקין');
    out.startMonth = String(body.startMonth);
  }
  if (body.openingBalance !== undefined) {
    const n = Number(body.openingBalance);
    if (!Number.isFinite(n)) throw badRequest('יתרת פתיחה לא תקינה');
    out.openingBalance = n;
  }
  if (body.note !== undefined) out.note = (body.note as string | null) ?? null;
  return out;
}

export async function getFunds(_req: Request, res: Response): Promise<void> {
  res.json(await fundsService.list());
}

export async function createFund(req: Request, res: Response): Promise<void> {
  res.status(201).json(await fundsService.create(parseFundInput(req.body as Record<string, unknown>, false) as FundInput));
}

export async function updateFund(req: Request, res: Response): Promise<void> {
  const f = await fundsService.update(parseId(req.params.id), parseFundInput(req.body as Record<string, unknown>, true));
  if (!f) throw notFound('הקופה לא נמצאה');
  res.json(f);
}

export async function deleteFund(req: Request, res: Response): Promise<void> {
  if (!(await fundsService.remove(parseId(req.params.id)))) throw notFound('הקופה לא נמצאה');
  res.status(204).end();
}

// ---------- התראות ----------

export async function getAlerts(_req: Request, res: Response): Promise<void> {
  res.json(await alertsService.list());
}

export async function dismissAlert(req: Request, res: Response): Promise<void> {
  const { key } = req.body as { key?: string };
  if (!key) throw badRequest('חסר מזהה התראה');
  await alertsService.dismiss(key);
  res.status(204).end();
}

// ---------- סעיף 46 ----------

export async function getSection46(req: Request, res: Response): Promise<void> {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('שנה לא תקינה');
  res.json(await taxService.summary(year));
}

export async function setSection46Payee(req: Request, res: Response): Promise<void> {
  const { name, eligible, year } = req.body as { name?: string; eligible?: boolean; year?: number };
  if (!name?.trim()) throw badRequest('חסר שם');
  await taxService.setPayee(name, eligible === true, Number.isInteger(year) ? year : undefined);
  res.status(204).end();
}

export async function setSection46Transactions(req: Request, res: Response): Promise<void> {
  const { ids, eligible } = req.body as { ids?: unknown; eligible?: boolean };
  if (!Array.isArray(ids) || !ids.length) throw badRequest('חסרות עסקאות');
  await taxService.setTransactions(ids.map((id) => parseId(id)), eligible !== false);
  res.status(204).end();
}

// ---------- ארנק מזומן ----------

export async function getWallet(_req: Request, res: Response): Promise<void> {
  res.json(await walletService.summary());
}

// ---------- תגיות ----------

function tagErrors<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    if (e instanceof TagError) throw badRequest(e.message);
    throw e;
  });
}

export async function getTags(_req: Request, res: Response): Promise<void> {
  res.json(await tagsService.list());
}

export async function getTag(req: Request, res: Response): Promise<void> {
  const tag = await tagsService.detail(parseId(req.params.id));
  if (!tag) throw notFound('התגית לא נמצאה');
  res.json(tag);
}

export async function createTag(req: Request, res: Response): Promise<void> {
  const { name, color } = req.body as { name?: string; color?: string };
  res.status(201).json(await tagErrors(() => tagsService.create(name ?? '', color)));
}

export async function updateTag(req: Request, res: Response): Promise<void> {
  const { name, color } = req.body as { name?: string; color?: string };
  if (!(await tagErrors(() => tagsService.update(parseId(req.params.id), { name, color })))) throw notFound('התגית לא נמצאה');
  res.status(204).end();
}

export async function deleteTag(req: Request, res: Response): Promise<void> {
  if (!(await tagsService.remove(parseId(req.params.id)))) throw notFound('התגית לא נמצאה');
  res.status(204).end();
}

export async function setTransactionTags(req: Request, res: Response): Promise<void> {
  const { tagIds } = req.body as { tagIds?: unknown };
  if (!Array.isArray(tagIds)) throw badRequest('חסרות תגיות');
  const ids = tagIds.map((id) => parseId(id));
  if (!(await tagErrors(() => tagsService.setForTransaction(parseId(req.params.id), ids)))) throw notFound('העסקה לא נמצאה');
  res.status(204).end();
}

export async function addTagToTransactions(req: Request, res: Response): Promise<void> {
  const { transactionIds } = req.body as { transactionIds?: unknown };
  if (!Array.isArray(transactionIds) || !transactionIds.length) throw badRequest('חסרות עסקאות');
  const added = await tagErrors(() => tagsService.addToTransactions(parseId(req.params.id), transactionIds.map((id) => parseId(id))));
  res.json({ added });
}

// ---------- כללי סיווג ----------

function parseRuleInput(body: Record<string, unknown>): RuleInput {
  const optNum = (v: unknown, label: string): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} לא תקין`);
    return n;
  };
  const direction = body.direction === 'expense' || body.direction === 'income' ? body.direction : null;
  return {
    categoryId: parseId(body.categoryId),
    text: typeof body.text === 'string' && body.text.trim() ? body.text.trim() : null,
    minAmount: optNum(body.minAmount, 'סכום מינימלי'),
    maxAmount: optNum(body.maxAmount, 'סכום מקסימלי'),
    direction,
    accountId: body.accountId === undefined || body.accountId === null || body.accountId === '' ? null : parseId(body.accountId),
  };
}

function ruleErrors<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    if (e instanceof RuleError) throw badRequest(e.message);
    throw e;
  });
}

export async function getRules(_req: Request, res: Response): Promise<void> {
  res.json(await rulesService.list());
}

export async function createRule(req: Request, res: Response): Promise<void> {
  const input = parseRuleInput(req.body as Record<string, unknown>);
  res.status(201).json(await ruleErrors(() => rulesService.create(input)));
}

export async function updateRule(req: Request, res: Response): Promise<void> {
  const input = parseRuleInput(req.body as Record<string, unknown>);
  const rule = await ruleErrors(() => rulesService.update(parseId(req.params.id), input));
  if (!rule) throw notFound('הכלל לא נמצא');
  res.json(rule);
}

export async function deleteRule(req: Request, res: Response): Promise<void> {
  if (!(await rulesService.remove(parseId(req.params.id)))) throw notFound('הכלל לא נמצא');
  res.status(204).end();
}

export async function previewRule(req: Request, res: Response): Promise<void> {
  const body = { ...(req.body as Record<string, unknown>), categoryId: 1 };
  res.json(await rulesService.preview(parseRuleInput(body)));
}

// ---------- סיכום שנה ----------

export async function getYearSummary(req: Request, res: Response): Promise<void> {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('שנה לא תקינה');
  res.json(await yearService.summary(year));
}

// ---------- ייבוא דוח תרומות ----------

export async function previewDonationReport(req: Request, res: Response): Promise<void> {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('לא התקבל קובץ');
  try {
    res.json(await donationImportService.preview(req.body));
  } catch (e) {
    if (e instanceof DonationImportError) throw badRequest(e.message);
    throw e;
  }
}

export async function applyDonationReport(req: Request, res: Response): Promise<void> {
  const { entries, markPayees } = req.body as { entries?: unknown; markPayees?: boolean };
  if (!Array.isArray(entries) || !entries.length) throw badRequest('אין תרומות לשמירה');
  const clean: ApplyEntry[] = entries.map((raw) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const amount = Number(e.amount);
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw badRequest('תאריך לא תקין');
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('סכום לא תקין');
    if (typeof e.org !== 'string' || !e.org.trim()) throw badRequest('חסר שם עמותה');
    return {
      date: e.date,
      org: e.org.trim(),
      amount,
      receipt: typeof e.receipt === 'string' ? e.receipt : null,
      transactionId: e.transactionId === null || e.transactionId === undefined ? null : parseId(e.transactionId),
      createCash: e.createCash === true,
    };
  });
  res.json(await donationImportService.apply(clean, markPayees === true));
}

// ---------- עוזר ----------

export async function getAssistantDataset(_req: Request, res: Response): Promise<void> {
  res.json(await assistantDataService.build());
}

export function getAssistantEngines(_req: Request, res: Response): void {
  res.json(assistantService.engines());
}

export async function askAssistant(req: Request, res: Response): Promise<void> {
  const { question, engine, sessionId, history } = req.body as { question?: string; engine?: string; sessionId?: string | null; history?: AssistantTurn[] };
  if (!question?.trim()) throw badRequest('יש לכתוב שאלה');
  if (engine !== 'claude' && engine !== 'codex') throw badRequest('מנוע לא תקין');
  const turns = Array.isArray(history) ? history.filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') : [];
  try {
    res.json(await assistantService.ask(question.trim(), engine as AssistantEngine, sessionId ?? null, turns));
  } catch (e) {
    if (e instanceof AssistantError) throw new HttpError(502, e.message);
    throw e;
  }
}
