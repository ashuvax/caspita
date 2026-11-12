export interface MaaserSettings {
  percent: number;
  startMonth: string | null;
  openingBalance: number;
}

export interface MaaserMonth {
  month: string;
  income: number;
  due: number;
  paid: number;
  balance: number;
}

export interface MaaserSummary {
  settings: MaaserSettings;
  months: MaaserMonth[];
  totals: { income: number; due: number; paid: number; balance: number };
}

export type MaaserRuleKind = 'donation' | 'income_exclude';

export interface MaaserRule {
  id: number;
  kind: MaaserRuleKind;
  pattern: string;
}

export type RecurringStatus = 'active' | 'ignored' | 'ended';
export type RecurringDirection = 'debit' | 'credit';

export interface RecurringItem {
  id: number;
  accountId: number;
  accountName: string;
  displayName: string;
  direction: RecurringDirection;
  dayOfMonth: number;
  expectedAmount: number;
  userAmount: number | null;
  amount: number;
  amountVaries: boolean;
  source: 'auto' | 'manual';
  status: RecurringStatus;
  occurrences: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
}

export interface RecurringInput {
  accountId: number;
  displayName: string;
  direction: RecurringDirection;
  dayOfMonth: number;
  amount: number;
}

export interface ForecastEvent {
  date: string;
  amount: number;
  label: string;
  kind: 'card' | 'recurring';
  estimated: boolean;
  late: boolean;
  knownAmount: number | null;
  balanceAfter: number;
  sourceId: number;
}

export interface AccountForecast {
  accountId: number;
  accountName: string;
  bankName: string;
  balance: number | null;
  balanceDate: string | null;
  events: ForecastEvent[];
  months: { month: string; debits: number; credits: number }[];
  endBalance: number | null;
  minBalance: number | null;
  minBalanceDate: string | null;
  willGoNegative: boolean;
  linkedCards: string[];
}

export interface DashboardMonth {
  month: string;
  partial: boolean;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  balance: number | null;
  maaserDue: number;
  maaserPaid: number;
  maaserBalance: number | null;
}

export interface DashboardCategory {
  categoryId: number | null;
  total: number;
  series: number[];
  typical: number;
}

export interface DashboardResult {
  months: DashboardMonth[];
  categories: DashboardCategory[];
  summary: { typicalIncome: number; typicalExpenses: number; typicalSavingsRate: number | null; balance: number | null; balanceChange: number | null };
}

export interface ForecastResult {
  from: string;
  until: string;
  accounts: AccountForecast[];
  unlinkedCards: string[];
}

export interface SyncStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  banks: { bankId: number; displayName: string; state: 'pending' | 'running' | 'done' | 'error'; error?: string; added?: number }[];
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  merchantCount: number;
}

export interface MerchantSummary {
  merchant: string;
  count: number;
  total: number;
  lastDate: string;
  categoryId: number | null;
  sourceCategory: string | null;
}

export const CATEGORY_ICONS = [
  'label', 'shopping_cart', 'restaurant', 'local_cafe', 'home', 'bolt', 'water_drop', 'smartphone', 'wifi',
  'directions_car', 'local_gas_station', 'local_parking', 'directions_bus', 'shield', 'medical_services', 'local_pharmacy',
  'school', 'child_care', 'checkroom', 'chair', 'build', 'volunteer_activism', 'synagogue', 'account_balance', 'redeem',
  'celebration', 'beach_access', 'flight', 'payments', 'family_restroom', 'receipt', 'pets', 'menu_book', 'sports_soccer',
  'content_cut', 'local_laundry_service', 'devices', 'savings', 'work',
];

export const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${HEBREW_MONTHS[Number(m) - 1]} ${year}`;
}
