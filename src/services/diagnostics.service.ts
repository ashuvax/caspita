/**
 * דוח תקלה לסנכרון: כשסנכרון של בנק נכשל נשמרים בתיקיית הנתונים (diagnostics/)
 * רצף הדפים, תשובות שגיאה מהשרת של הבנק, פרטי השגיאה וצילום מסך של הדף ברגע הכשל.
 * המשתמש מוריד מזה קובץ HTML אחד ושולח אותו למי שמתחזק את התוכנה — שום דבר לא נשלח אוטומטית.
 * פרטי ההתחברות לא נכנסים לדוח: הם לא נרשמים בלוג ולא בכתובות.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type Page } from 'puppeteer';
import { APP_ROOT, DATA_DIR } from '../utils/paths';

const DIAG_DIR = path.join(DATA_DIR, 'diagnostics');
const MAX_EVENTS = 300;
const BODY_SNIPPET = 600;

interface TraceEvent {
  at: string;
  kind: 'nav' | 'http' | 'console' | 'pageerror';
  text: string;
}

export interface SyncTrace {
  bankId: number;
  companyId: string;
  displayName: string;
  startedAt: string;
  finishedAt?: string;
  startDate: string;
  success?: boolean;
  errorType?: string;
  errorMessage?: string;
  shownMessage?: string;
  stack?: string;
  events: TraceEvent[];
}

function ensureDir(): void {
  fs.mkdirSync(DIAG_DIR, { recursive: true });
}

function screenshotPath(bankId: number): string {
  return path.join(DIAG_DIR, `bank-${bankId}.png`);
}

function tracePath(bankId: number): string {
  return path.join(DIAG_DIR, `bank-${bankId}.json`);
}

/** כתובת בלי ערכים ארוכים ב-query (טוקנים של סשן) */
function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const [key, value] of url.searchParams) {
      if (value.length > 24) url.searchParams.set(key, '…');
    }
    return url.toString();
  } catch {
    return raw.slice(0, 300);
  }
}

function push(trace: SyncTrace, kind: TraceEvent['kind'], text: string): void {
  if (trace.events.length >= MAX_EVENTS) trace.events.shift();
  trace.events.push({ at: new Date().toISOString(), kind, text });
}

function start(bankId: number, companyId: string, displayName: string, startDate: Date): SyncTrace {
  ensureDir();
  fs.rmSync(screenshotPath(bankId), { force: true });
  return { bankId, companyId, displayName, startedAt: new Date().toISOString(), startDate: startDate.toISOString().slice(0, 10), events: [] };
}

/** מאזין לדף: ניווטים, תשובות HTTP עם שגיאה (כולל JSON עם שדה Error), שגיאות קונסול */
function watchPage(trace: SyncTrace, page: Page): void {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) push(trace, 'nav', safeUrl(frame.url()));
  });
  page.on('pageerror', (err) => push(trace, 'pageerror', String(err instanceof Error ? err.message : err).slice(0, 300)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') push(trace, 'console', msg.text().slice(0, 300));
  });
  page.on('response', (res) => {
    const type = res.request().resourceType();
    if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return;
    const status = res.status();
    const url = safeUrl(res.url());
    if (status >= 400) {
      push(trace, 'http', `${status} ${res.request().method()} ${url}`);
      return;
    }
    if (type === 'document' || status >= 300) return;
    const contentType = res.headers()['content-type'] ?? '';
    if (!contentType.includes('json')) return;
    // תשובה "תקינה" שמכילה שגיאה מהבנק (למשל דיסקונט: { Error: { MsgText } })
    res
      .text()
      .then((body) => {
        if (/"(?:Error|error|errorCode|ErrorCode|errorMessage|MsgText)"\s*:\s*(?!null)/.test(body)) {
          push(trace, 'http', `${status} ${url}\n${body.slice(0, BODY_SNIPPET)}`);
        }
      })
      .catch(() => undefined);
  });
}

function finish(trace: SyncTrace, outcome: { success: boolean; errorType?: string; errorMessage?: string; shownMessage?: string; error?: unknown }): void {
  trace.finishedAt = new Date().toISOString();
  trace.success = outcome.success;
  trace.errorType = outcome.errorType;
  trace.errorMessage = outcome.errorMessage;
  trace.shownMessage = outcome.shownMessage;
  if (outcome.error instanceof Error) trace.stack = outcome.error.stack;
  else if (outcome.error !== undefined) trace.stack = String(outcome.error);
  try {
    ensureDir();
    // סנכרון מוצלח מוחק את הדוח הקודם — אין מה לדווח
    if (outcome.success) {
      fs.rmSync(tracePath(trace.bankId), { force: true });
      fs.rmSync(screenshotPath(trace.bankId), { force: true });
    } else {
      fs.writeFileSync(tracePath(trace.bankId), JSON.stringify(trace, null, 2));
    }
  } catch (err) {
    console.error('[DIAG] שמירת דוח תקלה נכשלה:', err);
  }
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '?';
  } catch {
    return '?';
  }
}

