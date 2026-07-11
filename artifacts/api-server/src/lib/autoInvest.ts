import { db } from "@workspace/db";
import { accountsTable, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ─── Assets ───────────────────────────────────────────────────────────────────
const ASSETS = [
  { symbol: "EURUSD",  price: 1.08542  },
  { symbol: "BTCUSD",  price: 67340.50 },
  { symbol: "GBPUSD",  price: 1.27180  },
  { symbol: "ETHUSD",  price: 3412.80  },
  { symbol: "XAUUSD",  price: 2318.40  },
  { symbol: "USDJPY",  price: 156.720  },
];

// ─── Scan status exposed to API ───────────────────────────────────────────────
export interface ConditionResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ScanStatus {
  scanning: boolean;
  lastScanned: string;       // ISO timestamp
  asset: string;
  direction: "UP" | "DOWN" | null;
  conditionsPassed: number;  // 0–8
  conditions: ConditionResult[];
  verdict: "HUNTING" | "PERFECT" | "SKIPPED";
  nextScanIn: number;        // seconds
  tradesToday: number;
  totalWon: number;
}

let _scanStatus: ScanStatus = {
  scanning: false,
  lastScanned: new Date().toISOString(),
  asset: "—",
  direction: null,
  conditionsPassed: 0,
  conditions: [],
  verdict: "HUNTING",
  nextScanIn: 30,
  tradesToday: 0,
  totalWon: 0,
};

export function getScanStatus(): ScanStatus { return _scanStatus; }

// ─── Price helpers ────────────────────────────────────────────────────────────
function livePrice(base: number) {
  return base + (Math.random() - 0.5) * base * 0.002;
}

interface Candle {
  open: number; close: number;
  high: number; low: number;
  volume: number;
}

function generateCandles(basePrice: number, count = 30): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const move = (Math.random() - 0.47) * basePrice * 0.0035;
    const close = open + move;
    candles.push({
      open,
      close,
      high:   Math.max(open, close) + Math.random() * basePrice * 0.001,
      low:    Math.min(open, close) - Math.random() * basePrice * 0.001,
      volume: Math.floor(Math.random() * 5000) + 1000,
    });
    price = close;
  }
  return candles;
}

// ─── RSI (14-period) ──────────────────────────────────────────────────────────
function calcRSI(candles: Candle[]): number {
  const slice = candles.slice(-15);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i].close - slice[i - 1].close;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Math.round(100 - 100 / (1 + rs));
}

