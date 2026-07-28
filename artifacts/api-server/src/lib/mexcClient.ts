/**
 * MEXC Spot API client (V3)
 * ─────────────────────────
 * Covers the pieces the trading bot needs:
 *   - Account free balance for any asset
 *   - Public 1-minute candles (no auth)
 *   - Real-time price (no auth)
 *   - Market buy (quote-quantity) and market sell (base-quantity)
 *
 * Auth: HMAC-SHA256 signature of the sorted query string, sent via
 *       X-MEXC-APIKEY header + &signature=<hex> appended to query.
 *
 * Docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
 */

import crypto from "node:crypto";
import { logger } from "./logger";

const BASE = "https://api.mexc.com";

function getCreds() {
  // Strip invisible Unicode formatting characters (e.g. U+200E LRM, U+200B ZWSP,
  // U+FEFF BOM) that can appear when copy-pasting keys from PDFs or chat apps.
  const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "").trim();
  return {
    apiKey:    clean(process.env.MEXC_API_KEY    ?? ""),
    apiSecret: clean(process.env.MEXC_API_SECRET ?? ""),
  };
}

export function hasMexcCredentials(): boolean {
  const { apiKey, apiSecret } = getCreds();
  return Boolean(apiKey && apiSecret);
}

function sign(queryString: string): string {
  const { apiSecret } = getCreds();
  return crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");
}

/** Build a signed query string. Adds timestamp automatically. */
function buildSignedQuery(params: Record<string, string | number>): string {
  const { apiKey } = getCreds();
  if (!apiKey) throw new Error("MEXC_API_KEY not configured");

  const p = { ...params, timestamp: Date.now() };
  const qs = Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const sig = sign(qs);
  return `${qs}&signature=${sig}`;
}

async function privateGet(path: string, params: Record<string, string | number> = {}) {
  const { apiKey } = getCreds();
  const qs = buildSignedQuery(params);
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "X-MEXC-APIKEY": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json() as any;
  // MEXC returns code:0 on success in some endpoints — only treat non-zero as an error
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`MEXC GET ${path} error ${res.status}: ${json.msg ?? JSON.stringify(json)}`);
  }
  return json;
}

