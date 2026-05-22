import { aiClient, AI_MODEL } from "../lib/ai-client.js";
import type { Bill } from "./bills.js";
import type { NewsArticle } from "./news-feed.js";
import type { PoliticalStatement } from "./gdelt.js";
import { formatPricesForPrompt, type PriceMap } from "./stock-prices.js";

export interface OptionsFlowSignal {
  ticker: string;
  contractType: "call" | "put";
  strike: number;
  expiration: string;
  volume: number;
  openInterest: number;
  premium: number;
  impliedVolatility: number;
  sentiment: "bullish" | "bearish" | "neutral";
  unusualActivity: boolean;
}

export interface AgentMessage {
  agentName: string;
  agentRole: string;
  message: string;
  timestamp: string;
}

export interface OptionPick {
  ticker: string;
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  contractCost: number;
  contracts: number;
  totalCost: number;
  targetReturn: number;
  stopLoss: number;
  currentStockPrice: number;
  entryOptionPrice: number;
  targetStockPrice: number;
  targetOptionPrice: number;
  stopLossStockPrice: number;
  daysToExpiration: number;
  compositeScore: number;
  optionsFlowScore: number;
  newsScore: number;
  legislativeScore: number;
  justification: string;
  confidence: "low" | "medium" | "high";
  sector: string;
  keyDrivers: string[];
}

export interface AnalysisResult {
  recommendations: OptionPick[];
  debateLog: AgentMessage[];
  marketContext: string;
  scoringWeights: {
    optionsFlow: number;
    news: number;
    legislative: number;
    technicalMomentum: number;
  };
  generatedAt: string;
}

export type StreamEventPayload =
  | { type: "agent_start"; agentName: string; agentRole: string }
  | { type: "agent_complete"; agentName: string; agentRole: string; message: string }
  | { type: "synthesis_start" }
  | { type: "synthesis_complete"; recommendations: OptionPick[]; marketContext: string; scoringWeights: AnalysisResult["scoringWeights"]; generatedAt: string }
  | { type: "error"; message: string };

export type StreamCallback = (event: StreamEventPayload) => void;

const SCORING_WEIGHTS = {
  optionsFlow: 0.35,
  news: 0.25,
  legislative: 0.25,
  technicalMomentum: 0.15,
};

const FULL_TICKER_UNIVERSE = `
MEGA-CAP: AAPL MSFT NVDA GOOGL META AMZN TSLA
SEMIS: AMD INTC QCOM AVGO MRVL SMCI ARM ANET
SOFTWARE: CRWD PLTR SNOW DDOG GTLB NET HUBS ZS
CLEAN-ENERGY/SOLAR: ENPH FSLR RUN SEDG NOVA BE ARRY CSIQ MAXN SHLS
EV/BATTERY: TSLA RIVN LCID NIO CHPT BLNK EVGO
OIL-GAS: XOM CVX COP OXY SLB HAL DVN FANG MRO
BIOTECH-LARGE: MRNA BNTX REGN BIIB GILD VRTX ILMN
BIOTECH-SMALL/MID: NVAX BHVN APLS RXRX ROIV ARWR KRYS XNCR ACAD
PHARMA: LLY PFE JNJ ABBV MRK BMY
FINTECH/CRYPTO: COIN MSTR MARA RIOT SQ PYPL HOOD UPST AFRM SOFI
FINANCE: JPM GS BAC WFC MS C SCHW
DEFENSE/GOV-TECH: LMT RTX NOC GD BA KTOS AXON CACI SAIC
INDUSTRIALS/MATERIALS: CAT DE HON GE FCX MP NEM CTRA AA
CONSUMER-GROWTH: CELH WING BROS CAVA DKNG ABNB
`;

