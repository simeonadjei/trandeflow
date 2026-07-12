import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startSession, stopSession, getSessionStatus } from "../lib/continuousTrader";
import { hasCoinbaseCredentials, getFreeBalance } from "../lib/coinbaseClient";

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

    // Real trading balance lives on Coinbase (funded independently via card),
    // separate from the GHS `balance` field which only tracks Paystack deposits/withdrawals.
    let coinbaseBalanceUsd: number | null = null;
    let coinbaseConnected = hasCoinbaseCredentials();
    if (coinbaseConnected) {
      try {
        coinbaseBalanceUsd = await getFreeBalance("USD");
      } catch (err) {
        req.log.warn(err, "Failed to fetch Coinbase balance");
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
      coinbaseConnected,
      coinbaseBalanceUsd,
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

// ── Continuous trading session (real Coinbase execution) ────────────────────
const MIN_TRADE_BALANCE_USD = 5;

router.post("/session/start", async (req, res) => {
  try {
    if (!hasCoinbaseCredentials()) {
      return res.status(400).json({
        error: "coinbase_not_connected",
        message: "Connect your Coinbase API key name and private key before starting the bot.",
      });
    }

    // Hard block: real Coinbase USD balance must be at least the minimum stake
    let balance = 0;
    try {
      balance = await getFreeBalance("USD");
    } catch (err) {
      req.log.error(err, "Failed to fetch Coinbase balance for session start check");
      return res.status(502).json({ error: "coinbase_unreachable", message: "Could not reach Coinbase to check your balance. Try again shortly." });
    }
    if (balance < MIN_TRADE_BALANCE_USD) {
      return res.status(400).json({
        error: "insufficient_balance",
        message: `Minimum Coinbase USD balance to start trading is ${MIN_TRADE_BALANCE_USD.toFixed(2)}. Fund your Coinbase account via card first.`,
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
