import { Router } from "express";
import { getLivePrice, getBasePrice, getPriceCache, getPriceLastRefreshedAt } from "../lib/prices";

const router = Router();

// ── Static asset list ──────────────────────────────────────────────────────
const ASSET_DEFS = [
  { symbol: "BTCUSD",  name: "BTC/USD",   payout: 100, trending: true  },
  { symbol: "ETHUSD",  name: "ETH/USD",   payout: 100, trending: true  },
  { symbol: "EURUSD",  name: "EUR/USD",   payout: 100, trending: true  },
  { symbol: "GBPUSD",  name: "GBP/USD",   payout: 100, trending: false },
  { symbol: "XAUUSD",  name: "Gold/USD",  payout: 100, trending: false },
  { symbol: "USDJPY",  name: "USD/JPY",   payout: 100, trending: false },
];

// ── Candle generation from shared live base price ─────────────────────────
function generateCandles(symbol: string, count = 60) {
  const base = getBasePrice(symbol);
  const candles = [];
  let price = base * (1 - Math.random() * 0.005);
  const now = Math.floor(Date.now() / 1000);
  const interval = 60; // 1-min candles

  for (let i = count; i >= 0; i--) {
    const open = price;
    const isForex = base < 1000;
    const volatility = isForex ? 0.0008 : 0.003;
    const move = (Math.random() - 0.48) * base * volatility;
    const close = open + move;
    const high = Math.max(open, close) + Math.random() * base * volatility * 0.4;
    const low  = Math.min(open, close) - Math.random() * base * volatility * 0.4;
    const volume = Math.floor(Math.random() * 5000) + 1000;

    candles.push({
      time:   now - i * interval,
      open:   parseFloat(open.toFixed(base > 100 ? 2 : 5)),
      high:   parseFloat(high.toFixed(base > 100 ? 2 : 5)),
      low:    parseFloat(low.toFixed(base > 100 ? 2 : 5)),
      close:  parseFloat(close.toFixed(base > 100 ? 2 : 5)),
      volume,
    });
    price = close;
  }
  return candles;
}

// ── Pattern analysis ───────────────────────────────────────────────────────
function analyzePattern(symbol: string, candles: ReturnType<typeof generateCandles>) {
  const recent = candles.slice(-5);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];

  const bodySize  = Math.abs(last.close - last.open);
  const prevBody  = Math.abs(prev.close - prev.open);
  const isGreen   = last.close > last.open;
  const wasGreen  = prev.close > prev.open;
  const wickDown  = Math.min(last.open, last.close) - last.low;
  const wickUp    = last.high - Math.max(last.open, last.close);

  let pattern = "Consolidation", signal = "HOLD", confidence = 50;

  const greenCount = recent.filter(c => c.close > c.open).length;
  const redCount   = recent.filter(c => c.close < c.open).length;

  if (wickDown > bodySize * 2.5 && isGreen) {
    pattern = "Hammer"; signal = "BUY"; confidence = 78;
  } else if (wickUp > bodySize * 2.5 && !isGreen) {
    pattern = "Shooting Star"; signal = "SELL"; confidence = 76;
  } else if (isGreen && bodySize > prevBody * 1.8 && !wasGreen) {
    pattern = "Bullish Engulfing"; signal = "BUY"; confidence = 82;
  } else if (!isGreen && bodySize > prevBody * 1.8 && wasGreen) {
    pattern = "Bearish Engulfing"; signal = "SELL"; confidence = 80;
  } else if (greenCount >= 4) {
    pattern = "Bullish Momentum"; signal = "BUY"; confidence = 72;
  } else if (redCount >= 4) {
    pattern = "Bearish Momentum"; signal = "SELL"; confidence = 70;
  } else if (bodySize < prevBody * 0.3) {
    pattern = "Neutral Doji"; signal = "HOLD"; confidence = 50;
  }

  const closes = candles.slice(-15).map(c => c.close);
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  const rsi = losses === 0 ? 100 : Math.round(100 - 100 / (1 + gains / losses));

  const smaFast = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const smaSlow = closes.slice(-15).reduce((a, b) => a + b, 0) / 15;
  const trend   = smaFast > smaSlow * 1.001 ? "UPTREND" : smaFast < smaSlow * 0.999 ? "DOWNTREND" : "SIDEWAYS";

  return {
    pattern, signal, confidence, rsi, trend,
    supportLevel:    parseFloat(Math.min(...candles.slice(-20).map(c => c.low)).toFixed(last.close > 100 ? 2 : 5)),
    resistanceLevel: parseFloat(Math.max(...candles.slice(-20).map(c => c.high)).toFixed(last.close > 100 ? 2 : 5)),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────
router.get("/assets", (_req, res) => {
  const cache = getPriceCache();
  const updatedAt = getPriceLastRefreshedAt();

  const assets = ASSET_DEFS.map((a) => {
    const price = getLivePrice(a.symbol);
    const prev  = cache[a.symbol as keyof typeof cache] as number ?? price;
    const change = price - prev;
    return {
      ...a,
      price:           parseFloat(price.toFixed(price > 100 ? 2 : 5)),
      change:          parseFloat(change.toFixed(price > 100 ? 2 : 5)),
      changePercent:   parseFloat(((change / prev) * 100).toFixed(2)),
      pricesUpdatedAt: new Date(updatedAt || Date.now()).toISOString(),
    };
  });
  res.json(assets);
});

router.get("/assets/:symbol/candles", (req, res) => {
  const { symbol } = req.params;
  const known = ASSET_DEFS.find(a => a.symbol === symbol.toUpperCase());
  if (!known) return res.status(404).json({ error: "Unknown symbol" });
  const candles = generateCandles(symbol.toUpperCase());
  res.json(candles);
});

router.get("/assets/:symbol/pattern", (req, res) => {
  const { symbol } = req.params;
  const known = ASSET_DEFS.find(a => a.symbol === symbol.toUpperCase());
  if (!known) return res.status(404).json({ error: "Unknown symbol" });
  const candles = generateCandles(symbol.toUpperCase());
  res.json(analyzePattern(symbol.toUpperCase(), candles));
});

export default router;
