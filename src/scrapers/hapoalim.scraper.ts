/**
 * סקרייפר בנק הפועלים מורחב.
 *
 * הגרסה בספרייה (6.13.0) לא מטפלת בשני דברים שבורים כרגע מול הבנק:
 *  1. קוד SMS (OTP) בכניסה ממכשיר לא מוכר — הספרייה מחכה 20 שניות ונכשלת.
 *     כאן: מזהים את טופס ה-OTP, מבקשים קוד מהמשתמש דרך ה-UI ומקלידים אותו.
 *     אם הבנק מציע גם שיחה קולית — המשתמש בוחר בדיאלוג, ולוחצים על הכפתור המתאים באתר.
 *     בנוסף הדפדפן רץ עם פרופיל קבוע (ראו scraper.service), כך שהבנק זוכר את המכשיר.
 *  2. השרת מחזיר לכל היותר 150 עסקאות לבקשה (החדשות ביותר) — עסקאות ישנות נעלמו בשקט.
 *     כאן: כשהתשובה מלאה, מפצלים את טווח התאריכים לחצאים עד שכל חלון נכנס בעמוד אחד.
 *
 * מבוסס על PR #1084 ו-#1191 בריפו של israeli-bank-scrapers (פתוחים, לא מוזגו).
 */
import moment, { type Moment } from 'moment';
import { randomUUID } from 'crypto';
import { type ElementHandle, type Page } from 'puppeteer';
import HapoalimScraper from 'israeli-bank-scrapers/lib/scrapers/hapoalim';
import { ScraperErrorTypes } from 'israeli-bank-scrapers/lib/scrapers/errors';
import { type OtpChannel, type OtpOptions } from '../services/otp.service';
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

/** מקומות שבהם דף הכניסה מציג שגיאות (הפורטל החדש לא משנה כתובת בסיסמה שגויה) */
const LOGIN_ERROR_SELECTOR = '[role="alert"], .error-message, .errors-rb, .login-error, .validation-error, [class*="error-msg"], [class*="errorMsg"]';

type LoginOutcome =
  | { kind: 'success' | 'change' | 'otp' | 'chooseChannel' }
  | { kind: 'invalid'; message?: string }
  | { kind: 'blocked' | 'bankError'; message: string }
  | { kind: 'unknown'; message?: string };

function classifyLoginError(message: string): LoginOutcome {
  if (/חסו|נחסם|נעול|ננעל/.test(message)) return { kind: 'blocked', message };
  if (/שגוי|אינם נכונ|לא נכונ|אינו נכון|לא תקינ|אינם תואמ|לא תואמ/.test(message)) return { kind: 'invalid', message };
  return { kind: 'bankError', message };
}

export type OtpRetriever = (options: OtpOptions) => Promise<string>;

