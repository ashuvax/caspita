/** נרמול טקסט להשוואה: רווחים, גרשיים, אותיות קטנות */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'״׳`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** מפתח קבוע לתיאור עסקה — מסיר מספרי אסמכתא ומספרים ארוכים */
export function descriptionKey(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\d{4,}/g, '')
    .replace(/[-–_/\.,:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** תיאורי העברה כלליים שהבנק נותן לכל העברה — הנמען/המעביר האמיתי מופיע רק בהערה */
const GENERIC_TRANSFER = /^(העברה לאחר|העברה\/הפקדה|העברה מיידית|העברה-נתב קולי|העברה מהבנק|העברה|הפקדה)$/;
const PAYEE_IN_MEMO = /(לטובת|המבצע):\s*([^.]+)/;

/**
 * שם הספק לתצוגה ולקיבוץ. בהעברות כלליות ("העברה לאחר") השם נלקח מההערה,
 * אחרת כל ההעברות — שכירות, הלוואה, מקדמה — היו נאספות תחת ספק אחד.
 */
export function merchantName(description: string, memo?: string | null): string {
  const desc = description.trim();
  if (!memo || !GENERIC_TRANSFER.test(desc)) return desc;
  const m = PAYEE_IN_MEMO.exec(memo);
  if (!m) return desc;
  const name = m[2].replace(/\s+/g, ' ').trim();
  if (!name) return desc;
  return m[1] === 'לטובת' ? `העברה ל${name}` : `העברה מ${name}`;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
