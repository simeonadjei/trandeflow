import { pgTable, serial, text, numeric, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().default(1),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // UP | DOWN
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  duration: integer("duration").notNull().default(60), // seconds
  entryPrice: numeric("entry_price", { precision: 18, scale: 6 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 18, scale: 6 }),
  profit: numeric("profit", { precision: 18, scale: 2 }),
  payout: numeric("payout", { precision: 5, scale: 2 }).notNull().default("85.00"),
  status: text("status").notNull().default("OPEN"), // OPEN | WIN | LOSS | DRAW
  isAuto: boolean("is_auto").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
