import { Router } from "express";
import { db } from "@workspace/db";
import { withdrawalsTable, accountsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { RequestWithdrawalBody } from "@workspace/api-zod";

const router = Router();

function mapWithdrawal(w: typeof withdrawalsTable.$inferSelect) {
  return {
    id: w.id,
    amount: parseFloat(w.amount as string),
    currency: w.currency,
    momoNumber: w.momoNumber,
    momoProvider: w.momoProvider,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
    completedAt: w.completedAt ? w.completedAt.toISOString() : null,
  };
}

router.get("/withdrawals", async (req, res) => {
  try {
    const withdrawals = await db.query.withdrawalsTable.findMany({
      orderBy: [desc(withdrawalsTable.createdAt)],
      limit: 20,
    });
    res.json(withdrawals.map(mapWithdrawal));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get withdrawals" });
  }
});

router.post("/withdrawals", async (req, res) => {
  try {
    const body = RequestWithdrawalBody.parse(req.body);

    // Check account balance
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const balance = parseFloat(account.balance as string);
    if (body.amount > balance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    if (body.amount < 10) {
      return res.status(400).json({ error: "Minimum withdrawal is GHS 10" });
    }

    // Deduct balance
    await db.update(accountsTable)
      .set({ balance: (balance - body.amount).toFixed(2) })
      .where(eq(accountsTable.id, 1));

    const [withdrawal] = await db.insert(withdrawalsTable).values({
      accountId: 1,
      amount: body.amount.toString(),
      currency: "GHS",
      momoNumber: body.momoNumber,
      momoProvider: body.momoProvider,
      status: "PENDING",
    }).returning();

    // Simulate processing
    setTimeout(async () => {
      await db.update(withdrawalsTable)
        .set({ status: "PROCESSING" })
        .where(eq(withdrawalsTable.id, withdrawal.id));
    }, 5000);

    setTimeout(async () => {
      await db.update(withdrawalsTable)
        .set({ status: "COMPLETED", completedAt: new Date() })
        .where(eq(withdrawalsTable.id, withdrawal.id));
    }, 30000);

    res.status(201).json(mapWithdrawal(withdrawal));
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Failed to request withdrawal" });
  }
});

export default router;
