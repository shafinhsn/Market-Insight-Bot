import { logger } from "../lib/logger.js";

export type PriceMap = Record<string, number>;

const PRICE_CACHE: { data: PriceMap; ts: number } = { data: {}, ts: 0 };
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

const STATIC_PRICES: PriceMap = {
  NVDA: 1000, TSLA: 290, AAPL: 210, AMD: 165, MSFT: 430,
  META: 570, AMZN: 195, GOOGL: 178, SPY: 580, QQQ: 500,
  PLTR: 138, COIN: 255, MSTR: 390, HOOD: 22, SOFI: 14,
  RIVN: 11, BA: 165, XOM: 122, JPM: 245, GS: 540,
  ENPH: 68, FSLR: 195, RUN: 15, SEDG: 32, NOVA: 10,
  ARRY: 9, BE: 23, CHPT: 3, BLNK: 4, EVGO: 5,
  ARWR: 28, RXRX: 9, BHVN: 38, APLS: 55, MRNA: 38,
  KTOS: 34, AXON: 325, CACI: 420, SAIC: 190,
  MP: 17, FCX: 44, CELH: 35, DKNG: 50, CAVA: 95,
  LLY: 830, PFE: 24, JNJ: 152, ABBV: 195,
  UNH: 290, SCHW: 78, UPST: 58, AFRM: 48,
};

async function fetchSingleQuote(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function fetchStockPrices(tickers: string[]): Promise<PriceMap> {
  const unique = [...new Set(tickers)];
  const now = Date.now();
  const cacheAge = now - PRICE_CACHE.ts;
  const allCached = unique.every(t => t in PRICE_CACHE.data);
  if (allCached && cacheAge < PRICE_CACHE_TTL_MS) {
    return Object.fromEntries(unique.map(t => [t, PRICE_CACHE.data[t]]));
  }

  const toFetch = cacheAge >= PRICE_CACHE_TTL_MS ? unique : unique.filter(t => !(t in PRICE_CACHE.data));
  const results = await Promise.allSettled(
    toFetch.map(async t => ({ ticker: t, price: await fetchSingleQuote(t) }))
  );

  const fetched: PriceMap = {};
  let hitCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.price !== null) {
      fetched[r.value.ticker] = r.value.price;
      hitCount++;
    }
  }

  if (hitCount > 0) {
    Object.assign(PRICE_CACHE.data, fetched);
    PRICE_CACHE.ts = now;
    logger.info({ hitCount, total: toFetch.length }, "Stock prices fetched from Yahoo Finance v8");
  } else {
    logger.warn({ total: toFetch.length }, "All Yahoo Finance quote requests failed, using static prices");
  }

  const out: PriceMap = {};
  for (const t of unique) {
    out[t] = fetched[t] ?? PRICE_CACHE.data[t] ?? STATIC_PRICES[t] ?? 50;
  }
  return out;
}

export function formatPricesForPrompt(prices: PriceMap): string {
  return Object.entries(prices)
    .map(([t, p]) => `${t}=$${p.toFixed(2)}`)
    .join(", ");
}
