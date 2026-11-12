export type LoanDirection = 'given' | 'taken';
export type LoanStatus = 'open' | 'overdue' | 'repaid';

export interface LoanEntry {
  id: number;
  source: 'bank' | 'manual';
  date: string;
  /** מנקודת המבט שלי: + נכנס, − יצא */
  amount: number;
  label: string;
  kind: 'principal' | 'payment';
}

export interface Loan {
  id: number;
  direction: LoanDirection;
  counterparty: string;
  amount: number;
  startDate: string | null;
  dueDate: string | null;
  note: string | null;
  closed: boolean;
  remainingOverride: number | null;
  paid: number;
  remaining: number;
  status: LoanStatus;
  daysFromDue: number | null;
  monthlyPayment: number | null;
  autoMatch: boolean;
  entries: LoanEntry[];
}

export interface LoanInput {
  direction?: LoanDirection;
  counterparty?: string;
  amount?: number;
  startDate?: string | null;
  dueDate?: string | null;
  note?: string | null;
  remainingOverride?: number | null;
  closed?: boolean;
  principalTransactionId?: number | null;
  matchDescription?: string | null;
  matchAmount?: number | null;
}

export interface LoanCandidate {
  id: number;
  date: string;
  amount: number;
  name: string;
  accountName: string;
  reason: string;
}

export interface LoanSuggestion {
  transactionId: number | null;
  counterparty: string;
  amount: number;
  date: string;
  monthly: number | null;
  matchDescription?: string;
}
