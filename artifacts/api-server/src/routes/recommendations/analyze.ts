import { Router } from "express";
import { z } from "zod";
import { fetchUnusualOptionsFlow } from "../../services/yahoo-finance.js";
import { fetchFinnhubOptionsFlow } from "../../services/finnhub.js";
import { fetchMarketNews } from "../../services/news-feed.js";
import { fetchLegislativeBills } from "../../services/bills.js";
import { fetchPoliticalStatements } from "../../services/gdelt.js";
import { runMultiAgentAnalysis, type StreamCallback } from "../../services/multi-agent.js";
import { fetchStockPrices } from "../../services/stock-prices.js";
import type { OptionsFlowItem } from "../../services/yahoo-finance.js";

const router = Router();

const AnalyzeBody = z.object({
  budget: z.number().min(100),
  riskLevel: z.enum(["conservative", "moderate", "aggressive"]),
  stopLossPercent: z.number().min(1).max(50),
  focusSectors: z.array(z.string()).optional(),
  focusTickers: z.array(z.string()).optional(),
});

const PRICE_TICKERS = [
  "NVDA","TSLA","AAPL","AMD","MSFT","META","AMZN","GOOGL","SPY","QQQ",
  "PLTR","COIN","MSTR","HOOD","SOFI","RIVN","BA","XOM","JPM","GS",
  "ENPH","FSLR","RUN","SEDG","NOVA","ARRY","BE","CHPT","BLNK","EVGO",
  "ARWR","RXRX","BHVN","APLS","MRNA","KTOS","AXON","CACI","SAIC",
  "MP","FCX","CELH","DKNG","CAVA","LLY","PFE","JNJ","ABBV","UPST","AFRM",
];

router.post("/recommendations/analyze", async (req, res) => {
  const parsed = AnalyzeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { budget, riskLevel, stopLossPercent, focusSectors, focusTickers } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function send(data: unknown) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function done() {
    res.write(`data: {"type":"done"}\n\n`);
    res.end();
  }

  try {
    req.log.info({ budget, riskLevel, stopLossPercent }, "Starting 9-agent streaming analysis");

    const allPriceTickers = [...new Set([...PRICE_TICKERS, ...(focusTickers ?? [])])];

    const [finnhubResult, yahooResult, newsResult, billsResult, statementsResult, priceResult] = await Promise.allSettled([
      fetchFinnhubOptionsFlow(20),
      fetchUnusualOptionsFlow(25),
      fetchMarketNews(undefined, 14),
      fetchLegislativeBills("all", 14),
      fetchPoliticalStatements(10),
      fetchStockPrices(allPriceTickers),
    ]);

    const finnhubFlow = finnhubResult.status === "fulfilled" ? finnhubResult.value : [];
    const yahooFlow = yahooResult.status === "fulfilled" ? yahooResult.value : [];
    const finnhubTickers = new Set(finnhubFlow.map((f: OptionsFlowItem) => f.ticker));
    const optionsFlow = [
      ...finnhubFlow,
      ...yahooFlow.filter((f: OptionsFlowItem) => !finnhubTickers.has(f.ticker)),
    ].sort((a, b) => b.unusualScore - a.unusualScore);

    const news = newsResult.status === "fulfilled" ? newsResult.value : [];
    const bills = billsResult.status === "fulfilled" ? billsResult.value : [];
    const politicalStatements = statementsResult.status === "fulfilled" ? statementsResult.value : [];
    const livePrices = priceResult.status === "fulfilled" ? priceResult.value : {};

    req.log.info({
      flowCount: optionsFlow.length,
      newsCount: news.length,
      billsCount: bills.length,
      statementsCount: politicalStatements.length,
      priceCount: Object.keys(livePrices).length,
    }, "All data fetched — launching 9-agent pipeline");

    send({
      type: "data_fetched",
      optionsFlowCount: optionsFlow.length,
      newsCount: news.length,
      billsCount: bills.length,
      statementsCount: politicalStatements.length,
      news: news.map(n => ({
        title: n.title, source: n.source, url: n.url,
        publishedAt: n.publishedAt, sentiment: n.sentiment,
        impactScore: n.impactScore, relatedTickers: n.relatedTickers, sector: n.sector,
      })),
      bills: bills.map(b => ({
        id: b.id, title: b.title, level: b.level, state: b.state,
        status: b.status, passageProbability: b.passageProbability,
        marketImpactScore: b.marketImpactScore, affectedSectors: b.affectedSectors,
        affectedTickers: b.affectedTickers, summary: b.summary,
        lastAction: b.lastAction, introducedDate: b.introducedDate,
      })),
      optionsFlow: optionsFlow.slice(0, 20).map(f => ({
        ticker: f.ticker, contractType: f.contractType, strike: f.strike,
        expiration: f.expiration, volume: f.volume, openInterest: f.openInterest,
        premium: f.premium, impliedVolatility: f.impliedVolatility,
        sentiment: f.sentiment, unusualActivity: f.unusualActivity,
        unusualScore: f.unusualScore,
      })),
      politicalStatements: politicalStatements.map(s => ({
        speaker: s.speaker, statement: s.statement, date: s.date,
        source: s.source, url: s.url, tickers: s.tickers,
        sectors: s.sectors, sentiment: s.sentiment, marketImpact: s.marketImpact,
      })),
    });

    const onStream: StreamCallback = (event) => send(event);

    await runMultiAgentAnalysis(
      budget, riskLevel, stopLossPercent,
      optionsFlow, news, bills, politicalStatements,
      focusSectors, focusTickers, livePrices, onStream,
    );

    done();
  } catch (err) {
    req.log.error({ err }, "Streaming analysis failed");
    send({ type: "error", message: "Analysis failed. Please try again." });
    done();
  }
});

export default router;
