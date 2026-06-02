import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import assetsRouter from "./assets";
import tradesRouter from "./trades";
import withdrawalsRouter from "./withdrawals";
import depositsRouter from "./deposits";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(assetsRouter);
router.use(tradesRouter);
router.use(withdrawalsRouter);
router.use(depositsRouter);

export default router;
