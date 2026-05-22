import { logger } from "../lib/logger.js";

export interface NewsArticle {
  title: string;
  description: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
  impactScore: number;
  relatedTickers: string[];
  sector: string;
}

const NEWS_API_KEY = process.env.NEWS_API_KEY ?? "";

const TICKER_KEYWORDS: Record<string, string[]> = {
  AAPL: ["apple", "iphone", "tim cook", "app store", "ios", "mac"],
  MSFT: ["microsoft", "azure", "copilot", "satya nadella", "windows"],
  NVDA: ["nvidia", "jensen huang", "gpu", "cuda", "ai chips", "blackwell"],
  TSLA: ["tesla", "elon musk", "electric vehicle", "model 3", "cybertruck"],
  AMZN: ["amazon", "aws", "prime", "bezos"],
  META: ["meta", "facebook", "instagram", "zuckerberg", "threads"],
  GOOGL: ["google", "alphabet", "gemini", "youtube", "waymo"],
  AMD: ["amd", "lisa su", "ryzen", "radeon", "epyc"],
  PLTR: ["palantir", "alex karp", "gotham", "foundry", "aip"],
  COIN: ["coinbase", "crypto exchange", "base network"],
  MSTR: ["microstrategy", "michael saylor", "bitcoin treasury"],
  HOOD: ["robinhood", "retail trading"],
  ENPH: ["enphase", "microinverter", "solar installer"],
  FSLR: ["first solar", "cadmium telluride", "utility solar"],
  RUN: ["sunrun", "rooftop solar", "residential solar"],
  ARWR: ["arrowhead pharmaceuticals", "rnai", "fatty liver"],
  RXRX: ["recursion", "recursion pharmaceuticals", "ai drug discovery"],
  BHVN: ["biohaven", "migraine"],
  MP: ["mp materials", "rare earth", "mountain pass"],
  FCX: ["freeport", "copper mining", "copper prices"],
  CELH: ["celsius", "celsius holdings", "energy drink"],
  DKNG: ["draftkings", "sports betting", "daily fantasy"],
  KTOS: ["kratos defense", "unmanned aerial", "drone defense"],
  AXON: ["axon enterprise", "taser", "body camera"],
  CAVA: ["cava group", "mediterranean restaurant"],
  UPST: ["upstart", "ai lending", "personal loans ai"],
  AFRM: ["affirm", "buy now pay later", "bnpl"],
  SPY: ["s&p 500", "sp500", "stock market rally", "correction"],
  QQQ: ["nasdaq", "tech stocks", "growth stocks"],
  XOM: ["exxon", "oil price", "crude oil"],
  JPM: ["jpmorgan", "jamie dimon", "banking"],
  BA: ["boeing", "aircraft", "faa", "737"],
  LLY: ["eli lilly", "ozempic", "mounjaro", "glp-1", "tirzepatide"],
  MRNA: ["moderna", "mrna vaccine"],
  GS: ["goldman sachs", "investment banking"],
};

const SECTOR_KEYWORDS: Record<string, string[]> = {
  Technology: ["ai", "artificial intelligence", "chip", "software", "cloud", "semiconductor", "tech", "cyber", "quantum"],
  Energy: ["oil", "gas", "opec", "crude", "lng", "natural gas", "pipeline"],
  CleanEnergy: ["renewable", "solar", "wind", "nuclear", "clean energy", "battery storage", "grid"],
  Healthcare: ["fda", "pharma", "drug approval", "medical", "healthcare", "hospital", "clinical trial"],
  Finance: ["fed", "interest rate", "inflation", "banking", "financial", "earnings", "recession"],
  Defense: ["defense", "military", "nato", "war", "weapon", "pentagon", "drone"],
  Crypto: ["bitcoin", "crypto", "blockchain", "ethereum", "digital asset", "defi", "nft"],
  Consumer: ["retail", "consumer", "spending", "e-commerce", "sports betting"],
  Biotech: ["biotech", "mrna", "gene therapy", "clinical", "trial", "fda approval"],
  EV: ["electric vehicle", "ev ", "battery", "charging", "tesla"],
};

const FINANCIAL_RSS_FEEDS = [
  { url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", source: "WSJ Markets" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch" },
  { url: "https://www.cnbc.com/id/15839135/device/rss/rss.html", source: "CNBC Markets" },
  { url: "https://www.investing.com/rss/news.rss", source: "Investing.com" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=TSLA&region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=PLTR&region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=ENPH&region=US&lang=en-US", source: "Yahoo Finance" },
];

interface RssItem { title?: string; description?: string; link?: string; pubDate?: string; guid?: string }

function extractFromXml(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/<!\[CDATA\[/, "").replace(/\]\]>/, "").replace(/<[^>]+>/g, "").trim();
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const item of itemMatches.slice(0, 5)) {
    items.push({
      title: extractFromXml(item, "title"),
      description: extractFromXml(item, "description"),
      link: extractFromXml(item, "link") || extractFromXml(item, "guid"),
      pubDate: extractFromXml(item, "pubDate"),
    });
  }
  return items;
}

