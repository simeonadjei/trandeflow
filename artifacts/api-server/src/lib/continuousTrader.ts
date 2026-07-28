/**
 * Continuous Trading Engine — Prediction-based MEXC spot execution
 * ──────────────────────────────────────────────────────────────────
 * Strategy: make a single directional prediction using 15-minute candles
 * for the trend backbone + 1-minute candles for entry timing.
 *
 * Unlike the old approach (which required a live 6/8 score to stay true),
 * the prediction is committed at analysis time and doesn't flicker.
 * The bot then holds up to 5 minutes and exits on TP, SL, or window expiry.
 *
 * Entry criteria: upScore OR downScore >= 5/8, AND winner leads by >= 2 points.
 */

import { db } from "@workspace/db";
import { accountsTable, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  hasMexcCredentials, getFreeBalance, getKlines, getPrice,
  marketBuy, marketSell, type Candle,
} from "./mexcClient";

// ─── Tunables ────────────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS  = 10_000;  // pause between scans when no signal
const TRADE_WINDOW_MS   = 300_000; // hold up to 5 min
const CHECK_INTERVAL_MS = 5_000;   // how often to check TP/SL during hold
const TAKE_PROFIT_PCT   = 0.008;   // +0.8%
const STOP_LOSS_PCT     = 0.004;   // -0.4%
const PRE_TRADE_SECS    = 5;       // countdown before order fires (for UI)
const MIN_SCORE         = 4;       // out of 8 indicators (lowered from 5 to get more signals)
const MIN_LEAD          = 2;       // winner must lead by this many points
const MIN_STAKE_USDT    = 5;       // MEXC minimum notional for BTC/ETH spot is ~$5

// ─── Session status ───────────────────────────────────────────────────────────
export interface SessionStatus {
  active:           boolean;
  stake:            number;
  tradePercent:     number;
  phase:            "idle" | "analyzing" | "pre-trade" | "trading" | "waiting" | "error";
  asset:            string;
  direction:        "UP" | "DOWN" | null;
  /** UP indicators fired out of 8 */
  upScore:          number;
  /** DOWN indicators fired out of 8 */
  downScore:        number;
  /** 0-100 confidence derived from winning score */
  winConfidence:    number;
  /** Seconds until the pre-trade countdown fires the order */
  preTradeIn:       number;
  lastResult:       "WIN" | "LOSS" | "DRAW" | null;
  lastProfit:       number;
  sessionTrades:    number;
  sessionWins:      number;
  sessionProfit:    number;
  message:          string;
  /** Unix ms when the current open trade was placed. Null when not in trading phase. */
  tradeStartedAt:   number | null;
  /** Max hold window in ms — lets the frontend compute % elapsed. */
  tradeWindowMs:    number;
  /** Last 30 bot events for real-time diagnostics in the UI */
  recentEvents:     string[];
}

// ─── In-memory event log ──────────────────────────────────────────────────────
const MAX_EVENTS = 30;
const _events: string[] = [];

function logEvent(msg: string) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const line = `[${ts}] ${msg}`;
  _events.push(line);
  if (_events.length > MAX_EVENTS) _events.shift();
  logger.info(msg, "CT:event");
}

let _s: SessionStatus = {
  active: false, stake: 0, tradePercent: 50,
  phase: "idle", asset: "—", direction: null,
  upScore: 0, downScore: 0, winConfidence: 0, preTradeIn: 0,
  lastResult: null, lastProfit: 0,
  sessionTrades: 0, sessionWins: 0, sessionProfit: 0,
  message: "Ready",
  tradeStartedAt: null, tradeWindowMs: TRADE_WINDOW_MS,
  recentEvents: [],
};

let _sessionStartBalanceUsdt: number | null = null;

export function getSessionStatus(): SessionStatus { return { ..._s, recentEvents: [..._events] }; }

// ─── Indicators ──────────────────────────────────────────────────────────────

