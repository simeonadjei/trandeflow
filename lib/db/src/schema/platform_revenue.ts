import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";

export const platformRevenueTable = pgTable("platform_revenue", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  type: text("type").notNull(), // WIN_CUT | LOSS_KEEP
  symbol: text("symbol").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlatformRevenue = typeof platformRevenueTable.$inferSelect;
