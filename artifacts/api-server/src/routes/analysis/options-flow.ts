import { Router } from "express";
import { fetchUnusualOptionsFlow } from "../../services/yahoo-finance.js";
import { fetchFinnhubOptionsFlow } from "../../services/finnhub.js";
import type { OptionsFlowItem } from "../../services/yahoo-finance.js";

const router = Router();

router.get("/analysis/options-flow", async (req, res) => {
  const limit = Number(req.query.limit) || 25;

  try {
    const [finnhubFlow, yahooFlow] = await Promise.allSettled([
      fetchFinnhubOptionsFlow(limit),
      fetchUnusualOptionsFlow(limit),
    ]);

    const finnhub = finnhubFlow.status === "fulfilled" ? finnhubFlow.value : [];
    const yahoo = yahooFlow.status === "fulfilled" ? yahooFlow.value : [];

    const finnhubTickers = new Set(finnhub.map((f: OptionsFlowItem) => f.ticker));
    const combined = [
      ...finnhub,
      ...yahoo.filter((f: OptionsFlowItem) => !finnhubTickers.has(f.ticker)),
    ].sort((a, b) => b.unusualScore - a.unusualScore);

    res.json(combined.slice(0, limit));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch options flow");
    res.status(500).json({ error: "Failed to fetch options flow data" });
  }
});

export default router;