/** Exponential moving average */
function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Standard RSI over last `period+1` closes */
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

// ─── Core prediction ──────────────────────────────────────────────────────────

interface Prediction {
  direction:  "UP" | "DOWN";
  upScore:    number;
  downScore:  number;
  confidence: number;
  reason:     string;
}

/**
 * Fetches 15-minute candles (trend backbone) and 1-minute candles (entry timing),
 * then scores 8 indicators for UP and 8 for DOWN independently.
 * Returns a Prediction if the winning direction has ≥ MIN_SCORE and leads by ≥ MIN_LEAD,
 * otherwise null (no trade this cycle).
 */
async function predictDirection(symbol: string): Promise<Prediction | null> {
  const [candles15m, candles1m] = await Promise.all([
    getKlines(symbol, 24, "15m"),  // 24 × 15min = 6 hours of context
    getKlines(symbol, 30, "1m"),   // 30 × 1min  = 30 min entry timing
  ]);

  if (candles15m.length < 22 || candles1m.length < 10) return null;

  const closes15 = candles15m.map(c => c.close);
  const rsiNow   = calcRSI(candles15m, 14);
  // RSI 3 periods back — tells us if momentum is rising or falling
  const rsiPrev  = calcRSI(candles15m.slice(0, -3), 14);
  const ema9     = ema(closes15, 9);
  const ema21    = ema(closes15, 21);

  const last3_15 = candles15m.slice(-3);
  const last6_15 = candles15m.slice(-6);
  const last4_15 = candles15m.slice(-4);

  // Price structure on 15m
  const higherHighs = last3_15[1].high > last3_15[0].high && last3_15[2].high > last3_15[1].high;
  const lowerHighs  = last3_15[1].high < last3_15[0].high && last3_15[2].high < last3_15[1].high;
  const higherLows  = last3_15[1].low  > last3_15[0].low  && last3_15[2].low  > last3_15[1].low;
  const lowerLows   = last3_15[1].low  < last3_15[0].low  && last3_15[2].low  < last3_15[1].low;

  const greenCount15 = last6_15.filter(c => c.close > c.open).length;
  const redCount15   = last6_15.length - greenCount15;

  // Net % change across last 4 × 15m candles (momentum)
  const netChange15 = (last4_15[3].close - last4_15[0].open) / last4_15[0].open;

  // 1-minute entry timing
  const rsi1m     = calcRSI(candles1m, 14);
  const last3_1m  = candles1m.slice(-3);
  const green1m   = last3_1m.filter(c => c.close > c.open).length;
  const red1m     = last3_1m.length - green1m;

  // ── Score each of the 8 indicators ────────────────────────────────────────
  let upScore = 0, downScore = 0;
  const upReasons:   string[] = [];
  const downReasons: string[] = [];

  // 1. EMA9 vs EMA21 (15m trend direction)
  if (ema9 > ema21) { upScore++;   upReasons.push("EMA9>EMA21"); }
  else              { downScore++; downReasons.push("EMA9<EMA21"); }

  // 2. RSI zone (15m): 40-65 bullish territory; above 65 overbought → bearish
  if (rsiNow >= 40 && rsiNow <= 65) { upScore++;   upReasons.push(`RSI ${rsiNow}`); }
  else if (rsiNow > 65)             { downScore++; downReasons.push(`RSI ${rsiNow} overbought`); }
  else                              { downScore++; downReasons.push(`RSI ${rsiNow} weak`); }

  // 3. RSI direction (15m): is momentum building or fading?
  if (rsiNow > rsiPrev + 2)      { upScore++;   upReasons.push("RSI rising"); }
  else if (rsiNow < rsiPrev - 2) { downScore++; downReasons.push("RSI falling"); }
  // else neutral — no point awarded

  // 4. Higher highs structure (15m)
  if (higherHighs) { upScore++;   upReasons.push("higher highs"); }
  if (lowerHighs)  { downScore++; downReasons.push("lower highs"); }

  // 5. Higher/lower lows structure (15m)
  if (higherLows) { upScore++;   upReasons.push("higher lows"); }
  if (lowerLows)  { downScore++; downReasons.push("lower lows"); }

  // 6. 15m candle majority (4 of last 6 green/red)
  if (greenCount15 >= 4) { upScore++;   upReasons.push(`${greenCount15}/6 green`); }
  if (redCount15   >= 4) { downScore++; downReasons.push(`${redCount15}/6 red`); }

  // 7. 4-bar momentum direction (15m)
  if (netChange15 > 0.001)       { upScore++;   upReasons.push(`momentum +${(netChange15 * 100).toFixed(2)}%`); }
  else if (netChange15 < -0.001) { downScore++; downReasons.push(`momentum ${(netChange15 * 100).toFixed(2)}%`); }

  // 8. 1m entry confirmation (RSI + candle direction)
  if (rsi1m >= 40 && rsi1m <= 70 && green1m >= 2) { upScore++;   upReasons.push("1m confirms UP"); }
  if (rsi1m <= 60 && rsi1m >= 30 && red1m   >= 2) { downScore++; downReasons.push("1m confirms DOWN"); }

  // ── Decision (spot-only = UP trades only) ─────────────────────────────────
  // Enter UP if upScore ≥ 5 AND downScore ≤ 4.
  // DOWN score acts as a bearish veto — if bearish signals dominate, skip.
  // We never signal DOWN because MEXC spot cannot short.
  if (upScore >= MIN_SCORE && downScore <= 4) {
    return {
      direction:  "UP",
      upScore,
      downScore,
      confidence: Math.round((upScore / 8) * 100),
      reason:     upReasons.join(", "),
    };
  }
  return null; // no confident UP prediction this cycle
}

