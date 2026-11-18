import path from 'path';
import fs from 'fs';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createScraper, CompanyTypes, type ScraperCredentials, type ScraperOptions, type ScraperScrapingResult } from 'israeli-bank-scrapers';
import { type TransactionsAccount } from 'israeli-bank-scrapers/lib/transactions';
import { ScraperErrorTypes } from 'israeli-bank-scrapers/lib/scrapers/errors';
import { BankConfig } from '../models/bank-config.model';
import { isSupportedCompany } from '../config/companies.config';
import { CaspitaHapoalimScraper } from '../scrapers/hapoalim.scraper';
import { banksService } from './banks.service';
import { otpService } from './otp.service';
import { diagnosticsService } from './diagnostics.service';
import { PROFILES_DIR } from '../utils/paths';
import { ensureChrome } from '../utils/chrome';

/** SHOW_BROWSER=true ב-.env כדי לראות את הדפדפן בזמן שליפה (לדיבאג) */
const SHOW_BROWSER = process.env.SHOW_BROWSER === 'true';
const KEEP_OPEN_MS = Number(process.env.KEEP_OPEN_MS ?? 30_000);

function log(tag: string, ...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}] [SCRAPER] [${tag}]`, ...args);
}

function logError(tag: string, ...args: unknown[]): void {
  console.error(`[${new Date().toISOString()}] [SCRAPER] [${tag}]`, ...args);
}

async function keepBrowserOpen(tag: string): Promise<void> {
  if (!SHOW_BROWSER) return;
  log(tag, `שגיאה — הדפדפן יישאר פתוח ${KEEP_OPEN_MS / 1000} שניות לבדיקה`);
  await new Promise((r) => setTimeout(r, KEEP_OPEN_MS));
}

async function launchBrowser(config: BankConfig): Promise<Browser> {
  const userDataDir = path.join(PROFILES_DIR, `bank-${config.id}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const executablePath = await ensureChrome();
  return puppeteer.launch({
    executablePath,
    headless: !SHOW_BROWSER,
    userDataDir,
    args: ['--disable-blink-features=AutomationControlled', '--lang=he-IL'],
  });
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_PASSWORD: 'פרטי ההתחברות שגויים',
  CHANGE_PASSWORD: 'הבנק דורש להחליף סיסמה — יש להיכנס לאתר ולהחליף',
  ACCOUNT_BLOCKED: 'החשבון חסום — יש לפנות לבנק',
  TIMEOUT: 'תם הזמן להתחברות לבנק',
  TWO_FACTOR_RETRIEVER_MISSING: 'הבנק דרש קוד SMS',
};

function describeError(result: ScraperScrapingResult): string {
  if (result.errorMessage && /[֐-׿]/.test(result.errorMessage)) return result.errorMessage;
  const known = result.errorType ? ERROR_MESSAGES[result.errorType] : undefined;
  if (known) return known;
  return `שגיאה בשליפה (${result.errorType ?? 'לא ידוע'}${result.errorMessage ? `: ${result.errorMessage}` : ''})`;
}

export interface ScrapedBank {
  config: BankConfig;
  accounts: TransactionsAccount[];
}

/** שגיאה מהשרת של הבנק אחרי הכניסה — לא סיסמה/חסימה/זמן — שאולי תעבור עם טווח קצר יותר */
class BankServerError extends Error {}

