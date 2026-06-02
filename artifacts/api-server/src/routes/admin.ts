import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, accountsTable, tradesTable, depositsTable, withdrawalsTable, platformRevenueTable } from "@workspace/db";
import { desc, sum, count, eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [userCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "user"));
    const [tradeCount] = await db.select({ count: count() }).from(tradesTable);
    const [openTradeCount] = await db.select({ count: count() }).from(tradesTable).where(eq(tradesTable.status, "OPEN"));
    const [depositSum] = await db.select({ total: sum(depositsTable.amount) }).from(depositsTable).where(eq(depositsTable.status, "COMPLETED"));
    const [withdrawalSum] = await db.select({ total: sum(withdrawalsTable.amount) }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "COMPLETED"));
    const [revenueSum] = await db.select({ total: sum(platformRevenueTable.amount) }).from(platformRevenueTable);
    const [winCutSum] = await db.select({ total: sum(platformRevenueTable.amount) }).from(platformRevenueTable).where(eq(platformRevenueTable.type, "WIN_CUT"));
    const [lossKeepSum] = await db.select({ total: sum(platformRevenueTable.amount) }).from(platformRevenueTable).where(eq(platformRevenueTable.type, "LOSS_KEEP"));

    res.json({
      totalUsers: Number(userCount.count),
      totalTrades: Number(tradeCount.count),
      openTrades: Number(openTradeCount.count),
      totalDeposited: parseFloat(depositSum.total ?? "0"),
      totalWithdrawn: parseFloat(withdrawalSum.total ?? "0"),
      platformRevenue: parseFloat(revenueSum.total ?? "0"),
      revenueFromWinCut: parseFloat(winCutSum.total ?? "0"),
      revenueFromLosses: parseFloat(lossKeepSum.total ?? "0"),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await db.query.usersTable.findMany({
      orderBy: [desc(usersTable.createdAt)],
      limit: 100,
    });
    res.json(users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/trades", requireAdmin, async (req, res) => {
  try {
    const trades = await db.query.tradesTable.findMany({
      orderBy: [desc(tradesTable.createdAt)],
      limit: 200,
    });
    res.json(trades.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      amount: parseFloat(t.amount as string),
      profit: t.profit ? parseFloat(t.profit as string) : null,
      status: t.status,
      isAuto: t.isAuto,
      isDemo: t.isDemo,
      createdAt: t.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/earnings", requireAdmin, async (req, res) => {
  try {
    const earnings = await db.query.platformRevenueTable.findMany({
      orderBy: [desc(platformRevenueTable.createdAt)],
      limit: 100,
    });
    res.json(earnings.map((e) => ({
      id: e.id,
      tradeId: e.tradeId,
      amount: parseFloat(e.amount as string),
      type: e.type,
      symbol: e.symbol,
      createdAt: e.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/deposits", requireAdmin, async (req, res) => {
  try {
    const deps = await db.query.depositsTable.findMany({
      orderBy: [desc(depositsTable.createdAt)],
      limit: 100,
    });
    res.json(deps.map((d) => ({
      id: d.id,
      amount: parseFloat(d.amount as string),
      momoProvider: d.momoProvider,
      momoNumber: d.momoNumber,
      status: d.status,
      reference: d.reference,
      createdAt: d.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/withdrawals", requireAdmin, async (req, res) => {
  try {
    const wds = await db.query.withdrawalsTable.findMany({
      orderBy: [desc(withdrawalsTable.createdAt)],
      limit: 100,
    });
    res.json(wds.map((w) => ({
      id: w.id,
      amount: parseFloat(w.amount as string),
      momoProvider: w.momoProvider,
      momoNumber: w.momoNumber,
      status: w.status,
      createdAt: w.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