/** שורות מהלוג שקשורות לבנק (קיים רק באפליקציית הווינדוס — שם הלוג נכתב לקובץ) */
function logLines(displayName: string, max = 200): string[] {
  const file = path.join(DATA_DIR, 'caspita.log');
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const related: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(`[${displayName}]`) && !lines[i].includes(`${displayName}:`)) continue;
      related.push(lines[i]);
      // שורות המשך (stack trace) שאחריה
      for (let j = i + 1; j < lines.length && /^\s+at |^[A-Za-z]*Error\b/.test(lines[j]); j++) related.push(lines[j]);
    }
    return related.slice(-max);
  } catch {
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function hasReport(bankId: number): boolean {
  return fs.existsSync(tracePath(bankId));
}

/** דוח HTML אחד (עם צילום המסך בתוכו) — קל לשלוח בוואטסאפ או במייל */
function buildReport(bankId: number): { fileName: string; html: string } | null {
  if (!hasReport(bankId)) return null;
  const trace = JSON.parse(fs.readFileSync(tracePath(bankId), 'utf8')) as SyncTrace;
  const shot = fs.existsSync(screenshotPath(bankId)) ? fs.readFileSync(screenshotPath(bankId)).toString('base64') : null;
  const rows: [string, string][] = [
    ['גרסת Caspita', appVersion()],
    ['מערכת', `${os.type()} ${os.release()} · Node ${process.version}`],
    ['ספק', `${trace.displayName} (${trace.companyId})`],
    ['התחלה', trace.startedAt],
    ['סיום', trace.finishedAt ?? '—'],
    ['שליפה מתאריך', trace.startDate],
    ['ההודעה שהוצגה', trace.shownMessage ?? '—'],
    ['סוג שגיאה', trace.errorType ?? '—'],
    ['הודעה מקורית', trace.errorMessage ?? '—'],
  ];
  const events = trace.events.map((e) => `<tr><td>${escapeHtml(e.at.slice(11, 19))} · ${e.kind}</td><td><pre>${escapeHtml(e.text)}</pre></td></tr>`).join('');
  const log = logLines(trace.displayName);
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>דוח תקלה — ${escapeHtml(trace.displayName)}</title>
<style>
body{font-family:system-ui,'Segoe UI',Arial,sans-serif;margin:24px;color:#1d2b26;background:#fff;line-height:1.5}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
p.note{color:#5d6b66;font-size:13px;margin:0 0 16px}
*{box-sizing:border-box}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px}td{border-bottom:1px solid #e3e7e5;padding:6px 8px;vertical-align:top}
td:first-child{color:#5d6b66;width:120px}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext;text-align:start;font-family:Consolas,monospace;font-size:12px}
img{max-width:100%;border:1px solid #e3e7e5;border-radius:8px}
</style></head><body>
<h1>דוח תקלה בסנכרון — ${escapeHtml(trace.displayName)}</h1>
<p class="note">הדוח נוצר על ידי Caspita ומכיל את פרטי השגיאה וצילום של אתר הבנק ברגע התקלה. הוא לא מכיל סיסמאות, אבל עשוי להכיל פרטים מהחשבון — שלח אותו רק למי שאתה סומך עליו.</p>
<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td><pre>${escapeHtml(v)}</pre></td></tr>`).join('')}</table>
${trace.stack ? `<h2>Stack</h2><pre>${escapeHtml(trace.stack)}</pre>` : ''}
<h2>צילום מסך ברגע התקלה</h2>
${shot ? `<img alt="צילום אתר הבנק" src="data:image/png;base64,${shot}">` : '<p class="note">אין צילום מסך (השגיאה קרתה לפני שהדף נטען, או מחוץ לדפדפן).</p>'}
<h2>רצף אירועים בדפדפן</h2>
${events ? `<table>${events}</table>` : '<p class="note">אין אירועים.</p>'}
<h2>לוג</h2>
${log.length ? `<pre>${escapeHtml(log.join('\n'))}</pre>` : '<p class="note">אין לוג (קיים רק באפליקציית הווינדוס).</p>'}
</body></html>`;
  const date = (trace.finishedAt ?? trace.startedAt).slice(0, 10);
  return { fileName: `caspita-report-${trace.companyId}-${date}.html`, html };
}

export const diagnosticsService = { start, watchPage, finish, screenshotPath, hasReport, buildReport };
