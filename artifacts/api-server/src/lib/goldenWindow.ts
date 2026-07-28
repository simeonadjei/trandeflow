/**
 * Golden Window Analyzer
 * ───────────────────────
 * Fetches 30 days of 1-hour candles for BTC + ETH from MEXC,
 * buckets them by UTC hour, and finds the one hour of the day
 * that historically has the highest directional win rate.
 *
 * "Win" = the 1h candle closed higher than it opened.
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
  /** Historical directional win rate at goldenHour (0–100) */
  winRate:              number;
  totalCandlesAnalyzed: number;
  /** Win-rate breakdown for all 24 UTC hours */
  distribution:         HourStat[];
  /** Unix ms timestamp when this result was computed */
  computedAt:           number;
}

// ─── In-memory cache ─────────────────────────────────────────────────────────
let _cache:    GoldenWindowResult | null = null;
let _cacheTs:  number = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours
let _computing = false;                    // prevent concurrent recomputes

export async function getGoldenWindow(forceRefresh = false): Promise<GoldenWindowResult | null> {
  const cacheValid = _cache && Date.now() - _cacheTs < CACHE_TTL_MS;
  if (!forceRefresh && cacheValid) return _cache;
  if (_computing) return _cache;           // return stale while computing

  _computing = true;
  try {
    logger.info("GoldenWindow: fetching 720 × 1h candles for BTC + ETH…");

    // 720 candles × 1h = 30 days of history
    const [btcCandles, ethCandles] = await Promise.all([
      getKlines("BTCUSDT", 720, "1h"),
      getKlines("ETHUSDT", 720, "1h"),
    ]);

    // Build hourly win/loss buckets (combine both assets)
    const buckets: Array<{ wins: number; total: number }> = Array.from(
      { length: 24 },
      () => ({ wins: 0, total: 0 })
    );

    for (const c of [...btcCandles, ...ethCandles]) {
      const hour = new Date(c.openTime).getUTCHours();
      buckets[hour].total++;
      if (c.close > c.open) buckets[hour].wins++;
    }

    // Build distribution array + find best hour
    let bestHour = 0;
    let bestRate = 0;
    const distribution: HourStat[] = buckets.map((b, hour) => {
      const winRate = b.total > 0
        ? Math.round((b.wins / b.total) * 1000) / 10  // 1 dp
        : 50;
      if (winRate > bestRate) { bestRate = winRate; bestHour = hour; }
      return { hour, wins: b.wins, total: b.total, winRate };
    });

    const result: GoldenWindowResult = {
      asset:                "BTCUSDT+ETHUSDT",
      goldenHour:           bestHour,
      winRate:              bestRate,
      totalCandlesAnalyzed: btcCandles.length + ethCandles.length,
      distribution,
      computedAt:           Date.now(),
    };

    _cache   = result;
    _cacheTs = Date.now();
    logger.info({ bestHour, bestRate, candles: result.totalCandlesAnalyzed }, "GoldenWindow: computed");
    return result;

  } catch (e) {
    logger.warn(e, "GoldenWindow: compute failed — returning stale cache if available");
    return _cache;
  } finally {
    _computing = false;
  }
}

/**
 * Returns true if the current UTC time is within ±30 minutes of the golden hour.
 * If `goldenHour` is null, always returns false.
 */
export function isInGoldenWindow(goldenHour: number | null): boolean {
  if (goldenHour === null) return false;
  const now = new Date();
  const totalMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const goldenMins = goldenHour * 60;
  const diff = Math.abs(totalMins - goldenMins);
  // Handle wrap-around at midnight (0 min ↔ 1439 min)
  return diff <= 30 || diff >= 1410;
}

/**
 * Returns how many minutes until the next golden window opens.
 * Returns 0 if currently inside the window.
 */
export function minsToGoldenWindow(goldenHour: number | null): number {
  if (goldenHour === null) return 0;
  if (isInGoldenWindow(goldenHour)) return 0;
  const now = new Date();
  const totalMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const goldenMins = goldenHour * 60;
  let diff = goldenMins - 30 - totalMins;   // mins until window opens
  if (diff < 0) diff += 1440;               // wrap to next day
  return diff;
}