async function scrapeOnce(config: BankConfig, startDate: Date): Promise<TransactionsAccount[]> {
  if (!isSupportedCompany(config.companyId)) {
    throw new Error(`חברה לא נתמכת: ${config.companyId}`);
  }
  const companyId = config.companyId;
  const credentials = banksService.getDecryptedCredentials(config);
  log(config.displayName, `מתחיל שליפה | companyId=${companyId} | מתאריך ${startDate.toISOString().slice(0, 10)}`);
  const trace = diagnosticsService.start(config.id, companyId, config.displayName, startDate);

  let browser: Browser;
  try {
    browser = await launchBrowser(config);
  } catch (err) {
    diagnosticsService.finish(trace, { success: false, shownMessage: 'הפעלת הדפדפן נכשלה', error: err });
    throw err;
  }
  const options: ScraperOptions = {
    companyId,
    startDate,
    browser,
    skipCloseBrowser: false,
    combineInstallments: false,
    futureMonthsToScrape: 2,
    defaultTimeout: 60_000,
    // הספרייה מצלמת את הדף לפני שהיא סוגרת אותו בכשל — נכנס לדוח התקלה
    storeFailureScreenShotPath: diagnosticsService.screenshotPath(config.id),
    preparePage: async (page: Page) => {
      diagnosticsService.watchPage(trace, page);
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) log(config.displayName, `[NAV] ${frame.url()}`);
      });
    },
  };

  let result: ScraperScrapingResult;
  try {
    if (companyId === CompanyTypes.hapoalim) {
      const scraper = new CaspitaHapoalimScraper(options);
      scraper.setOtpRetriever((options) => otpService.waitForOtp(config.displayName, options));
      result = await scraper.scrape({ userCode: credentials.userCode ?? '', password: credentials.password ?? '' });
    } else {
      const scraper = createScraper(options);
      const withOtp: Record<string, unknown> = { ...credentials };
      if (companyId === CompanyTypes.oneZero && !credentials.otpLongTermToken) {
        withOtp.otpCodeRetriever = () => otpService.waitForOtp(config.displayName);
      }
      result = await scraper.scrape(withOtp as ScraperCredentials);
    }
  } catch (err) {
    logError(config.displayName, 'חריגה בזמן שליפה:', err);
    diagnosticsService.finish(trace, { success: false, shownMessage: err instanceof Error ? err.message : String(err), error: err });
    await keepBrowserOpen(config.displayName);
    await browser.close().catch(() => undefined);
    throw err instanceof Error ? err : new Error(String(err));
  }

  log(config.displayName, 'תוצאה:', {
    success: result.success,
    errorType: result.errorType,
    accounts: result.accounts?.map((a) => ({ accountNumber: a.accountNumber, balance: a.balance, txns: a.txns.length })),
  });

  if (!result.success) {
    const shownMessage = describeError(result);
    diagnosticsService.finish(trace, { success: false, errorType: result.errorType, errorMessage: result.errorMessage, shownMessage });
    await keepBrowserOpen(config.displayName);
    await browser.close().catch(() => undefined);
    throw result.errorType === ScraperErrorTypes.Generic ? new BankServerError(shownMessage) : new Error(shownMessage);
  }
  diagnosticsService.finish(trace, { success: true });
  return result.accounts ?? [];
}

/**
 * דיסקונט ומרכנתיל (אותה מערכת) מחזירים לפעמים SYSTEM_ERROR (T101010, "אין אפשרות לבצע את הפעולה")
 * על שליפת עסקאות של שנה — למשל בחשבון שנפתח לפני פחות משנה. במקרה כזה מנסים שוב עם טווח קצר יותר.
 */
const SHORTER_RANGE_COMPANIES: string[] = [CompanyTypes.discount, CompanyTypes.mercantile];
const FALLBACK_DAYS = [180, 90, 30];

async function scrapeBank(config: BankConfig, startDate: Date): Promise<{ accounts: TransactionsAccount[]; startDate: Date }> {
  const fallbacks = SHORTER_RANGE_COMPANIES.includes(config.companyId)
    ? FALLBACK_DAYS.map((days) => new Date(Date.now() - days * 86_400_000)).filter((d) => d > startDate)
    : [];
  let from = startDate;
  for (;;) {
    try {
      return { accounts: await scrapeOnce(config, from), startDate: from };
    } catch (err) {
      const next = fallbacks.shift();
      if (!(err instanceof BankServerError) || !next) throw err;
      log(config.displayName, `הבנק החזיר שגיאה על הטווח מ-${from.toISOString().slice(0, 10)} — מנסה שוב מ-${next.toISOString().slice(0, 10)}`);
      from = next;
    }
  }
}

export const scraperService = { scrapeBank };
