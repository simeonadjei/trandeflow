/**
 * Shared live price cache
 * ─────────────────────────
 * Single source of truth for all asset prices.
 * Refreshes every 2 minutes (CoinGecko free tier: ≤30 req/min, but we share
 * one request across all consumers to avoid hitting daily quotas).
 */

import { logger } from "./logger";

export interface PriceMap {
  BTCUSD: number;
  ETHUSD: number;
  EURUSD: number;
  GBPUSD: number;
  XAUUSD: number;
  USDJPY: number;
}

const prices: PriceMap = {
  BTCUSD: 67340,
  ETHUSD: 3412,
  EURUSD: 1.0854,
  GBPUSD: 1.2718,
  XAUUSD: 2318,
  USDJPY: 156.72,
};

let lastRefreshAt = 0;
const REFRESH_INTERVAL_MS = 120_000; // 2 minutes — stay well within free tier

async function refreshPrices() {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_INTERVAL_MS) return; // debounce
  lastRefreshAt = now;

  // Crypto via CoinGecko public API (no key required)
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(8_000) }
    );
    if (res.ok) {
      const data = await res.json() as any;
      // Check for rate-limit / quota error inside the body
      if (data?.status?.error_code) {
        logger.warn({ code: data.status.error_code }, "CoinGecko quota – using cached prices");
      } else {
        if (data?.bitcoin?.usd)  prices.BTCUSD = data.bitcoin.usd;
        if (data?.ethereum?.usd) prices.ETHUSD = data.ethereum.usd;
      }
    }
  } catch { /* keep cached */ }

  // Forex via Frankfurter (truly free, no key needed)
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY",
      { signal: AbortSignal.timeout(8_000) }
    );
    if (res.ok) {
      const data = await res.json() as any;
      // Frankfurter from=USD gives EUR-per-USD; EURUSD/GBPUSD are USD-per-EUR/GBP (inverse)
      if (data?.rates?.EUR && data.rates.EUR > 0) prices.EURUSD = parseFloat((1 / data.rates.EUR).toFixed(5));
      if (data?.rates?.GBP && data.rates.GBP > 0) prices.GBPUSD = parseFloat((1 / data.rates.GBP).toFixed(5));
      if (data?.rates?.JPY && data.rates.JPY > 0) prices.USDJPY = parseFloat(data.rates.JPY.toFixed(3));
    }
  } catch { /* keep cached */ }
}

// Kick off initial refresh, then repeat every 2 minutes
refreshPrices();
setInterval(refreshPrices, REFRESH_INTERVAL_MS);

/** Returns the cached base price with a tiny realistic tick (±0.05%). */
export function getLivePrice(symbol: string): number {
  const base = prices[symbol as keyof PriceMap] ?? 100;
  return base * (1 + (Math.random() - 0.5) * 0.001);
}

/** Returns the raw cached price (no tick noise). */
export function getBasePrice(symbol: string): number {
  return prices[symbol as keyof PriceMap] ?? 100;
}

export function getPriceCache(): PriceMap {
  return { ...prices };
}

export function getPriceLastRefreshedAt(): number {
  return lastRefreshAt;
}
