import { Router } from "express";
import { db } from "@workspace/db";
import { tradesTable, accountsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { PlaceTradeBody, ToggleAutoInvestBody } from "@workspace/api-zod";
import {
  hasMexcCredentials,
  getPrice as getMexcPrice,
  getFreeBalance,
  marketBuy,
  marketSell,
} from "../lib/mexcClient";

const router = Router();

// ── MEXC-tradeable symbols ────────────────────────────────────────────────────
// Only UP trades on these symbols execute as real MEXC spot buy→sell.
const MEXC_SYMBOL_MAP: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
};

// ── Simulated prices for demo / non-MEXC symbols ─────────────────────────────
const SIM_PRICES: Record<string, number> = {
  EURUSD: 1.08542,
  BTCUSD: 67340.50,
  GBPUSD: 1.27180,
  ETHUSD: 3412.80,
  XAUUSD: 2318.40,
  USDJPY: 156.720,
};

function getSimPrice(symbol: string) {
  const base = SIM_PRICES[symbol] ?? 100;
  return base + (Math.random() - 0.5) * base * 0.001;
}

function mapTrade(t: typeof tradesTable.$inferSelect) {
  return {
    id: t.id,
    symbol: t.symbol,
    direction: t.direction,
    amount: parseFloat(t.amount as string),
    duration: t.duration,
    entryPrice: parseFloat(t.entryPrice as string),
    exitPrice: t.exitPrice ? parseFloat(t.exitPrice as string) : null,
    profit: t.profit ? parseFloat(t.profit as string) : null,
    payout: parseFloat(t.payout as string),
    status: t.status,
    isAuto: t.isAuto,
    isDemo: t.isDemo,
    createdAt: t.createdAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
  };
}

router.get("/trades", async (req, res) => {
  try {
    const trades = await db.query.tradesTable.findMany({
      orderBy: [desc(tradesTable.createdAt)],
      limit: 50,
    });
    res.json(trades.map(mapTrade));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get trades" });
  }
});

