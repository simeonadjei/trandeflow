/**
 * KuCoin REST client
 * ───────────────────
 * Minimal signed client for the pieces the trading bot needs:
 * account balance, public candles/price, and market order placement.
 * Docs: https://www.kucoin.com/docs/rest/introduction
 */

import crypto from "node:crypto";
import { logger } from "./logger";

const BASE = "https://api.kucoin.com";

function getCreds() {
  return {
    apiKey: process.env.KUCOIN_API_KEY,
    apiSecret: process.env.KUCOIN_API_SECRET,
    apiPassphrase: process.env.KUCOIN_API_PASSPHRASE,
  };
}

export function hasKucoinCredentials(): boolean {
  const { apiKey, apiSecret, apiPassphrase } = getCreds();
  return Boolean(apiKey && apiSecret && apiPassphrase);
}

async function signedRequest(method: "GET" | "POST", endpoint: string, body?: Record<string, unknown>) {
  const { apiKey, apiSecret, apiPassphrase } = getCreds();
  if (!apiKey || !apiSecret || !apiPassphrase) {
    throw new Error("KuCoin API credentials not configured");
  }

  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const strForSign = timestamp + method + endpoint + bodyStr;
  const signature = crypto.createHmac("sha256", apiSecret).update(strForSign).digest("base64");
  const passphraseSig = crypto.createHmac("sha256", apiSecret).update(apiPassphrase).digest("base64");

  const res = await fetch(BASE + endpoint, {
    method,
    headers: {
      "KC-API-KEY": apiKey,
      "KC-API-SIGN": signature,
      "KC-API-TIMESTAMP": timestamp,
      "KC-API-PASSPHRASE": passphraseSig,
      "KC-API-KEY-VERSION": "2",
      "Content-Type": "application/json",
    },
    body: method === "POST" ? bodyStr : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  const json = (await res.json()) as any;
  if (json.code !== "200000") {
    throw new Error(`KuCoin API error ${json.code}: ${json.msg ?? "unknown error"}`);
  }
  return json.data;
}

/** Free (available, tradeable) balance for a currency in the "trade" account. */
export async function getFreeBalance(currency: string): Promise<number> {
  const data = await signedRequest("GET", `/api/v1/accounts?currency=${currency}&type=trade`);
  const acc = (data as any[]).find((a) => a.currency === currency);
  return acc ? parseFloat(acc.available) : 0;
}

export interface Candle { open: number; close: number; high: number; low: number; volume: number; }

/** Real 1-minute candles, oldest → newest. */
export async function getKlines(symbol: string, count = 30): Promise<Candle[]> {
  const res = await fetch(`${BASE}/api/v1/market/candles?type=1min&symbol=${symbol}`, {
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as any;
  if (json.code !== "200000") throw new Error(`KuCoin klines error: ${json.msg}`);
  // Rows are newest-first: [time, open, close, high, low, volume, turnover]
  const rows = (json.data as string[][]).slice(0, count).reverse();
  return rows.map((r) => ({
    open: parseFloat(r[1]),
    close: parseFloat(r[2]),
    high: parseFloat(r[3]),
    low: parseFloat(r[4]),
    volume: parseFloat(r[5]),
  }));
}

/** Real-time last traded price. */
export async function getPrice(symbol: string): Promise<number> {
  const res = await fetch(`${BASE}/api/v1/market/orderbook/level1?symbol=${symbol}`, {
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as any;
  if (json.code !== "200000") throw new Error(`KuCoin price error: ${json.msg}`);
  return parseFloat(json.data.price);
}

export interface OrderFill {
  orderId: string;
  avgPrice: number;
  dealFunds: number;   // quote-currency (USDT) value of the fill
  dealSize: number;    // base-currency (e.g. BTC) amount filled
  fee: number;
  feeCurrency: string;
}

async function placeMarketOrder(
  symbol: string,
  side: "buy" | "sell",
  opts: { funds?: number; size?: number },
): Promise<OrderFill> {
  const clientOid = crypto.randomUUID();
  const body: Record<string, unknown> = { clientOid, side, symbol, type: "market" };
  if (opts.funds !== undefined) body.funds = opts.funds.toFixed(6);
  if (opts.size !== undefined) body.size = opts.size.toFixed(8);

  const created = await signedRequest("POST", "/api/v1/orders", body);
  const orderId = created.orderId as string;

  // Market orders fill almost instantly — poll the order until it's done.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const detail = await signedRequest("GET", `/api/v1/orders/${orderId}`);
    if (detail.isActive === false) {
      const dealFunds = parseFloat(detail.dealFunds);
      const dealSize = parseFloat(detail.dealSize);
      return {
        orderId,
        avgPrice: dealSize > 0 ? dealFunds / dealSize : 0,
        dealFunds,
        dealSize,
        fee: parseFloat(detail.fee ?? "0"),
        feeCurrency: detail.feeCurrency ?? "USDT",
      };
    }
  }
  logger.error({ orderId, symbol, side }, "KuCoin: order did not report done in time");
  throw new Error(`Order ${orderId} did not fill in time`);
}

export async function marketBuy(symbol: string, usdtAmount: number): Promise<OrderFill> {
  return placeMarketOrder(symbol, "buy", { funds: usdtAmount });
}

export async function marketSell(symbol: string, baseQty: number): Promise<OrderFill> {
  return placeMarketOrder(symbol, "sell", { size: baseQty });
}
