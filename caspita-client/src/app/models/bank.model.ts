export type AccountKind = 'bank' | 'card' | 'cash';

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

export interface BankConfig {
  id: number;
  companyId: string;
  displayName: string;
  kind: AccountKind;
  isActive: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface Account {
  id: number;
  bankConfigId: number;
  bankName: string;
  companyId: string;
  accountNumber: string;
  kind: AccountKind;
  label: string | null;
  displayName: string;
  balance: number | null;
  balanceUpdatedAt: string | null;
  paysFromAccountId: number | null;
  paysFromSource: 'auto' | 'manual' | null;
  chargeDay: number | null;
  isHidden: boolean;
}

export type MaaserOverride = 'include' | 'exclude';
export type MaaserRole = 'income' | 'donation' | null;

export interface Transaction {
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
  offsetNote: string | null;
  isLoanCredit: boolean;
  loanNote: string | null;
  loanExcluded: boolean;
  savingsNote: string | null;
  maaserOverride: MaaserOverride | null;
  maaserRole: MaaserRole;
  maaserNote: string | null;
  categoryId: number | null;
  categoryOverridden: boolean;
  splits: { categoryId: number; amount: number; note?: string | null }[];
  /** כלל הסיווג שקבע את הקטגוריה */
  ruleId: number | null;
  tagIds: number[];
  isCashWithdrawal: boolean;
  /** כמה מהמשיכה כבר נרשם כהוצאות מזומן */
  cashCovered: number;
  sourceCategory: string | null;
}

export interface GroupedMerchant {
  name: string;
  totalAmount: number;
  transactionCount: number;
  maaserCount: number;
  categoryId: number | null;
  transactions: Transaction[];
}

export type InsightKind = 'deficit' | 'surplus' | 'category_up' | 'category_down' | 'new_merchant' | 'largest' | 'pace' | 'budget';

export interface Insight {
  kind: InsightKind;
  text: string;
  amount: number;
  categoryId?: number | null;
  merchant?: string;
}

export interface ScrapeError {
  bankId: number;
  displayName: string;
  error: string;
}

export interface TransactionsResult {
  merchants: GroupedMerchant[];
  errors: ScrapeError[];
  scrapedAt: number | null;
  totals: { expenses: number; income: number; net: number; cardPayments: number; internalTransfers: number; offsets: number; loans: number; savings: number };
  previous: { expenses: number; income: number };
  hidden: GroupedMerchant[];
  insights: Insight[];
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  byCategory: { categoryId: number | null; expenses: number; count: number; prevExpenses: number; avgExpenses: number; budget: number | null }[];
}
