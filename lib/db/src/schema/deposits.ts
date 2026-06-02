import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const depositsTable = pgTable("deposits", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().default(1),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("GHS"),
  momoNumber: text("momo_number").notNull(),
  momoProvider: text("momo_provider").notNull(), // MTN | VODAFONE | AIRTELTIGO
  reference: text("reference").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | PROCESSING | COMPLETED | FAILED
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertDepositSchema = createInsertSchema(depositsTable).omit({ id: true, createdAt: true });
export type InsertDeposit = z.infer<typeof insertDepositSchema>;
export type Deposit = typeof depositsTable.$inferSelect;
