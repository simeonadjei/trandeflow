import { Router } from "express";
import {
  startSession,
  stopSession,
  getSessionStatus,
} from "../lib/continuousTrader";

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

export default router;