// ─── 8-Condition Sniper Analysis ─────────────────────────────────────────────
function analyzeSniper(candles: Candle[]): {
  signal: "UP" | "DOWN" | null;
  conditions: ConditionResult[];
  allPassed: boolean;
} {
  const last   = candles[candles.length - 1];
  const prev   = candles[candles.length - 2];
  const prev2  = candles[candles.length - 3];
  const recent = candles.slice(-5);

  const isGreen  = (c: Candle) => c.close > c.open;
  const bodySize = (c: Candle) => Math.abs(c.close - c.open);
  const rsi      = calcRSI(candles);

  const upCount   = recent.filter(isGreen).length;
  const downCount = recent.filter(c => !isGreen(c)).length;

  const wickDown = Math.min(last.open, last.close) - last.low;
  const wickUp   = last.high - Math.max(last.open, last.close);

  // Identify dominant direction from pattern + trend
  let dominantDir: "UP" | "DOWN" | null = null;
  if (upCount >= 4)   dominantDir = "UP";
  if (downCount >= 4) dominantDir = "DOWN";

  // C1: Strong reversal or continuation pattern
  let patternName = "None";
  let patternDir: "UP" | "DOWN" | null = null;
  if (wickDown > bodySize(last) * 2.5 && isGreen(last)) {
    patternName = "Hammer"; patternDir = "UP";
  } else if (wickUp > bodySize(last) * 2.5 && !isGreen(last)) {
    patternName = "Shooting Star"; patternDir = "DOWN";
  } else if (isGreen(last) && bodySize(last) > bodySize(prev) * 1.8 && !isGreen(prev)) {
    patternName = "Bullish Engulfing"; patternDir = "UP";
  } else if (!isGreen(last) && bodySize(last) > bodySize(prev) * 1.8 && isGreen(prev)) {
    patternName = "Bearish Engulfing"; patternDir = "DOWN";
  } else if (upCount === 5) {
    patternName = "5-candle Bull Run"; patternDir = "UP";
  } else if (downCount === 5) {
    patternName = "5-candle Bear Run"; patternDir = "DOWN";
  }
  const c1: ConditionResult = {
    name:   "Strong Pattern",
    passed: patternDir !== null,
    detail: patternDir ? `${patternName} → ${patternDir}` : "No clear pattern",
  };

  // Signal direction is whichever we detected
  const signal = patternDir ?? dominantDir;

  // C2: RSI Extreme
  const rsiPassed = signal === "UP" ? rsi <= 30 : signal === "DOWN" ? rsi >= 70 : false;
  const c2: ConditionResult = {
    name:   "RSI Extreme",
    passed: rsiPassed,
    detail: `RSI ${rsi} — need ${signal === "UP" ? "≤30 (oversold)" : signal === "DOWN" ? "≥70 (overbought)" : "signal first"}`,
  };

  // C3: Full trend alignment — 4 of last 5 candles match signal
  const trendAligned = signal === "UP" ? upCount >= 4 : signal === "DOWN" ? downCount >= 4 : false;
  const c3: ConditionResult = {
    name:   "Trend Alignment",
    passed: trendAligned,
    detail: signal === "UP" ? `${upCount}/5 green candles` : `${downCount}/5 red candles`,
  };

  // C4: Momentum acceleration — body sizes growing last 3 candles
  const b1 = bodySize(prev2);
  const b2 = bodySize(prev);
  const b3 = bodySize(last);
  const momentumAccel = b3 > b2 && b2 > b1 * 0.9;
  const c4: ConditionResult = {
    name:   "Momentum Building",
    passed: momentumAccel,
    detail: `Body sizes: ${b1.toFixed(5)} → ${b2.toFixed(5)} → ${b3.toFixed(5)}`,
  };

  // C5: Volume surge — last candle volume > 1.8× average of prev 5
  const avgVol = recent.slice(0, 4).reduce((s, c) => s + c.volume, 0) / 4;
  const volSurge = last.volume > avgVol * 1.8;
  const c5: ConditionResult = {
    name:   "Volume Surge",
    passed: volSurge,
    detail: `Last: ${last.volume} vs avg: ${avgVol.toFixed(0)} (need 1.8×)`,
  };

  // C6: Price structure — higher highs (BUY) or lower lows (SELL)
  const hh = last.high > prev.high && prev.high > prev2.high;
  const ll = last.low  < prev.low  && prev.low  < prev2.low;
  const priceStructure = signal === "UP" ? hh : signal === "DOWN" ? ll : false;
  const c6: ConditionResult = {
    name:   "Price Structure",
    passed: priceStructure,
    detail: signal === "UP" ? (hh ? "Higher Highs confirmed" : "No higher highs") : (ll ? "Lower Lows confirmed" : "No lower lows"),
  };

  // C7: Confirmation — last 2 candles both confirm signal
  const last2Confirm = signal === "UP"
    ? (isGreen(last) && isGreen(prev))
    : signal === "DOWN"
    ? (!isGreen(last) && !isGreen(prev))
    : false;
  const c7: ConditionResult = {
    name:   "Double Candle Confirm",
    passed: last2Confirm,
    detail: last2Confirm ? "Last 2 candles confirm direction" : "Conflicting candles",
  };

  // C8: Signal–trend convergence — pattern direction matches overall trend
  const convergence = patternDir !== null && patternDir === dominantDir;
  const c8: ConditionResult = {
    name:   "Signal Convergence",
    passed: convergence,
    detail: convergence
      ? `Pattern (${patternDir}) matches trend`
      : `Pattern (${patternDir ?? "none"}) vs trend (${dominantDir ?? "none"})`,
  };

  const conditions = [c1, c2, c3, c4, c5, c6, c7, c8];
  const allPassed  = conditions.every(c => c.passed) && signal !== null;

  return { signal: allPassed ? signal : null, conditions, allPassed };
}

// ─── Main scan cycle ──────────────────────────────────────────────────────────
let _tradesToday = 0;
let _totalWon    = 0;
let _nextScanAt  = Date.now();

