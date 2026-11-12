import { Holding, type HoldingCurrency, type PriceSource } from '../models/holding.model';
import { quotesService } from './quotes.service';
import { round2 } from '../utils/text';

export interface HoldingDto {
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
  /** מחיר ליחידה במטבע הנייר */
  price: number | null;
  /** שינוי יומי באחוזים */
  dayChangePct: number | null;
  /** שינוי יומי בשקלים (לכל הכמות) */
  dayChangeIls: number | null;
  value: number | null;
  valueIls: number | null;
  /** רווח/הפסד מהעלות (במטבע הנייר) */
  gain: number | null;
  gainPct: number | null;
  priceTime: string | null;
  /** המחיר החי לא התקבל — מוצג המחיר הידני/האחרון */
  priceStale: boolean;
}

export interface InvestmentsResult {
  holdings: HoldingDto[];
  usdIls: number | null;
  totalIls: number;
  dayChangeIls: number;
  gainIls: number | null;
  updatedAt: string;
}

export interface HoldingInput {
  account: string;
  name: string;
  symbol?: string | null;
  quantity: number;
  currency: HoldingCurrency;
  priceSource: PriceSource;
  manualPrice?: number | null;
  manualPriceDate?: string | null;
  costBasis?: number | null;
  note?: string | null;
}

async function list(force = false): Promise<InvestmentsResult> {
  const holdings = await Holding.findAll({ order: [['account', 'ASC'], ['name', 'ASC']] });
  const symbols = holdings.filter((h) => h.priceSource === 'yahoo' && h.symbol).map((h) => h.symbol!);
  const [quotes, fx] = await Promise.all([quotesService.getQuotes(symbols, force), quotesService.usdIls(force)]);
  const toIls = (v: number, cur: HoldingCurrency) => (cur === 'USD' ? (fx === null ? null : v * fx) : v);

  const dtos: HoldingDto[] = holdings.map((h) => {
    const q = h.priceSource === 'yahoo' && h.symbol ? quotes.get(h.symbol) : undefined;
    const price = q?.price ?? h.manualPrice ?? null;
    const value = price !== null ? round2(price * h.quantity) : null;
    const dayChangePct = q?.previousClose ? round2(((q.price - q.previousClose) / q.previousClose) * 100) : null;
    const dayChange = q?.previousClose ? (q.price - q.previousClose) * h.quantity : null;
    const gain = value !== null && h.costBasis !== null && h.costBasis !== undefined ? round2(value - h.costBasis) : null;
    const valueIls = value !== null ? toIls(value, h.currency) : null;
    const dayIls = dayChange !== null ? toIls(dayChange, h.currency) : null;
    return {
      id: h.id,
      account: h.account,
      name: h.name,
      symbol: h.symbol ?? null,
      quantity: h.quantity,
      currency: h.currency,
      priceSource: h.priceSource,
      manualPrice: h.manualPrice ?? null,
      manualPriceDate: h.manualPriceDate ?? null,
      costBasis: h.costBasis ?? null,
      note: h.note ?? null,
      price: price !== null ? round2(price * 10000) / 10000 : null,
      dayChangePct,
      dayChangeIls: dayIls !== null ? round2(dayIls) : null,
      value,
      valueIls: valueIls !== null ? round2(valueIls) : null,
      gain,
      gainPct: gain !== null && h.costBasis ? round2((gain / h.costBasis) * 100) : null,
      priceTime: q?.time ?? (h.manualPriceDate ? `${h.manualPriceDate}T00:00:00` : null),
      priceStale: h.priceSource === 'yahoo' && !q,
    };
  });

  const gains = dtos.filter((d) => d.gain !== null);
  return {
    holdings: dtos,
    usdIls: fx !== null ? round2(fx * 10000) / 10000 : null,
    totalIls: round2(dtos.reduce((s, d) => s + (d.valueIls ?? 0), 0)),
    dayChangeIls: round2(dtos.reduce((s, d) => s + (d.dayChangeIls ?? 0), 0)),
    gainIls: gains.length ? round2(gains.reduce((s, d) => s + (toIls(d.gain!, d.currency) ?? 0), 0)) : null,
    updatedAt: new Date().toISOString(),
  };
}

async function create(input: HoldingInput): Promise<void> {
  await Holding.create({
    account: input.account.trim(),
    name: input.name.trim(),
    symbol: input.symbol?.trim().toUpperCase() || null,
    quantity: input.quantity,
    currency: input.currency,
    priceSource: input.priceSource,
    manualPrice: input.manualPrice ?? null,
    manualPriceDate: input.manualPriceDate ?? null,
    costBasis: input.costBasis ?? null,
    note: input.note?.trim() || null,
  });
}

async function update(id: number, input: Partial<HoldingInput>): Promise<boolean> {
  const h = await Holding.findByPk(id);
  if (!h) return false;
  if (input.account !== undefined) h.account = input.account.trim();
  if (input.name !== undefined) h.name = input.name.trim();
  if (input.symbol !== undefined) h.symbol = input.symbol?.trim().toUpperCase() || null;
  if (input.quantity !== undefined) h.quantity = input.quantity;
  if (input.currency !== undefined) h.currency = input.currency;
  if (input.priceSource !== undefined) h.priceSource = input.priceSource;
  if (input.manualPrice !== undefined) h.manualPrice = input.manualPrice;
  if (input.manualPriceDate !== undefined) h.manualPriceDate = input.manualPriceDate;
  if (input.costBasis !== undefined) h.costBasis = input.costBasis;
  if (input.note !== undefined) h.note = input.note?.trim() || null;
  await h.save();
  return true;
}

async function remove(id: number): Promise<boolean> {
  return (await Holding.destroy({ where: { id } })) > 0;
}

/** שווי כולל בשקלים (למסך הבית) */
async function totalIls(): Promise<number> {
  return (await list()).totalIls;
}

export const investmentsService = { list, create, update, remove, totalIls };
