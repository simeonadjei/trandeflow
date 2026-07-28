/**
 * Super Trading Engine — Golden Window + 12-Indicator Suite
 * ──────────────────────────────────────────────────────────
 * Strategy:
 *   1. On startup, analyze 30 days of 1h candles to find the ONE UTC hour
 *      that has the highest historical directional win rate ("golden window").
 *   2. Wait until that window opens (±30 min).
 *   3. Inside the window, run a strict 12-indicator suite across 4h, 1h, and 15m
 *      timeframes. Only fire if 10+/12 agree on UP.
 *   4. One trade per UTC calendar day — then rest until the next golden window.
 *
 * Outside the golden window the bot scans every 30s and shows live stats
 * but does NOT place orders.
 */

import { db } from "@workspace/db";
import { accountsTable, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  hasMexcCredentials, getFreeBalance, getKlines, getPrice,
  marketBuy, marketSell, type Candle,
} from "./mexcClient";
import {
  getGoldenWindow, isInGoldenWindow, minsToGoldenWindow,
  type GoldenWindowResult,
} from "./goldenWindow";

// ─── Tunables ────────────────────────────────────────────────────────────────
const IDLE_SCAN_MS      = 30_000;  // how often to scan outside golden window
const WINDOW_SCAN_MS    = 10_000;  // how often to scan inside the golden window
const TRADE_WINDOW_MS   = 300_000; // hold up to 5 min
const CHECK_INTERVAL_MS = 5_000;   // check TP/SL every 5s while holding
const TAKE_PROFIT_PCT   = 0.008;   // +0.8%
const STOP_LOSS_PCT     = 0.004;   // -0.4%
const PRE_TRADE_SECS    = 5;       // countdown before order fires
const MIN_SUPER_SCORE   = 10;      // primary asset must score ≥10/12
const SECONDARY_SCORE   = 7;       // secondary asset (confirmation) must score ≥7/12
const MIN_STAKE_USDT    = 5;       // MEXC minimum notional
const WIN_RATE_FLOOR    = 65;      // skip all trading if golden window win rate < 65%

// ─── Session status ───────────────────────────────────────────────────────────
export interface SessionStatus {
  active:             boolean;
  stake:              number;
  tradePercent:       number;
  phase:              "idle" | "analyzing" | "pre-trade" | "trading" | "waiting" | "golden-wait" | "error";
  asset:              string;
  direction:          "UP" | "DOWN" | null;
  /** UP indicators fired (out of 12 in super mode) */
  upScore:            number;
  /** DOWN indicators fired (out of 12 in super mode) */
  downScore:          number;
  /** 0-100 confidence derived from winning score */
  winConfidence:      number;
  /** Seconds until the pre-trade countdown fires the order */
  preTradeIn:         number;
  lastResult:         "WIN" | "LOSS" | "DRAW" | null;
  lastProfit:         number;
  sessionTrades:      number;
  sessionWins:        number;
  sessionProfit:      number;
  message:            string;
  /** Unix ms when the current open trade was placed */
  tradeStartedAt:     number | null;
  /** Max hold window in ms */
  tradeWindowMs:      number;
  /** Last 30 bot events */
  recentEvents:       string[];
  // ── Golden window fields ──────────────────────────────────────────────────
  /** Best UTC hour (0–23) determined by 90-day analysis */
  goldenHour:           number | null;
  /** Day of week (0=Sun…6=Sat) or null for hour-only mode */
  goldenWeekday:        number | null;
  /** Human-readable weekday label e.g. "Tuesday" */
  goldenWeekdayLabel:   string | null;
  /** Historical win rate at the golden slot (0–100) */
  goldenWinRate:        number | null;
  /** True if the golden window meets the ≥65% floor */
  aboveFloor:           boolean;
  /** Whether right now is within ±30 min of the golden hour (and matching weekday) */
  inGoldenWindow:       boolean;
  /** Minutes until golden window opens (0 when inside) */
  minsToGoldenWindow:   number;
  /** Already placed one trade for today (UTC date) */
  todayTraded:          boolean;
  /** How many of the 12 super indicators currently score UP */
  superScore:           number;
  /** Total super indicators evaluated (12 when inside golden window) */
  superTotal:           number;
  /** Individual indicator results */
  indicators:           Array<{ name: string; result: "UP" | "DOWN" | "NEUTRAL" }>;
  /** Whether both BTC AND ETH confirmed the signal (required for a trade) */
  bothAssetsConfirmed:  boolean;
}

