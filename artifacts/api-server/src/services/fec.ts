import { logger } from "../lib/logger.js";

export interface FecContribution {
  committee_name: string;
  candidate_name: string;
  party: string;
  total_receipts: number;
  total_disbursements: number;
  state: string;
  office: string;
  industry?: string;
  tickers: string[];
}

interface FecCandidate {
  name: string;
  candidate_status: string;
  office: string;
  state: string;
  party: string;
  total_receipts?: number;
  total_disbursements?: number;
}

interface FecResponse {
  results?: FecCandidate[];
  pagination?: { count: number };
}

const INDUSTRY_TICKER_MAP: Record<string, string[]> = {
  technology: ["NVDA", "AAPL", "MSFT", "META", "GOOGL"],
  energy: ["XOM", "CVX", "COP", "OXY", "SLB"],
  finance: ["JPM", "GS", "BAC", "WFC", "MS"],
  defense: ["LMT", "RTX", "NOC", "GD", "BA", "KTOS"],
  healthcare: ["UNH", "JNJ", "PFE", "ABBV", "LLY"],
  pharmaceuticals: ["LLY", "PFE", "JNJ", "ABBV", "MRNA"],
  crypto: ["COIN", "MSTR", "MARA", "RIOT"],
  "clean energy": ["ENPH", "FSLR", "RUN", "SEDG", "BE"],
  telecom: ["T", "VZ", "TMUS"],
};

const FEC_CACHE: { data: FecContribution[] | null; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 60 * 60 * 1000;

export async function fetchFecCampaignFinance(limit = 10): Promise<FecContribution[]> {
  if (FEC_CACHE.data && Date.now() - FEC_CACHE.ts < CACHE_TTL) {
    return FEC_CACHE.data.slice(0, limit);
  }

  try {
    const url = `https://api.open.fec.gov/v1/candidates/?sort_hide_null=false&sort=-total_receipts&election_year=2026&office=H&per_page=20&sort_nulls_last=false&api_key=DEMO_KEY`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "FEC API request failed");
      return [];
    }

    const data = await res.json() as FecResponse;
    const candidates = data.results ?? [];

    const contributions: FecContribution[] = candidates
      .filter(c => c.total_receipts && c.total_receipts > 100000)
      .map(c => ({
        committee_name: c.name,
        candidate_name: c.name,
        party: c.party ?? "UNK",
        total_receipts: c.total_receipts ?? 0,
        total_disbursements: c.total_disbursements ?? 0,
        state: c.state ?? "US",
        office: c.office ?? "H",
        tickers: [],
      }));

    FEC_CACHE.data = contributions;
    FEC_CACHE.ts = Date.now();
    logger.info({ count: contributions.length }, "FEC campaign finance data fetched");
    return contributions.slice(0, limit);
  } catch (err) {
    logger.warn({ err }, "FEC API error — returning empty");
    return [];
  }
}

export function formatFecForPrompt(contributions: FecContribution[]): string {
  if (!contributions.length) return "No FEC campaign finance data available.";
  return contributions
    .slice(0, 8)
    .map(c => `${c.candidate_name} (${c.party}/${c.state}/${c.office}) | Receipts: $${(c.total_receipts / 1000).toFixed(0)}K`)
    .join("\n");
}
