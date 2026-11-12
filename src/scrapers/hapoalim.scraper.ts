/**
 * סקרייפר בנק הפועלים מורחב.
 *
 * הגרסה בספרייה (6.13.0) לא מטפלת בשני דברים שבורים כרגע מול הבנק:
 *  1. קוד SMS (OTP) בכניסה ממכשיר לא מוכר — הספרייה מחכה 20 שניות ונכשלת.
 *     כאן: מזהים את טופס ה-OTP, מבקשים קוד מהמשתמש דרך ה-UI ומקלידים אותו.
 *     בנוסף הדפדפן רץ עם פרופיל קבוע (ראו scraper.service), כך שהבנק זוכר את המכשיר.
 *  2. השרת מחזיר לכל היותר 150 עסקאות לבקשה (החדשות ביותר) — עסקאות ישנות נעלמו בשקט.
 *     כאן: כשהתשובה מלאה, מפצלים את טווח התאריכים לחצאים עד שכל חלון נכנס בעמוד אחד.
 *
 * מבוסס על PR #1084 ו-#1191 בריפו של israeli-bank-scrapers (פתוחים, לא מוזגו).
 */
import moment, { type Moment } from 'moment';
import { randomUUID } from 'crypto';
import { type Page } from 'puppeteer';
import HapoalimScraper from 'israeli-bank-scrapers/lib/scrapers/hapoalim';
import { ScraperErrorTypes } from 'israeli-bank-scrapers/lib/scrapers/errors';
import { type ScraperCredentials, type ScraperScrapingResult } from 'israeli-bank-scrapers/lib/scrapers/interface';
import { fetchGetWithinPage, fetchPostWithinPage } from 'israeli-bank-scrapers/lib/helpers/fetch';
import { waitUntil, sleep } from 'israeli-bank-scrapers/lib/helpers/waiting';
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
  type TransactionsAccount,
} from 'israeli-bank-scrapers/lib/transactions';

const DATE_FORMAT = 'YYYYMMDD';
const BASE_URL = 'https://login.bankhapoalim.co.il';
const OTP_FORM_SELECTOR = 'form.auth-otp-login';
const OTP_SUBMIT_SELECTOR = '.btn-red_1';
const OTP_ERROR_SELECTOR = '.errors-rb .error-message, .auth-otp-login .error';
const MAX_OTP_ATTEMPTS = 3;
/** זמן המתנה להפניה אחרי לחיצה על כניסה — ארוך, כדי לאפשר גם הקלדה ידנית בדפדפן */
const LOGIN_REDIRECT_TIMEOUT = 90_000;

const SUCCESS_PATTERNS = ['/portalserver/HomePage', '/ng-portals-bt/rb/he/homepage', '/ng-portals/rb/he/homepage'];
const INVALID_PASSWORD_PATTERNS = ['errorcode=1.6'];
const CHANGE_PASSWORD_PATTERNS = [/\/MCP\/START/i, /\/ABOUTTOEXPIRE\/START/i];

export type OtpRetriever = (attempt: number) => Promise<string>;

interface HapoalimCredentials {
  userCode: string;
  password: string;
}

interface ScrapedTransaction {
  serialNumber?: number;
  activityDescription?: string;
  eventAmount: number;
  valueDate?: string;
  eventDate?: string;
  referenceNumber?: number;
  eventActivityTypeCode: number;
  beneficiaryDetailsData?: {
    partyHeadline?: string;
    partyName?: string;
    messageHeadline?: string;
    messageDetail?: string;
  };
}

interface TransactionsResponse {
  transactions?: ScrapedTransaction[];
  numItemsPerPage?: string | number;
}

interface AccountInfo {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}

interface BalanceResponse {
  currentBalance?: number;
}

function isHapoalimCredentials(c: ScraperCredentials): c is ScraperCredentials & HapoalimCredentials {
  return 'userCode' in c && 'password' in c;
}

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
    const isOutbound = txn.eventActivityTypeCode === 2;
    const memoLines: string[] = [];
    const b = txn.beneficiaryDetailsData;
    if (b?.partyHeadline) memoLines.push(b.partyHeadline);
    if (b?.partyName) memoLines.push(`${b.partyName}.`);
    if (b?.messageHeadline) memoLines.push(b.messageHeadline);
    if (b?.messageDetail) memoLines.push(`${b.messageDetail}.`);
    const amount = isOutbound ? -txn.eventAmount : txn.eventAmount;
    return {
      type: TransactionTypes.Normal,
      identifier: txn.referenceNumber,
      date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
      originalAmount: amount,
      originalCurrency: 'ILS',
      chargedAmount: amount,
      description: txn.activityDescription || '',
      status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
      memo: memoLines.join(' '),
    };
  });
}

