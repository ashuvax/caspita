/**
 * נתוני דמה להדגמה: משפחה בדויה עם חשבון בנק, שני כרטיסי אשראי, משכורות, הוראות קבע,
 * הלוואות, חסכונות ותיק השקעות. התאריכים יחסיים להיום, כך שהנתונים תמיד "עדכניים".
 * כל השמות והמספרים מומצאים.
 */
import { sequelize } from '../utils/db';
import { encrypt } from '../utils/crypto';
import { addDays, addMonths, currentMonth, dateInMonth, monthsBetween, today } from '../utils/dates';
import { descriptionKey, round2 } from '../utils/text';
import { BankConfig, Account, TransactionRecord, MaaserRule, Category, Loan, LoanPayment, SavingsAccount, SavingsEntry, Holding, Fund } from '../models';
import { taxService } from '../services/tax.service';
import { settingsService } from '../services/settings.service';
import { accountsService } from '../services/accounts.service';
import { recurringService } from '../services/recurring.service';
import { categoryAutoService } from '../services/category-auto.service';
import { loansService } from '../services/loans.service';
import { savingsService } from '../services/savings.service';
import { categoriesService } from '../services/categories.service';

/** מחולל אקראי דטרמיניסטי — אותם נתונים בכל יצירה */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260101);
const between = (min: number, max: number): number => round2(min + rand() * (max - min));
const int = (min: number, max: number): number => Math.floor(min + rand() * (max - min + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const HISTORY_MONTHS = 12;

interface Txn {
  accountId: number;
  bankConfigId: number;
  date: string;
  processedDate?: string;
  amount: number;
  description: string;
  memo?: string;
  category?: string;
  status?: 'completed' | 'pending';
  installment?: [number, number];
  currency?: string;
  originalAmount?: number;
  loanId?: number;
}

/** ספקים בכרטיס: [תיאור, קטגוריית המקור, מינ', מקס', כמה פעמים בחודש] */
const CARD_MERCHANTS: [string, string, number, number, number][] = [
  ['שופרסל דיל', 'מזון וצריכה', 180, 620, 4],
  ['רמי לוי שיווק השקמה', 'מזון וצריכה', 250, 900, 3],
  ['יוחננוף', 'מזון וצריכה', 120, 480, 2],
  ['מאפיית אנג\'ל', 'מזון וצריכה', 25, 90, 3],
  ['ירקות ופירות השוק', 'מזון וצריכה', 60, 210, 2],
  ['ארומה', 'מסעדות, קפה וברים', 28, 85, 2],
  ['פיצה שמש', 'מזון מהיר', 70, 160, 1],
  ['בורגר ראנץ\'', 'מזון מהיר', 90, 220, 0.5],
  ['פז yellow', 'דלק, חשמל וגז', 180, 340, 2],
  ['סונול', 'דלק, חשמל וגז', 150, 300, 1],
  ['סופר-פארם', 'רפואה ובתי מרקחת', 40, 260, 1.5],
  ['רב-קו אונליין', 'תחבורה ורכבים', 50, 150, 1],
  ['כביש 6', 'תחבורה ורכבים', 20, 70, 1],
  ['קסטרו', 'אופנה', 120, 450, 0.4],
  ['שילב', 'ילדים', 80, 350, 0.4],
  ['ACE', 'עיצוב הבית', 40, 300, 0.5],
  ['סינמה סיטי', 'פנאי, בידור וספורט', 90, 220, 0.3],
  ['סטימצקי', 'ספרים ודפוס', 50, 160, 0.4],
];

export async function seedDemo(force: boolean): Promise<void> {
  if (!force && (await BankConfig.count()) > 0) return;
  if (force) {
    // מחיקה מלאה ובנייה מחדש
    await sequelize.drop();
    const { initDatabase } = await import('../models');
    await initDatabase();
    const { maaserService } = await import('../services/maaser.service');
    await maaserService.ensureDefaultRules();
    await categoriesService.ensureDefaults();
  }
  console.log('[DEMO] יוצר נתוני דמה...');

  const now = today();
  const startMonth = addMonths(currentMonth(), -HISTORY_MONTHS);
  const start = `${startMonth}-01`;
  const months = monthsBetween(startMonth, currentMonth());
  const creds = encrypt(JSON.stringify({ demo: 'true' }));

  // ---- חשבונות ----
  const bankCfg = await BankConfig.create({ companyId: 'hapoalim', displayName: 'בנק הפועלים', credentialsEncrypted: creds, lastSyncAt: new Date(), syncedFrom: start });
  const maxCfg = await BankConfig.create({ companyId: 'max', displayName: 'מקס', credentialsEncrypted: creds, lastSyncAt: new Date(), syncedFrom: start });
  const israCfg = await BankConfig.create({ companyId: 'isracard', displayName: 'ישראכרט', credentialsEncrypted: creds, lastSyncAt: new Date(), syncedFrom: start });

  const bank = await Account.create({ bankConfigId: bankCfg.id, accountNumber: '12-614-482917', kind: 'bank', label: 'עו"ש משפחתי' });
  const maxCard = await Account.create({ bankConfigId: maxCfg.id, accountNumber: '4417', kind: 'card', label: 'מקס - ראשי' });
  const israCard = await Account.create({ bankConfigId: israCfg.id, accountNumber: '8203', kind: 'card', label: 'ישראכרט - קניות' });

  // ---- הלוואות וחסכונות (לפני העסקאות, כדי לשייך) ----
  const takenStart = dateInMonth(addMonths(currentMonth(), -20), 3);
  await Loan.create({
    direction: 'taken', counterparty: 'בנק הפועלים', amount: 60000, startDate: takenStart,
    dueDate: dateInMonth(addMonths(currentMonth(), 28), 3), note: 'הלוואה לשיפוץ המטבח',
    matchKey: descriptionKey('החזר הלוואה 7781'), matchAmount: 1320,
  });
  const lentDate = dateInMonth(addMonths(currentMonth(), -5), 14);
  const givenLoan = await Loan.create({
    direction: 'given', counterparty: 'יוסי לוי', amount: 6000, startDate: lentDate,
    dueDate: dateInMonth(addMonths(currentMonth(), 4), 1), note: 'עזרה לקניית רכב',
  });
  await Loan.create({
    direction: 'taken', counterparty: 'גמ"ח אור החסד', amount: 15000, startDate: dateInMonth(addMonths(currentMonth(), -8), 1),
    note: 'החזר 625 ₪ בחודש', matchKey: descriptionKey('גמח אור החסד החזר'), matchAmount: 625,
  });

  await SavingsAccount.create({
    kind: 'gemach_deposit', name: 'פיקדון גמ"ח יד עזרה', balance: 9000, balanceDate: dateInMonth(startMonth, 1),
    penaltyPct: 10, note: 'הפקדה חודשית קבועה', matchKey: descriptionKey('גמח יד עזרה הפקדה'), matchAmount: 500,
  });
  const studyFund = await SavingsAccount.create({
    kind: 'study_fund', name: 'קרן השתלמות - מסלול כללי', balance: 84200, balanceDate: dateInMonth(addMonths(currentMonth(), -2), 1),
    liquidDate: dateInMonth(addMonths(currentMonth(), 30), 1), note: 'מופקד ישירות מהמשכורת',
  });
  for (const m of monthsBetween(addMonths(currentMonth(), -1), currentMonth())) {
    const d = dateInMonth(m, 10);
    if (d <= now) await SavingsEntry.create({ savingsId: studyFund.id, date: d, amount: 1540, note: 'הפקדה מהמשכורת' });
  }
  await SavingsAccount.create({ kind: 'other', name: 'חיסכון לכל ילד - נועה', balance: 7350, balanceDate: dateInMonth(addMonths(currentMonth(), -1), 1), note: 'ביטוח לאומי' });

  // ---- עסקאות ----
  const txns: Txn[] = [];
  const b = (date: string, amount: number, description: string, extra: Partial<Txn> = {}): void => {
    if (date < start || date > now) return;
    txns.push({ accountId: bank.id, bankConfigId: bankCfg.id, date, amount, description, ...extra });
  };

  for (const [i, m] of months.entries()) {
    // הכנסות
    b(dateInMonth(m, 10), between(12300, 12550), 'משכורת', { memo: 'אלפא סיסטמס בע"מ' });
    b(dateInMonth(m, 1), between(8240, 8380), 'משכורת', { memo: 'משרד החינוך' });
    b(dateInMonth(m, 20), 548, 'ביטוח לאומי', { memo: 'קצבת ילדים' });
    // הוראות קבע
    b(dateInMonth(m, 1), -4870, 'משכנתא', { memo: 'לאומי למשכנתאות תיק 33' });
    b(dateInMonth(m, 3), -1320, 'החזר הלוואה 7781');
    b(dateInMonth(m, 5), -286, 'הראל ביטוח בריאות');
    b(dateInMonth(m, 7), -1500, 'ועד הרבנים לישראל', { memo: 'הוראת קבע - מעשרות' });
    b(dateInMonth(m, 8), -950, 'תלמוד תורה בית יוסף');
    b(dateInMonth(m, 12), -500, 'גמח יד עזרה הפקדה');
    b(dateInMonth(m, 15), -between(598, 612), 'עיריית ירושלים ארנונה');
    if (m >= dateInMonth(addMonths(currentMonth(), -8), 1).slice(0, 7)) b(dateInMonth(m, 18), -625, 'גמח אור החסד החזר');
    b(dateInMonth(m, 28), -between(6, 14), 'עמלת פעולה בערוץ ישיר');
    if (i % 2 === 0) b(dateInMonth(m, 22), -between(380, 560), 'חברת החשמל לישראל');
    if (i % 2 === 1) b(dateInMonth(m, 24), -between(140, 230), 'הגיחון מים וביוב');
    if (rand() < 0.7) b(dateInMonth(m, int(2, 27)), -pick([300, 500, 500, 1000]), 'משיכה מכספומט');
  }
  // אירועים חד-פעמיים
  b(addDays(now, -40), 2400, 'העברה/הפקדה', { memo: 'המבצע: אבא - מתנה לחג' });
  b(addDays(now, -70), -1800, 'העברה לאחר', { memo: 'לטובת: אולמי הנסיכה - חתונת אחיין' });
  b(addDays(now, -95), 1850, 'החזר מס הכנסה');
  b(addDays(now, -88), -1500, 'ועד הרבנים לישראל', { memo: 'תרומה לחגים' });
  b(addDays(now, -200), -3200, 'העברה לאחר', { memo: 'לטובת: מוסך הדר - טיפול 60 אלף' });
  // הלוואה שנתתי ליוסי, ושני החזרים
  b(lentDate, -6000, 'העברה לאחר', { memo: 'לטובת: יוסי לוי', loanId: givenLoan.id });
  b(addDays(lentDate, 45), 1500, 'העברה/הפקדה', { memo: 'המבצע: יוסי לוי', loanId: givenLoan.id });
  b(addDays(lentDate, 105), 1500, 'העברה/הפקדה', { memo: 'המבצע: יוסי לוי', loanId: givenLoan.id });
  await LoanPayment.create({ loanId: givenLoan.id, date: addDays(lentDate, 130), amount: 500, note: 'החזיר במזומן' });
  // מכירת ניירות ערך וקניה (מסומנות כהעברה פנימית)
  b(addDays(now, -150), -5000, 'ני"ע-קניה', { memo: 'תיק השקעות' });

  // כרטיסי אשראי: חיוב ב-10 (מקס) וב-2 (ישראכרט); עסקאות מהחודש הקודם
  const cardTxns: Txn[] = [];
  const cardTxn = (card: Account, cfg: BankConfig, chargeDay: number, date: string, amount: number, description: string, extra: Partial<Txn> = {}): void => {
    if (date < start || date > now) return;
    // מועד החיוב: יום החיוב בחודש הבא אחרי תאריך העסקה
    const charge = dateInMonth(addMonths(date.slice(0, 7), 1), chargeDay);
    const pending = date >= addDays(now, -3);
    cardTxns.push({ accountId: card.id, bankConfigId: cfg.id, date, processedDate: charge, amount, description, status: pending ? 'pending' : 'completed', ...extra });
  };

  for (const m of months) {
    for (const [desc, cat, min, max, perMonth] of CARD_MERCHANTS) {
      const count = Math.floor(perMonth) + (rand() < perMonth % 1 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const useMax = desc.includes('שופרסל') || desc.includes('פז') || rand() < 0.6;
        const date = dateInMonth(m, int(1, 28));
        if (useMax) cardTxn(maxCard, maxCfg, 10, date, -between(min, max), desc, { category: cat });
        else cardTxn(israCard, israCfg, 2, date, -between(min, max), desc, { category: cat });
      }
    }
    // מנויים חודשיים
    // שינויי מחיר בחודש האחרון — מופיעים בהתראות (הוזלה והתייקרות)
    const lastMonth = m === currentMonth();
    cardTxn(maxCard, maxCfg, 10, dateInMonth(m, 4), lastMonth ? -79.9 : -99.9, 'פרטנר תקשורת', { category: 'שירותי תקשורת' });
    cardTxn(maxCard, maxCfg, 10, dateInMonth(m, 6), -189, 'הוט טלקום', { category: 'שירותי תקשורת' });
    cardTxn(israCard, israCfg, 2, dateInMonth(m, 9), -229, 'מכבי שירותי בריאות', { category: 'רפואה ובתי מרקחת' });
    cardTxn(israCard, israCfg, 2, dateInMonth(m, 11), -360, 'קופת העיר ירושלים', { category: 'שונות', memo: 'תרומה חודשית' });
    cardTxn(maxCard, maxCfg, 10, dateInMonth(m, 3), lastMonth ? -169 : -149, 'הולמס פלייס', { category: 'פנאי, בידור וספורט' });
    cardTxn(maxCard, maxCfg, 10, dateInMonth(m, 17), -1890, 'ש.ל.מ ליסינג ציי רכב', { category: 'תחבורה ורכבים' });
  }
  // רכישה בתשלומים + רכישה בחו"ל
  const ikea = dateInMonth(addMonths(currentMonth(), -2), 6);
  for (let n = 1; n <= 6; n++) {
    const d = dateInMonth(addMonths(ikea.slice(0, 7), n - 1), 6);
    cardTxn(maxCard, maxCfg, 10, d, -483.17, 'איקאה נתניה', { category: 'ריהוט ובית', installment: [n, 6] });
  }
  const laptop = dateInMonth(addMonths(currentMonth(), -4), 15);
  for (let n = 1; n <= 12; n++) {
    const d = dateInMonth(addMonths(laptop.slice(0, 7), n - 1), 15);
    cardTxn(israCard, israCfg, 2, d, -358.25, 'KSP מחשבים', { category: 'מחשבים', installment: [n, 12], originalAmount: -4299 });
  }
  for (const days of [12, 55, 130, 240]) {
    const usd = between(25, 120);
    cardTxn(israCard, israCfg, 2, addDays(now, -days), -round2(usd * 3.72), 'AMAZON MKTPLACE', { category: 'שונות', currency: 'USD', originalAmount: -usd });
  }

  // חיוב חודשי של הכרטיסים בבנק = סכום העסקאות שנפרעו באותו יום
  const chargeSums = new Map<string, number>();
  for (const t of cardTxns) {
    const key = `${t.accountId}|${t.processedDate}`;
    chargeSums.set(key, (chargeSums.get(key) ?? 0) + t.amount);
  }
  for (const [key, sum] of chargeSums) {
    const [cardId, date] = key.split('|');
    const isMax = Number(cardId) === maxCard.id;
    b(date, round2(sum), isMax ? 'מקס איט פיננסים' : 'ישראכרט', { memo: isMax ? 'חיוב כרטיס 4417' : 'חיוב כרטיס 8203' });
  }

  // יתרת הבנק: יתרת פתיחה + כל התנועות
  const bankTotal = txns.reduce((s, t) => s + t.amount, 0);
  const balance = 12840;
  const opening = round2(balance - bankTotal);
  console.log(`[DEMO] יתרת פתיחה ${opening}, יתרה נוכחית ${balance}`);
  await bank.update({ balance, balanceUpdatedAt: new Date() });

  const all = [...txns, ...cardTxns].sort((x, y) => x.date.localeCompare(y.date));
  await TransactionRecord.bulkCreate(
    all.map((t, i) => ({
      hash: `demo|${t.accountId}|${t.date}|${i}`,
      bankConfigId: t.bankConfigId,
      accountId: t.accountId,
      date: t.date,
      processedDate: t.processedDate ?? t.date,
      originalAmount: t.originalAmount ?? t.amount,
      originalCurrency: t.currency ?? 'ILS',
      chargedAmount: t.amount,
      chargedCurrency: 'ILS',
      description: t.description,
      memo: t.memo ?? null,
      type: t.installment ? 'installments' : 'normal',
      status: t.status ?? 'completed',
      identifier: null,
      installmentNumber: t.installment?.[0] ?? null,
      installmentTotal: t.installment?.[1] ?? null,
      category: t.category ?? null,
      loanId: t.loanId ?? null,
    }))
  );

  // ---- מעשרות ----
  await MaaserRule.create({ kind: 'donation', pattern: 'ועד הרבנים' });
  await MaaserRule.create({ kind: 'donation', pattern: 'קופת העיר' });
  await MaaserRule.create({ kind: 'income_exclude', pattern: 'החזר מס הכנסה' });
  await settingsService.set('maaser', { percent: 10, startMonth, openingBalance: -200 });

  // ---- השקעות ----
  const priceDate = addDays(now, -1);
  await Holding.bulkCreate([
    { account: 'אינטראקטיב ברוקרס', name: 'Vanguard S&P 500 ETF', symbol: 'VOO', quantity: 14, currency: 'USD', priceSource: 'yahoo', costBasis: 6420 },
    { account: 'אינטראקטיב ברוקרס', name: 'Apple', symbol: 'AAPL', quantity: 20, currency: 'USD', priceSource: 'yahoo', costBasis: 3480 },
    { account: 'בנק הפועלים', name: 'טבע', symbol: 'TEVA.TA', quantity: 60, currency: 'ILS', priceSource: 'yahoo', costBasis: 3900 },
    { account: 'בנק הפועלים', name: 'קרן מחקה ת"א 125', symbol: '5124482', quantity: 1200, currency: 'ILS', priceSource: 'manual', manualPrice: 24.86, manualPriceDate: priceDate, costBasis: 25000 },
  ]);

  // ---- ניתוח כמו אחרי סנכרון ----
  await accountsService.detectCardLinks();
  await accountsService.detectInternalTransfers();
  await recurringService.detect();
  await categoryAutoService.autoAssign();
  await loansService.autoLink();
  await savingsService.autoLink();

  // שיוך ידני כמו שמשתמש היה עושה (את AMAZON משאירים בלי קטגוריה — שיופיע ב"דורש תשומת לב")
  const cats = new Map((await Category.findAll()).map((c) => [c.name, c.id]));
  const manual: [string, string][] = [
    ['תלמוד תורה בית יוסף', 'חינוך וילדים'],
    ['העברה למוסך הדר - טיפול 60 אלף', 'רכב ותחבורה'],
    ['העברה לאולמי הנסיכה - חתונת אחיין', 'מתנות ושמחות'],
    ['העברה מאבא - מתנה לחג', 'מתנות ושמחות'],
    ['החזר מס הכנסה', 'אחר'],
  ];
  for (const [merchant, cat] of manual) {
    const id = cats.get(cat);
    if (id) await categoriesService.setMerchant(merchant, id);
  }

  // תקציבים לכמה קטגוריות
  const budgets: [string, number][] = [['מזון וסופר', 3200], ['מסעדות ובתי קפה', 450], ['דלק', 650], ['פנאי ונופש', 400]];
  for (const [name, budget] of budgets) {
    const id = cats.get(name);
    if (id) await Category.update({ monthlyBudget: budget }, { where: { id } });
  }

  // קופות ייעודיות
  const year = Number(currentMonth().slice(0, 4));
  await Fund.create({ name: 'פסח', icon: 'celebration', monthlyAmount: 600, targetAmount: 6000, targetDate: `${year + 1}-04-01`, startMonth: addMonths(currentMonth(), -3), categoryId: null, openingBalance: 1200 });
  await Fund.create({ name: 'ביטוח רכב', icon: 'directions_car', monthlyAmount: 350, targetAmount: 4200, targetDate: `${year + 1}-02-15`, startMonth: addMonths(currentMonth(), -8), categoryId: null, openingBalance: 0 });
  await Fund.create({ name: 'חופשה בקיץ', icon: 'beach_access', monthlyAmount: 400, targetAmount: null, targetDate: null, startMonth: addMonths(currentMonth(), -6), categoryId: cats.get('פנאי ונופש') ?? null, openingBalance: 0 });

  // מוסד עם אישור סעיף 46
  await taxService.setPayee('ועד הרבנים לישראל', true);

  console.log(`[DEMO] נוצרו ${all.length} עסקאות`);
}
