import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { today } from '../utils/dates';

export type AssistantEngine = 'claude' | 'codex';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantAnswer {
  answer: string;
  engine: AssistantEngine;
  /** ל-Claude: מזהה השיחה להמשך (resume) */
  sessionId: string | null;
  durationMs: number;
}

export class AssistantError extends Error {}

const TIMEOUT_MS = 4 * 60 * 1000;
const PORT = Number(process.env.PORT || 3000);
const API = `http://127.0.0.1:${PORT}/api`;
const MCP_SERVER = path.join(process.cwd(), 'src', 'assistant', 'mcp-server.js');
/** תיקייה ריקה — כדי שהעוזר לא יטען את קבצי הפרויקט */
const WORKDIR = path.join(os.tmpdir(), 'caspita-assistant');

const BINARIES: Record<AssistantEngine, string> = {
  claude: process.env.CLAUDE_BIN || 'claude',
  codex: process.env.CODEX_BIN || 'codex',
};

function systemPrompt(): string {
  return [
    'אתה העוזר של כספיטה — מערכת לניהול הכספים האישיים של המשתמש (בנקים וכרטיסי אשראי בישראל).',
    `היום ${today()}.`,
    'ענה בעברית, קצר וברור, כמו לחבר. סכומים בשקלים מעוגלים (למשל 1,234 ₪).',
    'כדי לענות השתמש בכלי query של caspita (שאילתות SQL לקריאה בלבד). אל תנחש מספרים — כל מספר צריך לבוא מהנתונים.',
    'לסיכומי הוצאות והכנסות השתמש רק בעסקאות עם counted=1. "השנה" = מתחילת השנה הנוכחית.',
    'אם חסר מידע, אמור מה חסר. אין לך אפשרות לשנות נתונים — אם המשתמש מבקש שינוי, הסבר איפה עושים את זה בממשק.',
    'בלי טבלאות markdown; רשימה עם "- " מותרת, והדגשה עם **.',
  ].join('\n');
}

function ensureWorkdir(): void {
  fs.mkdirSync(WORKDIR, { recursive: true });
}

function writeMcpConfig(): string {
  ensureWorkdir();
  const file = path.join(WORKDIR, 'mcp.json');
  const config = { mcpServers: { caspita: { type: 'stdio', command: process.execPath, args: [MCP_SERVER], env: { CASPITA_API: API } } } };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

function runProcess(bin: string, args: string[], input: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: WORKDIR, windowsHide: true, env: { ...process.env, CASPITA_API: API } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new AssistantError('העוזר לא ענה בזמן (4 דקות). נסה שאלה פשוטה יותר.'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new AssistantError(err.code === 'ENOENT' ? `לא נמצא ${bin} במחשב` : err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(input, 'utf8');
  });
}

async function askClaude(question: string, sessionId: string | null): Promise<{ answer: string; sessionId: string | null }> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--strict-mcp-config',
    '--mcp-config', writeMcpConfig(),
    '--tools', '',
    '--allowedTools', 'mcp__caspita__query',
    '--append-system-prompt', systemPrompt(),
  ];
  if (sessionId) args.push('--resume', sessionId);
  const { stdout, stderr, code } = await runProcess(BINARIES.claude, args, question);
  let parsed: { result?: string; session_id?: string; is_error?: boolean } | null = null;
  try {
    parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '') as { result?: string; session_id?: string; is_error?: boolean };
  } catch {
    parsed = null;
  }
  if (!parsed?.result || parsed.is_error) {
    const detail = (parsed?.result || stderr || stdout).trim().slice(0, 400);
    throw new AssistantError(`Claude לא החזיר תשובה${code ? ` (קוד ${code})` : ''}${detail ? `: ${detail}` : ''}`);
  }
  return { answer: parsed.result.trim(), sessionId: parsed.session_id ?? null };
}

function toml(value: string): string {
  return JSON.stringify(value.replace(/\\/g, '/'));
}

async function askCodex(question: string, history: AssistantTurn[]): Promise<string> {
  ensureWorkdir();
  const out = path.join(WORKDIR, `codex-${Date.now()}.txt`);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '-s', 'read-only',
    '-C', WORKDIR,
    '-o', out,
    '-c', 'approval_policy="never"',
    '-c', `mcp_servers.caspita.command=${toml(process.execPath)}`,
    '-c', `mcp_servers.caspita.args=[${toml(MCP_SERVER)}]`,
    '-c', `mcp_servers.caspita.env={ CASPITA_API = ${toml(API)} }`,
    // רק הכלי הזה מאושר מראש — שאילתות קריאה בלבד
    '-c', 'mcp_servers.caspita.tools.query.approval_mode="approve"',
    '-',
  ];
  const convo = history.slice(-6).map((t) => `${t.role === 'user' ? 'המשתמש' : 'אתה'}: ${t.text}`).join('\n\n');
  const prompt = `${systemPrompt()}\n\n${convo ? `השיחה עד עכשיו:\n${convo}\n\n` : ''}השאלה: ${question}`;
  const { stderr, code } = await runProcess(BINARIES.codex, args, prompt);
  const answer = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim() : '';
  fs.rmSync(out, { force: true });
  if (!answer) throw new AssistantError(`Codex לא החזיר תשובה${code ? ` (קוד ${code})` : ''}: ${stderr.trim().slice(-400)}`);
  return answer;
}

async function ask(question: string, engine: AssistantEngine, sessionId: string | null, history: AssistantTurn[]): Promise<AssistantAnswer> {
  const started = Date.now();
  if (engine === 'claude') {
    const r = await askClaude(question, sessionId);
    return { answer: r.answer, engine, sessionId: r.sessionId, durationMs: Date.now() - started };
  }
  const answer = await askCodex(question, history);
  return { answer, engine, sessionId: null, durationMs: Date.now() - started };
}

let enginesCache: { at: number; value: Record<AssistantEngine, boolean> } | null = null;

/** אילו כלים מותקנים במחשב */
function engines(): Record<AssistantEngine, boolean> {
  if (enginesCache && Date.now() - enginesCache.at < 5 * 60 * 1000) return enginesCache.value;
  const check = (bin: string) => {
    const r = spawnSync(bin, ['--version'], { windowsHide: true, timeout: 15000 });
    return r.status === 0;
  };
  const value = { claude: check(BINARIES.claude), codex: check(BINARIES.codex) };
  enginesCache = { at: Date.now(), value };
  return value;
}

export const assistantService = { ask, engines };
