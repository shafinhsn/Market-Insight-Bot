import { logger } from "../lib/logger.js";

export interface Bill {
  id: string;
  title: string;
  level: "federal" | "state";
  state: string | null;
  status: string;
  passageProbability: number;
  marketImpactScore: number;
  affectedSectors: string[];
  affectedTickers: string[];
  summary: string;
  introducedDate: string | null;
  lastAction: string | null;
}

const SECTOR_TICKERS: Record<string, string[]> = {
  Technology: ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "AMD", "SMCI", "ANET"],
  Semiconductors: ["NVDA", "AMD", "INTC", "QCOM", "AVGO", "MRVL", "TXN", "AMAT"],
  Software: ["CRWD", "PLTR", "SNOW", "DDOG", "NET", "ZS", "HUBS", "GTLB"],
  CleanEnergy: ["ENPH", "FSLR", "RUN", "SEDG", "NOVA", "BE", "ARRY", "CSIQ", "MAXN", "SHLS"],
  Energy: ["XOM", "CVX", "COP", "OXY", "SLB", "HAL", "DVN", "FANG", "MRO"],
  EV: ["TSLA", "RIVN", "LCID", "NIO", "CHPT", "BLNK", "EVGO", "F", "GM"],
  Healthcare: ["UNH", "JNJ", "PFE", "ABBV", "MRK", "BMY", "CVS", "HUM"],
  Biotech: ["MRNA", "BNTX", "REGN", "BIIB", "GILD", "VRTX", "NVAX", "BHVN", "APLS", "RXRX", "ARWR"],
  Pharma: ["LLY", "PFE", "JNJ", "ABBV", "MRK", "BMY"],
  Finance: ["JPM", "GS", "BAC", "WFC", "MS", "C", "SCHW"],
  Fintech: ["SQ", "PYPL", "HOOD", "UPST", "AFRM", "SOFI"],
  Crypto: ["COIN", "MSTR", "MARA", "RIOT", "CLSK"],
  Defense: ["LMT", "RTX", "NOC", "GD", "BA", "KTOS", "AXON", "CACI", "SAIC"],
  Industrials: ["CAT", "DE", "HON", "GE", "CARR"],
  Materials: ["FCX", "MP", "NEM", "CTRA", "AA"],
  Consumer: ["CELH", "WING", "CAVA", "DKNG", "ABNB", "WMT", "COST"],
  Housing: ["LEN", "DHI", "TOL", "PHM"],
};

const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY ?? "";
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY ?? "";

// ─── GovTrack searches (fallback, no key needed) ─────────────────────────────
const GOVTRACK_SEARCHES = [
  { q: "artificial intelligence technology semiconductor", sectors: ["Technology", "Semiconductors", "Software"], impactBase: 70 },
  { q: "clean energy solar wind renewable electricity grid", sectors: ["CleanEnergy", "Energy", "EV"], impactBase: 75 },
  { q: "pharmaceutical drug approval biotech healthcare", sectors: ["Biotech", "Healthcare", "Pharma"], impactBase: 65 },
  { q: "defense military national security", sectors: ["Defense"], impactBase: 60 },
  { q: "cryptocurrency digital asset bitcoin blockchain", sectors: ["Crypto", "Fintech", "Finance"], impactBase: 80 },
  { q: "banking financial regulation Wall Street", sectors: ["Finance", "Fintech"], impactBase: 60 },
  { q: "infrastructure broadband electric vehicle charging", sectors: ["EV", "CleanEnergy", "Industrials"], impactBase: 55 },
  { q: "climate carbon emissions environment", sectors: ["CleanEnergy", "Energy"], impactBase: 50 },
  { q: "trade tariff import export manufacturing", sectors: ["Industrials", "Materials", "Consumer"], impactBase: 55 },
  { q: "tax credit research investment incentive", sectors: ["Technology", "CleanEnergy", "Biotech"], impactBase: 45 },
  { q: "critical minerals rare earth supply chain", sectors: ["Materials", "Technology", "Defense"], impactBase: 70 },
];

// ─── Congress.gov API ─────────────────────────────────────────────────────────
interface CongressBill {
  congress: number;
  number: string;
  title: string;
  type: string;
  updateDate: string;
  originChamber: string;
  url: string;
  latestAction?: { actionDate: string; text: string };
  introducedDate?: string;
  policyArea?: { name: string };
}

