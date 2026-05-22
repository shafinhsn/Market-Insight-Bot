import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import optionsFlowRouter from "./analysis/options-flow.js";
import newsRouter from "./analysis/news.js";
import billsRouter from "./analysis/bills.js";
import marketSummaryRouter from "./analysis/market-summary.js";
import analyzeRouter from "./recommendations/analyze.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(optionsFlowRouter);
router.use(newsRouter);
router.use(billsRouter);
router.use(marketSummaryRouter);
router.use(analyzeRouter);

export default router;
