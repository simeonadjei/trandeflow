/**
 * Golden Window Analyzer — v2
 * ────────────────────────────
 * Fetches 90 days of 1h candles for BTC + ETH (3 batches of up to 1000),
 * buckets them by (weekday × hour), and finds the one (weekday, hour) slot
 * that historically has the highest directional win rate.
 *
 * "Win" = the 1h candle closed higher than it opened.
 *
 * Upgrades over v1:
 *   - 90-day history (3× more data)
 *   - Day-of-week analysis: finds the best "Tuesday 14:00 UTC" not just "14:00 UTC"
 *   - Minimum sample size: ≥10 candles per slot before trusting it
 *   - Win rate floor: best slot must be ≥65% to be actionable
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
const WEEKDAY_LABELS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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

    // ── Weekday×Hour buckets (168 slots) ────────────────────────────────────
    // buckets[weekday][hour] = { wins, total }
    const wb: Array<Array<{ wins: number; total: number }>> = Array.from(
      { length: 7 },
      () => Array.from({ length: 24 }, () => ({ wins: 0, total: 0 }))
    );

    // ── Hour-only buckets (24 slots, for bar chart) ──────────────────────────
    const hb: Array<{ wins: number; total: number }> = Array.from(
      { length: 24 },
      () => ({ wins: 0, total: 0 })
    );

    for (const c of allCandles) {
      const d = new Date(c.openTime);
      const weekday = d.getUTCDay();
      const hour    = d.getUTCHours();
      hb[hour].total++;
      wb[weekday][hour].total++;
      if (c.close > c.open) {
        hb[hour].wins++;
        wb[weekday][hour].wins++;
      }
    }

    // ── Build hourly distribution (for bar chart) ────────────────────────────
    let bestHourRate = 0;
    let bestHour = 0;
    const distribution: HourStat[] = hb.map((b, hour) => {
      const winRate = b.total > 0
        ? Math.round((b.wins / b.total) * 1000) / 10
        : 50;
      if (winRate > bestHourRate) { bestHourRate = winRate; bestHour = hour; }
      return { hour, wins: b.wins, total: b.total, winRate };
    });

    // ── Find best (weekday, hour) slot ───────────────────────────────────────
    let bestSlotWinRate = 0;
    let bestSlotWeekday: number | null = null;
    let bestSlotHour = bestHour;
    let bestSlotSamples = 0;

    for (let wd = 0; wd < 7; wd++) {
      for (let h = 0; h < 24; h++) {
        const b = wb[wd][h];
        if (b.total < MIN_SAMPLES) continue; // not enough data
        const rate = (b.wins / b.total) * 100;
        if (rate > bestSlotWinRate) {
          bestSlotWinRate = rate;
          bestSlotWeekday = wd;
          bestSlotHour    = h;
          bestSlotSamples = b.total;
        }
      }
    }

    // Round win rate to 1 dp
    bestSlotWinRate = Math.round(bestSlotWinRate * 10) / 10;

    // ── Decide final golden window ───────────────────────────────────────────
    // If the weekday+hour slot beats the pure-hour best by >2pp, use it.
    // Otherwise fall back to hour-only (more trading opportunities).
    const useWeekday = bestSlotWeekday !== null && bestSlotWinRate >= WIN_RATE_FLOOR;

    const result: GoldenWindowResult = {
      asset:                "BTCUSDT+ETHUSDT",
      goldenHour:           useWeekday ? bestSlotHour    : bestHour,
      goldenWeekday:        useWeekday ? bestSlotWeekday : null,
      goldenWeekdayLabel:   useWeekday && bestSlotWeekday !== null
                              ? WEEKDAY_LABELS[bestSlotWeekday]
                              : null,
      winRate:              useWeekday ? bestSlotWinRate  : Math.round(bestHourRate * 10) / 10,
      bestSlotSamples:      useWeekday ? bestSlotSamples : hb[bestHour].total,
      totalCandlesAnalyzed: allCandles.length,
      distribution,
      aboveFloor:           (useWeekday ? bestSlotWinRate : bestHourRate) >= WIN_RATE_FLOOR,
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

  if (goldenWeekday === null || goldenWeekday === undefined) {
    // Hour-only mode
    const goldenMins = goldenHour * 60;
    let diff = goldenMins - 30 - currentMins;
    if (diff < 0) diff += 1440;
    return diff;
  }

  // Weekday+hour mode: find minutes until window opens (goldenWeekday × 1440 + goldenHour×60 - 30)
  const currentWeekdayMins = now.getUTCDay() * 1440 + currentMins;
  const targetWeekdayMins  = goldenWeekday  * 1440 + goldenHour * 60 - 30;
  let diff = targetWeekdayMins - currentWeekdayMins;
  if (diff <= 0) diff += 7 * 1440; // wrap to next week
  return diff;
}
