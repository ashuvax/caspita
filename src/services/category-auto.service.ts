import { Category, MerchantCategory } from '../models/category.model';
import { MaaserRule } from '../models/maaser-rule.model';
import { TransactionRecord } from '../models/transaction.model';
import { merchantName, normalizeText } from '../utils/text';
import { merchantKey } from './categories.service';

/** קטגוריית חברת האשראי → שם הקטגוריה שלנו. null = לא לשייך (קטגוריה חסרת משמעות) */
const SOURCE_CATEGORY_MAP: Record<string, string | null> = {
  'מזון וצריכה': 'מזון וסופר',
  'מזון ומשקאות': 'מזון וסופר',
  'מסעדות, קפה וברים': 'מסעדות ובתי קפה',
  'מזון מהיר': 'מסעדות ובתי קפה',
  'מסעדות': 'מסעדות ובתי קפה',
  'תחבורה ורכבים': 'רכב ותחבורה',
  'דלק, חשמל וגז': 'דלק', // מפוצל לפי שם הספק — ראו UTILITY_PATTERN
  'ביטוח': 'ביטוח',
  'עירייה וממשלה': 'חשבונות הבית', // רק לגופים ממשלתיים — ראו GOVERNMENT_PATTERN
  'שירותי תקשורת': 'תקשורת',
  'עיצוב הבית': 'בית וריהוט',
  'ריהוט ובית': 'בית וריהוט',
  'חשמל ומחשבים': 'בית וריהוט',
  'רפואה ובתי מרקחת': 'בריאות',
  'אופנה': 'ביגוד והנעלה',
  'ילדים': 'חינוך וילדים',
  'פנאי, בידור וספורט': 'פנאי ונופש',
  'ספרים ודפוס': 'אחר',
  'טיפוח ויופי': 'אחר',
  'קוסמטיקה וטיפוח': 'אחר',
  'ציוד ומשרד': 'אחר',
  'שונות': null,
  'העברת כספים': null,
  'משיכת מזומן': null,
};

/** מקס מסווג גם מוסדות ועמותות כ"עירייה וממשלה" — משייכים רק גוף ממשלתי/עירוני אמיתי */
const GOVERNMENT_PATTERN = /עירי|מועצה|ארנונה|משרד |רשות|ממשלת|מס הכנסה|רשם/;

/** ב"דלק, חשמל וגז" — ספקי חשמל/גז לבית ולא דלק לרכב */
const UTILITY_PATTERN = /חשמל|גז|electra|אלקטרה/i;

/** מילות מפתח בתיאור (בעיקר עסקאות בנק, שאין להן קטגוריה מהמקור) */
const KEYWORD_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /משכורת|שכר/, category: 'משכורת' },
  { pattern: /ביטוח לאומ|בטוח לאומ|מענק עבודה/, category: 'קצבאות' },
  { pattern: /משכנ/, category: 'דיור ומשכנתא' },
  { pattern: /ציי רכב|ליסינג|רכב/, category: 'רכב ותחבורה' },
  { pattern: /גמ"?ח|הלוא|הלווא/, category: 'הלוואות וגמ"ח' },
  { pattern: /עמל[הת]|דמי ניהול/, category: 'עמלות בנק' },
  { pattern: /חברת החשמל|תאגיד מים|מים וביוב|ארנונה|עירית|עיריית/, category: 'חשבונות הבית' },
  { pattern: /ביטוח|בטוח|הראל|מגדל (ביטוח|בטוח|חיים|בריאות)|הפניקס|כלל ביטוח|מנורה מבטחים|איילון|שומרה/, category: 'ביטוח' },
  { pattern: /פז |דלק|סונול|דור אלון|ten |yellow/i, category: 'דלק' },
  // בלי מספרים בודדים (012/019) — הם מופיעים בתוך מספרי חשבון בהעברות
  { pattern: /סלקום|פרטנר|הוט מובייל|הוט טלקום|בזק|גולן טלקום|פלאפון|019 שירותי|012 סמייל/, category: 'תקשורת' },
];

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export interface AutoAssignResult {
  assigned: number;
  byCategory: { name: string; count: number }[];
}

/**
 * משייך קטגוריה לספקים שעדיין אין להם: ספקי מעשרות ← "מעשרות וצדקה", אחר כך מילות מפתח,
 * ואחר כך הקטגוריה שחברת האשראי נתנה. ספק שכבר יש לו קטגוריה לא נוגעים בו.
 */
async function autoAssign(): Promise<AutoAssignResult> {
  const [cats, maps, rules, txns] = await Promise.all([
    Category.findAll(),
    MerchantCategory.findAll(),
    MaaserRule.findAll({ where: { kind: 'donation' } }),
    TransactionRecord.findAll({ where: { cardPaymentForAccountId: null, internalTransfer: false } }),
  ]);
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  const assignedKeys = new Set(maps.map((m) => m.merchantKey));
  const donationPatterns = rules.map((r) => normalizeText(r.pattern)).filter(Boolean);

  const merchants = new Map<string, { description: string; sources: string[] }>();
  for (const t of txns) {
    const key = merchantKey(t.description, t.memo);
    if (assignedKeys.has(key)) continue;
    const m = merchants.get(key) ?? { description: merchantName(t.description, t.memo), sources: [] };
    if (t.category) m.sources.push(t.category);
    merchants.set(key, m);
  }

  const counts = new Map<string, number>();
  const toCreate: { merchantKey: string; categoryId: number }[] = [];
  for (const [key, m] of merchants) {
    // משיכת מזומן — לא ידוע על מה הוצא
    if (/כספומט|משיכ[הת] מזומן|מש' מכספומט/.test(m.description)) continue;
    let name: string | null = null;
    if (donationPatterns.some((p) => key.includes(p))) name = 'מעשרות וצדקה';
    if (!name) name = KEYWORD_RULES.find((r) => r.pattern.test(m.description))?.category ?? null;
    if (!name) {
      const source = mostCommon(m.sources);
      if (source) {
        name = SOURCE_CATEGORY_MAP[source] ?? null;
        if (source === 'דלק, חשמל וגז' && UTILITY_PATTERN.test(m.description)) name = 'חשבונות הבית';
        if (source === 'עירייה וממשלה' && !GOVERNMENT_PATTERN.test(m.description)) name = null;
      }
    }
    const categoryId = name ? catByName.get(name) : undefined;
    if (!name || !categoryId) continue;
    toCreate.push({ merchantKey: key, categoryId });
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  if (toCreate.length) await MerchantCategory.bulkCreate(toCreate);
  return {
    assigned: toCreate.length,
    byCategory: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

export const categoryAutoService = { autoAssign };
