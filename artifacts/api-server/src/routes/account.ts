import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/account", async (req, res) => {
  try {
    let account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    if (!account) {
      const [created] = await db.insert(accountsTable).values({
        name: "Kwame Mensah",
        balance: "1250.00",
        demoBalance: "10000.00",
        currency: "GHS",
        totalProfit: "250.00",
        totalTrades: 47,
        winRate: "68.09",
      }).returning();
      account = created;
    }
    res.json({
      id: account.id,
      name: account.name,
      balance: parseFloat(account.balance),
      demoBalance: parseFloat(account.demoBalance),
      currency: account.currency,
      autoInvestEnabled: account.autoInvestEnabled,
      totalProfit: parseFloat(account.totalProfit),
      totalTrades: account.totalTrades,
      winRate: parseFloat(account.winRate),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get account" });
  }
});

router.get("/account/stats", async (req, res) => {
  try {
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    if (!account) {
      return res.json({
        totalProfit: 0,
        totalTrades: 0,
        winRate: 0,
        todayProfit: 0,
        streak: 0,
        bestTrade: 0,
        avgReturn: 0,
      });
    }
    res.json({
      totalProfit: parseFloat(account.totalProfit),
      totalTrades: account.totalTrades,
      winRate: parseFloat(account.winRate),
      todayProfit: 38.50,
      streak: 4,
      bestTrade: 127.50,
      avgReturn: 5.32,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
