# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Caspita** is a personal finance dashboard that scrapes Israeli bank and credit card accounts and displays transactions grouped by merchant. It consists of:

- **Backend**: Express + TypeScript (CommonJS), port 3000
- **Frontend**: Angular 21 with NgModules (not standalone), RTL Hebrew UI
- **Database**: SQLite via Sequelize (file: `caspita.db` in project root)
- **Scraping**: `israeli-bank-scrapers` 6.x (CommonJS) + custom Hapoalim scraper in `src/scrapers/`

All UI text, labels, and error messages must be in **Hebrew**.

## Development Commands

### Backend
```bash
npm start          # Run backend (ts-node src/index.ts)
npm run build      # Compile TypeScript to dist/
```

### Frontend
```bash
cd caspita-client
npm start          # ng serve on port 4200 (proxies /api → localhost:3000)
npm run build      # Production build → caspita-client/dist/
npm run watch      # Build in watch mode (development)
```

### Production
Run `npm run build` + `npm run build:client` then `npm start` — the backend serves the Angular build as static files from `caspita-client/dist/caspita-client/browser/`.

## Architecture

### Data Flow
1. Sync: `POST /api/sync` starts a background sync (`sync.service.ts`); the client polls `GET /api/sync/status` and `GET /api/otp/status` every 2s (`SyncService` in the client, sidebar button)
2. Each active bank config is scraped in parallel with a **persistent Chrome profile** (`data/browser-profiles/bank-<id>`, gitignored) so banks remember the device. First sync = 364 days back, later syncs = 60 days back
3. Transactions are upserted into the `transactions` table (stable `hash`); pending rows are replaced each sync (manual maaser marks carried over)
4. After sync: `accountsService.detectCardLinks()` (links each card to the bank account it's paid from by amount matching, marks bank debits as `cardPaymentForAccountId` so they're not double-counted) then `recurringService.detect()` (standing orders from 6 months of history)
5. All pages read from the DB — no scraping on page load

