/**
 * Continuous Trading Engine — Real market prices, internal GHS balance
 * ─────────────────────────────────────────────────────────────────────
 * Scans BTC-USD / ETH-USD via Coinbase public API (no auth needed).
 * On a 6/8+ bullish signal it places a trade against the user's
 * internal GHS balance, holds for up to 30 seconds, then resolves
 * based on actual price movement.
 *
 * Balance is deducted immediately at trade open and refunded/settled
 * at close.
 */

import { db } from "@workspace/db";
import { accountsTable, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getKlines, getPrice, type Candle } from "./coinbaseClient";

// ─── Session status ───────────────────────────────────────────────────────
export interface SessionStatus {
  active:          boolean;
  stake:           number;
  tradePercent:    number;
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

// ─── 8-condition UP scorer ──────────────────────────────────────────────
function scoreUp(candles: Candle[]): number {
  if (candles.length < 12) return 0;
  const last   = candles[candles.length - 1];
  const prev   = candles[candles.length - 2];
  const prev2  = candles[candles.length - 3];
  const recent = candles.slice(-5);

  const rsi      = calcRSI(candles);
  const sma10    = candles.slice(-10).reduce((s, c) => s + c.close, 0) / 10;
  const bodyLast = Math.abs(last.close - last.open);
  const bodyPrev = Math.abs(prev.close - prev.open);
  const wickDown = Math.min(last.open, last.close) - last.low;
  const wickUp   = last.high - Math.max(last.open, last.close);
  const greenCnt = recent.filter(c => c.close > c.open).length;

  return [
    rsi <= 55,                       // 1. RSI not overbought (relaxed from 45 → 55)
    last.close > last.open,          // 2. Bullish candle
    greenCnt >= 3,                   // 3. 3 of last 5 candles green
    bodyLast >= bodyPrev * 0.5,      // 4. Body size maintained (relaxed from 0.75 → 0.5)
    wickDown >= wickUp * 0.5,        // 5. Buying pressure (relaxed from 0.8 → 0.5)
    last.close > sma10,              // 6. Price above SMA10
    last.low  >= prev.low  * 0.999,  // 7. Higher low (relaxed from 0.9998 → 0.999)
    prev.low  >= prev2.low * 0.999,  // 8. Sustained higher lows
  ].filter(Boolean).length;
}

// ─── Assets — Coinbase public pairs ──────────────────────────────────────
const ASSETS = ["BTC-USD", "ETH-USD"];
const MIN_SCORE = 6; // require 6/8 (strict but realistic)

async function findBestSignal(): Promise<{ asset: string; score: number } | null> {
  let best: { asset: string; score: number } | null = null;
  for (const asset of ASSETS) {
    try {
      const candles = await getKlines(asset, 30);
      const score = scoreUp(candles);
      if (!best || score > best.score) best = { asset, score };
    } catch (e) {
      logger.warn({ asset, err: (e as Error).message }, "CT: klines fetch failed, skipping asset");
    }
  }
  return best;
}

// ─── Tunables ─────────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS  = 5_000;
const TRADE_WINDOW_MS   = 30_000;  // hold up to 30 seconds
const CHECK_INTERVAL_MS = 2_000;
const TAKE_PROFIT_PCT   = 0.003;   // +0.3%
const STOP_LOSS_PCT     = 0.003;   // -0.3%
const MIN_BALANCE_GHS   = 1;       // minimum GHS balance to trade

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

    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    const tradePercent = Math.min(100, Math.max(1, parseFloat((account?.tradePercentage as string) ?? "50")));
    const ghsBalance = parseFloat(account?.balance as string ?? "0");
    _s.tradePercent = tradePercent;

    // ── Scan ─────────────────────────────────────────────────────────────
    _s.phase = "analyzing";
    _s.message = "Scanning BTC-USD / ETH-USD for a signal…";

    let best: { asset: string; score: number } | null;
    try {
      best = await findBestSignal();
    } catch (e) {
      logger.error(e, "CT: scan failed");
      _s.phase = "error"; _s.message = "Scan failed, retrying…";
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }

    if (!best || best.score < MIN_SCORE) {
      _s.asset   = best?.asset ?? "—";
      _s.upScore = best?.score ?? 0;
      _s.direction = null;
      _s.phase   = "waiting";
      _s.message = `Signal ${best?.score ?? 0}/8 on ${best?.asset ?? "—"} — need ${MIN_SCORE}/8, scanning again…`;
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }

    _s.asset   = best.asset;
    _s.upScore = best.score;
    _s.direction = "UP";

    // ── Balance check (internal GHS) ────────────────────────────────────
    if (ghsBalance < MIN_BALANCE_GHS) {
      _s.phase   = "waiting";
      _s.message = `GHS balance too low (GHS ${ghsBalance.toFixed(2)}) — deposit more to trade`;
      await sleep(15_000);
      continue;
    }

    const stake = parseFloat((ghsBalance * tradePercent / 100).toFixed(2));
    if (stake < 0.01) {
      _s.phase   = "waiting";
      _s.message = "Stake too small, increase balance or trade %";
      await sleep(10_000);
      continue;
    }
    _s.stake = stake;

