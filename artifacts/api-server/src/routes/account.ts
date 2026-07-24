import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startSession, stopSession, getSessionStatus } from "../lib/continuousTrader";
import { hasMexcCredentials, getFreeBalance } from "../lib/mexcClient";

const router = Router();

router.get("/account", async (req, res) => {
  try {
    let account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    if (!account) {
      const [created] = await db.insert(accountsTable).values({
        name: "Trader",
        balance: "0.00",
        demoBalance: "10000.00",
        currency: "GHS",
        totalProfit: "0.00",
        totalTrades: 0,
        winRate: "0.00",
      }).returning();
      account = created;
    }

    // Fetch live MEXC USDT balance to show alongside internal balance
    let mexcBalanceUsdt: number | null = null;
    const mexcConnected = hasMexcCredentials();
    if (mexcConnected) {
      try {
        mexcBalanceUsdt = await getFreeBalance("USDT");
      } catch (err) {
        req.log.warn(err, "Failed to fetch MEXC balance");
      }
    }

    res.json({
      id: account.id,
      name: account.name,
      balance: parseFloat(account.balance as string),
      demoBalance: parseFloat(account.demoBalance as string),
      currency: account.currency,
      autoInvestEnabled: account.autoInvestEnabled,
      totalProfit: parseFloat(account.totalProfit as string),
      totalTrades: account.totalTrades,
      winRate: parseFloat(account.winRate as string),
      realizedPnlUsd: parseFloat(account.realizedPnlUsd as string),
      mexcConnected,
      mexcBalanceUsdt,
      // kept for backward compat
      coinbaseConnected: false,
      coinbaseBalanceUsd: null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get account" });
  }
});

router.get("/account/stats", async (req, res) => {
  try {
    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    if (!account) return res.json({ totalProfit: 0, totalTrades: 0, winRate: 0, todayProfit: 0, streak: 0, bestTrade: 0, avgReturn: 0 });
    res.json({
      totalProfit: parseFloat(account.totalProfit as string),
      totalTrades: account.totalTrades,
      winRate:     parseFloat(account.winRate as string),
      todayProfit: 0,
      streak:      0,
      bestTrade:   0,
      avgReturn:   0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ── Continuous trading session (MEXC execution) ──────────────────────────────
const MIN_STAKE_USDT = 1;

router.post("/session/start", async (req, res) => {
  try {
    if (!hasMexcCredentials()) {
      return res.status(400).json({
        error: "mexc_not_connected",
        message: "MEXC API keys are not configured. Add MEXC_API_KEY and MEXC_API_SECRET.",
      });
    }

    // Check live MEXC USDT balance
    let usdtBalance = 0;
    try {
      usdtBalance = await getFreeBalance("USDT");
    } catch (err) {
      req.log.error(err, "Failed to fetch MEXC balance");
      return res.status(502).json({
        error: "mexc_unreachable",
        message: `Could not reach MEXC to check your balance: ${(err as Error).message}`,
      });
    }

    if (usdtBalance < MIN_STAKE_USDT) {
      return res.status(400).json({
        error: "insufficient_balance",
        message: `Need at least ${MIN_STAKE_USDT} USDT free on MEXC to start. Current: ${usdtBalance.toFixed(2)} USDT.`,
        currentBalance: usdtBalance,
        minimumRequired: MIN_STAKE_USDT,
      });
    }

    const pct = parseFloat(req.body?.tradePercent) || 50;
    const tradePercent = Math.min(100, Math.max(1, pct));
    await startSession(tradePercent);
    res.json({ ok: true, status: getSessionStatus() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to start session" });
  }
});

router.post("/session/stop", async (_req, res) => {
  try {
    await stopSession();
    res.json({ ok: true, status: getSessionStatus() });
  } catch (err) {
    res.status(500).json({ error: "Failed to stop session" });
  }
});

router.get("/session/status", (_req, res) => {
  res.json(getSessionStatus());
});

export default router;
