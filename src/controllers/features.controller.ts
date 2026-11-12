import { type Request, type Response } from 'express';
import { splitsService, SplitError, type SplitPart } from '../services/splits.service';
import { installmentsService } from '../services/installments.service';
import { fundsService, type FundInput } from '../services/funds.service';
import { alertsService } from '../services/alerts.service';
import { taxService } from '../services/tax.service';
import { assistantDataService } from '../services/assistant-data.service';
import { assistantService, AssistantError, type AssistantEngine, type AssistantTurn } from '../services/assistant.service';
import { HttpError, badRequest, notFound, parseId } from '../utils/http';

// ---------- פיצול עסקה ----------

export async function setSplits(req: Request, res: Response): Promise<void> {
  const { parts } = req.body as { parts?: unknown };
  if (!Array.isArray(parts)) throw badRequest('חסרים חלקים');
  const clean: SplitPart[] = parts.map((p) => {
    const { categoryId, amount } = (p ?? {}) as { categoryId?: unknown; amount?: unknown };
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) throw badRequest('סכום לא תקין');
    return { categoryId: parseId(categoryId), amount: value };
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
  const { name, eligible } = req.body as { name?: string; eligible?: boolean };
  if (!name?.trim()) throw badRequest('חסר שם');
  await taxService.setPayee(name, eligible === true);
  res.status(204).end();
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