async function fetchRssFeed(feed: { url: string; source: string }): Promise<NewsArticle[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "Accept": "application/rss+xml,application/xml,text/xml", "User-Agent": "MarketIntel/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRssItems(xml);
    return items.map(item => processArticle({
      title: item.title ?? "",
      description: item.description ?? "",
      source: feed.source,
      url: item.link ?? feed.url,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    })).filter(a => a.title.length > 20);
  } catch {
    return [];
  }
}

interface NewsApiArticle {
  title: string;
  description: string;
  source: { name: string };
  url: string;
  publishedAt: string;
}

interface NewsApiResponse {
  articles?: NewsApiArticle[];
  status?: string;
}

async function fetchNewsApi(query?: string): Promise<NewsArticle[]> {
  if (!NEWS_API_KEY) return [];
  try {
    const q = query ?? "stock market options trading earnings Fed interest rate";
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=15&language=en&apiKey=${NEWS_API_KEY}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as NewsApiResponse;
    return (data.articles ?? [])
      .filter(a => a.title && a.title !== "[Removed]")
      .map(a => processArticle({
        title: a.title,
        description: a.description ?? "",
        source: a.source?.name ?? "NewsAPI",
        url: a.url,
        publishedAt: a.publishedAt,
      }));
  } catch {
    return [];
  }
}

function processArticle(raw: { title: string; description: string; source: string; url: string; publishedAt: string }): NewsArticle {
  const text = `${raw.title} ${raw.description}`.toLowerCase();
  const relatedTickers: string[] = [];
  for (const [ticker, kws] of Object.entries(TICKER_KEYWORDS)) {
    if (kws.some(kw => text.includes(kw))) relatedTickers.push(ticker);
  }
  let sector = "General";
  let maxKws = 0;
  for (const [s, kws] of Object.entries(SECTOR_KEYWORDS)) {
    const hits = kws.filter(kw => text.includes(kw)).length;
    if (hits > maxKws) { maxKws = hits; sector = s; }
  }
  const bullish = ["surge", "rally", "gain", "boost", "beat", "growth", "record", "buy", "positive", "approve", "invest"];
  const bearish = ["crash", "decline", "fall", "risk", "cut", "miss", "fail", "threat", "sanction", "tariff", "ban", "recession"];
  const bScore = bullish.filter(w => text.includes(w)).length;
  const beScore = bearish.filter(w => text.includes(w)).length;
  const sentiment = bScore > beScore + 1 ? "positive" : beScore > bScore + 1 ? "negative" : "neutral";
  const impactScore = Math.min(95, 40 + relatedTickers.length * 8 + maxKws * 5);
  return {
    title: raw.title,
    description: raw.description.slice(0, 200),
    source: raw.source,
    url: raw.url,
    publishedAt: raw.publishedAt,
    sentiment,
    impactScore,
    relatedTickers: [...new Set(relatedTickers)].slice(0, 5),
    sector,
  };
}

const NEWS_CACHE: { data: NewsArticle[] | null; ts: number } = { data: null, ts: 0 };
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchMarketNews(query?: string, limit = 14): Promise<NewsArticle[]> {
  const now = Date.now();
  if (NEWS_CACHE.data && now - NEWS_CACHE.ts < NEWS_CACHE_TTL_MS) {
    return NEWS_CACHE.data.slice(0, limit);
  }

  logger.info("Fetching market news from NewsAPI and RSS feeds");

  const [newsApiResult, ...rssResults] = await Promise.allSettled([
    fetchNewsApi(query),
    ...FINANCIAL_RSS_FEEDS.map(f => fetchRssFeed(f)),
  ]);

  const all: NewsArticle[] = [];
  if (newsApiResult.status === "fulfilled") all.push(...newsApiResult.value);
  for (const r of rssResults) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const seen = new Set<string>();
  const unique = all.filter(a => {
    const key = a.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  logger.info({ total: unique.length, newsApi: newsApiResult.status === "fulfilled" ? newsApiResult.value.length : 0 }, "News fetched");
  NEWS_CACHE.data = unique;
  NEWS_CACHE.ts = now;
  return unique.slice(0, limit);
}