// ─── In-memory event log ──────────────────────────────────────────────────────
const MAX_EVENTS = 30;
const _events: string[] = [];

function logEvent(msg: string) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const line = `[${ts}] ${msg}`;
  _events.push(line);
  if (_events.length > MAX_EVENTS) _events.shift();
  logger.info(msg);
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
  goldenHour: null, goldenWeekday: null, goldenWeekdayLabel: null,
  goldenWinRate: null, aboveFloor: false,
  inGoldenWindow: false, minsToGoldenWindow: 0,
  todayTraded: false,
  superScore: 0, superTotal: 0,
  indicators: [],
  bothAssetsConfirmed: false,
};

let _sessionStartBalanceUsdt: number | null = null;
/** Last UTC date string (YYYY-MM-DD) that a trade was placed */
let _lastTradeDate: string | null = null;

export function getSessionStatus(): SessionStatus { return { ..._s, recentEvents: [..._events] }; }

// ─── Indicator helpers ────────────────────────────────────────────────────────

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

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

function avgVolume(candles: Candle[], lookback: number): number {
  const slice = candles.slice(-lookback - 1, -1); // exclude most recent
  if (!slice.length) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

// ─── 12-Indicator Super Suite ─────────────────────────────────────────────────
interface SuperPrediction {
  direction:  "UP" | "DOWN" | null;
  upScore:    number;
  downScore:  number;
  confidence: number;
  indicators: Array<{ name: string; result: "UP" | "DOWN" | "NEUTRAL" }>;
}

async function superPredict(symbol: string): Promise<SuperPrediction> {
  const [c4h, c1h, c15m, c1m] = await Promise.all([
    getKlines(symbol, 60, "4h"),
    getKlines(symbol, 60, "1h"),
    getKlines(symbol, 30, "15m"),
    getKlines(symbol, 30, "1m"),
  ]);

  const indicators: Array<{ name: string; result: "UP" | "DOWN" | "NEUTRAL" }> = [];
  let upScore = 0;

  function vote(name: string, result: "UP" | "DOWN" | "NEUTRAL") {
    indicators.push({ name, result });
    if (result === "UP") upScore++;
  }

  // ── 4h trend backbone (indicators 1–4) ──────────────────────────────────
  if (c4h.length >= 50) {
    const c4 = c4h.map(c => c.close);
    const e9_4h  = ema(c4, 9);
    const e21_4h = ema(c4, 21);
    const e50_4h = ema(c4, 50);
    const rsi4h  = calcRSI(c4h, 14);
    const e12_4h = ema(c4, 12);
    const e26_4h = ema(c4, 26);

    // 1. EMA9 > EMA21 on 4h
    vote("EMA9>EMA21 (4h)", e9_4h > e21_4h ? "UP" : "DOWN");

    // 2. EMA21 > EMA50 on 4h (confirmed uptrend)
    vote("EMA21>EMA50 (4h)", e21_4h > e50_4h ? "UP" : "DOWN");

    // 3. RSI 40–65 on 4h (bullish but not overbought)
    if (rsi4h >= 40 && rsi4h <= 65) vote("RSI zone (4h)", "UP");
    else if (rsi4h > 65)            vote("RSI zone (4h)", "DOWN");
    else                            vote("RSI zone (4h)", "DOWN");

    // 4. MACD (EMA12 > EMA26) on 4h
    vote("MACD (4h)", e12_4h > e26_4h ? "UP" : "DOWN");
  } else {
    for (let i = 0; i < 4; i++) vote(`4h indicator ${i + 1}`, "NEUTRAL");
  }

  // ── 1h momentum (indicators 5–8) ────────────────────────────────────────
  if (c1h.length >= 50) {
    const c1  = c1h.map(c => c.close);
    const e9_1h  = ema(c1, 9);
    const e21_1h = ema(c1, 21);
    const e50_1h = ema(c1, 50);
    const rsi1h  = calcRSI(c1h, 14);
    const lastClose1h = c1h[c1h.length - 1].close;
    const volNow1h = c1h[c1h.length - 1].volume;
    const volAvg1h = avgVolume(c1h, 20);

    // 5. Price > EMA50 (1h)
    vote("Price>EMA50 (1h)", lastClose1h > e50_1h ? "UP" : "DOWN");

    // 6. EMA9 > EMA21 (1h)
    vote("EMA9>EMA21 (1h)", e9_1h > e21_1h ? "UP" : "DOWN");

    // 7. RSI 40–65 on 1h
    if (rsi1h >= 40 && rsi1h <= 65) vote("RSI zone (1h)", "UP");
    else if (rsi1h > 65)            vote("RSI zone (1h)", "DOWN");
    else                            vote("RSI zone (1h)", "DOWN");

    // 8. Volume spike: current > 1.5× 20-bar avg
    vote("Volume spike (1h)", volAvg1h > 0 && volNow1h >= volAvg1h * 1.5 ? "UP" : "NEUTRAL");
  } else {
    for (let i = 0; i < 4; i++) vote(`1h indicator ${i + 1}`, "NEUTRAL");
  }

  // ── 15m structure (indicators 9–12) ─────────────────────────────────────
  if (c15m.length >= 10) {
    const last3 = c15m.slice(-3);
    const last6 = c15m.slice(-6);
    const higherHighs = last3[1].high > last3[0].high && last3[2].high > last3[1].high;
    const lowerHighs  = last3[1].high < last3[0].high && last3[2].high < last3[1].high;
    const higherLows  = last3[1].low  > last3[0].low  && last3[2].low  > last3[1].low;
    const lowerLows   = last3[1].low  < last3[0].low  && last3[2].low  < last3[1].low;
    const greenCount  = last6.filter(c => c.close > c.open).length;
    const rsi15m      = calcRSI(c15m, 14);
    const rsi15mPrev  = calcRSI(c15m.slice(0, -3), 14);

    // 9. Higher highs (15m)
    if      (higherHighs) vote("Higher highs (15m)", "UP");
    else if (lowerHighs)  vote("Higher highs (15m)", "DOWN");
    else                  vote("Higher highs (15m)", "NEUTRAL");

    // 10. Higher lows (15m)
    if      (higherLows) vote("Higher lows (15m)", "UP");
    else if (lowerLows)  vote("Higher lows (15m)", "DOWN");
    else                 vote("Higher lows (15m)", "NEUTRAL");

    // 11. Candle majority ≥4/6 green (15m)
    if      (greenCount >= 4)               vote("Candle majority (15m)", "UP");
    else if (last6.length - greenCount >= 4) vote("Candle majority (15m)", "DOWN");
    else                                     vote("Candle majority (15m)", "NEUTRAL");

    // 12. RSI rising (15m)
    if      (rsi15m > rsi15mPrev + 2) vote("RSI rising (15m)", "UP");
    else if (rsi15m < rsi15mPrev - 2) vote("RSI rising (15m)", "DOWN");
    else                              vote("RSI rising (15m)", "NEUTRAL");
  } else {
    for (let i = 0; i < 4; i++) vote(`15m indicator ${i + 1}`, "NEUTRAL");
  }

  // Count DOWN votes (NEUTRAL doesn't count for either)
  const downScore = indicators.filter(i => i.result === "DOWN").length;
  const confidence = Math.round((upScore / 12) * 100);

  const direction: "UP" | "DOWN" | null =
    upScore >= MIN_SUPER_SCORE ? "UP" : null;

  return { direction, upScore, downScore, confidence, indicators };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Main loop ────────────────────────────────────────────────────────────────
let _loopRunning = false;

async function isEnabled(): Promise<boolean> {
  try {
    const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
    if (account === undefined || account === null) return false;
    return Boolean(account.autoInvestEnabled);
  } catch (e) {
    logger.warn(e, "CT: isEnabled() DB query failed — assuming still enabled");
    return true;
  }
}

function todayUTCString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loop() {
  // ── Step 1: Compute the golden window on startup ──────────────────────────
  logEvent("Super Bot starting — computing 30-day golden window…");
  _s.phase   = "analyzing";
  _s.message = "Computing 30-day golden window analysis…";

  const gw = await getGoldenWindow();
  if (gw) {
    _s.goldenHour         = gw.goldenHour;
    _s.goldenWeekday      = gw.goldenWeekday;
    _s.goldenWeekdayLabel = gw.goldenWeekdayLabel;
    _s.goldenWinRate      = gw.winRate;
    _s.aboveFloor         = gw.aboveFloor;
    const slotLabel = gw.goldenWeekdayLabel
      ? `${gw.goldenWeekdayLabel}s at ${String(gw.goldenHour).padStart(2, "0")}:00 UTC`
      : `${String(gw.goldenHour).padStart(2, "0")}:00 UTC (any day)`;
    logEvent(`Golden window: ${slotLabel} — ${gw.winRate}% win rate (${gw.bestSlotSamples} samples / ${gw.totalCandlesAnalyzed} candles total)${gw.aboveFloor ? "" : " — BELOW 65% FLOOR, will not trade"}`);
  } else {
    logEvent("WARN: could not compute golden window — running in standard mode");
  }

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

    // ── Loss-limit check ───────────────────────────────────────────────────
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

    // ── Refresh golden window every 6h ─────────────────────────────────────
    if (gw && Date.now() - gw.computedAt > 6 * 60 * 60 * 1000) {
      const fresh = await getGoldenWindow(true);
      if (fresh) {
        _s.goldenHour         = fresh.goldenHour;
        _s.goldenWeekday      = fresh.goldenWeekday;
        _s.goldenWeekdayLabel = fresh.goldenWeekdayLabel;
        _s.goldenWinRate      = fresh.winRate;
        _s.aboveFloor         = fresh.aboveFloor;
        logEvent(`Golden window refreshed: ${fresh.goldenWeekdayLabel ? fresh.goldenWeekdayLabel + "s at " : ""}${String(fresh.goldenHour).padStart(2, "0")}:00 UTC — ${fresh.winRate}%`);
      }
    }

    // ── Update golden window status ────────────────────────────────────────
    const inWindow = isInGoldenWindow(_s.goldenHour, _s.goldenWeekday);
    const minsAway = minsToGoldenWindow(_s.goldenHour, _s.goldenWeekday);
    _s.inGoldenWindow     = inWindow;
    _s.minsToGoldenWindow = minsAway;

    // ── Already traded today? ─────────────────────────────────────────────
    const todayStr = todayUTCString();
    const alreadyTraded = _lastTradeDate === todayStr;
    _s.todayTraded = alreadyTraded;

    if (alreadyTraded) {
      // One trade per day — rest until tomorrow's golden window
      const hoursLeft = Math.max(0, (24 * 60 - (new Date().getUTCHours() * 60 + new Date().getUTCMinutes()))) / 60;
      _s.phase   = "waiting";
      _s.message = `Today's trade done. Next golden window in ~${minsAway > 0 ? minsAway + " min" : "< 1 min"} (resets at midnight UTC)`;
      if (Math.round(hoursLeft * 10) % 300 === 0) {
        logEvent(`Today's trade complete — resting ${hoursLeft.toFixed(1)}h until tomorrow`);
      }
      await sleep(60_000);
      continue;
    }

    // ── Outside golden window — scan and wait ─────────────────────────────
    if (!inWindow) {
      const slotLabel = _s.goldenHour !== null
        ? (_s.goldenWeekdayLabel
            ? `${_s.goldenWeekdayLabel}s ${String(_s.goldenHour).padStart(2, "0")}:00 UTC`
            : `${String(_s.goldenHour).padStart(2, "0")}:00 UTC`)
        : "unknown";

      const floorNote = _s.goldenHour !== null && !_s.aboveFloor
        ? " ⚠ win rate below 65% floor — no trade"
        : "";

      _s.phase   = "golden-wait";
      _s.message = _s.goldenHour !== null
        ? `Waiting for golden window (${slotLabel}, ${_s.goldenWinRate?.toFixed(1)}% win rate${floorNote}) — opens in ${minsAway} min`
        : "Golden window not yet computed";

      // Run a quick indicator scan for live UI feedback (no trade)
      _s.phase = "analyzing";
      try {
        const pred = await superPredict("BTCUSDT");
        _s.upScore     = pred.upScore;
        _s.downScore   = pred.downScore;
        _s.superScore  = pred.upScore;
        _s.superTotal  = 12;
        _s.indicators  = pred.indicators;
        _s.asset       = "BTCUSDT";
        _s.winConfidence = pred.confidence;
        _s.direction   = pred.direction;
      } catch { /* ignore scan errors outside window */ }

      _s.phase = "golden-wait";
      _s.message = _s.goldenHour !== null
        ? `Waiting for golden window (${slotLabel}, ${_s.goldenWinRate?.toFixed(1)}% win rate${floorNote}) — opens in ${minsAway} min`
        : "Golden window not yet computed — analyzing";
      logEvent(`Outside golden window — next opens in ${minsAway} min`);
      await sleep(IDLE_SCAN_MS);
      continue;
    }

    // ── Win rate floor check — skip if golden window is weak ───────────────
    if (!_s.aboveFloor) {
      _s.phase   = "golden-wait";
      _s.message = `Golden window win rate ${_s.goldenWinRate?.toFixed(1)}% is below the 65% floor — skipping today's trade`;
      logEvent(`WARN: golden window ${_s.goldenWinRate?.toFixed(1)}% < 65% floor — no trade this window`);
      await sleep(60_000);
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // GOLDEN WINDOW IS NOW OPEN — run the 12-indicator super suite
    // ════════════════════════════════════════════════════════════════════════
    logEvent(`GOLDEN WINDOW OPEN (${String(_s.goldenHour).padStart(2, "0")}:00 UTC, ${_s.goldenWinRate?.toFixed(1)}% hist. win rate) — scanning 12 indicators…`);
    _s.phase   = "analyzing";
    _s.message = "Golden window active — running 12-indicator super suite…";

    // ── Scan BOTH BTC and ETH — BOTH must score ≥11/12 to trade ─────────────
    let predBTC: SuperPrediction | null = null;
    let predETH: SuperPrediction | null = null;

    try { predBTC = await superPredict("BTCUSDT"); } catch (e) {
      logEvent(`ERROR scanning BTCUSDT: ${(e as Error).message}`);
    }
    try { predETH = await superPredict("ETHUSDT"); } catch (e) {
      logEvent(`ERROR scanning ETHUSDT: ${(e as Error).message}`);
    }

    if (predBTC) logEvent(`BTCUSDT: UP ${predBTC.upScore}/12, conf ${predBTC.confidence}%`);
    if (predETH) logEvent(`ETHUSDT: UP ${predETH.upScore}/12, conf ${predETH.confidence}%`);

    // Show whichever asset has the higher score in the UI
    const displayPred = predBTC && predETH
      ? (predBTC.upScore >= predETH.upScore ? predBTC : predETH)
      : (predBTC ?? predETH);

    if (displayPred) {
      _s.asset         = predBTC && predBTC.upScore >= (predETH?.upScore ?? 0) ? "BTCUSDT" : "ETHUSDT";
      _s.upScore       = displayPred.upScore;
      _s.downScore     = displayPred.downScore;
      _s.superScore    = displayPred.upScore;
      _s.superTotal    = 12;
      _s.indicators    = displayPred.indicators;
      _s.winConfidence = displayPred.confidence;
      _s.direction     = displayPred.direction;
    }

    // Pick primary (higher score) and secondary (lower score)
    const btcScore = predBTC?.upScore ?? 0;
    const ethScore = predETH?.upScore ?? 0;
    const primaryAsset    = btcScore >= ethScore ? "BTCUSDT" : "ETHUSDT";
    const secondaryAsset  = primaryAsset === "BTCUSDT" ? "ETHUSDT" : "BTCUSDT";
    const primaryPred     = primaryAsset  === "BTCUSDT" ? predBTC : predETH;
    const secondaryPred   = secondaryAsset === "BTCUSDT" ? predBTC : predETH;
    const primaryScore    = primaryPred?.upScore  ?? 0;
    const secondaryScore  = secondaryPred?.upScore ?? 0;

    // Primary ≥10/12, secondary ≥7/12
    const primaryOk   = primaryPred  !== null && primaryScore  >= MIN_SUPER_SCORE;
    const secondaryOk = secondaryPred !== null && secondaryScore >= SECONDARY_SCORE;
    const bothConfirmed = primaryOk && secondaryOk;
    _s.bothAssetsConfirmed = bothConfirmed;

    if (!bothConfirmed) {
      const primStr = primaryPred  ? `${primaryAsset.replace("USDT","")} ${primaryScore}/12 (need ≥${MIN_SUPER_SCORE})`  : `${primaryAsset.replace("USDT","")} failed`;
      const secStr  = secondaryPred ? `${secondaryAsset.replace("USDT","")} ${secondaryScore}/12 (need ≥${SECONDARY_SCORE})` : `${secondaryAsset.replace("USDT","")} failed`;
      _s.phase   = "golden-wait";
      _s.message = `Dual check failed — ${primStr}, ${secStr} — retrying in 10s`;
      logEvent(`Dual-asset check: ${primStr} | ${secStr}`);
      await sleep(WINDOW_SCAN_MS);
      continue;
    }

    // Trade the primary (stronger) asset
    const asset = primaryAsset;
    const bestPred = primaryPred!;
    logEvent(`DUAL CONFIRMED: ${primaryAsset.replace("USDT","")} ${primaryScore}/12 (primary) + ${secondaryAsset.replace("USDT","")} ${secondaryScore}/12 (secondary) — trading ${asset}`);
    logEvent(`SUPER SIGNAL: ${asset} UP ${bestPred.upScore}/12 (${bestPred.confidence}% confidence) — TRADING!`);

    // ── Pre-trade countdown ───────────────────────────────────────────────
    _s.phase = "pre-trade";
    for (let t = PRE_TRADE_SECS; t > 0; t--) {
      _s.preTradeIn = t;
      _s.message    = `SUPER TRADE — ${asset} ${bestPred.confidence}% confidence — entering in ${t}s`;
      await sleep(1_000);
    }
    _s.preTradeIn = 0;

    if (!(await isEnabled())) {
      logEvent("Session stopped during countdown — skipping trade");
      continue;
    }

    // ── Balance check ─────────────────────────────────────────────────────
    logEvent(`Fetching MEXC USDT balance (${tradePercent}%)…`);
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

    const stake = Math.floor(freeUsdt * tradePercent) / 100;
    logEvent(`Stake = ${stake.toFixed(4)} USDT (${tradePercent}% of ${freeUsdt.toFixed(4)})`);
    if (stake < MIN_STAKE_USDT) {
      logEvent(`WARN: stake ${stake.toFixed(2)} USDT below MEXC minimum ${MIN_STAKE_USDT} USDT — retrying in 30s`);
      _s.phase   = "error";
      _s.message = `Balance too low: ${freeUsdt.toFixed(4)} USDT free, need ≥ ${MIN_STAKE_USDT} USDT`;
      await sleep(30_000);
      continue;
    }
    _s.stake = stake;

    // ── Execute BUY ──────────────────────────────────────────────────────
    _s.phase          = "trading";
    _s.tradeStartedAt = null;
    _s.message        = `SUPER BUY: ${asset} ${stake.toFixed(4)} USDT (${bestPred.upScore}/12 indicators)…`;
    logEvent(`Placing SUPER MARKET BUY: ${asset} ${stake.toFixed(4)} USDT…`);

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

    if (!buy.baseQty || buy.baseQty <= 0) {
      logEvent(`ERROR: BUY returned qty=0 — not filled. Retrying in 30s.`);
      _s.phase   = "error";
      _s.message = `Buy not filled (qty=0) — check MEXC Spot Trading permissions. Retrying in 30s…`;
      await sleep(30_000);
      continue;
    }

    const entryPrice  = buy.avgPrice;
    _s.tradeStartedAt = Date.now();
    // Mark today as traded IMMEDIATELY after buy so a crash doesn't double-trade
    _lastTradeDate    = todayUTCString();
    _s.todayTraded    = true;
    logEvent(`SUPER trade open: entry @ ${entryPrice} — holding up to 5 min (TP +0.8%, SL -0.4%)`);

    let tradeId: number | null = null;
    try {
      const [trade] = await db.insert(tradesTable).values({
        accountId:  1, symbol: asset, direction: "UP",
        amount:     stake.toFixed(2),
        duration:   Math.round(TRADE_WINDOW_MS / 1000),
        entryPrice: entryPrice.toString(),
        payout:     "100", status: "OPEN",
        isAuto: true, isDemo: false,
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
      try { price = await getPrice(asset); }
      catch { logEvent(`WARN: price check failed mid-trade — holding`); continue; }

      const change   = (price - entryPrice) / entryPrice;
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
    logEvent(`SUPER trade closed: ${status} ${profitUsdt >= 0 ? "+" : ""}${profitUsdt.toFixed(4)} USDT`);

    if (tradeId) {
      await db.update(tradesTable)
        .set({ exitPrice: sell.avgPrice.toString(), profit: profitUsdt.toFixed(4), status, sellOrderId: sell.orderId, exitReason, closedAt: new Date() })
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
      await db.update(accountsTable)
        .set({ totalTrades: newTotal, winRate: newWinRate.toFixed(2), realizedPnlUsd: newPnl.toFixed(4), totalProfit: newProfit.toFixed(4) })
        .where(eq(accountsTable.id, 1));
    }

    _s.lastResult     = status as "WIN" | "LOSS" | "DRAW";
    _s.lastProfit     = profitUsdt;
    _s.tradeStartedAt = null;
    _s.sessionTrades++;
    if (won) _s.sessionWins++;
    _s.sessionProfit += profitUsdt;
    _s.phase   = "waiting";
    _s.message = `${won ? "✓ WON" : profitUsdt < 0 ? "✗ LOST" : "= FLAT"} ${profitUsdt >= 0 ? "+" : ""}${profitUsdt.toFixed(4)} USDT on ${asset} (${exitReason}) — resting until next golden window`;

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
    message:       "Starting super bot…",
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

export async function initContinuousTrader() {
  const account = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
  if (account?.autoInvestEnabled) {
    const tradePercent = parseFloat((account.tradePercentage as string) ?? "50");
    logger.info({ tradePercent }, "CT: auto-resuming super bot from DB");
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
