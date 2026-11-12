#!/usr/bin/env node
/*
 * שרת MCP מקומי (stdio) לעוזר של כספיטה.
 * Claude Code / Codex שמותקנים במחשב מפעילים אותו, והוא חושף כלי אחד: query —
 * שאילתת SELECT על עותק לקריאה בלבד של הנתונים (נטען מהשרת המקומי לזיכרון).
 * אין כאן גישה לכתיבה, לפרטי התחברות לבנקים, או לקובץ מסד הנתונים עצמו.
 */
'use strict';
const sqlite3 = require('sqlite3');
const readline = require('readline');

const API = process.env.CASPITA_API || 'http://127.0.0.1:3000/api';
const MAX_ROWS = 300;

const SCHEMA = `טבלאות (SQLite):
- transactions(id, date 'YYYY-MM-DD', month 'YYYY-MM', charge_date, merchant, description, memo, amount REAL — שלילי=יצא, חיובי=נכנס, original_amount, original_currency, account, account_kind 'bank'|'card'|'cash', category, counted 1/0, not_counted_reason, maaser_role 'income'|'donation'|NULL, installment 'n/N', status, cash_withdrawal 1/0, cash_recorded)
  * לסיכומי הכנסות/הוצאות השתמש רק ב-counted=1. הכנסה = amount>0 AND account_kind<>'card'. זיכוי בכרטיס הוא החזר שמקטין הוצאה.
  * counted=0: תשלומי כרטיס, העברות בין החשבונות שלי, הלוואות, חסכונות — לא הוצאה ולא הכנסה (not_counted_reason מסביר).
  * משיכת מזומן (cash_withdrawal=1): cash_recorded = כמה ממנה כבר נרשם כהוצאות מזומן (account_kind='cash') — לסכום הוצאות חסר את cash_recorded מהמשיכה כדי לא לספור פעמיים.
- transaction_splits(transaction_id, category, amount, note) — חלק מעסקה ששייך לקטגוריה אחרת (השארית בקטגוריה של העסקה)
- transaction_tags(transaction_id, tag) — תגיות לאירועים ("חתונה", "פסח")
- categories(name, monthly_budget)
- loans(direction 'נתתי'|'לקחתי', counterparty, amount, paid, remaining, monthly_payment, start_date, due_date, status, note)
- savings(name, kind, value, withdrawable, monthly_deposit, note)
- holdings(account, name, symbol, quantity, currency, price, value_ils, cost, gain)
- recurring(name, account, direction 'חיוב'|'זיכוי', day_of_month, amount, status 'active'|'ended'|'ignored')
- maaser_months(month, income, due, paid, balance — חיובי=עוד חייב מעשרות)
- installments(name, account, total_amount, per_payment, total_payments, paid_payments, remaining_amount, end_month, loan)
- funds(name, monthly_amount, target_amount, target_date, balance, category) — קופות ייעודיות`;

let dbPromise = null;

function run(db, sql, params) {
  return new Promise((resolve, reject) => db.run(sql, params || [], (err) => (err ? reject(err) : resolve())));
}

async function loadDb() {
  const res = await fetch(`${API}/assistant/dataset`);
  if (!res.ok) throw new Error(`השרת המקומי החזיר ${res.status}`);
  const { tables } = await res.json();
  const db = new sqlite3.Database(':memory:');
  for (const [name, rows] of Object.entries(tables)) {
    const cols = rows.length ? Object.keys(rows[0]) : ['empty'];
    await run(db, `CREATE TABLE ${name} (${cols.map((c) => `"${c}"`).join(', ')})`);
    if (!rows.length) continue;
    await run(db, 'BEGIN');
    const placeholders = cols.map(() => '?').join(', ');
    for (const r of rows) await run(db, `INSERT INTO ${name} VALUES (${placeholders})`, cols.map((c) => r[c]));
    await run(db, 'COMMIT');
  }
  return db;
}

function getDb() {
  if (!dbPromise) dbPromise = loadDb().catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

async function query(sql) {
  const clean = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(clean) || clean.includes(';')) throw new Error('רק שאילתת SELECT אחת');
  const db = await getDb();
  const rows = await new Promise((resolve, reject) => db.all(clean, (err, r) => (err ? reject(err) : resolve(r))));
  const shown = rows.slice(0, MAX_ROWS);
  return JSON.stringify({ rowCount: rows.length, truncated: rows.length > MAX_ROWS, rows: shown });
}

const TOOLS = [
  {
    name: 'query',
    description: `שאילתת SQL (SELECT בלבד) על הנתונים הפיננסיים של המשתמש. מחזיר עד ${MAX_ROWS} שורות.\n${SCHEMA}`,
    inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'שאילתת SELECT' } }, required: ['sql'] },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // התראה — אין תשובה
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'caspita', version: '1.0.0' } } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      if (!params || params.name !== 'query') throw new Error('כלי לא מוכר');
      try {
        const text = await query(params.arguments && params.arguments.sql);
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `שגיאה: ${e.message}` }], isError: true } });
      }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  handle(msg);
});
rl.on('close', () => process.exit(0));
