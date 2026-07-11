import { Router } from "express";
import { db } from "@workspace/db";
import { withdrawalsTable, accountsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { RequestWithdrawalBody } from "@workspace/api-zod";

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";

// Paystack recipient bank codes for Ghana Mobile Money
const PROVIDER_CODE: Record<string, string> = {
  MTN:        "MTN",
  VODAFONE:   "VOD",
  AIRTELTIGO: "ATL",
};

function makeRef() {
  return "TF-WD-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function mapWithdrawal(w: typeof withdrawalsTable.$inferSelect) {
  return {
    id: w.id,
    amount: parseFloat(w.amount as string),
    currency: w.currency,
    momoNumber: w.momoNumber,
    momoProvider: w.momoProvider,
    status: w.status,
    failureReason: w.failureReason,
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

    if (!PAYSTACK_SECRET) {
      return res.status(500).json({ error: "Payouts are not configured — missing Paystack key" });
    }

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

    const providerCode = PROVIDER_CODE[body.momoProvider] ?? "MTN";
    const reference = makeRef();

    // ── 1. Create (or reuse) a Paystack transfer recipient for this MoMo number ──
    const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type:           "mobile_money",
        name:           `TradeFlow Withdrawal ${body.momoNumber}`,
        account_number: body.momoNumber,
        bank_code:      providerCode,
        currency:       "GHS",
      }),
    });
    const recipientData = await recipientRes.json() as any;
    req.log.info({ recipientData }, "Paystack recipient created");

    if (!recipientData.status || !recipientData.data?.recipient_code) {
      req.log.error({ recipientData }, "Paystack recipient creation failed");
      return res.status(400).json({ error: recipientData.message ?? "Could not verify mobile money number" });
    }
    const recipientCode = recipientData.data.recipient_code as string;

    // Deduct balance up-front; refund if the transfer fails to initiate
    await db.update(accountsTable)
      .set({ balance: (balance - body.amount).toFixed(2) })
      .where(eq(accountsTable.id, 1));

    const [withdrawal] = await db.insert(withdrawalsTable).values({
      accountId:     1,
      amount:        body.amount.toString(),
      currency:      "GHS",
      momoNumber:    body.momoNumber,
      momoProvider:  body.momoProvider,
      status:        "PENDING",
      recipientCode,
      reference,
    }).returning();

    // ── 2. Initiate the actual Paystack transfer (real payout to MoMo) ──
    const amountKobo = Math.round(body.amount * 100);
    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source:    "balance",
        amount:    amountKobo,
        recipient: recipientCode,
        reason:    "TradeFlow withdrawal",
        currency:  "GHS",
        reference,
      }),
    });
    const transferData = await transferRes.json() as any;
    req.log.info({ transferData, reference }, "Paystack transfer initiated");

    if (!transferData.status) {
      // Transfer failed to even start — refund the balance
      await db.update(accountsTable)
        .set({ balance: balance.toFixed(2) })
        .where(eq(accountsTable.id, 1));
      await db.update(withdrawalsTable)
        .set({ status: "FAILED", failureReason: transferData.message ?? "Transfer failed to initiate" })
        .where(eq(withdrawalsTable.id, withdrawal.id));
      return res.status(400).json({ error: transferData.message ?? "Payout failed to initiate" });
    }

    const transferCode = transferData.data?.transfer_code as string | undefined;
    const initialStatus = transferData.data?.status as string | undefined; // e.g. "success" | "pending" | "otp"

    await db.update(withdrawalsTable)
      .set({
        transferCode,
        status: initialStatus === "success" ? "COMPLETED" : "PROCESSING",
        completedAt: initialStatus === "success" ? new Date() : undefined,
      })
      .where(eq(withdrawalsTable.id, withdrawal.id));

    // ── 3. Poll Paystack for final status (transfers settle async) ──
    let attempts = 0;
    const maxAttempts = 36; // 36 × 5s = 3 min

    const poll = setInterval(async () => {
      attempts++;
      try {
        const verifyRes = await fetch(`https://api.paystack.co/transfer/verify/${reference}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        });
        const verifyData = await verifyRes.json() as any;
        const status = verifyData?.data?.status;

        req.log.info({ status, reference, attempts }, "Paystack transfer poll");

        if (status === "success") {
          clearInterval(poll);
          await db.update(withdrawalsTable)
            .set({ status: "COMPLETED", completedAt: new Date() })
            .where(eq(withdrawalsTable.id, withdrawal.id));
          req.log.info({ reference }, "Withdrawal completed — money sent to MoMo");

        } else if (status === "failed" || status === "reversed" || attempts >= maxAttempts) {
          clearInterval(poll);
          // Refund balance since the money never reached the user
          const fresh = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
          if (fresh) {
            const refunded = parseFloat(fresh.balance as string) + body.amount;
            await db.update(accountsTable)
              .set({ balance: refunded.toFixed(2) })
              .where(eq(accountsTable.id, 1));
          }
          await db.update(withdrawalsTable)
            .set({ status: "FAILED", failureReason: status ?? "Transfer timed out" })
            .where(eq(withdrawalsTable.id, withdrawal.id));
          req.log.warn({ reference, status }, "Withdrawal failed/reversed — balance refunded");
        }
        // else: still pending/otp — keep polling, stays PROCESSING
      } catch (pollErr) {
        req.log.error(pollErr, "Paystack transfer poll error");
      }
    }, 5000);

    res.status(201).json(mapWithdrawal(withdrawal));
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Failed to request withdrawal" });
  }
});

export default router;
