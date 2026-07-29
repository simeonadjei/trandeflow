/**
 * Golden Window Analyzer — v3 (hour-only)
 * ─────────────────────────────────────────
 * Fetches 90 days of 1h candles for BTC + ETH (3 batches of up to 1000),
 * buckets them by UTC hour only (24 slots, ~180 samples each), and picks the
 * hour with the highest historical directional win rate.
 *
 * "Win" = the 1h candle closed higher than it opened.
 *
 * Why hour-only (not weekday×hour):
 *   - 24 slots × ~7.5 samples per week × 13 weeks ≈ 180 samples per slot
 *   - 168 weekday×hour slots get only ~13 samples each — severe overfitting risk
 *   - Hour-only lets the bot trade every day rather than once per week
 *
 * Minimum sample size: ≥10 candles per slot before trusting it
 * Win rate floor: best slot must be ≥65% to be actionable
 * Result is cached for 6 hours; stale cache is returned on error.
 */

import { getKlines } from "./mexcClient";
import { logger } from "./logger";

export interface HourStat {
  hour:    number;  // 0–23 UTC
  wins:    number;
  total:   number;
  winRate: number;  // 0–100, rounded to 1 dp
}

export interface GoldenWindowResult {
  /** Combined label for the assets used */
  asset:                string;
  /** UTC hour (0–23) with the best historical win rate */
  goldenHour:           number;
  /** Day of week (0=Sun … 6=Sat) of the best slot, or null if falling back to hour-only */
  goldenWeekday:        number | null;
  /** Human-readable weekday label, e.g. "Tuesday", or null */
  goldenWeekdayLabel:   string | null;
  /** Historical directional win rate at goldenHour (0–100) */
  winRate:              number;
  /** Number of candle samples in the best (weekday, hour) slot */
  bestSlotSamples:      number;
  totalCandlesAnalyzed: number;
  /** Win-rate breakdown for all 24 UTC hours (for the bar chart) */
  distribution:         HourStat[];
  /** True if the best slot meets the ≥65% floor and is worth trading */
  aboveFloor:           boolean;
  /** Unix ms timestamp when this result was computed */
  computedAt:           number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const WIN_RATE_FLOOR = 65;  // minimum historical win rate to trade
const MIN_SAMPLES    = 10;  // minimum candles in a slot before trusting it

// ─── In-memory cache ─────────────────────────────────────────────────────────
let _cache:    GoldenWindowResult | null = null;
let _cacheTs:  number = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours
let _computing = false;

/**
 * Fetch ~90 days of 1h candles for a symbol in 3 batches.
 * MEXC max per request = 1000 candles.
 */
async function fetchHistory90d(symbol: string) {
  const BATCH = 1000;
  const INTERVAL = "60m"; // MEXC uses "60m", not "1h"

  // Batch 1: most recent 1000 hours
  const batch1 = await getKlines(symbol, BATCH, INTERVAL);
  if (!batch1.length) return batch1;

  // Batch 2: the 1000 hours before batch1
  const batch2 = await getKlines(symbol, BATCH, INTERVAL, { endTime: batch1[0].openTime - 1 });

  // Batch 3: the remaining hours to reach 90 days (2160 total – 2000 fetched = 160)
  const TARGET = 90 * 24; // 2160
  const remaining = TARGET - batch1.length - batch2.length;
  let batch3: typeof batch1 = [];
  if (remaining > 0 && batch2.length > 0) {
    batch3 = await getKlines(symbol, remaining, INTERVAL, { endTime: batch2[0].openTime - 1 });
  }

  // Combine oldest-first
  return [...batch3, ...batch2, ...batch1];
}

export async function getGoldenWindow(forceRefresh = false): Promise<GoldenWindowResult | null> {
  const cacheValid = _cache && Date.now() - _cacheTs < CACHE_TTL_MS;
  if (!forceRefresh && cacheValid) return _cache;
  if (_computing) return _cache;

  _computing = true;
  try {
    logger.info("GoldenWindow v2: fetching 90 days of 1h candles for BTC + ETH…");

    const [btcCandles, ethCandles] = await Promise.all([
      fetchHistory90d("BTCUSDT"),
      fetchHistory90d("ETHUSDT"),
    ]);

    const allCandles = [...btcCandles, ...ethCandles];
    logger.info({ btc: btcCandles.length, eth: ethCandles.length }, "GoldenWindow v2: candles fetched");

    // ── Hour-only buckets (24 slots) ─────────────────────────────────────────
    const hb: Array<{ wins: number; total: number }> = Array.from(
      { length: 24 },
      () => ({ wins: 0, total: 0 })
    );

    for (const c of allCandles) {
      const hour = new Date(c.openTime).getUTCHours();
      hb[hour].total++;
      if (c.close > c.open) hb[hour].wins++;
    }

    // ── Find best hour (≥MIN_SAMPLES) and build distribution ─────────────────
    let bestHourRate = 0;
    let bestHour = 0;
    const distribution: HourStat[] = hb.map((b, hour) => {
      const winRate = b.total >= MIN_SAMPLES
        ? Math.round((b.wins / b.total) * 1000) / 10
        : 50; // default when not enough data
      if (b.total >= MIN_SAMPLES && winRate > bestHourRate) {
        bestHourRate = winRate;
        bestHour = hour;
      }
      return { hour, wins: b.wins, total: b.total, winRate };
    });

    const result: GoldenWindowResult = {
      asset:                "BTCUSDT+ETHUSDT",
      goldenHour:           bestHour,
      goldenWeekday:        null,   // hour-only mode — trades every day
      goldenWeekdayLabel:   null,
      winRate:              Math.round(bestHourRate * 10) / 10,
      bestSlotSamples:      hb[bestHour].total,
      totalCandlesAnalyzed: allCandles.length,
      distribution,
      aboveFloor:           bestHourRate >= WIN_RATE_FLOOR,
      computedAt:           Date.now(),
    };

    _cache   = result;
    _cacheTs = Date.now();
    logger.info(
      {
        goldenHour: result.goldenHour,
        goldenWeekday: result.goldenWeekdayLabel,
        winRate: result.winRate,
        samples: result.bestSlotSamples,
        aboveFloor: result.aboveFloor,
        candles: result.totalCandlesAnalyzed,
      },
      "GoldenWindow v2: computed",
    );
    return result;

  } catch (e) {
    logger.warn(e, "GoldenWindow v2: compute failed — returning stale cache if available");
    return _cache;
  } finally {
    _computing = false;
  }
}

/**
 * Returns true if right now is within ±30 min of the golden hour
 * AND (if goldenWeekday is set) today is the golden weekday.
 */
export function isInGoldenWindow(
  goldenHour: number | null,
  goldenWeekday?: number | null,
): boolean {
  if (goldenHour === null) return false;
  const now = new Date();
  const totalMins  = now.getUTCHours() * 60 + now.getUTCMinutes();
  const goldenMins = goldenHour * 60;
  const diff       = Math.abs(totalMins - goldenMins);
  const inHourWin  = diff <= 30 || diff >= 1410; // handle midnight wrap
  if (!inHourWin) return false;
  if (goldenWeekday === null || goldenWeekday === undefined) return true;
  return now.getUTCDay() === goldenWeekday;
}

/**
 * Returns how many minutes until the next golden window opens.
 * Returns 0 if currently inside the window.
 */
export function minsToGoldenWindow(
  goldenHour: number | null,
  goldenWeekday?: number | null,
): number {
  if (goldenHour === null) return 0;
  if (isInGoldenWindow(goldenHour, goldenWeekday)) return 0;

  const now         = new Date();
  const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Hour-only mode (goldenWeekday is always null in v3)
  const goldenMins = goldenHour * 60;
  let diff = goldenMins - 30 - currentMins;
  if (diff < 0) diff += 1440;
  return diff;
}
