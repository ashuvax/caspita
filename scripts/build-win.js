// בונה את תוכנת ההתקנה לווינדוס: release/Caspita-Setup-<version>.exe
//
// מה נכנס להתקנה: node.exe, השרת המהודר (dist), בניית הלקוח, תלויות ייצור בלבד (מקוצצות),
// ומפעיל קטן (Caspita.exe). לא נכנסים: Electron ו-Chrome —
// החלון הוא חלון אפליקציה של Edge (קיים בכל Windows 10/11), ו-Chrome לשליפה מהבנקים יורד בסנכרון הראשון.
//
// דרישות: npm run build + npm run build:client לפני (npm run dist:win עושה הכול), makensis
// (ב-PATH, ב-MAKENSIS, או ב-Program Files\NSIS), ו-csc של .NET Framework (קיים בכל Windows).
// חתימה דיגיטלית (אופציונלי): WINDOWS_CERT_PFX (נתיב לקובץ, או תוכן base64) + WINDOWS_CERT_PASSWORD.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'win');
const STAGE = path.join(OUT, 'stage');
const APP = path.join(STAGE, 'app');
const RELEASE = path.join(ROOT, 'release');
const ICON = path.join(ROOT, 'desktop', 'icon', 'icon.ico');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function step(title) {
  console.log(`\n▸ ${title}`);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', shell: cmd === 'npm', ...opts });
}

function copy(from, to, filter) {
  fs.cpSync(path.join(ROOT, from), path.join(APP, to ?? from), { recursive: true, filter });
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  }
  return total;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/** מוחק מ-node_modules מה שלא צריך בזמן ריצה */
function prune(dir) {
  const DROP_DIRS = new Set(['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github', 'benchmark', 'benchmarks', 'man']);
  const DROP_FILE = /(\.map|\.d\.ts|\.d\.mts|\.d\.cts|\.tsbuildinfo|\.md|\.markdown|\.gyp|\.gypi|\.cc|\.cpp|\.h|\.c|\.o|\.obj|\.pdb|\.lib|\.ilk|\.iobj|\.ipdb|\.tlog)$/i;
  const KEEP_FILE = /^(license|licence|notice)/i;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (DROP_DIRS.has(entry.name.toLowerCase())) fs.rmSync(p, { recursive: true, force: true });
      else prune(p);
    } else if (DROP_FILE.test(entry.name) && !KEEP_FILE.test(entry.name)) {
      fs.rmSync(p, { force: true });
    }
  }
}

function findMakensis() {
  const candidates = [
    process.env.MAKENSIS,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'NSIS', 'makensis.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'NSIS', 'makensis.exe'),
  ].filter(Boolean);
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((n) => n.startsWith('nsis-'))) {
      for (const sub of fs.readdirSync(path.join(cache, d))) candidates.push(path.join(cache, d, sub, 'makensis.exe'));
    }
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return found;
  try {
    execFileSync('makensis', ['/VERSION'], { stdio: 'ignore' });
    return 'makensis';
  } catch {
    throw new Error('לא נמצא makensis — התקן NSIS (https://nsis.sourceforge.io) או הגדר MAKENSIS');
  }
}

function findCsc() {
  const p = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(p)) throw new Error(`לא נמצא csc.exe (${p})`);
  return p;
}

