import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import assetsRouter from "./assets";
import tradesRouter from "./trades";
import withdrawalsRouter from "./withdrawals";
import depositsRouter from "./deposits";
import authRouter from "./auth";
import adminRouter from "./admin";
import sessionRouter from "./session";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(accountRouter);
router.use(assetsRouter);
router.use(tradesRouter);
router.use(withdrawalsRouter);
router.use(depositsRouter);
router.use(sessionRouter);

export default router;
