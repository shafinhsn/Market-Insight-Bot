import { Router } from "express";
import { fetchMarketNews } from "../../services/news-feed.js";

const router = Router();

router.get("/analysis/news", async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query : undefined;
  const limit = Number(req.query.limit) || 14;

  try {
    const articles = await fetchMarketNews(query, limit);
    res.json(articles);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch news");
    res.status(500).json({ error: "Failed to fetch news data" });
  }
});

export default router;
