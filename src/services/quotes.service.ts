/**
 * מחירים חיים מ-Yahoo Finance (ממשק ה-chart הציבורי, בלי מפתח).
 * מניות בבורסה בת"א מתומחרות באגורות (ILA) — מומר לשקלים.
 * מטמון קצר כדי לא להעמיס: כל סימול נשלף לכל היותר פעם בדקה.
 */
export interface Quote {
  symbol: string;
  /** מחיר במטבע הנייר (שקלים, לא אגורות) */
  price: number;
  previousClose: number | null;
  currency: string;
  name: string | null;
  /** זמן המחיר האחרון במסחר */
  time: string | null;
  fetchedAt: number;
}

const CACHE_MS = 60_000;
const cache = new Map<string, Quote>();
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; caspita/1.0)', Accept: 'application/json' };

interface ChartMeta {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
  longName?: string;
  shortName?: string;
  regularMarketTime?: number;
}

async function fetchOne(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { chart?: { result?: { meta?: ChartMeta }[] } };
    const meta = body.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    // ILA = אגורות
    const factor = meta.currency === 'ILA' ? 0.01 : 1;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    return {
      symbol,
      price: meta.regularMarketPrice * factor,
      previousClose: typeof prev === 'number' ? prev * factor : null,
      currency: meta.currency === 'ILA' ? 'ILS' : meta.currency ?? '',
      name: meta.longName ?? meta.shortName ?? null,
      time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** מחירים לרשימת סימולים; סימול שנכשל מחזיר את המחיר האחרון שבמטמון (אם יש) */
async function getQuotes(symbols: string[], force = false): Promise<Map<string, Quote>> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const stale = unique.filter((s) => force || !cache.has(s) || Date.now() - cache.get(s)!.fetchedAt > CACHE_MS);
  const fetched = await Promise.all(stale.map((s) => fetchOne(s)));
  fetched.forEach((q) => q && cache.set(q.symbol, q));
  return new Map(unique.filter((s) => cache.has(s)).map((s) => [s, cache.get(s)!]));
}

/** שער הדולר בשקלים */
async function usdIls(force = false): Promise<number | null> {
  return (await getQuotes(['ILS=X'], force)).get('ILS=X')?.price ?? null;
}

export const quotesService = { getQuotes, usdIls };