function findSigntool() {
  if (process.env.SIGNTOOL && fs.existsSync(process.env.SIGNTOOL)) return process.env.SIGNTOOL;
  const kits = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (!fs.existsSync(kits)) return null;
  const versions = fs.readdirSync(kits).filter((v) => /^10\./.test(v)).sort().reverse();
  for (const v of versions) {
    const p = path.join(kits, v, 'x64', 'signtool.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** חתימה עם תעודת PFX, אם הוגדרה. בלי תעודה — מדלגים (ווינדוס יציג אזהרת "מפרסם לא ידוע") */
function signer() {
  const pfx = process.env.WINDOWS_CERT_PFX;
  if (!pfx) return null;
  let file = pfx;
  if (!fs.existsSync(pfx)) {
    file = path.join(os.tmpdir(), `caspita-cert-${process.pid}.pfx`);
    fs.writeFileSync(file, Buffer.from(pfx, 'base64'));
    process.on('exit', () => fs.rmSync(file, { force: true }));
  }
  const signtool = findSigntool();
  if (!signtool) throw new Error('הוגדרה תעודה אבל לא נמצא signtool.exe (Windows SDK)');
  const timestamp = process.env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com';
  return (target) => {
    const args = ['sign', '/fd', 'SHA256', '/f', file, '/tr', timestamp, '/td', 'SHA256', '/d', 'Caspita'];
    if (process.env.WINDOWS_CERT_PASSWORD) args.push('/p', process.env.WINDOWS_CERT_PASSWORD);
    execFileSync(signtool, [...args, target], { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log(`  נחתם: ${path.basename(target)}`);
  };
}

function main() {
  for (const required of ['dist/index.js', 'caspita-client/dist/caspita-client/browser/index.html']) {
    if (!fs.existsSync(path.join(ROOT, required))) throw new Error(`חסר ${required} — הרץ npm run build && npm run build:client`);
  }
  const sign = signer();

  step('מכין תיקייה');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });
  copy('dist', 'dist', (src) => !/\.d\.ts$/.test(src) && !/\.map$/.test(src));
  copy('caspita-client/dist/caspita-client/browser');
  copy('src/assistant/mcp-server.js');
  copy('desktop/launcher.js');
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(APP, 'package-lock.json'));
  // devDependencies נשארות ברשימה כדי ש-npm ci יתאים ל-lock (ולא מותקנות, בגלל --omit=dev)
  const appPkg = { name: pkg.name, version: pkg.version, private: true, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, allowScripts: pkg.allowScripts };
  fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify(appPkg, null, 2));

  step('תלויות ייצור בלבד');
  run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: APP,
    // Chrome לא נארז — יורד בסנכרון הראשון
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' },
  });
  const beforePrune = sizeOf(path.join(APP, 'node_modules'));
  prune(path.join(APP, 'node_modules'));
  // sqlite3: רק הקובץ המהודר
  const sqlite = path.join(APP, 'node_modules', 'sqlite3');
  for (const d of ['deps', 'src', path.join('build', 'Release', 'obj'), path.join('build', 'Release', 'obj.target'), path.join('build', 'deps')]) {
    fs.rmSync(path.join(sqlite, d), { recursive: true, force: true });
  }
  // typescript מגיע כ-peer אופציונלי של cosmiconfig (דרך puppeteer) — נטען רק לקובצי הגדרה ב-TS, שאין לנו
  fs.rmSync(path.join(APP, 'node_modules', 'typescript'), { recursive: true, force: true });
  fs.rmSync(path.join(APP, 'package-lock.json'), { force: true });
  console.log(`  node_modules: ${mb(beforePrune)} → ${mb(sizeOf(path.join(APP, 'node_modules')))}`);

  step('node.exe');
  fs.mkdirSync(path.join(STAGE, 'node'));
  fs.copyFileSync(process.execPath, path.join(STAGE, 'node', 'node.exe'));
  fs.writeFileSync(path.join(STAGE, 'node', 'VERSION'), process.version);

  step('Caspita.exe');
  run(findCsc(), [
    '/nologo',
    '/target:winexe',
    '/codepage:65001',
    '/optimize+',
    `/win32icon:${ICON}`,
    `/out:${path.join(STAGE, 'Caspita.exe')}`,
    '/reference:System.Windows.Forms.dll',
    path.join(ROOT, 'desktop', 'Caspita.cs'),
  ]);
  fs.copyFileSync(ICON, path.join(STAGE, 'Caspita.ico'));
  if (sign) sign(path.join(STAGE, 'Caspita.exe'));
  console.log(`  סה"כ לפני דחיסה: ${mb(sizeOf(STAGE))}`);

  step('תוכנת התקנה (NSIS)');
  fs.mkdirSync(RELEASE, { recursive: true });
  const setup = path.join(RELEASE, `Caspita-Setup-${pkg.version}.exe`);
  run(findMakensis(), [
    '/V2',
    '/INPUTCHARSET', 'UTF8',
    `/DVERSION=${pkg.version}`,
    `/DSTAGE=${STAGE}`,
    `/DOUTFILE=${setup}`,
    `/DICON=${ICON}`,
    path.join(ROOT, 'desktop', 'installer.nsi'),
  ]);
  if (sign) sign(setup);
  console.log(`\n✓ ${path.relative(ROOT, setup)} — ${mb(fs.statSync(setup).size)}`);
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
}
