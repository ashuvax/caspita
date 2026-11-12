import { type Request, type Response } from 'express';
import { SUPPORTED_COMPANIES, getCompany } from '../config/companies.config';
import { banksService } from '../services/banks.service';
import { badRequest, notFound, parseId } from '../utils/http';

interface BankBody {
  companyId?: string;
  displayName?: string;
  credentials?: Record<string, string> | null;
  isActive?: boolean;
}

function cleanCredentials(raw: Record<string, string>, allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of allowed) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim() !== '') result[key] = v.trim();
  }
  return result;
}

export function getSupportedCompanies(_req: Request, res: Response): void {
  res.json(SUPPORTED_COMPANIES);
}

export async function getAllBanks(_req: Request, res: Response): Promise<void> {
  res.json(await banksService.getAll());
}

export async function createBank(req: Request, res: Response): Promise<void> {
  const body = req.body as BankBody;
  const company = body.companyId ? getCompany(body.companyId) : undefined;
  if (!company) throw badRequest('יש לבחור בנק או חברת אשראי נתמכים');
  if (!body.displayName?.trim()) throw badRequest('שם תצוגה הוא שדה חובה');
  const credentials = cleanCredentials(body.credentials ?? {}, company.fields.map((f) => f.key));
  const missing = company.fields.filter((f) => !credentials[f.key] && f.key !== 'otpLongTermToken');
  if (missing.length) throw badRequest(`חסרים שדות: ${missing.map((f) => f.label).join(', ')}`);
  res.status(201).json(await banksService.create(company.id, body.displayName.trim(), credentials));
}

export async function updateBank(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const body = req.body as BankBody;
  if (!body.displayName?.trim()) throw badRequest('שם תצוגה הוא שדה חובה');
  const existing = (await banksService.getAll()).find((b) => b.id === id);
  if (!existing) throw notFound('הבנק לא נמצא');
  const company = getCompany(existing.companyId);
  const credentials = body.credentials ? cleanCredentials(body.credentials, company?.fields.map((f) => f.key) ?? []) : null;
  const updated = await banksService.update(id, body.displayName.trim(), credentials && Object.keys(credentials).length ? credentials : null, body.isActive ?? true);
  res.json(updated);
}

export async function deleteBank(req: Request, res: Response): Promise<void> {
  const ok = await banksService.remove(parseId(req.params.id));
  if (!ok) throw notFound('הבנק לא נמצא');
  res.status(204).end();
}
