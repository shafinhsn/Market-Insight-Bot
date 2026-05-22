import { Router } from "express";
import { fetchLegislativeBills } from "../../services/bills.js";

const router = Router();

router.get("/analysis/bills", async (req, res) => {
  const level = typeof req.query.level === "string" ? req.query.level : "all";
  const limit = Number(req.query.limit) || 15;

  try {
    const bills = await fetchLegislativeBills(level, limit);
    res.json(bills);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch bills");
    res.status(500).json({ error: "Failed to fetch legislative data" });
  }
});

export default router;