    // ── Deduct stake from balance immediately ────────────────────────────
    const balanceBefore = parseFloat((await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) }))?.balance as string ?? "0");
    if (balanceBefore < stake) {
      _s.phase   = "waiting";
      _s.message = "Insufficient balance for this stake";
      await sleep(5_000);
      continue;
    }
    await db.update(accountsTable)
      .set({ balance: (balanceBefore - stake).toFixed(2) })
      .where(eq(accountsTable.id, 1));

    // ── Get real entry price ─────────────────────────────────────────────
    let entryPrice: number;
    try {
      entryPrice = await getPrice(best.asset);
    } catch (e) {
      logger.error(e, "CT: failed to get entry price — refunding stake");
      // Refund
      await db.update(accountsTable)
        .set({ balance: balanceBefore.toFixed(2) })
        .where(eq(accountsTable.id, 1));
      _s.phase = "error"; _s.message = "Could not read market price, retrying…";
      await sleep(10_000);
      continue;
    }

    _s.phase   = "trading";
    _s.message = `${best.score}/8 signal on ${best.asset} — trading GHS ${stake.toFixed(2)} at ${entryPrice.toFixed(2)}…`;
    logger.info({ asset: best.asset, score: best.score, stake, entryPrice }, "CT: trade opened");

    // ── Record trade in DB ───────────────────────────────────────────────
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
      }).returning();
      tradeId = trade.id;
    } catch (e) {
      logger.error(e, "CT: failed to record trade in DB");
    }

    // ── Monitor window ───────────────────────────────────────────────────
    const startTs = Date.now();
    let exitReason: "signal_reversed" | "take_profit" | "stop_loss" | "window_expired" = "window_expired";
    let exitPrice = entryPrice;

    while (Date.now() - startTs < TRADE_WINDOW_MS) {
      await sleep(CHECK_INTERVAL_MS);
      let price: number;
      let score: number;
      try {
        [price, score] = await Promise.all([
          getPrice(best.asset),
          getKlines(best.asset, 30).then(scoreUp),
        ]);
        exitPrice = price;
      } catch (e) {
        logger.warn(e, "CT: mid-trade check failed, holding");
        continue;
      }

      const change = (price - entryPrice) / entryPrice;
      _s.message = `Holding ${best.asset} — ${(change * 100).toFixed(3)}% since entry`;

      if (score < MIN_SCORE)              { exitReason = "signal_reversed"; exitPrice = price; break; }
      if (change >= TAKE_PROFIT_PCT)      { exitReason = "take_profit";     exitPrice = price; break; }
      if (change <= -STOP_LOSS_PCT)       { exitReason = "stop_loss";       exitPrice = price; break; }
      if (!(await isEnabled()))           { exitReason = "signal_reversed"; break; }
    }

    // ── Settle trade ─────────────────────────────────────────────────────
    const priceDiff = (exitPrice - entryPrice) / entryPrice;
    const won       = priceDiff > 0;
    // On win: return stake + profit equal to stake × |priceDiff| × 100 (capped at 100% gain)
    // On loss: return stake × (1 - |priceDiff| × 100), minimum 0
    const profitGhs = won
      ? parseFloat((stake * Math.min(priceDiff * 100, 1)).toFixed(2))
      : parseFloat((-stake * Math.min(Math.abs(priceDiff) * 100, 1)).toFixed(2));
    const returnToBalance = parseFloat((stake + profitGhs).toFixed(2));
    const status = priceDiff > 0.0001 ? "WIN" : priceDiff < -0.0001 ? "LOSS" : "DRAW";

    // Return stake ± profit to balance
    const accNow = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    const balanceNow = parseFloat(accNow?.balance as string ?? "0");
    const newBalance = Math.max(0, balanceNow + returnToBalance);

    if (tradeId) {
      await db.update(tradesTable)
        .set({
          exitPrice:  exitPrice.toString(),
          profit:     profitGhs.toFixed(4),
          status,
          exitReason,
          closedAt:   new Date(),
        })
        .where(eq(tradesTable.id, tradeId));
    }

    const newTotal   = (accNow?.totalTrades ?? 0) + 1;
    const prevWins   = Math.round(parseFloat(accNow?.winRate as string ?? "0") * (accNow?.totalTrades ?? 0) / 100);
    const newWinRate = ((prevWins + (won ? 1 : 0)) / newTotal) * 100;
    const newPnl     = parseFloat((parseFloat(accNow?.realizedPnlUsd as string ?? "0") + profitGhs).toFixed(4));

    await db.update(accountsTable).set({
      balance:        newBalance.toFixed(2),
      totalTrades:    newTotal,
      winRate:        newWinRate.toFixed(2),
      totalProfit:    (parseFloat(accNow?.totalProfit as string ?? "0") + profitGhs).toFixed(2),
      realizedPnlUsd: newPnl.toFixed(4),
    }).where(eq(accountsTable.id, 1));

    _s.lastResult   = status as "WIN" | "LOSS" | "DRAW";
    _s.lastProfit   = profitGhs;
    _s.sessionTrades++;
    if (won) _s.sessionWins++;
    _s.sessionProfit += profitGhs;
    _s.phase   = "waiting";
    _s.message = `${status === "WIN" ? "✓ WON" : status === "LOSS" ? "✗ LOST" : "= FLAT"} ${profitGhs >= 0 ? "+" : ""}GHS ${profitGhs.toFixed(2)} on ${best.asset} (${exitReason})`;

    logger.info({ asset: best.asset, status, profitGhs, exitReason, newBalance }, "CT: trade closed");
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
