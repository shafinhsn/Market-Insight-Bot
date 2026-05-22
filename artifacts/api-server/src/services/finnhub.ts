import { logger } from "../lib/logger.js";
import type { OptionsFlowItem } from "./yahoo-finance.js";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "";
const BASE = "https://finnhub.io/api/v1";

interface FinnhubQuote {
  c: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

interface FinnhubOptionChain {
  code: string;
  exchange: string;
  lastTradeDate: string;
  data?: Array<{
    expirationDate: string;
    options?: {
      CALL?: Array<FinnhubContract>;
      PUT?: Array<FinnhubContract>;
    };
  }>;
}

interface FinnhubContract {
  contractName: string;
  contractSize: number;
  currency: string;
  expirationDate: string;
  impliedVolatility: number;
  inTheMoney: boolean;
  lastPrice: number;
  lastTradeDate: string;
  openInterest: number;
  strike: number;
  type: "C" | "P";
  volume: number;
}

interface FinnhubNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

const FINNHUB_CACHE: { flow: OptionsFlowItem[] | null; ts: number } = { flow: null, ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

async function finnhubGet<T>(path: string): Promise<T | null> {
  if (!FINNHUB_API_KEY) return null;
  try {
    const res = await fetch(`${BASE}${path}&token=${FINNHUB_API_KEY}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function getQuote(ticker: string): Promise<number | null> {
  const data = await finnhubGet<FinnhubQuote>(`/quote?symbol=${ticker}`);
  return data && data.c > 0 ? data.c : null;
}

async function getOptionsFlow(ticker: string): Promise<OptionsFlowItem[]> {
  const [chain, quote] = await Promise.all([
    finnhubGet<FinnhubOptionChain>(`/stock/option-chain?symbol=${ticker}`),
    getQuote(ticker),
  ]);

  if (!chain?.data?.length) return [];

  const now = new Date().toISOString();
  const items: OptionsFlowItem[] = [];
  const stockPrice = quote ?? 100;

  for (const expiry of chain.data.slice(0, 3)) {
    const calls = expiry.options?.CALL ?? [];
    const puts = expiry.options?.PUT ?? [];

    for (const [contracts, type, sentiment] of [
      [calls, "call" as const, "bullish" as const],
      [puts, "put" as const, "bearish" as const],
    ] as const) {
      for (const c of contracts as FinnhubContract[]) {
        const vol = c.volume ?? 0;
        const oi = Math.max(c.openInterest ?? 1, 1);
        if (vol < 100) continue;
        const ratio = vol / oi;
        if (ratio < 1.5) continue;
        const score = ratio * Math.log10(vol + 10);
        const strikeRatio = Math.abs(c.strike - stockPrice) / stockPrice;
        if (strikeRatio > 0.3) continue;

        items.push({
          ticker,
          contractType: type,
          strike: c.strike,
          expiration: expiry.expirationDate,
          volume: vol,
          openInterest: oi,
          premium: c.lastPrice ?? 0,
          impliedVolatility: c.impliedVolatility ?? 0.3,
          sentiment,
          unusualActivity: ratio > 2,
          unusualScore: score,
          timestamp: now,
        });
      }
    }
  }

  return items.sort((a, b) => b.unusualScore - a.unusualScore).slice(0, 5);
}

export async function fetchFinnhubOptionsFlow(limit = 25): Promise<OptionsFlowItem[]> {
  if (FINNHUB_CACHE.flow && Date.now() - FINNHUB_CACHE.ts < CACHE_TTL) {
    return FINNHUB_CACHE.flow.slice(0, limit);
  }

  if (!FINNHUB_API_KEY) {
    logger.warn("FINNHUB_API_KEY not set — skipping Finnhub options scan");
    return [];
  }

  const WATCH_LIST = [
    "NVDA", "TSLA", "AAPL", "AMD", "PLTR", "COIN", "META", "MSFT",
    "ENPH", "FSLR", "ARWR", "RXRX", "KTOS", "DKNG", "AXON",
  ];

  logger.info({ count: WATCH_LIST.length }, "Scanning Finnhub options chain");
  const results = await Promise.allSettled(WATCH_LIST.map(t => getOptionsFlow(t)));

  const all: OptionsFlowItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  all.sort((a, b) => b.unusualScore - a.unusualScore);
  logger.info({ count: all.length }, "Finnhub options flow collected");

  FINNHUB_CACHE.flow = all;
  FINNHUB_CACHE.ts = Date.now();
  return all.slice(0, limit);
}

export interface FinnhubNewsArticle {
  headline: string;
  source: string;
  url: string;
  datetime: number;
  summary: string;
  category: string;
  related: string;
}

export async function fetchFinnhubMarketNews(category = "general", limit = 10): Promise<FinnhubNewsArticle[]> {
  if (!FINNHUB_API_KEY) return [];
  const data = await finnhubGet<FinnhubNewsItem[]>(`/news?category=${category}`);
  if (!data) return [];
  return data.slice(0, limit).map(n => ({
    headline: n.headline,
    source: n.source,
    url: n.url,
    datetime: n.datetime,
    summary: n.summary,
    category: n.category,
    related: n.related,
  }));
}
