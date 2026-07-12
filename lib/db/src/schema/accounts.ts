import { pgTable, serial, text, numeric, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull().default("0.00"),
  demoBalance: numeric("demo_balance", { precision: 18, scale: 2 }).notNull().default("10000.00"),
  currency: text("currency").notNull().default("GHS"),
  autoInvestEnabled: boolean("auto_invest_enabled").notNull().default(false),
  autoInvestStake: numeric("auto_invest_stake", { precision: 18, scale: 2 }).notNull().default("10.00"),
  tradePercentage: numeric("trade_percentage", { precision: 5, scale: 2 }).notNull().default("50.00"),
  autoInvestMaxDaily: integer("auto_invest_max_daily").notNull().default(10),
  autoInvestTradesToday: integer("auto_invest_trades_today").notNull().default(0),
  totalProfit: numeric("total_profit", { precision: 18, scale: 2 }).notNull().default("0.00"),
  totalTrades: integer("total_trades").notNull().default(0),
  winRate: numeric("win_rate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  // Realized profit/loss in USDT from real KuCoin trading — separate pool from the
  // GHS `balance` field above (which tracks Paystack deposits/withdrawals only).
  realizedPnlUsd: numeric("realized_pnl_usd", { precision: 18, scale: 4 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
