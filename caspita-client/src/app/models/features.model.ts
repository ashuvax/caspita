import { LoanDirection } from './loan.model';

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
  kind: 'price_up' | 'price_down' | 'budget' | 'installment_done' | 'installment_last';
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

export interface InstallmentLoanInput {
  key: string;
  direction: LoanDirection;
  counterparty: string;
}
