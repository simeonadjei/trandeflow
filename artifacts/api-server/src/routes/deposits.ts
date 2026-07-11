import { Router } from "express";
import { db } from "@workspace/db";
import { depositsTable, accountsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreateDepositBody } from "@workspace/api-zod";

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";

// Paystack provider codes for Ghana MoMo
const PROVIDER_CODE: Record<string, string> = {
  MTN:       "MTN",
  VODAFONE:  "VOD",
  AIRTELTIGO: "ATL",
};

function makeRef() {
  return "TF-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
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

    if (body.amount < 10)    return res.status(400).json({ error: "Minimum deposit is GHS 10" });
    if (body.amount > 50000) return res.status(400).json({ error: "Maximum deposit is GHS 50,000" });

    const reference = makeRef();
    const amountKobo = Math.round(body.amount * 100); // Paystack uses pesewas (smallest unit)
    const providerCode = PROVIDER_CODE[body.momoProvider] ?? "MTN";

    // Look up the account owner's real email for Paystack
    const owner = await db.query.usersTable.findFirst({ where: eq(usersTable.accountId, 1) });
    const chargeEmail = owner?.email ?? process.env.PAYSTACK_EMAIL ?? "payments@tradeflow.gh";

    // Initiate Paystack Mobile Money charge
    const paystackRes = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email:          chargeEmail,
        amount:         amountKobo,
        currency:       "GHS",
        mobile_money: {
          phone:    body.momoNumber,
          provider: providerCode,
        },
        reference,
        metadata: {
          account_id: 1,
          app:        "TradeFlow",
        },
      }),
    });

    const psData = await paystackRes.json() as any;
    req.log.info({ psData, reference }, "Paystack charge initiated");

    if (!psData.status) {
      req.log.error({ psData }, "Paystack charge failed");
      return res.status(400).json({ error: psData.message ?? "Payment initiation failed" });
    }

    // Save deposit record — PENDING until webhook/poll confirms
    const [deposit] = await db.insert(depositsTable).values({
      accountId:    1,
      amount:       body.amount.toString(),
      currency:     "GHS",
      momoNumber:   body.momoNumber,
      momoProvider: body.momoProvider,
      reference,
      status:       "PENDING",
    }).returning();

    // Poll Paystack for confirmation (mobile money needs user to approve on phone)
    // Poll every 5s for up to 3 minutes
    let attempts = 0;
    const maxAttempts = 36; // 36 × 5s = 3 min

    const poll = setInterval(async () => {
      attempts++;
      try {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        });
        const verifyData = await verifyRes.json() as any;

        req.log.info({ status: verifyData?.data?.status, reference, attempts }, "Paystack poll");

        if (verifyData?.data?.status === "success") {
          clearInterval(poll);

          await db.update(depositsTable)
            .set({ status: "COMPLETED", completedAt: new Date() })
            .where(eq(depositsTable.id, deposit.id));

          const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
          if (account) {
            const newBalance = parseFloat(account.balance as string) + body.amount;
            await db.update(accountsTable)
              .set({ balance: newBalance.toFixed(2) })
              .where(eq(accountsTable.id, 1));
          }
          req.log.info({ reference, amount: body.amount }, "Deposit confirmed — balance credited");

        } else if (
          verifyData?.data?.status === "failed" ||
          verifyData?.data?.status === "abandoned" ||
          attempts >= maxAttempts
        ) {
          clearInterval(poll);
          await db.update(depositsTable)
            .set({ status: "FAILED" })
            .where(eq(depositsTable.id, deposit.id));
          req.log.warn({ reference, status: verifyData?.data?.status }, "Deposit failed/expired");
        } else {
          // Still pending — mark PROCESSING so UI shows spinner
          await db.update(depositsTable)
            .set({ status: "PROCESSING" })
            .where(eq(depositsTable.id, deposit.id));
        }
      } catch (pollErr) {
        req.log.error(pollErr, "Paystack poll error");
      }
    }, 5000);

    res.status(201).json({
      ...mapDeposit(deposit),
      displayStatus: psData.data?.display_text ?? "Check your phone and approve the MoMo prompt",
    });

  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Failed to create deposit" });
  }
});

export default router;
