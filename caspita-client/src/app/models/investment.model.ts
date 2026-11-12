export type PriceSource = 'yahoo' | 'manual';
export type HoldingCurrency = 'ILS' | 'USD';

export interface Holding {
  id: number;
  account: string;
  name: string;
  symbol: string | null;
  quantity: number;
  currency: HoldingCurrency;
  priceSource: PriceSource;
  manualPrice: number | null;
  manualPriceDate: string | null;
  costBasis: number | null;
  note: string | null;
  price: number | null;
  dayChangePct: number | null;
  dayChangeIls: number | null;
  value: number | null;
  valueIls: number | null;
  gain: number | null;
  gainPct: number | null;
  priceTime: string | null;
  priceStale: boolean;
}

export interface InvestmentsResult {
  holdings: Holding[];
  usdIls: number | null;
  totalIls: number;
  dayChangeIls: number;
  gainIls: number | null;
  updatedAt: string;
}

export interface HoldingInput {
  account?: string;
  name?: string;
  symbol?: string | null;
  quantity?: number;
  currency?: HoldingCurrency;
  priceSource?: PriceSource;
  manualPrice?: number | null;
  manualPriceDate?: string | null;
  costBasis?: number | null;
  note?: string | null;
}

export interface NetWorth {
  bank: number;
  savings: number;
  savingsWithdrawable: number;
  investments: number;
  owedToMe: number;
  debts: number;
  assets: number;
  net: number;
}