### Domain features
- **Maaser** (`maaser.service.ts`): `roleOf()` decides income/donation per transaction — manual `maaserOverride` wins, then `maaser_rules` (`donation` payees, `income_exclude` sources); bank credits are income by default. Settings (percent, start month, opening balance) in `settings` table
- **Recurring** (`recurring.service.ts`): ≥3 months, ≥75% continuity, day spread ≤5. Auto items not seen in 2 months → `ended`; user `ignored`/`manual` items are never overwritten
- **Merchant names** (`merchantName()` in `utils/text.ts`): generic bank transfer descriptions ("העברה לאחר", "העברה/הפקדה"...) take the payee from the memo ("לטובת:"/"המבצע:") — used for grouping and category keys
- **Offset pairs**: a credit matched to a same-amount transfer debit (loan + repayment, money passed through) is maaser-exempt and both sides are excluded from income/expense totals (`offsetNote` on the DTO). Reversals — a bank credit with the same merchant name and exact opposite amount of an earlier debit on the same account (within 60 days) — pair at any amount (e.g. a refunded 2₪ fee)
- **Overview** (`caspita-client/src/app/overview`, default route): composed client-side from forecast + current month + maaser + banks — account balances with lowest expected balance, "needs attention" list (overdraft, failed/stale sync, late recurring, unlinked cards, uncategorized spend, maaser due), upcoming 31 days
- **Loans** (`loans.service.ts`, `models/loan.model.ts`, routes `/loans/given` + `/loans/taken` sharing `LoansComponent`): `loans` + `loan_payments` (manual/cash) tables, bank transactions linked via `transactions.loanId` (carried over on pending replace). Given loans: principal and repayments are excluded from income/expense and maaser. Taken loans: principal credit excluded, monthly payments still count as expenses. Candidate matching by counterparty name (ש/ס and וו/ו folded); suggestions from transactions mentioning הלוואה and from active recurring loan-like debits
- **Savings** (`savings.service.ts`, `models/savings.model.ts`, `/savings`): gemach deposits / study funds / other. Value = known balance (with date) + linked movements after that date; `penaltyPct` gives withdrawable. Bank debits linked via `transactions.savingsId` are savings, not expenses (and withdrawals are not income). Loans and savings both support `matchKey` + `matchAmount` auto-linking, run after each sync (loans first, so a loan payment with the same description isn't taken as a deposit)
- **Investments** (`investments.service.ts`, `quotes.service.ts`, `models/holding.model.ts`, `/investments`): holdings with `priceSource` yahoo (public chart API, 60s cache, ILA→ILS, `ILS=X` for USD) or manual (Israeli mutual funds — TASE blocks automated access, don't work around it). Client refreshes every 60s while open
- **Net worth** (`networth.service.ts`, `GET /api/networth`): bank balances + savings + investments + loans given − loans taken; shown on the overview
- **Loan credits** (`isLoanCredit`): bank credits mentioning הלוואה are not income in totals/dashboard (loan taken or loan repaid to me); current-month comparisons use the previous month up to the same day
- **Dashboard** (`dashboard.service.ts`, `GET /api/dashboard?months=`): monthly income/expenses/net, month-end bank balance reconstructed backwards from the current balance, maaser balance, top categories; "typical" = median of completed months. Charts are hand-built SVG (`dashboard/month-chart`, `forecast/balance-chart`); time flows right→left
- **Budgets**: `categories.monthlyBudget` (set inline on the categories page). `byCategory[].budget` + `budget` insights (over budget, or spending faster than the month's pace)
- **Splits** (`transaction_splits`, `splits.service.ts`, `PUT /api/transactions/:id/splits`): parts of a transaction in other categories; the remainder stays in the transaction's category. Always go through `categoryPortions()` when summing by category. Splits, manual category and loan/savings links are carried over when pending rows are replaced
- **Installments** (`installments.service.ts`, `/installments`): card plans grouped by account + identifier (without `_N`). A plan can be marked as a loan (`POST /api/installments/loan`) — all its rows, including future ones (`installmentsService.autoLink()` after sync), are linked to the loan
- **Funds** (`funds` table, `funds.service.ts`, `/funds`): virtual sinking funds — monthly amount × months since start − spending in the linked category (no money moves)
- **Alerts** (`alerts.service.ts`, `GET /api/alerts`, bell in the sidebar + overview): fixed charges that got cheaper or more expensive (stable months then a change), taken-loan payment changes (mortgage rate), budget pace, installments ending. Dismissed keys in `settings['alerts.dismissed']`
- **Section 46** (`tax.service.ts`): user marks donation payees with an approved-institution certificate (`settings['section46.payees']`) or single transactions (`settings['section46.transactions']`); 35% credit per year. The app cannot know eligibility by itself
- **Donation report import** (`donation-import.service.ts`, `POST /api/tax/donations/preview` with the raw PDF, then `/apply`): parses the tax authority's "ריכוז תרומות" PDF (`pdf-parse`), matches each row to a debit by organization-name tokens + amount within 200 days (cash rows only to cash-account transactions), offers to create missing cash donations. Re-importing is idempotent
- **Assistant** (`assistant.service.ts`, `src/assistant/mcp-server.js`, `/assistant`): spawns the locally installed `claude -p` (or `codex exec`) — no API key. The CLI gets one MCP tool, `query`: read-only SQL over an in-memory copy of `GET /api/assistant/dataset` (flattened DTOs, no credentials). Claude follow-ups use `--resume`; Codex gets the history in the prompt. The query tool is pre-approved via `mcp_servers.caspita.tools.query.approval_mode`
- **Cash wallet** (`wallet.service.ts`, `GET /api/wallet`, `/wallet`): ATM withdrawals (`CASH_WITHDRAWAL`) have no category by default. Cash-account expenses are deducted from the nearest earlier withdrawal (within 60 days) — `cashCovered` on the DTO, subtracted in `sumExpenses()` and `categoryPortions()` so cash isn't counted twice. The rest of a withdrawal can be split (splits have an optional `note`)
- **Category rules** (`category_rules`, `rules.service.ts`, `/api/categories/rules`): text contains / amount range / direction / account → category. Priority: manual per-transaction category > rule (more conditions wins, then newest) > merchant category. `ruleId` on the DTO; `POST /categories/rules/preview` shows what a rule would catch
- **Tags** (`tags` + `transaction_tags`, `tags.service.ts`, `/tags`): free event tags across categories/months; `tagIds` on the DTO; carried over on pending replace
- **Year summary** (`year.service.ts`, `GET /api/year?year=`, `/year`): income/expenses by month, categories (vs. same period last year only when that year has full data), top merchants, maaser, section 46, fees, cash, tags. Printable (`@media print` in `styles.scss`)
- **Alerts** also include: given loans with `expectedMonthly`/`expectedDay` behind schedule (7-day grace, cumulative since start), duplicate charges (same account/day/amount/description, ≥100₪), a charge ≥2.5× the merchant's median and above its previous max (donations excluded), a first ≥400₪ charge from an unknown merchant on a card, and a new bank fee
- **Forecast** (`forecast.service.ts`): per bank account — balance + upcoming card charges (card txns by `processedDate`) + active recurring items not yet seen this month → timeline, min balance, overdraft warning

### Bank Config Storage
Bank credentials are stored in SQLite (`bank_configs` table) encrypted with **AES-256-GCM** via `src/utils/crypto.ts`. The encryption key is derived from `SECRET_KEY` env var (falls back to a dev default). Credentials are never sent to the frontend. Partial credential updates are merged with existing ones.

### Schema changes
SQLite + Sequelize `sync()` doesn't alter existing tables. New columns on existing tables go through `ensureColumns()` in `src/models/index.ts` (`src/utils/migrate.ts`).

### Supported Companies
`src/config/companies.config.ts` derives the list from the library's `SCRAPERS` export, adding Hebrew names, account kind (bank/card) and field labels. Served via `GET /api/banks/supported`.

### israeli-bank-scrapers
Version 6.x is CommonJS — static imports (including deep `israeli-bank-scrapers/lib/...` paths) work fine.

### Hapoalim custom scraper
`src/scrapers/hapoalim.scraper.ts` extends the library's `HapoalimScraper` because upstream (6.13.0) still lacks: SMS OTP handling (PR #1084) and the 150-row server cap (PR #1191). It overrides `login()` (OTP via `otpService` → UI dialog, 90s redirect wait) and `fetchData()` (splits date range when a page is full). Re-check upstream when upgrading; drop the subclass once those PRs are merged.

The old Mercantile patch is no longer needed — upstream `discount.js` includes `retail2` since 6.7.8.

## Angular Frontend Constraints

- **NgModules only** — all components use `standalone: false`. Never add `standalone: true`.
- **Zone.js** — explicitly listed in `angular.json` polyfills and as a package dependency. Required because Angular 20+ doesn't include it by default.
- **Change detection** — use immutable array operations (`[...arr]`, `.map()`, `.filter()`) when updating component state arrays. Mutating in place (e.g. `push()`) won't trigger re-renders.
- **Loading flags** — set `loading = false` directly inside `next` and `error` callbacks of subscriptions, **not** in `finalize()`. The `finalize()` operator runs outside Angular's zone.
- **Subscriptions** — use `takeUntil(this.destroy$)` with a `Subject` completed in `ngOnDestroy`.

### Shared `ListRowComponent`
Used on both the banks page and transactions page. Inputs: `icon`, `iconGradient` (`primary`/`success`/`warning`/`neutral`), `title`, `subtitle`, `value`, `valueColor` (`expense`/`income`/`neutral`), `badge`, `badgeColor` (`active`/`inactive`/`warning`), `clickable`. Action buttons go in `<ng-content select="[slot=actions]">`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Express bootstrap, static file serving |
| `src/utils/crypto.ts` | AES-256-GCM encrypt/decrypt for credentials |
| `src/utils/db.ts` | Sequelize SQLite connection (`caspita.db`) |
| `src/config/companies.config.ts` | All supported banks + their credential fields |
| `src/services/scraper.service.ts` | Launches browser (persistent profile) + scraper per bank |
| `src/services/transactions.service.ts` | Month view from DB + grouping |
| `src/services/sync.service.ts` | Background sync, upsert, post-sync analysis |
| `src/services/{maaser,recurring,forecast,accounts}.service.ts` | Domain logic (see above) |
| `src/services/banks.service.ts` | CRUD for bank configs, credential encryption |
| `caspita-client/src/app/shared/` | `ListRowComponent`, `SharedModule`, `MaterialModule` |

## Demo Mode

`npm run demo` runs the server on port 3001 (`DEMO_PORT`) with a separate `caspita-demo.db` (`CASPITA_DB`), seeded with fake data by `src/demo/seed.ts` on first run. `npm run demo:reset` rebuilds it (dates are relative to today). In demo mode (`IS_DEMO` in `utils/db.ts`) sync is simulated — no scraping. Requires the client build (`npm run build:client`).

## Scraper Debug Mode

Set `SHOW_BROWSER=true` (and optionally `KEEP_OPEN_MS`) in `.env` to see the browser while scraping. Default is headless. Server binds to `127.0.0.1` unless `HOST` is set.
