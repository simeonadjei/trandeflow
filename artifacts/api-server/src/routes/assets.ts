import { Router } from "express";

const router = Router();

const ASSETS = [
  { symbol: "EURUSD", name: "EUR/USD", price: 1.08542, change: 0.00123, changePercent: 0.11, payout: 100, trending: true },
  { symbol: "BTCUSD", name: "BTC/USD", price: 67340.50, change: -1240.30, changePercent: -1.81, payout: 100, trending: true },
  { symbol: "GBPUSD", name: "GBP/USD", price: 1.27180, change: 0.00345, changePercent: 0.27, payout: 100, trending: false },
  { symbol: "ETHUSD", name: "ETH/USD", price: 3412.80, change: 87.40, changePercent: 2.63, payout: 100, trending: true },
  { symbol: "XAUUSD", name: "Gold/USD", price: 2318.40, change: 12.30, changePercent: 0.53, payout: 100, trending: false },
  { symbol: "USDJPY", name: "USD/JPY", price: 156.720, change: -0.340, changePercent: -0.22, payout: 100, trending: false },
  { symbol: "AAPL", name: "Apple Inc.", price: 189.50, change: 2.30, changePercent: 1.23, payout: 100, trending: false },
  { symbol: "TSLA", name: "Tesla Inc.", price: 174.80, change: -3.20, changePercent: -1.80, payout: 100, trending: true },
];

function generateCandles(basePrice: number, count = 60) {
  const candles = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);
  const interval = 300; // 5min

  for (let i = count; i >= 0; i--) {
    const open = price;
    const move = (Math.random() - 0.48) * basePrice * 0.003;
    const close = open + move;
    const high = Math.max(open, close) + Math.random() * basePrice * 0.001;
    const low = Math.min(open, close) - Math.random() * basePrice * 0.001;
    const volume = Math.floor(Math.random() * 5000) + 1000;

    candles.push({
      time: now - i * interval,
      open: parseFloat(open.toFixed(5)),
      high: parseFloat(high.toFixed(5)),
      low: parseFloat(low.toFixed(5)),
      close: parseFloat(close.toFixed(5)),
      volume,
    });

    price = close;
  }

  return candles;
}

function analyzePatternForSymbol(symbol: string, candles: ReturnType<typeof generateCandles>) {
  const recent = candles.slice(-5);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];

  const bodySize = Math.abs(last.close - last.open);
  const wickUp = last.high - Math.max(last.open, last.close);
  const wickDown = Math.min(last.open, last.close) - last.low;
  const isGreen = last.close > last.open;

  let pattern = "Neutral Doji";
  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 50;
  let reason = "Market is consolidating. Wait for a clearer signal.";

  const upTrend = recent.filter((c) => c.close > c.open).length >= 3;
  const downTrend = recent.filter((c) => c.close < c.open).length >= 3;

  if (wickDown > bodySize * 2 && isGreen) {
    pattern = "Hammer";
    signal = "BUY";
    confidence = 78;
    reason = "Hammer pattern detected — buyers rejected the lows strongly. Bullish reversal likely.";
  } else if (wickUp > bodySize * 2 && !isGreen) {
    pattern = "Shooting Star";
    signal = "SELL";
    confidence = 74;
    reason = "Shooting Star detected — sellers overwhelmed buyers at the highs. Bearish reversal likely.";
  } else if (isGreen && bodySize > Math.abs(prev.close - prev.open) * 1.5 && !prev.close) {
    pattern = "Bullish Engulfing";
    signal = "BUY";
    confidence = 82;
    reason = "Bullish Engulfing pattern — current candle engulfs previous bearish candle. Strong buy signal.";
  } else if (upTrend && isGreen) {
    pattern = "Bullish Momentum";
    signal = "BUY";
    confidence = 68;
    reason = "Price trending upward with consistent green candles. Momentum favours buyers.";
  } else if (downTrend && !isGreen) {
    pattern = "Bearish Momentum";
    signal = "SELL";
    confidence = 66;
    reason = "Consecutive red candles indicate bearish pressure. Sellers are in control.";
  } else if (bodySize < (last.high - last.low) * 0.15) {
    pattern = "Doji";
    signal = "HOLD";
    confidence = 45;
    reason = "Doji candle — indecision in the market. Wait for next candle confirmation.";
  }

  const prices = candles.slice(-14).map((c) => c.close);
  const gains = prices.filter((p, i) => i > 0 && p > prices[i - 1]).reduce((s, p, i) => s + (p - prices[i]), 0);
  const losses = prices.filter((p, i) => i > 0 && p < prices[i - 1]).reduce((s, p, i) => s + (prices[i] - p), 0);
  const rsi = losses === 0 ? 100 : Math.round(100 - 100 / (1 + gains / losses));

  return {
    symbol,
    pattern,
    signal,
    confidence,
    reason,
    supportLevel: parseFloat((last.low * 0.998).toFixed(5)),
    resistanceLevel: parseFloat((last.high * 1.002).toFixed(5)),
    rsi: Math.min(100, Math.max(0, rsi)),
    trend: upTrend ? "UPTREND" : downTrend ? "DOWNTREND" : "SIDEWAYS",
  };
}

router.get("/assets", (req, res) => {
  const assets = ASSETS.map((a) => ({
    ...a,
    price: a.price + (Math.random() - 0.5) * a.price * 0.001,
  }));
  res.json(assets);
});

router.get("/assets/:symbol/candles", (req, res) => {
  const asset = ASSETS.find((a) => a.symbol === req.params.symbol);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  const candles = generateCandles(asset.price);
  res.json(candles);
});

router.get("/assets/:symbol/pattern", (req, res) => {
  const asset = ASSETS.find((a) => a.symbol === req.params.symbol);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  const candles = generateCandles(asset.price);
  const analysis = analyzePatternForSymbol(req.params.symbol, candles);
  res.json(analysis);
});

export default router;
