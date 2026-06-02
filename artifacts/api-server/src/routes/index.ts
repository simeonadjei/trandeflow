import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import assetsRouter from "./assets";
import tradesRouter from "./trades";
import withdrawalsRouter from "./withdrawals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(assetsRouter);
router.use(tradesRouter);
router.use(withdrawalsRouter);

export default router;