router.post("/trades", async (req, res) => {
  try {
    const body = PlaceTradeBody.parse(req.body);
    const isDemo = body.isDemo ?? false;
    const duration = body.duration ?? 60;
    const payout = 100;

    // Determine if this trade should execute on real MEXC
    // Only UP direction trades on BTC/ETH can be executed as real spot buy→sell
    const mexcPair = MEXC_SYMBOL_MAP[body.symbol];
    const execOnMexc =
      !isDemo &&
      !!mexcPair &&
      body.direction === "UP" &&
      hasMexcCredentials();

    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    // Balance check — only needed for simulated trades (real MEXC funds itself)
    if (!execOnMexc) {
      if (isDemo) {
        const demoBalance = parseFloat(account.demoBalance as string);
        if (body.amount > demoBalance) {
          return res.status(400).json({ error: "Insufficient demo balance" });
        }
      } else if (hasMexcCredentials()) {
        // Real mode with MEXC: check live USDT free balance
        const freeUsdt = await getFreeBalance("USDT");
        if (body.amount > freeUsdt) {
          return res.status(400).json({
            error: `Insufficient MEXC balance. Free: ${freeUsdt.toFixed(2)} USDT, needed: ${body.amount} USDT`,
          });
        }
      } else {
        const currentBalance = parseFloat(account.balance as string);
        if (body.amount > currentBalance) {
          return res.status(400).json({ error: "Insufficient balance" });
        }
      }
    }

    // ── Entry price ────────────────────────────────────────────────────────
    let entryPrice: number;
    let buyOrderId: string | undefined;
    let baseQty = 0;

    if (execOnMexc) {
      // Get live MEXC price as entry reference
      try {
        entryPrice = await getMexcPrice(mexcPair);
      } catch {
        entryPrice = getSimPrice(body.symbol);
      }
      // Execute real MEXC market buy (spend body.amount USDT)
      try {
        const buy = await marketBuy(mexcPair, body.amount);
        buyOrderId = buy.orderId;
        baseQty = buy.baseQty;
        entryPrice = buy.avgPrice;
        req.log.info(
          { pair: mexcPair, spent: body.amount, baseQty, entryPrice, orderId: buy.orderId },
          "Manual MEXC market buy executed"
        );
      } catch (e) {
        req.log.error(e, "MEXC manual buy failed");
        return res.status(502).json({
          error: `MEXC buy failed: ${(e as Error).message}`,
        });
      }
    } else {
      entryPrice = getSimPrice(body.symbol);
    }

    // ── Record trade ────────────────────────────────────────────────────────
    const [trade] = await db
      .insert(tradesTable)
      .values({
        accountId: 1,
        symbol: body.symbol,
        direction: body.direction,
        amount: body.amount.toString(),
        duration,
        entryPrice: entryPrice.toString(),
        payout: payout.toString(),
        status: "OPEN",
        isAuto: false,
        isDemo,
        buyOrderId: buyOrderId ?? null,
      })
      .returning();

    // ── Schedule close after duration ───────────────────────────────────────
    setTimeout(async () => {
      try {
        let exitPrice: number;
        let profitOrLoss: number;

        if (execOnMexc && baseQty > 0) {
          // Real MEXC market sell — get back USDT for the crypto we bought
          const sell = await marketSell(mexcPair, baseQty);
          exitPrice = sell.avgPrice;
          profitOrLoss = parseFloat((sell.quoteQty - body.amount).toFixed(4));
          req.log.info(
            { pair: mexcPair, received: sell.quoteQty, stake: body.amount, profit: profitOrLoss },
            "Manual MEXC market sell executed"
          );
        } else {
          // Simulated: UP wins if price went up, DOWN wins if price went down
          exitPrice = getSimPrice(body.symbol);
          const won =
            body.direction === "UP"
              ? exitPrice > entryPrice
              : exitPrice < entryPrice;
          profitOrLoss = won
            ? body.amount * (payout / 100)
            : -body.amount;
        }

        const won = profitOrLoss > 0;
        const status = won ? "WIN" : "LOSS";

        await db
          .update(tradesTable)
          .set({
            exitPrice: exitPrice.toString(),
            profit: profitOrLoss.toFixed(4),
            status,
            closedAt: new Date(),
          })
          .where(eq(tradesTable.id, trade.id));

        // Update account stats
        const fresh = await db.query.accountsTable.findFirst({
          where: eq(accountsTable.id, 1),
        });
        if (fresh) {
          const newTotal = fresh.totalTrades + 1;
          const prevWins = Math.round(
            (parseFloat(fresh.winRate as string) * fresh.totalTrades) / 100
          );
          const newWinRate = ((prevWins + (won ? 1 : 0)) / newTotal) * 100;

          if (isDemo) {
            const newDemo = Math.max(
              0,
              parseFloat(fresh.demoBalance as string) + profitOrLoss
            );
            await db
              .update(accountsTable)
              .set({
                demoBalance: newDemo.toFixed(2),
                totalTrades: newTotal,
                winRate: newWinRate.toFixed(2),
              })
              .where(eq(accountsTable.id, 1));
          } else if (execOnMexc) {
            // MEXC real trade — track P&L in realizedPnlUsd
            const newPnl = parseFloat(
              (parseFloat(fresh.realizedPnlUsd as string) + profitOrLoss).toFixed(4)
            );
            const newProfit = parseFloat(
              (parseFloat(fresh.totalProfit as string) + profitOrLoss).toFixed(4)
            );
            await db
              .update(accountsTable)
              .set({
                totalTrades: newTotal,
                winRate: newWinRate.toFixed(2),
                realizedPnlUsd: newPnl.toFixed(4),
                totalProfit: newProfit.toFixed(4),
              })
              .where(eq(accountsTable.id, 1));
          } else {
            // Simulated non-demo: internal balance
            const newBalance = Math.max(
              0,
              parseFloat(fresh.balance as string) + profitOrLoss
            );
            await db
              .update(accountsTable)
              .set({
                balance: newBalance.toFixed(2),
                totalTrades: newTotal,
                winRate: newWinRate.toFixed(2),
                totalProfit: (
                  parseFloat(fresh.totalProfit as string) + profitOrLoss
                ).toFixed(2),
              })
              .where(eq(accountsTable.id, 1));
          }
        }
      } catch (_e) {
        // background errors — log only
      }
    }, duration * 1000);

    res.status(201).json(mapTrade(trade));
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Failed to place trade" });
  }
});

router.post("/trades/auto", async (req, res) => {
  try {
    const body = ToggleAutoInvestBody.parse(req.body);
    await db
      .update(accountsTable)
      .set({
        autoInvestEnabled: body.enabled,
        autoInvestStake: (body.stakeAmount ?? 10).toString(),
        autoInvestMaxDaily: body.maxDailyTrades ?? 10,
      })
      .where(eq(accountsTable.id, 1));

    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });

    res.json({
      enabled: account?.autoInvestEnabled ?? body.enabled,
      stakeAmount: parseFloat(account?.autoInvestStake as string ?? "10"),
      maxDailyTrades: account?.autoInvestMaxDaily ?? 10,
      tradesToday: account?.autoInvestTradesToday ?? 0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Failed to toggle auto-invest" });
  }
});

router.get("/trades/auto/status", async (req, res) => {
  try {
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    res.json({
      enabled: account?.autoInvestEnabled ?? false,
      stakeAmount: parseFloat(account?.autoInvestStake as string ?? "10"),
      maxDailyTrades: account?.autoInvestMaxDaily ?? 10,
      tradesToday: account?.autoInvestTradesToday ?? 0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get auto-invest status" });
  }
});

export default router;
