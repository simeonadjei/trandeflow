import { db } from "@workspace/db";
import { accountsTable, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const ASSETS = [
  { symbol: "EURUSD", price: 1.08542 },
  { symbol: "BTCUSD", price: 67340.50 },
  { symbol: "GBPUSD", price: 1.27180 },
  { symbol: "ETHUSD", price: 3412.80 },
  { symbol: "XAUUSD", price: 2318.40 },
];

function getPrice(base: number) {
  return base + (Math.random() - 0.5) * base * 0.002;
}

function generateCandles(basePrice: number, count = 20) {
  const candles = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const move = (Math.random() - 0.48) * basePrice * 0.003;
    const close = open + move;
    candles.push({ open, close, high: Math.max(open, close) + Math.random() * basePrice * 0.001, low: Math.min(open, close) - Math.random() * basePrice * 0.001 });
    price = close;
  }
  return candles;
}

function analyzeSignal(candles: ReturnType<typeof generateCandles>): { signal: "UP" | "DOWN" | null; confidence: number; pattern: string } {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recent = candles.slice(-5);

  const bodySize = Math.abs(last.close - last.open);
  const wickDown = Math.min(last.open, last.close) - last.low;
  const wickUp = last.high - Math.max(last.open, last.close);
  const isGreen = last.close > last.open;
  const upTrend = recent.filter((c) => c.close > c.open).length >= 3;
  const downTrend = recent.filter((c) => c.close < c.open).length >= 3;

  // Hammer — strong BUY
  if (wickDown > bodySize * 2 && isGreen) {
    return { signal: "UP", confidence: 76 + Math.random() * 8, pattern: "Hammer" };
  }
  // Shooting Star — strong SELL
  if (wickUp > bodySize * 2 && !isGreen) {
    return { signal: "DOWN", confidence: 73 + Math.random() * 8, pattern: "Shooting Star" };
  }
  // Bullish Engulfing
  if (isGreen && bodySize > Math.abs(prev.close - prev.open) * 1.4 && !prev.close) {
    return { signal: "UP", confidence: 80 + Math.random() * 6, pattern: "Bullish Engulfing" };
  }
  // Trend continuation
  if (upTrend && isGreen) {
    return { signal: "UP", confidence: 62 + Math.random() * 10, pattern: "Bullish Momentum" };
  }
  if (downTrend && !isGreen) {
    return { signal: "DOWN", confidence: 61 + Math.random() * 10, pattern: "Bearish Momentum" };
  }

  return { signal: null, confidence: 0, pattern: "Doji" };
}

async function runAutoInvestCycle() {
  try {
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });

    if (!account || !account.autoInvestEnabled) return;

    const balance = parseFloat(account.balance as string);
    const stake = parseFloat(account.autoInvestStake as string);
    const maxDaily = account.autoInvestMaxDaily;
    const tradesToday = account.autoInvestTradesToday;

    if (tradesToday >= maxDaily) {
      logger.info("Auto-invest: daily limit reached");
      return;
    }
    if (balance < stake) {
      logger.info("Auto-invest: insufficient balance");
      return;
    }

    // Pick a random asset and analyse it
    const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
    const candles = generateCandles(asset.price);
    const { signal, confidence, pattern } = analyzeSignal(candles);

    // Only trade on high-confidence signals
    if (!signal || confidence < 65) {
      logger.info({ confidence, pattern }, "Auto-invest: signal not strong enough, skipping");
      return;
    }

    const entryPrice = getPrice(asset.price);
    const payout = 85;
    const duration = 60;

    logger.info({ symbol: asset.symbol, signal, confidence, pattern }, "Auto-invest: placing trade");

    const [trade] = await db.insert(tradesTable).values({
      accountId: 1,
      symbol: asset.symbol,
      direction: signal,
      amount: stake.toString(),
      duration,
      entryPrice: entryPrice.toString(),
      payout: payout.toString(),
      status: "OPEN",
      isAuto: true,
    }).returning();

    // Increment trades-today counter
    await db.update(accountsTable)
      .set({ autoInvestTradesToday: tradesToday + 1 })
      .where(eq(accountsTable.id, 1));

    // Resolve trade after duration
    setTimeout(async () => {
      try {
        const exitPrice = getPrice(asset.price);
        // Win rate weighted slightly in favour of the player (60%)
        const won = Math.random() < 0.60
          ? signal === "UP" ? exitPrice >= entryPrice : exitPrice <= entryPrice
          : signal === "UP" ? exitPrice < entryPrice : exitPrice > entryPrice;

        const profit = won ? stake * (payout / 100) : -stake;
        const status = won ? "WIN" : "LOSS";

        await db.update(tradesTable)
          .set({ exitPrice: exitPrice.toString(), profit: profit.toString(), status, closedAt: new Date() })
          .where(eq(tradesTable.id, trade.id));

        // Update account balance + stats
        const fresh = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
        if (fresh) {
          const newBalance = Math.max(0, parseFloat(fresh.balance as string) + profit);
          const newTotal = fresh.totalTrades + 1;
          const wins = Math.round(parseFloat(fresh.winRate as string) * fresh.totalTrades / 100) + (won ? 1 : 0);
          const newWinRate = newTotal > 0 ? (wins / newTotal) * 100 : 0;
          const newProfit = parseFloat(fresh.totalProfit as string) + profit;

          await db.update(accountsTable).set({
            balance: newBalance.toFixed(2),
            totalTrades: newTotal,
            winRate: newWinRate.toFixed(2),
            totalProfit: newProfit.toFixed(2),
          }).where(eq(accountsTable.id, 1));
        }

        logger.info({ symbol: asset.symbol, status, profit }, "Auto-invest: trade closed");
      } catch (e) {
        logger.error(e, "Auto-invest: error closing trade");
      }
    }, duration * 1000);
  } catch (err) {
    logger.error(err, "Auto-invest cycle error");
  }
}

// Reset daily trade counter at midnight
function scheduleMidnightReset() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const msUntilMidnight = next.getTime() - now.getTime();

  setTimeout(async () => {
    await db.update(accountsTable).set({ autoInvestTradesToday: 0 }).where(eq(accountsTable.id, 1));
    logger.info("Auto-invest: daily trade counter reset");
    scheduleMidnightReset();
  }, msUntilMidnight);
}

export function startAutoInvestEngine() {
  logger.info("Auto-invest engine started (30s cycle)");
  scheduleMidnightReset();
  // Run immediately, then every 30 seconds
  runAutoInvestCycle();
  setInterval(runAutoInvestCycle, 30_000);
}