async function runAgent(persona: string, task: string, contextData: string): Promise<string> {
  const response = await aiClient.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 1400,
    messages: [
      {
        role: "system",
        content: `You are ${persona}. You are a specialist in a multi-agent financial analysis pipeline. Be concise, direct, and data-driven. Use specific tickers and numbers from the data provided. Consider the FULL market universe — not just mega-caps.`,
      },
      {
        role: "user",
        content: `${task}\n\nContextual Data:\n${contextData}`,
      },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

async function synthesizeWithRetry(
  prompt: string,
  maxRetries = 3,
): Promise<{ recommendations: OptionPick[]; marketContext: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await aiClient.chat.completions.create({
        model: AI_MODEL,
        max_tokens: 4000,
        messages: [
          {
            role: "system",
            content: `You are a synthesis agent for an options trading recommender. Output ONLY valid JSON — no markdown, no code blocks, no explanation. Start your response with { and end with }.`,
          },
          { role: "user", content: prompt },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "";
      const strategies = [
        () => JSON.parse(raw),
        () => { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error("no match"); },
        () => { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) return JSON.parse(m[1]); throw new Error("no match"); },
        () => JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")),
      ];

      for (const strategy of strategies) {
        try {
          const parsed = strategy() as { recommendations?: OptionPick[]; marketContext?: string };
          if (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
            return { recommendations: parsed.recommendations, marketContext: parsed.marketContext ?? "" };
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return { recommendations: [], marketContext: "Synthesis parsing failed after retries." };
}

export async function runMultiAgentAnalysis(
  budget: number,
  riskLevel: "conservative" | "moderate" | "aggressive",
  stopLossPercent: number,
  optionsFlow: OptionsFlowSignal[],
  news: NewsArticle[],
  bills: Bill[],
  politicalStatements: PoliticalStatement[],
  focusSectors: string[] | undefined,
  focusTickers: string[] | undefined,
  livePrices: PriceMap,
  onStream: StreamCallback,
): Promise<AnalysisResult> {
  const debateLog: AgentMessage[] = [];
  const ts = () => new Date().toISOString();
  const today = new Date().toISOString().split("T")[0];

  const sortedFlow = [...optionsFlow].sort((a, b) => {
    const scoreA = (a as { unusualScore?: number }).unusualScore ?? ((a.volume / Math.max(a.openInterest, 1)) * Math.log10(a.volume + 10));
    const scoreB = (b as { unusualScore?: number }).unusualScore ?? ((b.volume / Math.max(b.openInterest, 1)) * Math.log10(b.volume + 10));
    return scoreB - scoreA;
  });

  const flowSummary = sortedFlow.slice(0, 20).map((f, idx) => {
    const score = (f as { unusualScore?: number }).unusualScore ?? ((f.volume / Math.max(f.openInterest, 1)) * Math.log10(f.volume + 10));
    return `#${idx + 1} [unusualScore:${score.toFixed(1)}] ${f.ticker} ${f.contractType.toUpperCase()} $${f.strike} exp ${f.expiration} | Vol:${f.volume.toLocaleString()} OI:${f.openInterest.toLocaleString()} IV:${(f.impliedVolatility * 100).toFixed(0)}% Premium:$${f.premium} | ${f.sentiment.toUpperCase()} | Unusual:${f.unusualActivity}`;
  }).join("\n");

  const newsSummary = news.slice(0, 12).map(n =>
    `[${n.sentiment.toUpperCase()} impact:${n.impactScore}] "${n.title}" | Source: ${n.source} | Date: ${n.publishedAt} | URL: ${n.url} | Tickers: ${n.relatedTickers.join(",")} | Sector: ${n.sector}`
  ).join("\n");

  const billsSummary = bills.slice(0, 12).map(b =>
    `[${b.level.toUpperCase()}${b.state ? "/" + b.state : ""}] "${b.title}" | Status: ${b.status} | Pass prob: ${b.passageProbability}% | Impact: ${b.marketImpactScore > 0 ? "+" : ""}${b.marketImpactScore} | Sectors: ${b.affectedSectors.join(",")} | Tickers: ${b.affectedTickers.join(",")}`
  ).join("\n");

  const statementsSummary = politicalStatements.slice(0, 10).map(s =>
    `[${s.speaker}] "${s.statement}" | Date: ${s.date} | Source: ${s.source} | Sentiment: ${s.sentiment.toUpperCase()} | Tickers: ${s.tickers.join(",") || "none"} | Sectors: ${s.sectors.join(",") || "none"}`
  ).join("\n");

  const focusNote = [
    focusSectors?.length ? `PRIORITY sectors: ${focusSectors.join(", ")}` : "",
    focusTickers?.length ? `PRIORITY tickers: ${focusTickers.join(", ")}` : "",
  ].filter(Boolean).join(" | ");

  const priceNote = Object.keys(livePrices).length > 0
    ? `\n\n⚡ LIVE PRICES (fetched NOW from Yahoo Finance — use EXACTLY, do NOT use training-data prices):\n${formatPricesForPrompt(livePrices)}`
    : "";

  async function fireAgent(
    agentName: string,
    agentRole: string,
    persona: string,
    task: string,
    context: string,
  ): Promise<string> {
    onStream({ type: "agent_start", agentName, agentRole });
    const message = await runAgent(persona, task, context);
    const log: AgentMessage = { agentName, agentRole, message, timestamp: ts() };
    debateLog.push(log);
    onStream({ type: "agent_complete", agentName, agentRole, message });
    return message;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 1: Options Flow Scanner
  // ═══════════════════════════════════════════════════════════════════════════
  const flowAnalysis = await fireAgent(
    "Alex Chen",
    "options_flow_analyst",
    "Alex Chen, the Options Flow Analyst — specialist in detecting unusual sweeps, dark pool positioning, and asymmetric bets across ALL market caps",
    `You are analyzing options flow data RANKED BY UNUSUALNESS SCORE (volume/OI ratio × log(volume)).

Your mission: Identify the top 4-6 MOST UNUSUAL signals. Do NOT default to mega-caps. A small-cap with score 18.5 is MORE significant than a mega-cap with score 2.0.

For EACH unusual signal:
1. Ticker + why the vol/OI ratio is remarkable (e.g. "21,400 contracts against 900 OI = 23.8× normal")
2. What this positioning suggests (earnings play? insider anticipation? sector rotation?)
3. Implied move if options pay off
4. EXACT current stock price from LIVE PRICES table (never invent)
5. Confidence 0-100

Flag any tickers where multiple expiration dates show coordinated unusual activity.
${focusNote}

Full investable universe: ${FULL_TICKER_UNIVERSE}${priceNote}`,
    `OPTIONS FLOW RANKED BY UNUSUALNESS (top = most unusual):\n${flowSummary || "Use market knowledge for the full ticker universe above"}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 2: News Analyst
  // ═══════════════════════════════════════════════════════════════════════════
  const newsAnalysis = await fireAgent(
    "Morgan Lee",
    "news_analyst",
    "Morgan Lee, the News Analyst — specialist in breaking news and macro event correlation",
    `Analyze live news headlines for market-moving stories. For each key story:
- Specific tickers affected (include mid/small caps)
- Sentiment direction and magnitude
- News impact score 0-100
- Cite the source name and date for each claim
- Identify cross-sector catalysts
${focusNote}\n\nFull universe: ${FULL_TICKER_UNIVERSE}`,
    `CURRENT NEWS (with sources and dates):\n${newsSummary || "Assess current market context"}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 3: Legislative Analyst
  // ═══════════════════════════════════════════════════════════════════════════
  const legisAnalysis = await fireAgent(
    "Jordan Rivera",
    "legislative_analyst",
    "Jordan Rivera, the Legislative Analyst — expert at finding OVERLOOKED tickers benefiting from legislation the market hasn't priced",
    `For each key bill:
1. Primary AND secondary beneficiary tickers
2. Impact direction (bullish/bearish) and magnitude
3. REALISTIC passage probability assessment given current political climate
4. Legislative score 0-100
5. Best option play timing (strike relative to current price, expiration aligned with legislative calendar)
6. Assess POSITIVE vs NEGATIVE market outcomes for each sector

Consider: bill chamber, current status, political majority, historical base rates for similar legislation.
${focusNote}\n\nFull universe: ${FULL_TICKER_UNIVERSE}`,
    `BILLS (from Congress.gov, OpenStates, GovTrack):\n${billsSummary}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 4: Political Statements Analyst
  // ═══════════════════════════════════════════════════════════════════════════
  const politicalAnalysis = await fireAgent(
    "Dana Voss",
    "political_analyst",
    "Dana Voss, the Political Statements Analyst — specialist in parsing statements from government officials, CEOs, and public figures for market-moving signals",
    `Analyze recent statements from notable figures for market-moving implications.

For EACH significant statement:
1. Who said it, what they said
2. Which tickers/sectors are directly affected
3. Is this bullish, bearish, or noise for markets?
4. Timeline: how quickly could markets react?
5. Does this confirm or contradict options flow / legislative trends?

Key figures to watch: President Trump (tariffs, energy policy, crypto), Fed Chair Powell (rates, inflation), Treasury Secretary Bessent (fiscal policy), major CEOs (Musk, Huang, Cook), activist investors.

${focusNote}\n\nFull universe: ${FULL_TICKER_UNIVERSE}`,
    `RECENT STATEMENTS FROM NOTABLE FIGURES (via GDELT):\n${statementsSummary || "No live statements retrieved — assess based on known policy positions and recent market context"}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 5: Fact Checker Alpha
  // ═══════════════════════════════════════════════════════════════════════════
  const factCheckAlpha = await fireAgent(
    "Sam Park",
    "fact_checker_alpha",
    "Sam Park, Fact Checker Alpha — rigorous verifier of options flow claims and price accuracy",
    `Fact-check the Options Flow Analyst and Political Statements Analyst claims:

OPTIONS FLOW CLAIMS:
1. Are the tickers mentioned actually liquid enough for retail options trading?
2. Are the volume/OI ratios cited plausible? (Flag any that seem inflated)
3. Are the stated current stock prices approximately correct vs live prices?
4. Which picks have genuinely unusual activity vs normal daily trading?

POLITICAL STATEMENTS:
5. Are the cited statements plausible given known policy positions?
6. Do these statements actually have market-moving precedent?
7. Flag any overblown interpretations or fake/misattributed quotes.

Rate each claim: CONFIRMED / QUESTIONABLE / REJECT`,
    `FLOW ANALYST CLAIMS:\n${flowAnalysis}\n\nPOLITICAL ANALYST CLAIMS:\n${politicalAnalysis}\n\nRAW FLOW DATA:\n${flowSummary}\n\nRAW STATEMENTS:\n${statementsSummary}${priceNote}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 6: Fact Checker Beta
  // ═══════════════════════════════════════════════════════════════════════════
  const factCheckBeta = await fireAgent(
    "Dr. Alex Torres",
    "fact_checker_beta",
    "Dr. Alex Torres, Fact Checker Beta — validates legislative impact claims, news accuracy, and passage probability estimates",
    `Fact-check the News Analyst and Legislative Analyst claims:

NEWS CLAIMS:
1. Are the news sources cited credible and dates plausible?
2. Do the headlines accurately reflect bullish/bearish direction for the stated tickers?
3. Is the news fresh or is it stale/already priced in?

LEGISLATIVE CLAIMS:
4. Are passage probability estimates realistic given current political climate?
5. Are market impact scores logically consistent with bill content?
6. Do cited beneficiary tickers actually have meaningful exposure to the bill?
7. Flag any overstated legislative catalysts.

Rate each claim: CONFIRMED / QUESTIONABLE / REJECT`,
    `NEWS ANALYST CLAIMS:\n${newsAnalysis}\n\nLEGISLATIVE ANALYST CLAIMS:\n${legisAnalysis}\n\nRAW NEWS (with sources):\n${newsSummary}\n\nRAW BILLS:\n${billsSummary}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 7: Deliberation Board
  // ═══════════════════════════════════════════════════════════════════════════
  const debate = await fireAgent(
    "Deliberation Board",
    "synthesis",
    "The Multi-Agent Deliberation Board — synthesizing all analyst inputs including fact-checker corrections into actionable intelligence",
    `Review all 4 analyst positions AND both fact-checker findings. Deliberate:

1. Cross-domain signals: Where do options flow + news + legislation + political statements ALL align? (These are highest conviction)
2. Which claims were REJECTED by fact-checkers? Drop those picks.
3. QUESTIONABLE claims: apply extra skepticism — require 2+ signal sources to include
4. Narrative synthesis: Is the current market environment risk-on or risk-off? Which sectors are most favored?
5. Mid/small-cap plays with fact-checked catalysts: highlight the best risk/reward
6. "Obvious" plays that are already priced in: flag these to avoid

Output a 3-4 paragraph deliberation resolving conflicts and ranking the highest-conviction cross-domain opportunities.`,
    `FLOW: ${flowAnalysis}\nNEWS: ${newsAnalysis}\nLEGIS: ${legisAnalysis}\nPOLITICAL: ${politicalAnalysis}\nFACT-CHECK-A (flow + political): ${factCheckAlpha}\nFACT-CHECK-B (news + legis): ${factCheckBeta}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 8: Risk Manager
  // ═══════════════════════════════════════════════════════════════════════════
  const riskContext = `Budget: $${budget} | Risk: ${riskLevel} | Stop-loss: ${stopLossPercent}%`;
  const riskAnalysis = await fireAgent(
    "Riley Morgan",
    "risk_manager",
    "Riley Morgan, the Risk Manager — enforces position sizing, stop-loss discipline, and liquidity checks",
    `Evaluate the deliberation board's recommendations with risk discipline:
1. Liquidity checks: can the recommended contracts actually be filled without slippage?
2. Position sizing: given budget $${budget} and risk ${riskLevel}, state max contract counts
3. Portfolio diversification: ensure sector spread, flag if too concentrated
4. Volatility environment: assess whether current IV levels make options expensive or cheap
5. Risk/reward: for each surviving play, state expected value (prob × gain - prob × loss)
6. Reject any plays where fact-checkers raised REJECT flags
${focusNote}`,
    `${riskContext}\n\nDELIBERATION: ${debate}\n\nFLOW: ${flowAnalysis}\n\nFACT-CHECK-A: ${factCheckAlpha}\n\nFACT-CHECK-B: ${factCheckBeta}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 9: Freshness Validator
  // ═══════════════════════════════════════════════════════════════════════════
  const freshnessValidation = await fireAgent(
    "Kai Nakamura",
    "freshness_validator",
    "Kai Nakamura, the Freshness Validator — final quality control agent ensuring all data is current, non-static, and logically coherent",
    `You are the FINAL CHECK before recommendations reach the user. Validate:

1. DATA FRESHNESS: Are the news articles fresh (within 48 hours)? Flag if news is older than 1 week.
2. PRICE SANITY: Do the recommended strike prices make sense relative to live stock prices? (Strike should be within 30% of current price)
3. EXPIRATION LOGIC: Are expiration dates realistic? (At least 14 days out, aligned with catalysts)
4. STATIC DATA RISK: Are agents reasoning from stale/training data vs live inputs? Flag anything that seems memorized rather than data-driven.
5. INTERNAL CONSISTENCY: Do all numbers add up? (totalCost = contractCost × contracts × 100)
6. FINAL VERDICT: Which picks PASS all checks? Which should be MODIFIED or REMOVED?

Today's date: ${today}
Be extremely rigorous. A wrong recommendation costs real money.`,
    `RISK MANAGER OUTPUT:\n${riskAnalysis}\n\nDELIBERATION:\n${debate}\n\nLIVE PRICES:\n${priceNote}\n\nNEWS DATES:\n${news.slice(0, 5).map(n => `${n.source}: ${n.publishedAt}`).join("\n")}\n\nFLOW DATA TIMESTAMP: ${new Date().toISOString()}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNTHESIS — Final JSON output
  // ═══════════════════════════════════════════════════════════════════════════
  onStream({ type: "synthesis_start" });

  const maxPositionSize = riskLevel === "conservative" ? budget * 0.10 : riskLevel === "moderate" ? budget * 0.20 : budget * 0.30;

  const synthPrompt = `Based on ALL 9 agents — including fact-checker corrections, deliberation, risk management, and freshness validation — generate FINAL recommendations.

Today: ${today}
Budget: $${budget} | Risk: ${riskLevel} | Stop-loss: ${stopLossPercent}% | Max per position: $${maxPositionSize.toFixed(0)}

Output ONLY this JSON object (no markdown, no code blocks, start with {):
{
  "recommendations": [
    {
      "ticker": "ENPH",
      "optionType": "call",
      "strike": 70,
      "expiration": "2025-09-19",
      "contractCost": 4.20,
      "contracts": 2,
      "totalCost": 840,
      "targetReturn": 95,
      "stopLoss": 2.10,
      "currentStockPrice": 63.50,
      "entryOptionPrice": 4.20,
      "targetStockPrice": 82.00,
      "targetOptionPrice": 14.50,
      "stopLossStockPrice": 56.00,
      "daysToExpiration": 120,
      "compositeScore": 81,
      "optionsFlowScore": 75,
      "newsScore": 78,
      "legislativeScore": 95,
      "justification": "...",
      "confidence": "high",
      "sector": "Clean Energy",
      "keyDrivers": ["CA clean grid law signed", "installer cycle acceleration", "unusual call sweep"]
    }
  ],
  "marketContext": "Overall narrative summary of what's driving the market and why these picks are timely..."
}

⚡ MANDATORY LIVE PRICES — USE THESE EXACT VALUES for currentStockPrice:
${Object.keys(livePrices).length > 0 ? formatPricesForPrompt(livePrices) : "Use best estimates from agent analysis above"}

CRITICAL RULES:
- 4-6 recommendations across minimum 3 different sectors
- At least 1 mid/small-cap play where fact-checkers CONFIRMED the catalyst
- EXCLUDE any picks the freshness validator flagged for removal
- EXCLUDE any picks fact-checkers rated REJECT
- currentStockPrice: USE LIVE PRICE ABOVE — never from training memory
- strike: set near-the-money relative to live currentStockPrice (within 20%)
- targetStockPrice: 15-40% above currentStockPrice for calls, 15-40% below for puts
- totalCost = contractCost × contracts × 100 ≤ $${maxPositionSize.toFixed(0)}
- stopLoss = entryOptionPrice × ${(1 - stopLossPercent / 100).toFixed(2)}
- daysToExpiration: calendar days from ${today} to expiration date
- confidence: low<50, medium 50-70, high>70 (compositeScore)
- keyDrivers: include signal sources (flow, news, legislation, political statement)

ALL AGENT INPUTS:
FLOW: ${flowAnalysis}
NEWS: ${newsAnalysis}
LEGIS: ${legisAnalysis}
POLITICAL: ${politicalAnalysis}
FACT-CHECK-A: ${factCheckAlpha}
FACT-CHECK-B: ${factCheckBeta}
DELIBERATION: ${debate}
RISK: ${riskAnalysis}
FRESHNESS VALIDATION: ${freshnessValidation}
RAW FLOW: ${flowSummary}`;

  const { recommendations, marketContext } = await synthesizeWithRetry(synthPrompt);

  const finalMsg = `SYNTHESIS COMPLETE: ${recommendations.length} validated recommendation(s). 9-agent pipeline: flow + news + legislation + political + 2× fact-check + deliberation + risk + freshness. Sectors: ${[...new Set(recommendations.map(r => r.sector))].join(", ")}.`;
  debateLog.push({ agentName: "Synthesis Engine", agentRole: "synthesis", message: finalMsg, timestamp: ts() });

  const scoringWeights = { ...SCORING_WEIGHTS };
  onStream({ type: "synthesis_complete", recommendations, marketContext, scoringWeights, generatedAt: ts() });

  return { recommendations, debateLog, marketContext, scoringWeights, generatedAt: ts() };
}
