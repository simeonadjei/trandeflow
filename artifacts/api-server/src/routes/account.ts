import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startSession, stopSession, getSessionStatus } from "../lib/continuousTrader";
import { hasKucoinCredentials, getFreeBalance } from "../lib/kucoinClient";

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

    // Real trading balance lives on KuCoin (funded independently via P2P), separate
    // from the GHS `balance` field which only tracks Paystack deposits/withdrawals.
    let kucoinBalanceUsd: number | null = null;
    let kucoinConnected = hasKucoinCredentials();
    if (kucoinConnected) {
      try {
        kucoinBalanceUsd = await getFreeBalance("USDT");
      } catch (err) {
        req.log.warn(err, "Failed to fetch KuCoin balance");
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
      kucoinConnected,
      kucoinBalanceUsd,
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

// ── Continuous trading session (real KuCoin execution) ──────────────────────
const MIN_TRADE_BALANCE_USD = 5;

router.post("/session/start", async (req, res) => {
  try {
    if (!hasKucoinCredentials()) {
      return res.status(400).json({
        error: "kucoin_not_connected",
        message: "Connect your KuCoin API key, secret, and passphrase before starting the bot.",
      });
    }

    // Hard block: real KuCoin USDT balance must be at least the minimum stake
    let balance = 0;
    try {
      balance = await getFreeBalance("USDT");
    } catch (err) {
      req.log.error(err, "Failed to fetch KuCoin balance for session start check");
      return res.status(502).json({ error: "kucoin_unreachable", message: "Could not reach KuCoin to check your balance. Try again shortly." });
    }
    if (balance < MIN_TRADE_BALANCE_USD) {
      return res.status(400).json({
        error: "insufficient_balance",
        message: `Minimum KuCoin USDT balance to start trading is ${MIN_TRADE_BALANCE_USD.toFixed(2)}. Fund your KuCoin account via P2P first.`,
        currentBalance: balance,
        minimumRequired: MIN_TRADE_BALANCE_USD,
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
