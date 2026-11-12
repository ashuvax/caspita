export type SavingsKind = 'gemach_deposit' | 'study_fund' | 'other';

export const SAVINGS_KIND_LABELS: Record<SavingsKind, string> = {
  gemach_deposit: 'פיקדון בגמ"ח',
  study_fund: 'קרן השתלמות',
  other: 'חיסכון אחר',
};

export const SAVINGS_KIND_ICONS: Record<SavingsKind, string> = {
  gemach_deposit: 'savings',
  study_fund: 'school',
  other: 'account_balance_wallet',
};

export interface SavingsMovement {
  id: number;
  source: 'bank' | 'manual';
  date: string;
  amount: number;
  label: string;
}

export interface Savings {
  id: number;
  kind: SavingsKind;
  name: string;
  balance: number | null;
  balanceDate: string | null;
  penaltyPct: number | null;
  liquidDate: string | null;
  note: string | null;
  autoMatch: boolean;
  value: number;
  withdrawable: number;
  monthlyDeposit: number | null;
  basedOnBalance: boolean;
  movements: SavingsMovement[];
}

export interface SavingsInput {
  kind?: SavingsKind;
  name?: string;
  balance?: number | null;
  balanceDate?: string | null;
  penaltyPct?: number | null;
  liquidDate?: string | null;
  note?: string | null;
}

export interface SavingsCandidate {
  id: number;
  date: string;
  amount: number;
  name: string;
  accountName: string;
}
