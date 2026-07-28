import { Router } from "express";
import {
  startSession,
  stopSession,
  getSessionStatus,
} from "../lib/continuousTrader";
import {
  hasMexcCredentials,
  getFreeBalance,
  getPrice,
} from "../lib/mexcClient";

const router = Router();

/** GET /session/status — current bot state (no auth needed, polled every second) */
router.get("/session/status", (_req, res) => {
  res.json(getSessionStatus());
});

/** POST /session/start — start or restart the auto-trading bot */
router.post("/session/start", async (req, res) => {
  try {
    const tradePercent = Number(req.body?.tradePercent ?? 50);
    if (isNaN(tradePercent) || tradePercent < 1 || tradePercent > 100) {
      return res.status(400).json({ error: "tradePercent must be 1–100" });
    }
    await startSession(tradePercent);
    res.json({ ok: true, status: getSessionStatus() });
  } catch (err) {
    req.log.error(err, "session/start failed");
    res.status(500).json({ error: "Failed to start session" });
  }
});

/** POST /session/stop — stop the auto-trading bot */
router.post("/session/stop", async (req, res) => {
  try {
    await stopSession();
    res.json({ ok: true, status: getSessionStatus() });
  } catch (err) {
    req.log.error(err, "session/stop failed");
    res.status(500).json({ error: "Failed to stop session" });
  }
});

/**
 * GET /bot/test-mexc — verify MEXC API credentials and connectivity.
 * Returns key presence, live USDT balance, and BTC/ETH prices.
 * Safe to call at any time; does not place any orders.
 */
router.get("/bot/test-mexc", async (req, res) => {
  const credentialsPresent = hasMexcCredentials();
  if (!credentialsPresent) {
    return res.status(400).json({
      ok: false,
      credentialsPresent: false,
      error: "MEXC_API_KEY or MEXC_API_SECRET not configured",
    });
  }

  const result: {
    ok: boolean;
    credentialsPresent: boolean;
    usdtBalance?: number;
    btcPrice?: number;
    ethPrice?: number;
    error?: string;
  } = { ok: false, credentialsPresent: true };

  try {
    // Run all three checks in parallel — if any throw, we capture the error
    const [usdtBalance, btcPrice, ethPrice] = await Promise.all([
      getFreeBalance("USDT"),
      getPrice("BTCUSDT"),
      getPrice("ETHUSDT"),
    ]);
    result.ok = true;
    result.usdtBalance = usdtBalance;
    result.btcPrice    = btcPrice;
    result.ethPrice    = ethPrice;
    req.log.info(result, "bot/test-mexc: credentials OK");
    return res.json(result);
  } catch (e) {
    result.error = (e as Error).message;
    req.log.error({ err: result.error }, "bot/test-mexc: MEXC call failed");
    return res.status(502).json(result);
  }
});

export default router;
