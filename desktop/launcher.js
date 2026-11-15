// מפעיל אפליקציית ווינדוס: מריץ את שרת Caspita ופותח אותו בחלון אפליקציה של Edge
// (Edge מותקן בכל Windows 10/11 — כך לא צריך לארוז דפדפן שלם עם ההתקנה).
// Caspita.exe (desktop/Caspita.cs) מריץ את הקובץ הזה עם ה-node.exe שמגיע עם ההתקנה, בלי חלון קונסול.
// הנתונים נשמרים ב-%APPDATA%\Caspita. סגירת החלון האחרון עוצרת את השרת.
'use strict';
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const util = require('util');

const PORT = Number(process.env.CASPITA_DESKTOP_PORT || 3210);
const URL = `http://127.0.0.1:${PORT}`;
const APP_ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.CASPITA_DATA_DIR || path.join(process.env.APPDATA || require('os').homedir(), 'Caspita');

/** כל מה שנכתב ללוג נשמר בקובץ — אין קונסול */
function logToFile() {
  const file = path.join(DATA_DIR, 'caspita.log');
  // לוג מתגלגל: מעל 5MB מתחילים קובץ חדש
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.old`);
  } catch {
    /* אין עדיין לוג */
  }
  const stream = fs.createWriteStream(file, { flags: 'a' });
  for (const method of ['log', 'info', 'warn', 'error']) {
    console[method] = (...args) => stream.write(util.format(...args) + '\n');
  }
}

/** מפתח הצפנה לפרטי ההתחברות לבנקים — נוצר פעם אחת. מחיקה שלו = צריך להזין את הפרטים מחדש */
function secretKey() {
  const file = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/sync/status`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function findEdge() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

/** חלון אפליקציה (בלי שורת כתובת) עם פרופיל נפרד — מחזיר את התהליך; הוא חי כל עוד יש חלון פתוח */
function openWindow() {
  const edge = findEdge();
  if (!edge) {
    // אין Edge: פותחים בדפדפן ברירת המחדל, והשרת נשאר פעיל
    spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return null;
  }
  return spawn(
    edge,
    [
      `--app=${URL}`,
      `--user-data-dir=${path.join(DATA_DIR, 'window')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--disable-features=msEdgeStartupBoost,msImplicitSignin,msEdgeSidebarV2',
      '--start-maximized',
      '--lang=he',
    ],
    { stdio: 'ignore', windowsHide: false },
  );
}

function showError(message) {
  // הודעת שגיאה בלי תלות ב-Electron — חלון של ווינדוס דרך PowerShell
  const text = `${message}\n\nפרטים בקובץ: ${path.join(DATA_DIR, 'caspita.log')}`.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text}', 'Caspita') | Out-Null`], { windowsHide: true });
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logToFile();

  // כבר רץ (הפעלה שנייה) — רק פותחים עוד חלון
  if (await isServerUp()) {
    openWindow();
    return;
  }

  process.env.CASPITA_DATA_DIR = DATA_DIR;
  process.env.CASPITA_APP_ROOT = APP_ROOT;
  process.env.CASPITA_DESKTOP = 'true';
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  // Chrome לשליפה מהבנקים יורד בסנכרון הראשון לתיקיית הנתונים
  process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(DATA_DIR, 'chrome');
  if (!process.env.SECRET_KEY) process.env.SECRET_KEY = secretKey();
  // קובץ .env אופציונלי בתיקיית הנתונים (למשל SHOW_BROWSER=true)
  process.chdir(DATA_DIR);

  console.log(`[DESKTOP] ${new Date().toISOString()} עולה מ-${APP_ROOT}`);
  require(path.join(APP_ROOT, 'dist', 'index.js'));
  if (!(await waitForServer(60_000))) {
    showError('האפליקציה לא הצליחה לעלות.');
    process.exit(1);
  }

  const win = openWindow();
  if (!win) return;
  win.on('exit', async () => {
    // Edge מעביר הפעלה נוספת לתהליך הקיים ויוצא מיד — מחכים שכל החלונות ייסגרו
    const others = () =>
      spawnSync('powershell', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.join(DATA_DIR, 'window').replace(/'/g, "''")}*' }).Count`], {
        windowsHide: true,
        encoding: 'utf8',
      }).stdout.trim();
    while (Number(others()) > 0) await new Promise((r) => setTimeout(r, 3000));
    console.log('[DESKTOP] החלון נסגר — יוצא');
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => {
  console.error('[DESKTOP] שגיאה:', err);
  showError(`האפליקציה לא הצליחה לעלות.
${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[DESKTOP] שגיאה:', err);
  if (err && err.code === 'EADDRINUSE') showError(`הפורט ${PORT} תפוס על ידי תוכנה אחרת.`);
  process.exit(1);
});

main().catch((err) => {
  console.error('[DESKTOP] הפעלה נכשלה:', err);
  showError(`האפליקציה לא הצליחה לעלות.\n${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
