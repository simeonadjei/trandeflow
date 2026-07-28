import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startSession, stopSession, getSessionStatus } from "../lib/continuousTrader";
import { hasMexcCredentials, getFreeBalance, getMexcPortfolioValueUsdt } from "../lib/mexcClient";

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

    // Fetch live MEXC portfolio value (free USDT + locked USDT + crypto holdings at market price)
    let mexcBalanceUsdt: number | null = null;
    let mexcFreeUsdt: number | null = null;
    let mexcLockedUsdt: number | null = null;
    let mexcCryptoValueUsdt: number | null = null;
    let mexcBreakdown: Array<{ asset: string; free: number; locked: number; valueUsdt: number }> | null = null;
    const mexcConnected = hasMexcCredentials();
    if (mexcConnected) {
      try {
        const portfolio = await getMexcPortfolioValueUsdt();
        mexcBalanceUsdt       = portfolio.totalUsdt;
        mexcFreeUsdt          = portfolio.freeUsdt;
        mexcLockedUsdt        = portfolio.lockedUsdt;
        mexcCryptoValueUsdt   = portfolio.cryptoValueUsdt;
        mexcBreakdown         = portfolio.breakdown;
      } catch (err) {
        req.log.warn(err, "Failed to fetch MEXC portfolio value");
        // Fallback to free USDT only
        try {
          mexcFreeUsdt = await getFreeBalance("USDT");
          mexcBalanceUsdt = mexcFreeUsdt;
        } catch (err2) {
          req.log.warn(err2, "Failed to fetch MEXC free balance fallback");
        }
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
      mexcFreeUsdt,
      mexcLockedUsdt,
      mexcCryptoValueUsdt,
      mexcBreakdown,
      dailyLossLimit: parseFloat(account.dailyLossLimit as string),
      // kept for backward compat
      coinbaseConnected: false,
      coinbaseBalanceUsd: null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get account" });
  }
});

router.patch("/account/settings", async (req, res) => {
  try {
    const { dailyLossLimit } = req.body ?? {};
    const updates: Record<string, string> = {};
    if (dailyLossLimit !== undefined) {
      const val = Math.max(0, parseFloat(dailyLossLimit));
      updates.dailyLossLimit = val.toFixed(2);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    await db.update(accountsTable).set(updates).where(eq(accountsTable.id, 1));
    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    res.json({
      id: account!.id,
      name: account!.name,
      balance: parseFloat(account!.balance as string),
      demoBalance: parseFloat(account!.demoBalance as string),
      currency: account!.currency,
      autoInvestEnabled: account!.autoInvestEnabled,
      totalProfit: parseFloat(account!.totalProfit as string),
      totalTrades: account!.totalTrades,
      winRate: parseFloat(account!.winRate as string),
      realizedPnlUsd: parseFloat(account!.realizedPnlUsd as string),
      mexcConnected: hasMexcCredentials(),
      mexcBalanceUsdt: null,
      mexcFreeUsdt: null,
      mexcLockedUsdt: null,
      mexcCryptoValueUsdt: null,
      mexcBreakdown: null,
      dailyLossLimit: parseFloat(account!.dailyLossLimit as string),
      coinbaseConnected: false,
      coinbaseBalanceUsd: null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update settings" });
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

router.post("/session/start", async (req, res) => {
  try {
    if (!hasMexcCredentials()) {
      return res.status(400).json({
        error: "mexc_not_connected",
        message: "MEXC API keys are not configured. Add MEXC_API_KEY and MEXC_API_SECRET.",
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