/** אלמנטים שאפשר ללחוץ עליהם בדף — כפתורי/קישורי בחירת ערוץ לקוד */
const CLICKABLE_SELECTOR = 'button, a, [role="button"], [role="radio"], input[type="radio"]';
const CHANNEL_PATTERNS: Record<OtpChannel, RegExp> = {
  voice: /שיחה|קולי|קולית|הקראה|טלפוני|voice|call/i,
  sms: /sms|מסרון|הודעת טקסט|שלח(?:ו)? (?:שוב|מחדש)|שליחה חוזרת/i,
};
const CONFIRM_SEND_PATTERN = /^(?:שלח|שלחו|המשך|קבל(?:ת)? קוד|אישור)/;

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
    // נותנים לדף רגע להגיב, כדי לא לתפוס הודעה ישנה שנשארה על המסך
    await sleep(1500);

    // אם המשתמש מקליד בעצמו בדפדפן, או שיש מעבר ביניים — מחכים לתוצאה ברורה
    const outcome = await this.waitForLoginOutcome(LOGIN_REDIRECT_TIMEOUT);
    if (outcome.kind === 'otp') return this.handleOtp(false);
    if (outcome.kind === 'chooseChannel') return this.handleOtp(true);
    return this.resultFromOutcome(outcome);
  }

  /** טקסט נראה של אלמנט לחיץ (כולל label של radio), או null אם הוא מוסתר */
  private async clickableText(el: ElementHandle<Element>): Promise<string | null> {
    return el.evaluate((node) => {
      const h = node as HTMLElement;
      let text = h.innerText || h.getAttribute('aria-label') || h.getAttribute('title') || '';
      let visible = h.getClientRects().length > 0;
      if (h instanceof HTMLInputElement) {
        // רדיו מעוצב בדרך כלל מוסתר, והטקסט נמצא ב-label שלו
        const label = ((h.id && document.querySelector(`label[for="${CSS.escape(h.id)}"]`)) || h.closest('label')) as HTMLElement | null;
        text = label?.innerText || text;
        visible = visible || !!label?.getClientRects().length;
      }
      if (!visible) return null;
      text = text.replace(/\s+/g, ' ').trim();
      return text.length > 0 && text.length <= 80 ? text : null;
    });
  }

  /** ערוצים שהבנק מציע כרגע בדף (SMS / שיחה קולית) */
  private async otpChannels(): Promise<OtpChannel[]> {
    const found = new Set<OtpChannel>();
    for (const el of await this.page.$$(CLICKABLE_SELECTOR)) {
      const text = await this.clickableText(el).catch(() => null);
      if (!text) continue;
      if (CHANNEL_PATTERNS.voice.test(text)) found.add('voice');
      else if (CHANNEL_PATTERNS.sms.test(text)) found.add('sms');
    }
    return (['sms', 'voice'] as const).filter((c) => found.has(c));
  }

  /** לוחץ באתר הבנק על "שלח ב-SMS" / "קבל בשיחה קולית" */
  private async sendOtpVia(channel: OtpChannel): Promise<boolean> {
    for (const el of await this.page.$$(CLICKABLE_SELECTOR)) {
      const text = await this.clickableText(el).catch(() => null);
      if (!text || !CHANNEL_PATTERNS[channel].test(text)) continue;
      if (channel === 'sms' && CHANNEL_PATTERNS.voice.test(text)) continue;
      // רדיו מוסתר: לוחצים דרך ה-DOM (ה-label מעביר את הבחירה)
      await el.click().catch(() => el.evaluate((n) => (n as HTMLElement).click()));
      // בחירה ברדיו — צריך עוד לחיצה על "שלח"/"המשך"
      const isChoice = await el.evaluate(
        (n) => (n instanceof HTMLInputElement && n.type === 'radio') || n.getAttribute('role') === 'radio'
      );
      if (isChoice) {
        await sleep(300);
        for (const btn of await this.page.$$('button, [role="button"], input[type="submit"]')) {
          const t = await this.clickableText(btn).catch(() => null);
          if (t && CONFIRM_SEND_PATTERN.test(t) && !CHANNEL_PATTERNS.voice.test(t)) {
            await btn.click();
            break;
          }
        }
      }
      console.log(`[SCRAPER] [בנק הפועלים] קוד אימות נשלח: ${channel === 'voice' ? 'שיחה קולית' : 'SMS'} ("${text}")`);
      return true;
    }
    return false;
  }

  private async isLoggedIn(): Promise<boolean> {
    const url = await currentUrl(this.page).catch(() => '');
    return SUCCESS_PATTERNS.some((p) => url.includes(p));
  }

  /** הודעת שגיאה שהבנק מציג בדף הכניסה (סיסמה שגויה, משתמש חסום...) — בלי שינוי כתובת */
  private async loginPageError(): Promise<string | null> {
    return this.page.evaluate((selector) => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        if (!el.getClientRects().length) continue;
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && text.length <= 300 && /[֐-׿]/.test(text)) return text;
      }
      return null;
    }, LOGIN_ERROR_SELECTOR);
  }

  private async waitForLoginOutcome(timeout: number): Promise<LoginOutcome> {
    let lastError: string | null = null;
    try {
      return await waitUntil(
        async () => {
          try {
            const url = await currentUrl(this.page);
            if (SUCCESS_PATTERNS.some((p) => url.includes(p))) return { kind: 'success' } as const;
            if (INVALID_PASSWORD_PATTERNS.some((p) => url.includes(p))) return { kind: 'invalid' } as const;
            if (CHANGE_PASSWORD_PATTERNS.some((p) => p.test(url))) return { kind: 'change' } as const;
            if (await this.page.$(OTP_FORM_SELECTOR)) return { kind: 'otp' } as const;
            // מסך "לאן לשלוח את הקוד?" לפני טופס הקוד: טופס הכניסה נעלם ויש אפשרות שיחה קולית
            if (!(await this.page.$('#userCode')) && (await this.otpChannels()).includes('voice')) return { kind: 'chooseChannel' } as const;
            const message = await this.loginPageError();
            if (message) {
              // אותה הודעה פעמיים ברציפות — זו לא הודעה חולפת בזמן טעינה
              if (message === lastError) return classifyLoginError(message);
              lastError = message;
            }
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
      return { kind: 'unknown', message: lastError ?? undefined };
    }
  }

  private resultFromOutcome(outcome: LoginOutcome): ScraperScrapingResult {
    switch (outcome.kind) {
      case 'success':
        return { success: true };
      case 'invalid':
        return { success: false, errorType: ScraperErrorTypes.InvalidPassword, errorMessage: outcome.message ? `הבנק: ${outcome.message}` : 'קוד משתמש או סיסמה שגויים' };
      case 'blocked':
        return { success: false, errorType: ScraperErrorTypes.AccountBlocked, errorMessage: `הבנק: ${outcome.message}` };
      case 'change':
        return { success: false, errorType: ScraperErrorTypes.ChangePassword, errorMessage: 'הבנק דורש להחליף סיסמה — יש להיכנס לאתר הבנק ולהחליף' };
      case 'bankError':
        return { success: false, errorType: ScraperErrorTypes.General, errorMessage: `הבנק: ${outcome.message}` };
      case 'otp':
      case 'chooseChannel':
      case 'unknown':
        return {
          success: false,
          errorType: ScraperErrorTypes.Timeout,
          errorMessage: outcome.kind === 'unknown' && outcome.message
            ? `ההתחברות לא הושלמה. הבנק הציג: ${outcome.message}`
            : 'הבנק לא אישר את הכניסה תוך 90 שניות. ייתכן שקוד המשתמש או הסיסמה שגויים — כדאי לנסות להיכנס איתם לאתר הבנק',
        };
    }
  }

  private async handleOtp(needsChannel: boolean): Promise<ScraperScrapingResult> {
    if (!this.otpRetriever) {
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: 'הבנק ביקש קוד אימות ואין דרך לקבל אותו',
      };
    }

    for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
      const channels = await this.otpChannels().catch((): OtpChannel[] => []);
      const code = (
        await this.otpRetriever({
          attempt,
          channels,
          needsChannel: needsChannel && attempt === 1,
          sendVia: (channel) => this.sendOtpVia(channel),
        })
      ).replace(/\D/g, '');
      // אחרי בחירת ערוץ הטופס נטען רק עכשיו
      const form = await this.page.waitForSelector(OTP_FORM_SELECTOR, { timeout: 20_000 }).catch(() => null);
      if (!form) {
        return { success: false, errorType: ScraperErrorTypes.General, errorMessage: 'טופס קוד האימות לא הופיע באתר הבנק' };
      }
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
        if (outcome.kind === 'otp' || outcome.kind === 'chooseChannel') continue;
        return this.resultFromOutcome(outcome);
      }
    }

    return {
      success: false,
      errorType: ScraperErrorTypes.General,
      errorMessage: `קוד האימות נדחה ${MAX_OTP_ATTEMPTS} פעמים`,
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
