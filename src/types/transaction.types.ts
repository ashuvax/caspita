import { type AccountKind } from '../models/account.model';
import { type MaaserOverride } from '../models/transaction.model';

export interface CompanyField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
}

export interface SupportedCompany {
  id: string;
  displayName: string;
  kind: AccountKind;
  fields: CompanyField[];
}

/** תפקיד העסקה בחישוב המעשרות */
export type MaaserRole = 'income' | 'donation' | null;

export interface TransactionDto {
  id: number;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo: string | null;
  type: string;
  status: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  bankName: string;
  accountId: number;
  accountNumber: string;
  accountKind: AccountKind;
  isCardPayment: boolean;
  isInternalTransfer: boolean;
  /** חלק מזוג חיוב/זיכוי באותו סכום (הלוואה והחזר, כסף שעבר דרכי) */
  offsetNote: string | null;
  /** זיכוי של הלוואה (שלקחתי, או החזר של הלוואה שנתתי) — לא הכנסה */
  isLoanCredit: boolean;
  /** משויכת להלוואה — הסבר ("הלוואה ליוסף", "החזר מיוסף") */
  loanNote: string | null;
  /** חלק מהלוואה שלא נספר כהכנסה/הוצאה (קרן, או החזר של הלוואה שנתתי) */
  loanExcluded: boolean;
  /** הפקדה לחיסכון / משיכה ממנו — לא הוצאה ולא הכנסה */
  savingsNote: string | null;
  maaserOverride: MaaserOverride | null;
  maaserRole: MaaserRole;
  /** למה העסקה לא נספרת במעשרות (אם רלוונטי) */
  maaserNote: string | null;
  /** הקטגוריה בפועל (ידני לעסקה ← של הספק ← אין) */
  categoryId: number | null;
  /** האם נקבעה לעסקה הזו קטגוריה שונה מהספק */
  categoryOverridden: boolean;
  /** חלקים מהעסקה ששייכים לקטגוריות אחרות (סכומים חיוביים). השארית בקטגוריה של העסקה */
  splits: { categoryId: number; amount: number; note: string | null }[];
  /** כלל הסיווג שקבע את הקטגוריה (אם כלל קבע) */
  ruleId: number | null;
  tagIds: number[];
  /** משיכת מזומן מכספומט */
  isCashWithdrawal: boolean;
  /** כמה מהמשיכה כבר נרשם כהוצאות מזומן (לא נספר פעמיים) */
  cashCovered: number;
  /** הקטגוריה שחברת האשראי נתנה (רמז) */
  sourceCategory: string | null;
}

export interface GroupedMerchant {
  name: string;
  totalAmount: number;
  transactionCount: number;
  maaserCount: number;
  /** הקטגוריה הגלובלית של הספק */
  categoryId: number | null;
  transactions: TransactionDto[];
}

export type InsightKind = 'deficit' | 'surplus' | 'category_up' | 'category_down' | 'new_merchant' | 'largest' | 'pace' | 'budget';

export interface Insight {
  kind: InsightKind;
  text: string;
  amount: number;
  categoryId?: number | null;
  merchant?: string;
}

export interface SyncError {
  bankId: number;
  displayName: string;
  error: string;
}

export interface GroupedResult {
  merchants: GroupedMerchant[];
  errors: SyncError[];
  scrapedAt: number | null;
  totals: {
    expenses: number;
    income: number;
    /** הכנסות פחות הוצאות */
    net: number;
    cardPayments: number;
    internalTransfers: number;
    offsets: number;
    loans: number;
    savings: number;
  };
  /** החודש הקודם — להשוואה */
  previous: { expenses: number; income: number };
  /** תשלומי כרטיס והעברות בין חשבונות — לא נספרים, מוצגים בנפרד */
  hidden: GroupedMerchant[];
  insights: Insight[];
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  /** הוצאות נטו לפי קטגוריה (null = ללא קטגוריה) */
  byCategory: { categoryId: number | null; expenses: number; count: number; prevExpenses: number; avgExpenses: number; budget: number | null }[];
}
