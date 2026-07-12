/**
 * Continuous Trading Engine — REAL KuCoin execution
 * ──────────────────────────────────────────────────
 * Runs server-side forever until stopped.
 * Scans BTC-USDT / ETH-USDT for a perfect 8/8 bullish (UP-only) signal.
 * On a perfect signal it places a REAL market buy on KuCoin sized as a
 * percentage of the user's real free USDT balance, watches it for up to
 * a short window, and exits (real market sell) the instant the signal
 * reverses, a take-profit hits, or a stop-loss hits — whichever comes first.
 *
 * There is no guaranteed outcome. Every trade is a real order against real
 * market prices; wins and losses both happen.
 */

import { db } from "@workspace/db";
import { accountsTable, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  hasKucoinCredentials, getFreeBalance, getKlines, getPrice,
  marketBuy, marketSell, type Candle,
} from "./kucoinClient";

// ─── Session status ───────────────────────────────────────────────────────
export interface SessionStatus {
  active:          boolean;
  stake:           number;
  tradePercent:    number;   // % of real USDT balance used as stake each trade
  phase:           "idle" | "analyzing" | "trading" | "waiting" | "error";
  asset:           string;
  direction:       "UP" | null;
  upScore:         number;
  lastResult:      "WIN" | "LOSS" | "DRAW" | null;
  lastProfit:      number;
  sessionTrades:   number;
  sessionWins:     number;
  sessionProfit:   number;
  message:         string;
}

let _s: SessionStatus = {
  active: false, stake: 0, tradePercent: 50, phase: "idle",
  asset: "—", direction: null, upScore: 0,
  lastResult: null, lastProfit: 0,
  sessionTrades: 0, sessionWins: 0, sessionProfit: 0,
  message: "Ready",
};

export function getSessionStatus(): SessionStatus { return { ..._s }; }

// ─── RSI ────────────────────────────────────────────────────────────────
function calcRSI(candles: Candle[], period = 14): number {
  const slice = candles.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i].close - slice[i - 1].close;
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  return Math.round(100 - 100 / (1 + gains / losses));
}

// ─── 8-condition UP-only scorer (long-only: real spot can't short) ───────
function scoreUp(candles: Candle[]): number {
  if (candles.length < 12) return 0;
  const last  = candles[candles.length - 1];
  const prev  = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  const recent = candles.slice(-5);

  const rsi      = calcRSI(candles);
  const sma10    = candles.slice(-10).reduce((s, c) => s + c.close, 0) / 10;
  const bodyLast = Math.abs(last.close - last.open);
  const bodyPrev = Math.abs(prev.close - prev.open);
  const wickDown = Math.min(last.open, last.close) - last.low;
  const wickUp   = last.high - Math.max(last.open, last.close);
  const greenCnt = recent.filter(c => c.close > c.open).length;

  return [
    rsi <= 45,                      // 1. RSI not overbought
    last.close > last.open,         // 2. Bullish candle
    greenCnt >= 3,                  // 3. 3 of last 5 candles green
    bodyLast >= bodyPrev * 0.75,    // 4. Body size maintained
    wickDown >= wickUp * 0.8,       // 5. Buying pressure
    last.close > sma10,             // 6. Price above SMA10
    last.low  >= prev.low * 0.9998, // 7. Higher low
    prev.low  >= prev2.low * 0.9998,// 8. Sustained higher lows
  ].filter(Boolean).length;
}

// ─── Assets — real KuCoin spot pairs only ────────────────────────────────
const ASSETS = ["BTC-USDT", "ETH-USDT"];

async function findBestSignal(): Promise<{ asset: string; score: number } | null> {
  let best: { asset: string; score: number } | null = null;
  for (const asset of ASSETS) {
    try {
      const candles = await getKlines(asset, 30);
      const score = scoreUp(candles);
      if (!best || score > best.score) best = { asset, score };
    } catch (e) {
      logger.warn({ asset, err: (e as Error).message }, "CT: klines fetch failed, skipping asset this scan");
    }
  }
  return best;
}

// ─── Tunables ─────────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS  = 3_000;
const TRADE_WINDOW_MS   = 5_000;   // max time to hold before forced exit
const CHECK_INTERVAL_MS = 1_000;   // how often we re-check signal/price mid-trade
const TAKE_PROFIT_PCT   = 0.004;   // +0.4%
const STOP_LOSS_PCT     = 0.003;   // -0.3%
const MIN_TRADE_USDT    = 5;       // floor so fees don't eat the trade

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Main loop ────────────────────────────────────────────────────────────
let _loopRunning = false;