async function privatePost(path: string, params: Record<string, string | number> = {}) {
  const { apiKey } = getCreds();
  const qs = buildSignedQuery(params);
  const res = await fetch(`${BASE}${path}?${qs}`, {
    method: "POST",
    headers: { "X-MEXC-APIKEY": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json() as any;
  // MEXC returns code:0 on success in some endpoints — only treat non-zero as an error
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`MEXC POST ${path} error ${res.status}: ${json.msg ?? JSON.stringify(json)}`);
  }
  return json;
}

// ─── Public endpoints (no auth) ──────────────────────────────────────────────

export interface Candle {
  openTime: number; // ms since epoch
  open: number; close: number;
  high: number; low: number;
  volume: number;
}

/**
 * Candles for a MEXC spot symbol.
 * @param symbol  e.g. "BTCUSDT"
 * @param count   number of candles to return
 * @param interval MEXC interval string: "1m" | "5m" | "15m" | "1h" etc. (default "1m")
 * Returns oldest → newest.
 */
export async function getKlines(symbol: string, count = 30, interval = "1m"): Promise<Candle[]> {
  const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${count}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  const json = await res.json() as any;
  if (!res.ok) throw new Error(`MEXC klines error ${res.status}: ${JSON.stringify(json)}`);
  // Each row: [openTime, open, high, low, close, volume, closeTime, ...]
  return (json as any[][]).map((r) => ({
    openTime: parseInt(r[0]),
    open:   parseFloat(r[1]),
    high:   parseFloat(r[2]),
    low:    parseFloat(r[3]),
    close:  parseFloat(r[4]),
    volume: parseFloat(r[5]),
  }));
}

/** Real-time last price for a symbol (e.g. "BTCUSDT"). */
export async function getPrice(symbol: string): Promise<number> {
  const url = `${BASE}/api/v3/ticker/price?symbol=${symbol}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  const json = await res.json() as any;
  if (!res.ok) throw new Error(`MEXC price error ${res.status}: ${JSON.stringify(json)}`);
  return parseFloat(json.price);
}

// ─── Private endpoints (auth required) ───────────────────────────────────────

/** Available (free) balance for an asset, e.g. "USDT", "BTC". */
export async function getFreeBalance(asset: string): Promise<number> {
  const data = await privateGet("/api/v3/account");
  const entry = (data.balances as any[])?.find((b: any) => b.asset === asset);
  return entry ? parseFloat(entry.free) : 0;
}

/**
 * Total MEXC portfolio value in USDT.
 * Adds up free + locked USDT, plus BTC and ETH holdings converted at current
 * market prices. This reflects the true account value even when the bot has
 * funds tied up in open crypto positions.
 */
export async function getMexcPortfolioValueUsdt(): Promise<{
  totalUsdt: number;
  freeUsdt: number;
  lockedUsdt: number;
  cryptoValueUsdt: number;
  breakdown: Array<{ asset: string; free: number; locked: number; valueUsdt: number }>;
}> {
  const [accountData] = await Promise.all([privateGet("/api/v3/account")]);
  const balances = (accountData.balances as any[]) ?? [];

  // Collect non-zero balances
  const nonZero = balances
    .map((b: any) => ({ asset: b.asset as string, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
    .filter((b) => b.free + b.locked > 0);

  const usdtEntry  = nonZero.find((b) => b.asset === "USDT");
  const freeUsdt   = usdtEntry?.free  ?? 0;
  const lockedUsdt = usdtEntry?.locked ?? 0;

  // Crypto assets to price (skip USDT itself)
  const cryptoAssets = nonZero.filter((b) => b.asset !== "USDT" && b.free + b.locked > 0);

  // Fetch prices in parallel for known crypto holdings
  const priceMap: Record<string, number> = {};
  await Promise.all(
    cryptoAssets.map(async (b) => {
      try {
        const p = await getPrice(`${b.asset}USDT`);
        priceMap[b.asset] = p;
      } catch {
        // If symbol not found or unreachable, value = 0
        priceMap[b.asset] = 0;
      }
    })
  );

  const breakdown: Array<{ asset: string; free: number; locked: number; valueUsdt: number }> = [];
  let cryptoValueUsdt = 0;

  if (usdtEntry) {
    breakdown.push({ asset: "USDT", free: freeUsdt, locked: lockedUsdt, valueUsdt: freeUsdt + lockedUsdt });
  }
  for (const b of cryptoAssets) {
    const price = priceMap[b.asset] ?? 0;
    const valueUsdt = (b.free + b.locked) * price;
    cryptoValueUsdt += valueUsdt;
    breakdown.push({ asset: b.asset, free: b.free, locked: b.locked, valueUsdt });
  }

  return {
    totalUsdt: freeUsdt + lockedUsdt + cryptoValueUsdt,
    freeUsdt,
    lockedUsdt,
    cryptoValueUsdt,
    breakdown,
  };
}

export interface OrderResult {
  orderId:    string;
  symbol:     string;
  side:       "BUY" | "SELL";
  /** Filled base-asset qty (e.g. BTC amount) */
  baseQty:    number;
  /** Filled quote-asset spend/receive (e.g. USDT) */
  quoteQty:   number;
  avgPrice:   number;
}

/**
 * Market BUY using quote quantity (spend `quoteQty` USDT to buy the base asset).
 * symbol example: "BTCUSDT"
 */
export async function marketBuy(symbol: string, quoteQty: number): Promise<OrderResult> {
  logger.info({ symbol, quoteQty }, "MEXC: placing market BUY");
  const data = await privatePost("/api/v3/order", {
    symbol,
    side:             "BUY",
    type:             "MARKET",
    quoteOrderQty:    quoteQty.toFixed(2),
  });

  // Log the full raw response so we can diagnose unexpected shapes
  logger.info({ rawOrderResponse: data }, "MEXC: raw order response");

  // MEXC returns fills immediately for market orders
  const filled = parseFloat(data.executedQty   ?? "0");
  const spent  = parseFloat(data.cummulativeQuoteQty ?? "0");
  const avg    = filled > 0 ? spent / filled : 0;

  logger.info({ orderId: data.orderId, filled, spent, avg }, "MEXC: BUY filled");
  return {
    orderId:  String(data.orderId),
    symbol,
    side:     "BUY",
    baseQty:  filled,
    quoteQty: spent,
    avgPrice: avg,
  };
}

/**
 * Market SELL of `baseQty` units of the base asset.
 * symbol example: "BTCUSDT"
 */
export async function marketSell(symbol: string, baseQty: number): Promise<OrderResult> {
  logger.info({ symbol, baseQty }, "MEXC: placing market SELL");
  // MEXC requires quantity as a string with appropriate precision
  const data = await privatePost("/api/v3/order", {
    symbol,
    side:     "SELL",
    type:     "MARKET",
    quantity: baseQty.toFixed(8),
  });

  const filled  = parseFloat(data.executedQty          ?? "0");
  const received = parseFloat(data.cummulativeQuoteQty ?? "0");
  const avg      = filled > 0 ? received / filled : 0;

  logger.info({ orderId: data.orderId, filled, received, avg }, "MEXC: SELL filled");
  return {
    orderId:  String(data.orderId),
    symbol,
    side:     "SELL",
    baseQty:  filled,
    quoteQty: received,
    avgPrice: avg,
  };
}
