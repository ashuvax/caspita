import { type Request, type Response, type NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(message = 'לא נמצא'): HttpError {
  return new HttpError(404, message);
}

export function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('מזהה לא תקין');
  return id;
}

export function parseMonth(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw badRequest('חודש לא תקין (נדרש YYYY-MM)');
  return value;
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[API] שגיאה לא צפויה:', err);
  res.status(500).json({ error: 'שגיאת שרת פנימית' });
}