interface CongressResponse {
  bills?: CongressBill[];
}

async function fetchCongressBills(subject: string, sectors: string[], impactBase: number, limit = 3): Promise<Bill[]> {
  if (!CONGRESS_API_KEY) return [];
  try {
    const url = `https://api.congress.gov/v3/bill?query=${encodeURIComponent(subject)}&sort=updateDate+desc&limit=${limit}&format=json&api_key=${CONGRESS_API_KEY}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as CongressResponse;
    const bills = data.bills ?? [];

    return bills.map(b => {
      const inferred = inferSectors(`${b.title} ${b.policyArea?.name ?? ""}`, sectors);
      const tickers = inferTickers(inferred, b.title);
      const passProb = estimatePassageProbability(b.latestAction?.text ?? "");
      return {
        id: `cg-${b.congress}-${b.type}${b.number}`,
        title: `${b.type}${b.number}: ${b.title.slice(0, 120)}`,
        level: "federal" as const,
        state: null,
        status: b.latestAction?.text ?? "Introduced",
        passageProbability: passProb,
        marketImpactScore: marketImpactScore(inferred, passProb, impactBase),
        affectedSectors: inferred,
        affectedTickers: tickers,
        summary: b.latestAction?.text ?? `Introduced ${b.introducedDate ?? ""}`,
        introducedDate: b.introducedDate ?? null,
        lastAction: b.latestAction ? `${b.latestAction.actionDate}: ${b.latestAction.text}` : null,
      };
    });
  } catch {
    return [];
  }
}

// ─── OpenStates API ────────────────────────────────────────────────────────────
interface OpenStatesBill {
  id: string;
  title: string;
  jurisdiction: { name: string; classification: string };
  session: string;
  status: string;
  identifier: string;
  subject: string[];
  abstract?: string;
  created_at: string;
  updated_at: string;
  first_action_date?: string;
  latest_action_date?: string;
  latest_action_description?: string;
}

interface OpenStatesResponse {
  results?: OpenStatesBill[];
}

async function fetchOpenStatesBills(subject: string, sectors: string[], impactBase: number, states = ["ny", "ca", "tx"]): Promise<Bill[]> {
  if (!OPENSTATES_API_KEY) return [];
  try {
    const stateFilter = states.map(s => `jurisdiction=${s}`).join("&");
    const url = `https://v3.openstates.org/bills?q=${encodeURIComponent(subject)}&${stateFilter}&per_page=5&sort=updated_desc`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-API-KEY": OPENSTATES_API_KEY,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as OpenStatesResponse;
    const bills = data.results ?? [];

    return bills.map(b => {
      const text = `${b.title} ${(b.subject ?? []).join(" ")}`;
      const inferred = inferSectors(text, sectors);
      const tickers = inferTickers(inferred, b.title);
      const passProb = estimatePassageProbability(b.status);
      return {
        id: `os-${b.id}`,
        title: `[${b.jurisdiction.name}] ${b.identifier}: ${b.title.slice(0, 110)}`,
        level: "state" as const,
        state: b.jurisdiction.name,
        status: b.latest_action_description ?? b.status,
        passageProbability: passProb,
        marketImpactScore: marketImpactScore(inferred, passProb, impactBase - 10),
        affectedSectors: inferred,
        affectedTickers: tickers,
        summary: b.abstract ?? b.latest_action_description ?? `State bill in ${b.session}`,
        introducedDate: b.first_action_date ?? null,
        lastAction: b.latest_action_date ? `${b.latest_action_date}: ${b.latest_action_description ?? ""}` : null,
      };
    });
  } catch {
    return [];
  }
}

// ─── GovTrack fallback ────────────────────────────────────────────────────────
interface GovTrackBill {
  id: number;
  display_number: string;
  title_without_number: string;
  current_status: string;
  current_status_date: string;
  current_status_description: string;
  introduced_date: string;
  is_alive: boolean;
  major_actions: Array<[string, string]>;
}

