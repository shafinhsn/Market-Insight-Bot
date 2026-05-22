import { Router } from "express";
import { fetchMarketNews } from "../../services/news-feed.js";
import { fetchLegislativeBills } from "../../services/bills.js";
import { fetchUnusualOptionsFlow } from "../../services/yahoo-finance.js";
import { fetchPoliticalStatements } from "../../services/gdelt.js";

const router = Router();

router.get("/analysis/market-summary", async (req, res) => {
  try {
    const [news, bills, flow, statements] = await Promise.allSettled([
      fetchMarketNews(undefined, 5),
      fetchLegislativeBills("all", 5),
      fetchUnusualOptionsFlow(10),
      fetchPoliticalStatements(5),
    ]);

    res.json({
      news: news.status === "fulfilled" ? news.value : [],
      bills: bills.status === "fulfilled" ? bills.value : [],
      optionsFlow: flow.status === "fulfilled" ? flow.value : [],
      politicalStatements: statements.status === "fulfilled" ? statements.value : [],
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch market summary");
    res.status(500).json({ error: "Failed to fetch market summary" });
  }
});

export default router;
