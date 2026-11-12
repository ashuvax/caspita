import { SCRAPERS, CompanyTypes } from 'israeli-bank-scrapers';
import { type AccountKind } from '../models/account.model';
import { type CompanyField, type SupportedCompany } from '../types/transaction.types';

interface CompanyMeta {
  displayName: string;
  kind: AccountKind;
}

/** שמות בעברית וסוג (בנק/כרטיס) לכל חברה שהספרייה תומכת בה */
const COMPANY_META: Record<string, CompanyMeta> = {
  hapoalim: { displayName: 'בנק הפועלים', kind: 'bank' },
  leumi: { displayName: 'בנק לאומי', kind: 'bank' },
  mizrahi: { displayName: 'בנק מזרחי טפחות', kind: 'bank' },
  discount: { displayName: 'בנק דיסקונט', kind: 'bank' },
  mercantile: { displayName: 'בנק מרכנתיל', kind: 'bank' },
  otsarHahayal: { displayName: 'בנק אוצר החייל', kind: 'bank' },
  union: { displayName: 'בנק איגוד', kind: 'bank' },
  beinleumi: { displayName: 'הבנק הבינלאומי', kind: 'bank' },
  massad: { displayName: 'בנק מסד', kind: 'bank' },
  yahav: { displayName: 'בנק יהב', kind: 'bank' },
  pagi: { displayName: 'פאג"י', kind: 'bank' },
  oneZero: { displayName: 'וואן זירו', kind: 'bank' },
  max: { displayName: 'מקס', kind: 'card' },
  visaCal: { displayName: 'כאל', kind: 'card' },
  isracard: { displayName: 'ישראכרט', kind: 'card' },
  amex: { displayName: 'אמריקן אקספרס', kind: 'card' },
  behatsdaa: { displayName: 'בהצדעה', kind: 'card' },
  beyahadBishvilha: { displayName: 'ביחד בשבילך', kind: 'card' },
};

const FIELD_META: Record<string, Omit<CompanyField, 'key'>> = {
  userCode: { label: 'קוד משתמש', type: 'text' },
  username: { label: 'שם משתמש', type: 'text' },
  password: { label: 'סיסמה', type: 'password' },
  id: { label: 'תעודת זהות', type: 'text' },
  nationalID: { label: 'תעודת זהות', type: 'text' },
  num: { label: 'קוד מזהה', type: 'text' },
  card6Digits: { label: '6 ספרות אחרונות של הכרטיס', type: 'number' },
  email: { label: 'אימייל', type: 'text' },
  phoneNumber: { label: 'מספר טלפון (כולל קידומת +972)', type: 'text' },
  otpLongTermToken: { label: 'טוקן OTP לטווח ארוך', type: 'password' },
};

/** שדות שהמערכת מספקת בעצמה ולא המשתמש */
const INTERNAL_FIELDS = new Set(['otpCodeRetriever']);

function buildCompanies(): SupportedCompany[] {
  return Object.entries(SCRAPERS).map(([id, def]) => {
    const meta = COMPANY_META[id];
    const fields: CompanyField[] = def.loginFields
      .filter((key) => !INTERNAL_FIELDS.has(key))
      .map((key) => ({ key, ...(FIELD_META[key] ?? { label: key, type: 'text' as const }) }));
    return {
      id,
      displayName: meta?.displayName ?? def.name,
      kind: meta?.kind ?? 'bank',
      fields,
    };
  });
}

export const SUPPORTED_COMPANIES: SupportedCompany[] = buildCompanies();

export function getCompany(companyId: string): SupportedCompany | undefined {
  return SUPPORTED_COMPANIES.find((c) => c.id === companyId);
}

export function companyKind(companyId: string): AccountKind {
  return getCompany(companyId)?.kind ?? 'bank';
}

/** איך חיוב החברה מופיע בדף החשבון בבנק (לזיהוי תשלומי כרטיס) */
export const CARD_BANK_KEYWORDS: Record<string, RegExp> = {
  max: /מקס|לאומי קארד/,
  visaCal: /כאל|כ\.א\.ל|כ\.א\.ל\./,
  isracard: /ישראכרט/,
  amex: /אמריקן|אמקס|אמ\.אקס/,
  behatsdaa: /בהצדעה/,
  beyahadBishvilha: /ביחד בשבילך/,
};

export function isSupportedCompany(companyId: string): companyId is CompanyTypes {
  return Object.values<string>(CompanyTypes).includes(companyId);
}