async function searchGovTrack(q: string, seedSectors: string[], impactBase: number, limit: number): Promise<Bill[]> {
  try {
    const url = `https://www.govtrack.us/api/v2/bill?q=${encodeURIComponent(q)}&congress=119&sort=-introduced_date&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "MarketIntel/1.0 Financial Research Tool",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { objects?: GovTrackBill[] };
    const objects = data.objects ?? [];

    return objects
      .filter(b => b.is_alive && b.title_without_number?.length > 20)
      .map(b => {
        const sectors = inferSectors(b.title_without_number, seedSectors);
        const tickers = inferTickers(sectors, b.title_without_number);
        const passProb = govtrackPassageProb(b.current_status);
        const impact = marketImpactScore(sectors, passProb, impactBase);
        const lastAction = b.major_actions?.at(-1);
        return {
          id: `gt-${b.id}`,
          title: `${b.display_number}: ${b.title_without_number.slice(0, 120)}`,
          level: "federal" as const,
          state: null,
          status: b.current_status_description ?? b.current_status,
          passageProbability: passProb,
          marketImpactScore: impact,
          affectedSectors: sectors,
          affectedTickers: tickers,
          summary: b.current_status_description ?? `Status: ${b.current_status}`,
          introducedDate: b.introduced_date,
          lastAction: lastAction ? `${lastAction[0]}: ${lastAction[1]}` : `Introduced ${b.introduced_date}`,
        };
      });
  } catch {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function govtrackPassageProb(status: string): number {
  const map: Record<string, number> = {
    introduced: 8, referred: 12, reported: 28,
    pass_over_house: 52, pass_over_senate: 52,
    pass_back_senate: 68, pass_back_house: 68,
    conference: 75, enacted_signed: 100, enacted_veto_override: 100,
    prov_kill_veto: 2, fail_originating_house: 1, fail_originating_senate: 1,
  };
  return map[status] ?? 10;
}

function estimatePassageProbability(text: string): number {
  const lower = (text ?? "").toLowerCase();
  if (lower.includes("signed") || lower.includes("enacted") || lower.includes("law")) return 100;
  if (lower.includes("passed") || lower.includes("approved")) return 75;
  if (lower.includes("committee")) return 25;
  if (lower.includes("referred")) return 12;
  if (lower.includes("failed") || lower.includes("vetoed")) return 2;
  return 10;
}

function inferSectors(text: string, seedSectors: string[]): string[] {
  const lower = text.toLowerCase();
  const detected = [...seedSectors];
  const map: Record<string, string[]> = {
    Technology: ["technology", "tech", "software", "ai", "artificial intelligence", "cyber", "cloud", "data"],
    Semiconductors: ["semiconductor", "chip", "microchip", "integrated circuit", "wafer"],
    CleanEnergy: ["solar", "wind", "renewable", "clean energy", "clean electricity", "photovoltaic"],
    Energy: ["oil", "gas", "petroleum", "natural gas", "pipeline"],
    EV: ["electric vehicle", "ev ", "charging station", "battery electric"],
    Healthcare: ["healthcare", "hospital", "medicare", "medicaid"],
    Biotech: ["biotech", "biotechnology", "fda", "drug approval", "clinical trial"],
    Pharma: ["pharmaceutical", "prescription drug", "drug pricing"],
    Finance: ["banking", "bank", "securities", "lending", "wall street"],
    Fintech: ["fintech", "payment", "digital payment", "neobank"],
    Crypto: ["cryptocurrency", "bitcoin", "blockchain", "digital asset", "stablecoin"],
    Defense: ["defense", "military", "pentagon", "weapon", "national security", "drone"],
    Materials: ["critical mineral", "rare earth", "lithium", "cobalt", "copper", "mining"],
    Consumer: ["consumer", "retail", "e-commerce", "sports betting"],
    Housing: ["housing", "mortgage", "homeowner", "real estate"],
  };
  for (const [sector, kws] of Object.entries(map)) {
    if (kws.some(kw => lower.includes(kw)) && !detected.includes(sector)) {
      detected.push(sector);
    }
  }
  return [...new Set(detected)].slice(0, 4);
}

function inferTickers(sectors: string[], titleText: string): string[] {
  const tickers = new Set<string>();
  for (const sector of sectors) {
    (SECTOR_TICKERS[sector] ?? []).slice(0, 5).forEach(t => tickers.add(t));
  }
  const lower = titleText.toLowerCase();
  const specificMap: Record<string, string[]> = {
    "enphase": ["ENPH"], "sunrun": ["RUN"], "first solar": ["FSLR"],
    "palantir": ["PLTR"], "nvidia": ["NVDA"], "apple": ["AAPL"],
    "eli lilly": ["LLY"], "moderna": ["MRNA"], "coinbase": ["COIN"],
    "tesla": ["TSLA"], "amazon": ["AMZN"], "microsoft": ["MSFT"],
    "freeport": ["FCX"], "mp materials": ["MP"], "draftkings": ["DKNG"],
    "kratos": ["KTOS"], "axon": ["AXON"],
  };
  for (const [name, t] of Object.entries(specificMap)) {
    if (lower.includes(name)) t.forEach(x => tickers.add(x));
  }
  return [...tickers].slice(0, 8);
}

function marketImpactScore(sectors: string[], passProb: number, impactBase: number): number {
  const highImpact = new Set(["CleanEnergy", "Technology", "Crypto", "Biotech", "Semiconductors"]);
  const boost = sectors.some(s => highImpact.has(s)) ? 15 : 0;
  return Math.round(Math.min(95, (impactBase + boost) * (0.5 + (passProb / 100) * 0.5)));
}

// ─── Cache & main export ──────────────────────────────────────────────────────
const BILLS_CACHE: { data: Bill[] | null; ts: number } = { data: null, ts: 0 };
const BILLS_CACHE_TTL_MS = 20 * 60 * 1000;

export async function fetchLegislativeBills(_sector?: string, limit = 14): Promise<Bill[]> {
  const now = Date.now();
  if (BILLS_CACHE.data && now - BILLS_CACHE.ts < BILLS_CACHE_TTL_MS) {
    return BILLS_CACHE.data.slice(0, limit);
  }

  const highPrioritySubjects = [
    { q: "artificial intelligence semiconductor", sectors: ["Technology", "Semiconductors"], impactBase: 70 },
    { q: "clean energy solar renewable", sectors: ["CleanEnergy", "Energy", "EV"], impactBase: 75 },
    { q: "pharmaceutical biotech drug", sectors: ["Biotech", "Healthcare", "Pharma"], impactBase: 65 },
    { q: "defense military national security", sectors: ["Defense"], impactBase: 60 },
    { q: "cryptocurrency digital asset", sectors: ["Crypto", "Fintech"], impactBase: 80 },
    { q: "banking financial regulation", sectors: ["Finance", "Fintech"], impactBase: 60 },
    { q: "critical minerals rare earth", sectors: ["Materials", "Technology"], impactBase: 70 },
    { q: "trade tariff import manufacturing", sectors: ["Industrials", "Materials"], impactBase: 55 },
  ];

  logger.info("Fetching bills from Congress.gov, OpenStates, and GovTrack");

  const [congressResults, openStatesResults, govtrackResults] = await Promise.all([
    Promise.allSettled(
      highPrioritySubjects.map(s => fetchCongressBills(s.q, s.sectors, s.impactBase, 2))
    ),
    Promise.allSettled(
      highPrioritySubjects.slice(0, 4).map(s => fetchOpenStatesBills(s.q, s.sectors, s.impactBase))
    ),
    CONGRESS_API_KEY
      ? Promise.resolve([])
      : Promise.allSettled(
          GOVTRACK_SEARCHES.map(s => searchGovTrack(s.q, s.sectors, s.impactBase, 2))
        ).then(r => r.flatMap(x => x.status === "fulfilled" ? x.value : [])),
  ]);

  const all: Bill[] = [];

  for (const r of congressResults) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  for (const r of openStatesResults) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  if (Array.isArray(govtrackResults)) {
    all.push(...govtrackResults);
  }

  if (all.length === 0) {
    logger.warn("All bill sources failed — running GovTrack fallback");
    const fallback = await Promise.allSettled(
      GOVTRACK_SEARCHES.map(s => searchGovTrack(s.q, s.sectors, s.impactBase, 2))
    );
    for (const r of fallback) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
  }

  const seen = new Set<string>();
  const unique = all.filter(b => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
  unique.sort((a, b) => b.marketImpactScore - a.marketImpactScore);

  logger.info({ total: unique.length }, "Legislative bills fetched and deduped");
  BILLS_CACHE.data = unique;
  BILLS_CACHE.ts = now;
  return unique.slice(0, limit);
}