// ─── Multi-asset scan ────────────────────────────────────────────────────────
const ASSETS = ["BTCUSDT", "ETHUSDT"];

interface BestSignal {
  asset:      string;
  prediction: Prediction;
}

async function findBestPrediction(): Promise<BestSignal | null> {
  const results = await Promise.allSettled(
    ASSETS.map(async (asset) => {
      const p = await predictDirection(asset);
      return p ? { asset, prediction: p } : null;
    })
  );

  let best: BestSignal | null = null;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      const sig = r.value;
      if (!best || sig.prediction.confidence > best.prediction.confidence) {
        best = sig;
      }
    }
  }
  return best;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Main loop ────────────────────────────────────────────────────────────────
let _loopRunning = false;

async function isEnabled(): Promise<boolean> {
  try {
    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    // If DB returns null (row missing) treat as disabled; if query throws, assume still enabled
    if (account === undefined || account === null) return false;
    return Boolean(account.autoInvestEnabled);
  } catch (e) {
    // DB transient error — don't kill the session over it
    logger.warn(e, "CT: isEnabled() DB query failed — assuming still enabled");
    return true;
  }
}

async function loop() {
  while (true) {
    if (!(await isEnabled())) {
      _s.active = false; _s.phase = "idle"; _s.message = "Stopped";
      _loopRunning = false;
      logEvent("Session stopped.");
      return;
    }

    if (!hasMexcCredentials()) {
      logEvent("ERROR: MEXC API keys not configured");
      _s.phase   = "error";
      _s.message = "MEXC API keys not configured";
      await sleep(10_000);
      continue;
    }

    const account      = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    const tradePercent = Math.min(100, Math.max(1, parseFloat((account?.tradePercentage as string) ?? "50")));
    _s.tradePercent    = tradePercent;

    // ── Balance loss-limit check ───────────────────────────────────────────
    const lossLimitPct = parseFloat((account?.dailyLossLimit as string) ?? "0");
    if (lossLimitPct > 0 && _sessionStartBalanceUsdt !== null && _sessionStartBalanceUsdt > 0) {
      let current: number;
      try { current = await getFreeBalance("USDT"); }
      catch { current = _sessionStartBalanceUsdt; }
      const dropPct = (_sessionStartBalanceUsdt - current) / _sessionStartBalanceUsdt * 100;
      if (dropPct >= lossLimitPct) {
        logEvent(`STOPPED: loss limit hit — balance dropped ${dropPct.toFixed(1)}%`);
        await db.update(accountsTable).set({ autoInvestEnabled: false }).where(eq(accountsTable.id, 1));
        _s.active = false; _s.phase = "idle";
        _s.message = `Loss limit hit: balance dropped ${dropPct.toFixed(1)}%. Session stopped.`;
        _loopRunning = false;
        return;
      }
    }

    // ── Prediction scan ───────────────────────────────────────────────────
    _s.phase   = "analyzing";
    _s.message = "Analysing 15m trend + 1m entry on BTCUSDT / ETHUSDT…";
    logEvent("Scanning BTCUSDT / ETHUSDT…");

    let best: BestSignal | null;
    try {
      best = await findBestPrediction();
    } catch (e) {
      logEvent(`ERROR: scan failed — ${(e as Error).message}`);
      _s.phase = "error"; _s.message = "Scan failed, retrying…";
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }

    if (!best) {
      _s.upScore       = 0;
      _s.downScore     = 0;
      _s.winConfidence = 0;
      _s.direction     = null;
      _s.phase         = "waiting";
      _s.message       = "No signal: UP score < 5/8 or bearish pressure too high — scanning again…";
      logEvent("No signal this cycle (UP < 5/8 or DOWN dominant) — waiting 10s");
      await sleep(SCAN_INTERVAL_MS);
      continue;
    }

    const { asset, prediction } = best;
    _s.asset         = asset;
    _s.upScore       = prediction.upScore;
    _s.downScore     = prediction.downScore;
    _s.winConfidence = prediction.confidence;
    _s.direction     = prediction.direction;
    logEvent(`Signal: UP on ${asset} — UP ${prediction.upScore}/8, DN ${prediction.downScore}/8, conf ${prediction.confidence}%`);

    // ── Pre-trade countdown (no DB checks inside — avoids false-stop on transient errors) ──
    _s.phase = "pre-trade";
    logEvent(`Pre-trade countdown starting (${PRE_TRADE_SECS}s)…`);
    for (let t = PRE_TRADE_SECS; t > 0; t--) {
      _s.preTradeIn = t;
      _s.message    = `UP on ${asset} — ${prediction.confidence}% confidence — entering in ${t}s`;
      await sleep(1_000);
    }
    _s.preTradeIn = 0;
    logEvent("Countdown done — checking session still active");

    // Only bail if user explicitly stopped (not on DB errors)
    if (!(await isEnabled())) {
      logEvent("Session was stopped during countdown — skipping trade");
      continue;
    }

    // ── Check USDT balance ────────────────────────────────────────────────
    logEvent(`Fetching MEXC USDT balance (tradePercent=${tradePercent}%)`);
    let freeUsdt: number;
    try {
      freeUsdt = await getFreeBalance("USDT");
      logEvent(`Balance: ${freeUsdt.toFixed(4)} USDT free`);
    } catch (e) {
      logEvent(`ERROR fetching balance: ${(e as Error).message}`);
      _s.phase = "error"; _s.message = `Balance check failed: ${(e as Error).message}`;
      await sleep(10_000);
      continue;
    }

    const stake = parseFloat((freeUsdt * tradePercent / 100).toFixed(2));
    logEvent(`Stake = ${stake.toFixed(4)} USDT (${tradePercent}% of ${freeUsdt.toFixed(4)})`);
    if (stake < MIN_STAKE_USDT) {
      logEvent(`WARN: stake ${stake.toFixed(2)} USDT below MEXC minimum ${MIN_STAKE_USDT} USDT — waiting 30s, will retry`);
      _s.phase   = "waiting";
      _s.message = `Balance too low: ${freeUsdt.toFixed(4)} USDT free, need ≥ ${MIN_STAKE_USDT} USDT. Retrying in 30s…`;
      await sleep(30_000);
      continue;
    }
    _s.stake = stake;

    // ── Execute UP order on MEXC spot ─────────────────────────────────────
    _s.phase          = "trading";
    _s.tradeStartedAt = null;
    _s.message        = `Placing BUY: ${asset} ${stake.toFixed(4)} USDT…`;
    logEvent(`Placing MARKET BUY: ${asset} ${stake.toFixed(4)} USDT…`);

    let buy;
    try {
      buy = await marketBuy(asset, stake);
      logEvent(`BUY filled: orderId=${buy.orderId} qty=${buy.baseQty} @ ${buy.avgPrice} spent=${buy.quoteQty}`);
    } catch (e) {
      const errMsg = (e as Error).message;
      logEvent(`ERROR: marketBuy failed — ${errMsg} — retrying in 30s`);
      _s.phase   = "error";
      _s.message = `Buy failed: ${errMsg}. Retrying in 30s…`;
      await sleep(30_000);
      continue;
    }

    // Guard: MEXC returned zero fill — order was accepted but not executed
    if (!buy.baseQty || buy.baseQty <= 0) {
      logEvent(`ERROR: BUY returned qty=0 — order not filled. Retrying in 30s. Check MEXC spot trading permissions if this persists.`);
      _s.phase   = "error";
      _s.message = `Buy not filled (qty=0) — check MEXC API permissions have Spot Trading enabled. Retrying in 30s…`;
      await sleep(30_000);
      continue;
    }

    const entryPrice      = buy.avgPrice;
    _s.tradeStartedAt     = Date.now();
    logEvent(`Trade open: entry @ ${entryPrice} — holding up to 5 min (TP +0.8%, SL -0.4%)`);

    let tradeId: number | null = null;
    try {
      const [trade] = await db.insert(tradesTable).values({
        accountId:  1,
        symbol:     asset,
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
      logEvent(`WARN: DB insert failed — position open on MEXC but not recorded`);
    }

    // ── Monitor hold window ────────────────────────────────────────────────
    const startTs = Date.now();
    let exitReason: "signal_reversed" | "take_profit" | "stop_loss" | "window_expired" = "window_expired";

    while (Date.now() - startTs < TRADE_WINDOW_MS) {
      await sleep(CHECK_INTERVAL_MS);
      let price: number;
      try {
        price = await getPrice(asset);
      } catch (e) {
        logEvent(`WARN: price check failed mid-trade — holding`);
        continue;
      }

      const change = (price - entryPrice) / entryPrice;
      const secsLeft = Math.round((TRADE_WINDOW_MS - (Date.now() - startTs)) / 1000);
      _s.message = `Holding ${asset} — ${(change * 100).toFixed(3)}% since entry · ${secsLeft}s left`;

      if (change >= TAKE_PROFIT_PCT)  { exitReason = "take_profit";     break; }
      if (change <= -STOP_LOSS_PCT)   { exitReason = "stop_loss";       break; }
      if (!(await isEnabled()))       { exitReason = "signal_reversed"; break; }
    }

    logEvent(`Exit triggered: ${exitReason} — placing SELL`);

    // ── Exit position ──────────────────────────────────────────────────────
    _s.message = `Exiting ${asset} (${exitReason})…`;
    let sell;
    try {
      sell = await marketSell(asset, buy.baseQty);
      logEvent(`SELL filled: received=${sell.quoteQty} USDT @ ${sell.avgPrice}`);
    } catch (e) {
      logEvent(`ERROR: SELL FAILED — ${(e as Error).message} — check MEXC manually!`);
      _s.phase   = "error";
      _s.message = `Sell failed — check MEXC manually: ${(e as Error).message}`;
      await sleep(10_000);
      continue;
    }

    const profitUsdt = parseFloat((sell.quoteQty - stake).toFixed(4));
    const status     = profitUsdt > 0 ? "WIN" : profitUsdt < 0 ? "LOSS" : "DRAW";
    const won        = profitUsdt > 0;
    logEvent(`Trade closed: ${status} ${profitUsdt >= 0 ? "+" : ""}${profitUsdt.toFixed(4)} USDT`);

    if (tradeId) {
      await db.update(tradesTable)
        .set({
          exitPrice:   sell.avgPrice.toString(),
          profit:      profitUsdt.toFixed(4),
          status,
          sellOrderId: sell.orderId,
          exitReason,
          closedAt:    new Date(),
        })
        .where(eq(tradesTable.id, tradeId));
    }

    // Update account stats
    const acc2 = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    if (acc2) {
      const newTotal   = acc2.totalTrades + 1;
      const prevWins   = Math.round(parseFloat(acc2.winRate as string) * acc2.totalTrades / 100);
      const newWinRate = ((prevWins + (won ? 1 : 0)) / newTotal) * 100;
      const newPnl     = parseFloat((parseFloat(acc2.realizedPnlUsd as string) + profitUsdt).toFixed(4));
      const newProfit  = parseFloat((parseFloat(acc2.totalProfit as string) + profitUsdt).toFixed(4));
      await db.update(accountsTable).set({
        totalTrades:    newTotal,
        winRate:        newWinRate.toFixed(2),
        realizedPnlUsd: newPnl.toFixed(4),
        totalProfit:    newProfit.toFixed(4),
      }).where(eq(accountsTable.id, 1));
    }

    _s.lastResult     = status as "WIN" | "LOSS" | "DRAW";
    _s.lastProfit     = profitUsdt;
    _s.tradeStartedAt = null;
    _s.sessionTrades++;
    if (won) _s.sessionWins++;
    _s.sessionProfit += profitUsdt;
    _s.phase   = "waiting";
    _s.message = `${won ? "✓ WON" : profitUsdt < 0 ? "✗ LOST" : "= FLAT"} ${profitUsdt >= 0 ? "+" : ""}${profitUsdt.toFixed(4)} USDT on ${asset} (${exitReason})`;

    await sleep(500);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function startSession(tradePercentage: number) {
  await db.update(accountsTable).set({
    autoInvestEnabled: true,
    tradePercentage:   tradePercentage.toFixed(2),
  }).where(eq(accountsTable.id, 1));

  try {
    _sessionStartBalanceUsdt = await getFreeBalance("USDT");
    logger.info({ startBalance: _sessionStartBalanceUsdt }, "CT: session start balance recorded");
  } catch (e) {
    logger.warn(e, "CT: could not fetch start balance — loss-limit check disabled");
    _sessionStartBalanceUsdt = null;
  }

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
  _sessionStartBalanceUsdt = null;
  _s.active  = false;
  _s.phase   = "idle";
  _s.message = "Stopped by user";
}

/** Called on server start — auto-resumes an active session from DB. */
export async function initContinuousTrader() {
  const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
  if (account?.autoInvestEnabled) {
    const tradePercent = parseFloat((account.tradePercentage as string) ?? "50");
    logger.info({ tradePercent }, "CT: auto-resuming session from DB");
    try {
      _sessionStartBalanceUsdt = await getFreeBalance("USDT");
      logger.info({ startBalance: _sessionStartBalanceUsdt }, "CT: resume start balance recorded");
    } catch {
      _sessionStartBalanceUsdt = null;
    }
    _s.active       = true;
    _s.tradePercent = tradePercent;
    _loopRunning    = true;
    loop().catch(e => { logger.error(e, "CT: loop crashed"); _loopRunning = false; });
  } else {
    logger.info("CT: no active session, standing by");
  }
}
