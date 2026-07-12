/**
 * Coinbase Advanced Trade API client
 * ───────────────────────────────────
 * Minimal client for the pieces the trading bot needs: USD balance,
 * public candles/price, and real market order placement.
 * Docs: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/
 *
 * Auth uses Coinbase Developer Platform (CDP) API keys: a key "name"
 * (organizations/{org_id}/apiKeys/{key_id}) plus an EC (P-256) private
 * key in PEM format. Each request is authorized with a short-lived
 * ES256 JWT — no HMAC signing like KuCoin/Binance.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { logger } from "./logger";

const HOST = "api.coinbase.com";
const BASE = `https://${HOST}`;

function getCreds() {
  return {
    keyName: process.env.COINBASE_API_KEY_NAME,
    // Private keys are stored with literal "\n" sequences in env vars; restore real newlines.
    privateKey: process.env.COINBASE_API_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  };
}

export function hasCoinbaseCredentials(): boolean {
  const { keyName, privateKey } = getCreds();
  return Boolean(keyName && privateKey);
}

function buildJwt(method: "GET" | "POST", path: string): string {
  const { keyName, privateKey } = getCreds();
  if (!keyName || !privateKey) throw new Error("Coinbase API credentials not configured");

  const uri = `${method} ${HOST}${path}`;
  const payload = {
    iss: "cdp",
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
    sub: keyName,
    uri,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: {
      alg: "ES256",
      kid: keyName,
      nonce: crypto.randomBytes(16).toString("hex"),
    } as any,
  });
}

async function signedRequest(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const token = buildJwt(method, path);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  const json = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(`Coinbase API error ${res.status}: ${json.message ?? json.error_response?.message ?? JSON.stringify(json)}`);
  }
  return json;
}

/** Free (available) balance for a currency across brokerage accounts. */
export async function getFreeBalance(currency: string): Promise<number> {
  const data = await signedRequest("GET", "/api/v3/brokerage/accounts?limit=250");
  const acc = (data.accounts as any[])?.find((a) => a.currency === currency);
  return acc ? parseFloat(acc.available_balance?.value ?? "0") : 0;
}

export interface Candle { open: number; close: number; high: number; low: number; volume: number; }

/** Real 1-minute candles (public endpoint, no auth needed), oldest → newest. */
export async function getKlines(productId: string, count = 30): Promise<Candle[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - count * 60;
  const url = `${BASE}/api/v3/brokerage/market/products/${productId}/candles?start=${start}&end=${end}&granularity=ONE_MINUTE`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Coinbase klines error: ${json.message ?? res.status}`);
  // Rows are newest-first.
  const rows = (json.candles as any[]).slice(0, count).reverse();
  return rows.map((r) => ({
    open: parseFloat(r.open),
    close: parseFloat(r.close),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    volume: parseFloat(r.volume),
  }));
}

/** Real-time last traded price (public endpoint). */
export async function getPrice(productId: string): Promise<number> {
  const res = await fetch(`${BASE}/api/v3/brokerage/market/products/${productId}/ticker?limit=1`, {
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Coinbase price error: ${json.message ?? res.status}`);
  const trade = json.trades?.[0];
  if (!trade) throw new Error("Coinbase price error: no recent trades");
  return parseFloat(trade.price);
}

export interface OrderFill {
  orderId: string;
  avgPrice: number;
  dealFunds: number;   // quote-currency (USD) value of the fill
  dealSize: number;    // base-currency (e.g. BTC) amount filled
  fee: number;
  feeCurrency: string;
}

async function placeMarketOrder(
  productId: string,
  side: "BUY" | "SELL",
  opts: { quoteSize?: number; baseSize?: number },
): Promise<OrderFill> {
  const clientOrderId = crypto.randomUUID();
  const orderConfiguration: Record<string, unknown> = {
    market_market_ioc: {
      ...(opts.quoteSize !== undefined ? { quote_size: opts.quoteSize.toFixed(2) } : {}),
      ...(opts.baseSize !== undefined ? { base_size: opts.baseSize.toFixed(8) } : {}),
    },
  };

  const created = await signedRequest("POST", "/api/v3/brokerage/orders", {
    client_order_id: clientOrderId,
    product_id: productId,
    side,
    order_configuration: orderConfiguration,
  });

  if (created.success === false) {
    throw new Error(`Coinbase order rejected: ${created.error_response?.message ?? created.failure_reason ?? "unknown error"}`);
  }
  const orderId = created.success_response?.order_id as string;

  // Market orders fill almost instantly — poll the order until it's done.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const detail = await signedRequest("GET", `/api/v3/brokerage/orders/historical/${orderId}`);
    const order = detail.order;
    if (order && order.status !== "OPEN" && order.status !== "PENDING") {
      const dealSize = parseFloat(order.filled_size ?? "0");
      const avgPrice = parseFloat(order.average_filled_price ?? "0");
      const dealFunds = dealSize * avgPrice;
      return {
        orderId,
        avgPrice,
        dealFunds,
        dealSize,
        fee: parseFloat(order.total_fees ?? "0"),
        feeCurrency: "USD",
      };
    }
  }
  logger.error({ orderId, productId, side }, "Coinbase: order did not report done in time");
  throw new Error(`Order ${orderId} did not fill in time`);
}

export async function marketBuy(productId: string, usdAmount: number): Promise<OrderFill> {
  return placeMarketOrder(productId, "BUY", { quoteSize: usdAmount });
}

export async function marketSell(productId: string, baseQty: number): Promise<OrderFill> {
  return placeMarketOrder(productId, "SELL", { baseSize: baseQty });
}
