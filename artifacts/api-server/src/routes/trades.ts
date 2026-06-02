import { Router } from "express";
import { db } from "@workspace/db";
import { tradesTable, accountsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { PlaceTradeBody, ToggleAutoInvestBody } from "@workspace/api-zod";

const router = Router();

const ASSET_PRICES: Record<string, number> = {
  EURUSD: 1.08542,
  BTCUSD: 67340.50,
  GBPUSD: 1.27180,
  ETHUSD: 3412.80,
  XAUUSD: 2318.40,
  USDJPY: 156.720,
  AAPL: 189.50,
  TSLA: 174.80,
};

function getPrice(symbol: string) {
  const base = ASSET_PRICES[symbol] ?? 100;
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
    const entryPrice = getPrice(body.symbol);
    const payout = 85;
    const duration = body.duration ?? 60;

    // Check balance
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const currentBalance = isDemo
      ? parseFloat(account.demoBalance as string)
      : parseFloat(account.balance as string);

    if (body.amount > currentBalance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const [trade] = await db.insert(tradesTable).values({
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
    }).returning();

    // Simulate trade close after duration
    setTimeout(async () => {
      try {
        const exitPrice = getPrice(body.symbol);
        const won = body.direction === "UP"
          ? exitPrice > entryPrice
          : exitPrice < entryPrice;
        const profit = won
          ? parseFloat(body.amount.toString()) * (payout / 100)
          : -parseFloat(body.amount.toString());
        const status = won ? "WIN" : "LOSS";

        await db.update(tradesTable)
          .set({ exitPrice: exitPrice.toString(), profit: profit.toString(), status, closedAt: new Date() })
          .where(eq(tradesTable.id, trade.id));

        // Update the right balance
        const fresh = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
        if (fresh) {
          if (isDemo) {
            const newDemo = Math.max(0, parseFloat(fresh.demoBalance as string) + profit);
            await db.update(accountsTable)
              .set({ demoBalance: newDemo.toFixed(2) })
              .where(eq(accountsTable.id, 1));
          } else {
            const newBalance = parseFloat(fresh.balance as string) + profit;
            const newTotal = fresh.totalTrades + 1;
            const wins = Math.round(parseFloat(fresh.winRate as string) * fresh.totalTrades / 100) + (won ? 1 : 0);
            const newWinRate = (wins / newTotal) * 100;
            const newProfit = parseFloat(fresh.totalProfit as string) + profit;
            await db.update(accountsTable)
              .set({
                balance: Math.max(0, newBalance).toFixed(2),
                totalTrades: newTotal,
                winRate: newWinRate.toFixed(2),
                totalProfit: newProfit.toFixed(2),
              })
              .where(eq(accountsTable.id, 1));
          }
        }
      } catch (_e) {
        // ignore background errors
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
    await db.update(accountsTable)
      .set({
        autoInvestEnabled: body.enabled,
        autoInvestStake: (body.stakeAmount ?? 10).toString(),
        autoInvestMaxDaily: body.maxDailyTrades ?? 10,
      })
      .where(eq(accountsTable.id, 1));

    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });

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
    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
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