async function currentUrl(page: Page): Promise<string> {
  return page.evaluate(() => window.location.href);
}

export class CaspitaHapoalimScraper extends HapoalimScraper {
  private otpRetriever?: OtpRetriever;

  setOtpRetriever(retriever: OtpRetriever): void {
    this.otpRetriever = retriever;
  }

  async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    if (!isHapoalimCredentials(credentials)) {
      return { success: false, errorType: ScraperErrorTypes.General, errorMessage: 'חסרים קוד משתמש או סיסמה' };
    }

    await this.navigateTo(`${BASE_URL}/cgi-bin/poalwwwc?reqName=getLogonPage`);

    // פרופיל קבוע — ייתכן שכבר מחוברים
    if (await this.isLoggedIn()) return { success: true };

    await this.page.waitForSelector('#userCode', { timeout: 30_000 });
    await this.fillInputs(this.page, [
      { selector: '#userCode', value: credentials.userCode },
      { selector: '#password', value: credentials.password },
    ]);
    await this.page.click('.login-btn');

    const initialUrl = await currentUrl(this.page).catch(() => '');
    await waitUntil(
      async () => {
        try {
          if ((await currentUrl(this.page)) !== initialUrl) return true;
          return !!(await this.page.$(OTP_FORM_SELECTOR));
        } catch {
          // ההקשר נהרס בגלל ניווט — זו התקדמות
          return true;
        }
      },
      'ממתין להפניה או לטופס קוד SMS',
      LOGIN_REDIRECT_TIMEOUT,
      1000
    );

