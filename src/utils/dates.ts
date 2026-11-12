const TZ = 'Asia/Jerusalem';
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** ISO/Date → 'YYYY-MM-DD' לפי שעון ישראל */
export function toLocalDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return dateFormatter.format(d);
}

export function today(): string {
  return toLocalDate(new Date());
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function currentMonth(): string {
  return monthOf(today());
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** תאריך בחודש עם יום נתון, מוגבל לאורך החודש */
export function dateInMonth(month: string, day: number): string {
  const d = Math.min(Math.max(1, day), daysInMonth(month));
  return `${month}-${String(d).padStart(2, '0')}`;
}

export function endOfMonth(month: string): string {
  return dateInMonth(month, 31);
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00Z`);
  const pb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((pa - pb) / 86400000);
}

/** תחילת יום מקומי כ-Date (לשימוש מול הסקרייפר) */
export function localDateToDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function monthsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  let cur = from;
  while (cur <= to) {
    result.push(cur);
    cur = addMonths(cur, 1);
  }
  return result;
}
