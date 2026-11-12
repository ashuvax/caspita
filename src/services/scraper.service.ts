import path from 'path';
import fs from 'fs';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createScraper, CompanyTypes, type ScraperCredentials, type ScraperOptions, type ScraperScrapingResult } from 'israeli-bank-scrapers';
import { type TransactionsAccount } from 'israeli-bank-scrapers/lib/transactions';
import { BankConfig } from '../models/bank-config.model';
import { isSupportedCompany } from '../config/companies.config';
import { CaspitaHapoalimScraper } from '../scrapers/hapoalim.scraper';
import { banksService } from './banks.service';
import { otpService } from './otp.service';

/** SHOW_BROWSER=true ב-.env כדי לראות את הדפדפן בזמן שליפה (לדיבאג) */
const SHOW_BROWSER = process.env.SHOW_BROWSER === 'true';
const KEEP_OPEN_MS = Number(process.env.KEEP_OPEN_MS ?? 30_000);
/** פרופיל דפדפן קבוע לכל חיבור — הבנקים זוכרים את המכשיר ולא מבקשים SMS בכל פעם */
const PROFILES_DIR = path.join(process.cwd(), 'data', 'browser-profiles');

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
  return puppeteer.launch({
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

async function scrapeBank(config: BankConfig, startDate: Date): Promise<TransactionsAccount[]> {
  if (!isSupportedCompany(config.companyId)) {
    throw new Error(`חברה לא נתמכת: ${config.companyId}`);
  }
  const companyId = config.companyId;
  const credentials = banksService.getDecryptedCredentials(config);
  log(config.displayName, `מתחיל שליפה | companyId=${companyId} | מתאריך ${startDate.toISOString().slice(0, 10)}`);

  const browser = await launchBrowser(config);
  const options: ScraperOptions = {
    companyId,
    startDate,
    browser,
    skipCloseBrowser: false,
    combineInstallments: false,
    futureMonthsToScrape: 2,
    defaultTimeout: 60_000,
    preparePage: async (page: Page) => {
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) log(config.displayName, `[NAV] ${frame.url()}`);
      });
    },
  };

  let result: ScraperScrapingResult;
  try {
    if (companyId === CompanyTypes.hapoalim) {
      const scraper = new CaspitaHapoalimScraper(options);
      scraper.setOtpRetriever((attempt) => otpService.waitForOtp(config.displayName, attempt));
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
    await keepBrowserOpen(config.displayName);
    await browser.close().catch(() => undefined);
    throw new Error(describeError(result));
  }
  return result.accounts ?? [];
}

export const scraperService = { scrapeBank };