    // אם המשתמש מקליד בעצמו בדפדפן, או שיש מעבר ביניים — מחכים לתוצאה ברורה
    const outcome = await this.waitForLoginOutcome(LOGIN_REDIRECT_TIMEOUT);
    if (outcome === 'otp') return this.handleOtp();
    return this.resultFromOutcome(outcome);
  }

  private async isLoggedIn(): Promise<boolean> {
    const url = await currentUrl(this.page).catch(() => '');
    return SUCCESS_PATTERNS.some((p) => url.includes(p));
  }

  private async waitForLoginOutcome(timeout: number): Promise<'success' | 'invalid' | 'change' | 'otp' | 'unknown'> {
    try {
      return await waitUntil(
        async () => {
          try {
            const url = await currentUrl(this.page);
            if (SUCCESS_PATTERNS.some((p) => url.includes(p))) return 'success' as const;
            if (INVALID_PASSWORD_PATTERNS.some((p) => url.includes(p))) return 'invalid' as const;
            if (CHANGE_PASSWORD_PATTERNS.some((p) => p.test(url))) return 'change' as const;
            if (await this.page.$(OTP_FORM_SELECTOR)) return 'otp' as const;
            return false;
          } catch {
            return false;
          }
        },
        'ממתין לתוצאת התחברות',
        timeout,
        1000
      );
    } catch {
      return 'unknown';
    }
  }

  private resultFromOutcome(outcome: 'success' | 'invalid' | 'change' | 'otp' | 'unknown'): ScraperScrapingResult {
    switch (outcome) {
      case 'success':
        return { success: true };
      case 'invalid':
        return { success: false, errorType: ScraperErrorTypes.InvalidPassword, errorMessage: 'קוד משתמש או סיסמה שגויים' };
      case 'change':
        return { success: false, errorType: ScraperErrorTypes.ChangePassword, errorMessage: 'הבנק דורש להחליף סיסמה — יש להיכנס לאתר הבנק ולהחליף' };
      default:
        return { success: false, errorType: ScraperErrorTypes.General, errorMessage: 'ההתחברות לבנק הפועלים לא הושלמה בזמן' };
    }
  }

  private async handleOtp(): Promise<ScraperScrapingResult> {
    if (!this.otpRetriever) {
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: 'הבנק ביקש קוד SMS ואין דרך לקבל אותו',
      };
    }

    for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
      const code = (await this.otpRetriever(attempt)).replace(/\D/g, '');
      const inputs = await this.page.$$(`${OTP_FORM_SELECTOR} input[type="text"], ${OTP_FORM_SELECTOR} input[type="tel"]`);

      if (inputs.length === 1) {
        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(code, { delay: 60 });
      } else {
        for (let i = 0; i < inputs.length; i++) {
          await inputs[i].click();
          await inputs[i].evaluate((el) => {
            (el as HTMLInputElement).value = '';
          });
          if (i < code.length) await inputs[i].type(code[i], { delay: 60 });
          await sleep(100);
        }
      }

      // page.click מייצר אירועי עכבר אמיתיים — Angular מתעלם מ-el.click()
      await this.page.click(OTP_SUBMIT_SELECTOR);

      let otpResult: 'gone' | 'error' | 'timeout' = 'timeout';
      try {
        otpResult = await waitUntil(
          async () => {
            try {
              if (!(await this.page.$(OTP_FORM_SELECTOR))) return 'gone' as const;
              if (await this.page.$(OTP_ERROR_SELECTOR)) return 'error' as const;
              return false;
            } catch {
              return 'gone' as const;
            }
          },
          'ממתין לאימות קוד SMS',
          20_000,
          1000
        );
      } catch {
        otpResult = 'timeout';
      }

      if (otpResult === 'gone') {
        const outcome = await this.waitForLoginOutcome(30_000);
        if (outcome === 'otp') continue;
        return this.resultFromOutcome(outcome);
      }
    }

    return {
      success: false,
      errorType: ScraperErrorTypes.General,
      errorMessage: `קוד ה-SMS נדחה ${MAX_OTP_ATTEMPTS} פעמים`,
    };
  }

  async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const page = this.page;
    await waitUntil(() => page.evaluate(() => 'bnhpApp' in window), 'ממתין לטעינת אפליקציית הבנק');
    const restContext = await page.evaluate(() => {
      const app = (window as Window & { bnhpApp?: { restContext?: string } }).bnhpApp;
      return app?.restContext ?? '';
    });
    const apiSiteUrl = `${BASE_URL}/${restContext.slice(1)}`;

    const accountsInfo = (await fetchGetWithinPage<AccountInfo[]>(page, `${BASE_URL}/ServerServices/general/accounts`)) ?? [];
    const openAccounts = accountsInfo.filter((a) => a.accountClosingReasonCode === 0);

    const defaultStart = moment().subtract(1, 'years').add(1, 'day');
    const startMoment = moment.max(defaultStart, moment(this.options.startDate));
    const endMoment = moment();

    const accounts: TransactionsAccount[] = [];
    for (const info of openAccounts) {
      const accountNumber = `${info.bankNumber}-${info.branchNumber}-${info.accountNumber}`;
      const balance = await fetchGetWithinPage<BalanceResponse>(
        page,
        `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details&lang=he`
      );
      const raw = await this.fetchTransactionsInRange(page, apiSiteUrl, accountNumber, startMoment, endMoment);
      accounts.push({ accountNumber, balance: balance?.currentBalance, txns: convertTransactions(raw) });
    }
    return { success: true, accounts };
  }

  /** השרת מגביל ל-150 שורות בלי סמן עמוד — מפצלים את הטווח עד שכל חלון נכנס */
  private async fetchTransactionsInRange(
    page: Page,
    apiSiteUrl: string,
    accountNumber: string,
    start: Moment,
    end: Moment
  ): Promise<ScrapedTransaction[]> {
    const url =
      `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=1000` +
      `&retrievalEndDate=${end.format(DATE_FORMAT)}&retrievalStartDate=${start.format(DATE_FORMAT)}&sortCode=1`;
    const result = await this.fetchWithXsrf(page, url);
    const txns = result?.transactions ?? [];
    const pageSize = Number(result?.numItemsPerPage);
    const isFull = pageSize > 0 && txns.length >= pageSize;
    const days = end.diff(start, 'days');
    if (!isFull || days < 1) return txns;

    const mid = start.clone().add(Math.floor(days / 2), 'days');
    const older = await this.fetchTransactionsInRange(page, apiSiteUrl, accountNumber, start, mid);
    const newer = await this.fetchTransactionsInRange(page, apiSiteUrl, accountNumber, mid.clone().add(1, 'day'), end);
    return [...newer, ...older];
  }

  private async fetchWithXsrf(page: Page, url: string): Promise<TransactionsResponse | null> {
    const cookies = await page.cookies();
    const xsrf = cookies.find((c) => c.name === 'XSRF-TOKEN');
    const headers: Record<string, string> = {
      pageUuid: '/current-account/transactions',
      uuid: randomUUID(),
      'Content-Type': 'application/json;charset=UTF-8',
    };
    if (xsrf) headers['X-XSRF-TOKEN'] = xsrf.value;
    return fetchPostWithinPage<TransactionsResponse>(page, url, [], headers);
  }
}