async function runSniperCycle() {
  _scanStatus.scanning = true;

  try {
    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, 1),
    });
    if (!account || !account.autoInvestEnabled) {
      _scanStatus.scanning = false;
      _scanStatus.verdict  = "HUNTING";
      return;
    }

    const balance = parseFloat(account.balance as string);
    if (balance < 1) {
      logger.info("Sniper: balance too low to trade");
      _scanStatus.scanning = false;
      return;
    }

    // Scan ALL assets, pick the one with best (or first perfect) signal
    let bestAsset    = ASSETS[Math.floor(Math.random() * ASSETS.length)];
    let bestCandles  = generateCandles(bestAsset.price);
    let bestAnalysis = analyzeSniper(bestCandles);

    for (const asset of ASSETS) {
      const candles  = generateCandles(asset.price);
      const analysis = analyzeSniper(candles);
      const passed   = analysis.conditions.filter(c => c.passed).length;
      const bestPassed = bestAnalysis.conditions.filter(c => c.passed).length;
      if (passed > bestPassed) {
        bestAsset = asset; bestCandles = candles; bestAnalysis = analysis;
      }
      if (bestAnalysis.allPassed) break; // found perfect — stop scanning
    }

    const conditionsPassed = bestAnalysis.conditions.filter(c => c.passed).length;

    _scanStatus = {
      scanning:         false,
      lastScanned:      new Date().toISOString(),
      asset:            bestAsset.symbol,
      direction:        bestAnalysis.signal,
      conditionsPassed,
      conditions:       bestAnalysis.conditions,
      verdict:          bestAnalysis.allPassed ? "PERFECT" : "HUNTING",
      nextScanIn:       30,
      tradesToday:      _tradesToday,
      totalWon:         _totalWon,
    };

    if (!bestAnalysis.allPassed || !bestAnalysis.signal) {
      logger.info({ asset: bestAsset.symbol, conditionsPassed }, "Sniper: no perfect signal, waiting…");
      return;
    }

    // ── ALL 8 CONDITIONS PASSED → FIRE ──────────────────────────────────────
    const signal     = bestAnalysis.signal;
    const stake      = balance; // 100% of account balance
    const entryPrice = livePrice(bestAsset.price);
    const payout     = 100; // user keeps 100% of profit on win
    const duration   = 60; // always 1 minute

    logger.info({ asset: bestAsset.symbol, signal, stake, conditionsPassed }, "Sniper: PERFECT SIGNAL — placing trade with full balance");

    const [trade] = await db.insert(tradesTable).values({
      accountId:  1,
      symbol:     bestAsset.symbol,
      direction:  signal,
      amount:     stake.toFixed(2),
      duration,
      entryPrice: entryPrice.toString(),
      payout:     payout.toString(),
      status:     "OPEN",
      isAuto:     true,
    }).returning();

    _tradesToday++;
    _scanStatus.tradesToday = _tradesToday;
    _scanStatus.verdict     = "PERFECT";

    // Resolve after 60s — guaranteed win on perfect (8/8) signals
    setTimeout(async () => {
      try {
        // 100% win probability for perfect-signal trades — force exit price in the winning direction
        const won = true;
        const exitPrice = won
          ? (signal === "UP" ? entryPrice * 1.0006 : entryPrice * 0.9994)
          : livePrice(bestAsset.price);

        const profit = won ? stake * (payout / 100) : -stake;
        const status = won ? "WIN" : "LOSS";

        await db.update(tradesTable)
          .set({ exitPrice: exitPrice.toString(), profit: profit.toString(), status, closedAt: new Date() })
          .where(eq(tradesTable.id, trade.id));

        // Update account balance + stats
        const fresh = await db.query.accountsTable.findFirst({ where: eq(accountsTable.id, 1) });
        if (fresh) {
          const newBalance  = Math.max(0, parseFloat(fresh.balance as string) + profit);
          const newTotal    = fresh.totalTrades + 1;
          const wins        = Math.round(parseFloat(fresh.winRate as string) * fresh.totalTrades / 100) + (won ? 1 : 0);
          const newWinRate  = newTotal > 0 ? (wins / newTotal) * 100 : 0;
          const newProfit   = parseFloat(fresh.totalProfit as string) + profit;

          await db.update(accountsTable).set({
            balance:      newBalance.toFixed(2),
            totalTrades:  newTotal,
            winRate:      newWinRate.toFixed(2),
            totalProfit:  newProfit.toFixed(2),
          }).where(eq(accountsTable.id, 1));

            if (won) _totalWon++;
        }

        logger.info({ symbol: bestAsset.symbol, status, profit: profit.toFixed(2) }, "Sniper: trade closed");
        _scanStatus.verdict  = "HUNTING";
        _scanStatus.totalWon = _totalWon;
      } catch (e) {
        logger.error(e, "Sniper: error closing trade");
      }
    }, duration * 1000);

  } catch (err) {
    logger.error(err, "Sniper cycle error");
    _scanStatus.scanning = false;
  }
}

// ─── Countdown ticker ─────────────────────────────────────────────────────────
function startCountdown() {
  setInterval(() => {
    const remaining = Math.max(0, Math.round((_nextScanAt - Date.now()) / 1000));
    _scanStatus.nextScanIn = remaining;
  }, 1000);
}

// ─── Midnight reset ───────────────────────────────────────────────────────────
function scheduleMidnightReset() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  setTimeout(async () => {
    _tradesToday = 0;
    _scanStatus.tradesToday = 0;
    logger.info("Sniper: daily counter reset");
    scheduleMidnightReset();
  }, next.getTime() - now.getTime());
}

// ─── Start ────────────────────────────────────────────────────────────────────
export function startAutoInvestEngine() {
  logger.info("Sniper bot started — scanning every 30s for 8/8 perfect signals");
  scheduleMidnightReset();
  startCountdown();

  const INTERVAL = 30_000;
  const tick = () => {
    _nextScanAt = Date.now() + INTERVAL;
    runSniperCycle();
  };

  tick();
  setInterval(tick, INTERVAL);
}
