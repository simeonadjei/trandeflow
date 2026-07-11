import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().default(1),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("GHS"),
  momoNumber: text("momo_number").notNull(),
  momoProvider: text("momo_provider").notNull(), // MTN | VODAFONE | AIRTELTIGO
  status: text("status").notNull().default("PENDING"), // PENDING | PROCESSING | COMPLETED | FAILED
  recipientCode: text("recipient_code"), // Paystack transfer recipient code
  transferCode: text("transfer_code"),   // Paystack transfer code
  reference: text("reference"),          // Our own transfer reference
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({ id: true, createdAt: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
