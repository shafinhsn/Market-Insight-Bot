import { logger } from "../lib/logger.js";

export interface PoliticalStatement {
  speaker: string;
  statement: string;
  date: string;
  source: string;
  url: string;
  tickers: string[];
  sectors: string[];
  sentiment: "bullish" | "bearish" | "neutral";
  marketImpact: number;
}

interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
  status?: string;
}

const NOTABLE_FIGURES = [
  "Trump", "Biden", "Powell", "Yellen", "Bessent",
  "Musk", "Cook", "Huang", "Altman", "Zuckerberg",
  "Dimon", "Buffett", "Munger", "Saylor", "Wood",
];

const SECTOR_KEYWORDS: Record<string, string[]> = {
  Technology: ["ai", "artificial intelligence", "chip", "semiconductor", "tech", "software", "cyber"],
  Energy: ["oil", "gas", "opec", "crude", "lng", "pipeline", "energy"],
  CleanEnergy: ["solar", "wind", "renewable", "clean energy", "climate", "carbon", "green"],
  Defense: ["defense", "military", "weapon", "nato", "pentagon", "war", "tariff", "trade"],
  Finance: ["fed", "interest rate", "inflation", "bank", "economy", "gdp", "recession"],
  Crypto: ["bitcoin", "crypto", "blockchain", "digital asset", "defi", "coinbase"],
  Healthcare: ["pharma", "drug", "fda", "healthcare", "vaccine", "biotech"],
  EV: ["electric vehicle", "ev", "tesla", "battery", "charging"],
};

const TICKER_KEYWORDS: Record<string, string[]> = {
  TSLA: ["tesla", "elon musk", "electric vehicle"],
  NVDA: ["nvidia", "ai chips", "gpu", "jensen huang"],
  AAPL: ["apple", "iphone", "tim cook"],
  COIN: ["coinbase", "crypto exchange"],
  MSTR: ["microstrategy", "michael saylor", "bitcoin treasury"],
  ENPH: ["enphase", "solar", "renewable energy"],
  LLY: ["eli lilly", "ozempic", "glp-1", "weight loss"],
  META: ["meta", "facebook", "zuckerberg"],
  JPM: ["jpmorgan", "jamie dimon"],
  GS: ["goldman sachs"],
  PLTR: ["palantir", "alex karp"],
  BA: ["boeing", "aircraft", "aerospace"],
};

const GDELT_CACHE: { data: PoliticalStatement[] | null; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 15 * 60 * 1000;

function inferTickers(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [ticker, kws] of Object.entries(TICKER_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw))) found.push(ticker);
  }
  return [...new Set(found)].slice(0, 4);
}

function inferSectors(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw))) found.push(sector);
  }
  return [...new Set(found)].slice(0, 3);
}

function inferSentiment(text: string): "bullish" | "bearish" | "neutral" {
  const lower = text.toLowerCase();
  const bullish = ["boost", "surge", "rally", "growth", "invest", "support", "buy", "positive", "good", "great", "expand", "sign", "approve", "fund", "win", "up", "rise", "gain"];
  const bearish = ["sanction", "ban", "restrict", "tariff", "fine", "penalty", "crash", "fail", "risk", "threat", "cut", "down", "fall", "loss", "war", "concern", "worry"];
  const bScore = bullish.filter(w => lower.includes(w)).length;
  const beScore = bearish.filter(w => lower.includes(w)).length;
  if (bScore > beScore + 1) return "bullish";
  if (beScore > bScore + 1) return "bearish";
  return "neutral";
}

async function fetchGdeltForFigure(figure: string): Promise<PoliticalStatement[]> {
  try {
    const query = encodeURIComponent(`"${figure}" market economy stock investment`);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=5&sort=DateDesc&format=json&timespan=3d`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as GdeltResponse;
    const articles = data.articles ?? [];

    return articles.map(a => {
      const text = `${a.title}`;
      const dateStr = a.seendate
        ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}`
        : new Date().toISOString().split("T")[0];
      return {
        speaker: figure,
        statement: a.title.slice(0, 200),
        date: dateStr,
        source: a.domain,
        url: a.url,
        tickers: inferTickers(text),
        sectors: inferSectors(text),
        sentiment: inferSentiment(text),
        marketImpact: Math.floor(Math.random() * 30) + 40,
      };
    });
  } catch {
    return [];
  }
}

export async function fetchPoliticalStatements(limit = 12): Promise<PoliticalStatement[]> {
  if (GDELT_CACHE.data && Date.now() - GDELT_CACHE.ts < CACHE_TTL) {
    return GDELT_CACHE.data.slice(0, limit);
  }

  logger.info("Scanning GDELT for political statements from notable figures");

  const priority = ["Trump", "Powell", "Musk", "Bessent", "Yellen"];
  const results = await Promise.allSettled(priority.map(f => fetchGdeltForFigure(f)));

  const all: PoliticalStatement[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  logger.info({ count: all.length }, "GDELT political statements collected");
  GDELT_CACHE.data = all;
  GDELT_CACHE.ts = Date.now();
  return all.slice(0, limit);
}

export function formatStatementsForPrompt(statements: PoliticalStatement[]): string {
  if (!statements.length) return "No recent political statements available.";
  return statements.map(s =>
    `[${s.speaker}] "${s.statement}" | Source: ${s.source} | Date: ${s.date} | Sentiment: ${s.sentiment.toUpperCase()} | Tickers: ${s.tickers.join(",") || "none"} | Sectors: ${s.sectors.join(",") || "none"}`
  ).join("\n");
}
