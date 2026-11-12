import { LoanDirection } from './loan.model';
import { Transaction } from './bank.model';

export interface InstallmentPlan {
  key: string;
  name: string;
  accountName: string;
  categoryId: number | null;
  totalAmount: number;
  perPayment: number;
  totalPayments: number;
  paidPayments: number;
  remainingPayments: number;
  remainingAmount: number;
  firstDate: string;
  nextChargeDate: string | null;
  endMonth: string;
  done: boolean;
  loanId: number | null;
  loanName: string | null;
}

export interface InstallmentsResult {
  plans: InstallmentPlan[];
  upcoming: { month: string; amount: number }[];
  totalRemaining: number;
  monthlyNow: number;
}

export interface Fund {
  id: number;
  name: string;
  icon: string;
  monthlyAmount: number;
  targetAmount: number | null;
  targetDate: string | null;
  categoryId: number | null;
  startMonth: string;
  openingBalance: number;
  note: string | null;
  contributed: number;
  spent: number;
  balance: number;
  recent: { date: string; name: string; amount: number }[];
  neededMonthly: number | null;
  onTrack: boolean | null;
}

export interface FundInput {
  name: string;
  icon: string;
  monthlyAmount: number;
  targetAmount: number | null;
  targetDate: string | null;
  categoryId: number | null;
  startMonth: string;
  openingBalance: number;
  note: string | null;
}

export type AlertTone = 'good' | 'bad' | 'info';

export interface AppAlert {
  key: string;
  kind: 'price_up' | 'price_down' | 'budget' | 'installment_done' | 'installment_last' | 'loan_late' | 'duplicate' | 'unusual' | 'new_merchant' | 'fee';
  tone: AlertTone;
  title: string;
  text: string;
  link: string;
  date: string;
}

export interface Section46Payee {
  name: string;
  total: number;
  count: number;
  eligible: boolean;
  eligibleAmount: number;
  eligibleCount: number;
}

export interface Section46Summary {
  year: number;
  payees: Section46Payee[];
  donationsTotal: number;
  eligibleTotal: number;
  creditRate: number;
  expectedCredit: number;
}

export type AssistantEngine = 'claude' | 'codex';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantAnswer {
  answer: string;
  engine: AssistantEngine;
  sessionId: string | null;
  durationMs: number;
}

// ---------- ארנק מזומן ----------

export interface SplitPartInput {
  categoryId: number;
  amount: number;
  note?: string | null;
}

export interface WalletWithdrawal {
  id: number;
  date: string;
  amount: number;
  accountName: string;
  categoryId: number | null;
  splits: { categoryId: number; amount: number; note: string | null }[];
  splitTotal: number;
  covered: number;
  remaining: number;
}

export interface WalletExpense {
  id: number;
  date: string;
  amount: number;
  description: string;
  note: string | null;
  covered: number;
}

export interface WalletSummary {
  fromMonth: string;
  withdrawals: WalletWithdrawal[];
  expenses: WalletExpense[];
  totals: { withdrawn: number; detailed: number; unallocated: number; received: number };
}

// ---------- תגיות ----------

export type TagColor = 'pine' | 'gold' | 'brick' | 'leaf' | 'sky' | 'plum';
export const TAG_COLORS: TagColor[] = ['pine', 'gold', 'brick', 'leaf', 'sky', 'plum'];

export interface Tag {
  id: number;
  name: string;
  color: TagColor;
  count: number;
  total: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface TagDetail extends Tag {
  byCategory: { categoryId: number | null; amount: number }[];
  byMonth: { month: string; amount: number }[];
  transactions: (Transaction & { merchant: string })[];
}

// ---------- כללי סיווג ----------

export type RuleDirection = 'expense' | 'income';

export interface CategoryRule {
  id: number;
  categoryId: number;
  text: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  direction: RuleDirection | null;
  accountId: number | null;
}

export type CategoryRuleInput = Omit<CategoryRule, 'id'>;

export interface RulePreview {
  count: number;
  total: number;
  samples: { date: string; name: string; amount: number }[];
}

// ---------- ייבוא דוח תרומות ----------

export type DonationEntryStatus = 'matched' | 'cash_new' | 'unmatched';

export interface DonationPreviewEntry {
  index: number;
  date: string;
  org: string;
  amount: number;
  method: 'card' | 'cash' | 'other';
  methodLabel: string;
  receipt: string | null;
  cancelled: boolean;
  status: DonationEntryStatus;
  transaction: { id: number; date: string; name: string; amount: number; accountKind: string } | null;
}

export interface DonationPreview {
  year: number | null;
  reportTotal: number | null;
  entries: DonationPreviewEntry[];
  counts: Record<DonationEntryStatus, number>;
  totals: Record<DonationEntryStatus, number>;
}

export interface DonationApplyResult {
  marked: number;
  created: number;
  payees: number;
}

// ---------- סיכום שנה ----------

export interface YearSummary {
  year: number;
  partial: boolean;
  throughDate: string;
  firstDate: string | null;
  totals: { income: number; expenses: number; net: number; savings: number; avgMonthlyExpenses: number; transactionCount: number };
  previous: { income: number; expenses: number } | null;
  months: { month: string; income: number; expenses: number; net: number }[];
  byCategory: { categoryId: number | null; amount: number; prevAmount: number | null }[];
  topMerchants: { name: string; amount: number; count: number }[];
  largest: { name: string; date: string; amount: number }[];
  maaser: { income: number; due: number; paid: number };
  donations: { total: number; eligible: number; credit: number };
  fees: { total: number; count: number };
  cashWithdrawn: number;
  tags: { id: number; name: string; color: TagColor; amount: number }[];
}

export interface InstallmentLoanInput {
  key: string;
  direction: LoanDirection;
  counterparty: string;
}