async function isEnabled(): Promise<boolean> {
  const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
  return Boolean(account?.autoInvestEnabled);
}

async function loop() {
  while (true) {
    if (!(await isEnabled())) {
      _s.active = false; _s.phase = "idle"; _s.message = "Stopped";
      _loopRunning = false;
      logger.info("CT: session stopped");
      return;
    }

    if (!hasKucoinCredentials()) {
      _s.phase = "error";
      _s.message = "Waiting for KuCoin API keys to be configured";
      await sleep(10_000);
      continue;
    }

    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    const tradePercent = Math.min(100, Math.max(1, parseFloat((account?.tradePercentage as string) ?? "50")));
    _s.tradePercent = tradePercent;

    // ── Scan ─────────────────────────────────────────────────────────────
    _s.phase = "analyzing";
    _s.message = "Scanning BTC-USDT / ETH-USDT for a perfect signal…";

    let best: { asset: string; score: number } | null;
    try {
      best = await findBestSignal();
    } catch (e) {
      logger.error(e, "CT: scan failed");
      _s.phase = "error"; _s.message = "Scan failed, retrying…";
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }

    if (!best || best.score < 8) {
      _s.asset = best?.asset ?? "—";
      _s.upScore = best?.score ?? 0;
      _s.direction = null;
      _s.phase = "waiting";
      _s.message = `Signal ${best?.score ?? 0}/8 on ${best?.asset ?? "—"} — need 8/8, scanning again`;
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }

    _s.asset = best.asset;
    _s.upScore = best.score;
    _s.direction = "UP";

    // ── Balance check (real KuCoin USDT) ────────────────────────────────
    let freeUsdt: number;
    try {
      freeUsdt = await getFreeBalance("USDT");
    } catch (e) {
      logger.error(e, "CT: failed to fetch KuCoin balance");
      _s.phase = "error"; _s.message = "Could not read KuCoin balance, retrying…";
      await sleep(10_000);
      continue;
    }

    const stake = parseFloat((freeUsdt * tradePercent / 100).toFixed(2));
    if (stake < MIN_TRADE_USDT) {
      _s.phase = "waiting";
      _s.message = `KuCoin USDT balance too low (need at least $${MIN_TRADE_USDT} stake) — deposit more via P2P`;
      await sleep(15_000);
      continue;
    }
    _s.stake = stake;

    // ── Fire: real market buy ───────────────────────────────────────────
    _s.phase = "trading";
    _s.message = `8/8 signal on ${best.asset} — buying $${stake} …`;
    logger.info({ asset: best.asset, score: best.score, stake }, "CT: placing real market buy");

    let buy;
    try {
      buy = await marketBuy(best.asset, stake);
    } catch (e) {
      logger.error(e, "CT: buy order failed");
      _s.phase = "error"; _s.message = `Buy failed: ${(e as Error).message}`;
      await sleep(10_000);
      continue;
    }

    const entryPrice = buy.avgPrice;
    let tradeId: number | null = null;
    try {
      const [trade] = await db.insert(tradesTable).values({
        accountId:  1,
        symbol:     best.asset,
        direction:  "UP",
        amount:     stake.toFixed(2),
        duration:   Math.round(TRADE_WINDOW_MS / 1000),
        entryPrice: entryPrice.toString(),
        payout:     "100",
        status:     "OPEN",
        isAuto:     true,
        isDemo:     false,
        buyOrderId: buy.orderId,
      }).returning();
      tradeId = trade.id;
    } catch (e) {
      logger.error(e, "CT: failed to record trade — position is still open on KuCoin!");
    }

    // ── Monitor window: exit on signal reversal, take-profit, or stop-loss ──
    const startTs = Date.now();
    let exitReason: "signal_reversed" | "take_profit" | "stop_loss" | "window_expired" = "window_expired";

    while (Date.now() - startTs < TRADE_WINDOW_MS) {
      await sleep(CHECK_INTERVAL_MS);
      let price: number;
      let score: number;
      try {
        [price, score] = await Promise.all([
          getPrice(best.asset),
          getKlines(best.asset, 30).then(scoreUp),
        ]);
      } catch (e) {
        logger.warn(e, "CT: mid-trade check failed, holding");
        continue;
      }

      const change = (price - entryPrice) / entryPrice;
      _s.message = `Holding ${best.asset} — ${(change * 100).toFixed(2)}% since entry`;

      if (score < 8)                       { exitReason = "signal_reversed"; break; }
      if (change >= TAKE_PROFIT_PCT)        { exitReason = "take_profit"; break; }
      if (change <= -STOP_LOSS_PCT)         { exitReason = "stop_loss"; break; }

      if (!(await isEnabled())) { exitReason = "signal_reversed"; break; } // user hit stop — exit immediately
    }

    // ── Exit: real market sell ──────────────────────────────────────────
    _s.message = `Exiting ${best.asset} (${exitReason})…`;
    let sell;
    try {
      sell = await marketSell(best.asset, buy.dealSize);
    } catch (e) {
      logger.error(e, "CT: SELL FAILED — position remains open on KuCoin, needs manual attention");
      _s.phase = "error";
      _s.message = `Sell failed — check KuCoin manually: ${(e as Error).message}`;
      await sleep(10_000);
      continue;
    }

    const buyCostUsdt     = buy.feeCurrency === "USDT" ? buy.dealFunds + buy.fee : buy.dealFunds;
    const sellProceedsUsdt = sell.feeCurrency === "USDT" ? sell.dealFunds - sell.fee : sell.dealFunds;
    const profit = parseFloat((sellProceedsUsdt - buyCostUsdt).toFixed(4));
    const status = profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "DRAW";
    const won = profit > 0;

    if (tradeId) {
      await db.update(tradesTable)
        .set({
          exitPrice: sell.avgPrice.toString(),
          profit: profit.toFixed(4),
          status,
          sellOrderId: sell.orderId,
          exitReason,
          closedAt: new Date(),
        })
        .where(eq(tradesTable.id, tradeId));
    }

    // Update account stats (winRate/totalTrades are shared; realizedPnlUsd is the real-money ledger)
    const acc2 = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    if (acc2) {
      const newTotal    = acc2.totalTrades + 1;
      const prevWins    = Math.round(parseFloat(acc2.winRate as string) * acc2.totalTrades / 100);
      const newWinRate  = ((prevWins + (won ? 1 : 0)) / newTotal) * 100;
      const newPnl      = parseFloat((parseFloat(acc2.realizedPnlUsd as string) + profit).toFixed(4));
      await db.update(accountsTable).set({
        totalTrades:    newTotal,
        winRate:        newWinRate.toFixed(2),
        realizedPnlUsd: newPnl.toFixed(4),
      }).where(eq(accountsTable.id, 1));
    }

    _s.lastResult = status as "WIN" | "LOSS" | "DRAW";
    _s.lastProfit = profit;
    _s.sessionTrades++;
    if (won) _s.sessionWins++;
    _s.sessionProfit += profit;
    _s.phase = "waiting";
    _s.message = `${won ? "✓ WON" : profit < 0 ? "✗ LOST" : "= FLAT"} ${profit >= 0 ? "+" : ""}$${profit.toFixed(2)} on ${best.asset} (${exitReason})`;

    logger.info({ asset: best.asset, status, profit, exitReason }, "CT: real trade closed");

    await sleep(500);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────
export async function startSession(tradePercentage: number) {
  await db.update(accountsTable).set({
    autoInvestEnabled: true,
    tradePercentage:   tradePercentage.toFixed(2),
  }).where(eq(accountsTable.id, 1));

  _s = {
    ..._s,
    active:        true,
    tradePercent:  tradePercentage,
    stake:         0,
    phase:         "analyzing",
    sessionTrades: 0,
    sessionWins:   0,
    sessionProfit: 0,
    lastResult:    null,
    lastProfit:    0,
    message:       "Starting…",
  };

  if (!_loopRunning) {
    _loopRunning = true;
    loop().catch(e => { logger.error(e, "CT: loop crashed"); _loopRunning = false; });
  }
}

export async function stopSession() {
  await db.update(accountsTable).set({ autoInvestEnabled: false }).where(eq(accountsTable.id, 1));
  _s.active  = false;
  _s.phase   = "idle";
  _s.message = "Stopped by user";
}

/** Called on server start — auto-resumes an active session from DB. */
export async function initContinuousTrader() {
  const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
  if (account?.autoInvestEnabled) {
    const tradePercent = parseFloat((account.tradePercentage as string) ?? "50");
    logger.info({ tradePercent }, "CT: auto-resuming active session from DB");
    _s.active       = true;
    _s.tradePercent = tradePercent;
    _loopRunning    = true;
    loop().catch(e => { logger.error(e, "CT: loop crashed"); _loopRunning = false; });
  } else {
    logger.info("CT: no active session, standing by");
  }
}
