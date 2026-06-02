import { Router } from "express";
import { db } from "@workspace/db";
import { depositsTable, accountsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreateDepositBody } from "@workspace/api-zod";

const router = Router();

function makeRef() {
  return "TF-" + Math.random().toString(36).slice(2, 10).toUpperCase();
}

function mapDeposit(d: typeof depositsTable.$inferSelect) {
  return {
    id: d.id,
    amount: parseFloat(d.amount as string),
    currency: d.currency,
    momoNumber: d.momoNumber,
    momoProvider: d.momoProvider,
    reference: d.reference,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
  };
}

router.get("/deposits", async (req, res) => {
  try {
    const deposits = await db.query.depositsTable.findMany({
      orderBy: [desc(depositsTable.createdAt)],
      limit: 20,
    });
    res.json(deposits.map(mapDeposit));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get deposits" });
  }
});

router.post("/deposits", async (req, res) => {
  try {
    const body = CreateDepositBody.parse(req.body);

    if (body.amount < 10) {
      return res.status(400).json({ error: "Minimum deposit is GHS 10" });
    }
    if (body.amount > 10000) {
      return res.status(400).json({ error: "Maximum deposit is GHS 10,000" });
    }

    const reference = makeRef();

    const [deposit] = await db.insert(depositsTable).values({
      accountId: 1,
      amount: body.amount.toString(),
      currency: "GHS",
      momoNumber: body.momoNumber,
      momoProvider: body.momoProvider,
      reference,
      status: "PENDING",
    }).returning();

    // Simulate: PENDING → PROCESSING after 5s
    setTimeout(async () => {
      await db.update(depositsTable)
        .set({ status: "PROCESSING" })
        .where(eq(depositsTable.id, deposit.id));
    }, 5000);

    // Simulate: PROCESSING → COMPLETED + credit account after 20s
    setTimeout(async () => {
      await db.update(depositsTable)
        .set({ status: "COMPLETED", completedAt: new Date() })
        .where(eq(depositsTable.id, deposit.id));

      const account = await db.query.accountsTable.findFirst({
        where: eq(accountsTable.id, 1),
      });
      if (account) {
        const newBalance = parseFloat(account.balance as string) + body.amount;
        await db.update(accountsTable)
          .set({ balance: newBalance.toFixed(2) })
          .where(eq(accountsTable.id, 1));
      }
    }, 20000);

    res.status(201).json(mapDeposit(deposit));
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Failed to create deposit" });
  }
});

export default router;
