import { Link } from "wouter";
import { TrendingUp, ArrowRight } from "lucide-react";

const patterns = [
  {
    name: "Doji",
    signal: "HOLD",
    confidence: "40–55%",
    description: "A Doji forms when the opening and closing price are almost equal, creating a cross or plus shape. It signals indecision in the market — neither buyers nor sellers are in control.",
    tip: "Wait for the next candle to confirm direction before placing a trade.",
    candle: { color: "neutral", body: 2, wickUp: 30, wickDown: 30 },
  },
  {
    name: "Hammer",
    signal: "BUY",
    confidence: "70–80%",
    description: "A Hammer has a small body at the top with a long lower wick. It appears after a downtrend and shows that buyers pushed the price back up after sellers initially drove it down sharply.",
    tip: "Best seen at the bottom of a downtrend. Trade UP after a Hammer.",
    candle: { color: "green", body: 10, wickUp: 5, wickDown: 45 },
  },
  {
    name: "Shooting Star",
    signal: "SELL",
    confidence: "70–78%",
    description: "The opposite of a Hammer — a small body at the bottom with a long upper wick. It appears after an uptrend and shows sellers rejected higher prices.",
    tip: "Best seen at the top of an uptrend. Trade DOWN after a Shooting Star.",
    candle: { color: "red", body: 10, wickUp: 45, wickDown: 5 },
  },
  {
    name: "Bullish Engulfing",
    signal: "BUY",
    confidence: "78–88%",
    description: "A large green candle that completely covers (engulfs) the previous red candle. This is a very strong reversal signal — buyers have completely taken over from sellers.",
    tip: "One of the strongest BUY signals. Especially powerful after a downtrend.",
    candle: { color: "green", body: 50, wickUp: 5, wickDown: 5 },
  },
  {
    name: "Bearish Engulfing",
    signal: "SELL",
    confidence: "78–88%",
    description: "A large red candle that completely engulfs the previous green candle. Sellers have overwhelmed buyers in one decisive move.",
    tip: "One of the strongest SELL signals. Especially powerful after an uptrend.",
    candle: { color: "red", body: 50, wickUp: 5, wickDown: 5 },
  },
  {
    name: "Bullish Momentum",
    signal: "BUY",
    confidence: "60–72%",
    description: "Three or more consecutive green candles with consistent body sizes, indicating buyers are firmly in control and the trend is upward.",
    tip: "Trend continuation pattern. Trade UP but watch for reversal candles.",
    candle: { color: "green", body: 35, wickUp: 8, wickDown: 8 },
  },
  {
    name: "Bearish Momentum",
    signal: "SELL",
    confidence: "60–72%",
    description: "Three or more consecutive red candles with consistent body sizes, showing sellers are dominant and the downtrend is likely to continue.",
    tip: "Trend continuation pattern. Trade DOWN but watch for support levels.",
    candle: { color: "red", body: 35, wickUp: 8, wickDown: 8 },
  },
  {
    name: "Spinning Top",
    signal: "HOLD",
    confidence: "35–50%",
    description: "A candle with a small body and equal upper and lower wicks. Like a Doji but with a slightly larger body. Still signals indecision — the market is at a tipping point.",
    tip: "Context matters most here. Look at the surrounding candles and trend direction.",
    candle: { color: "neutral", body: 12, wickUp: 22, wickDown: 22 },
  },
];

function CandleVisual({ pattern }: { pattern: typeof patterns[0] }) {
  const { color, body, wickUp, wickDown } = pattern.candle;
  const totalH = wickUp + body + wickDown;
  const wickColor = color === "green" ? "#22c55e" : color === "red" ? "#ef4444" : "#a1a1aa";
  const bodyColor = color === "green" ? "#22c55e" : color === "red" ? "#ef4444" : "#a1a1aa";
  const bodyBg = color === "green" ? "rgba(34,197,94,0.2)" : color === "red" ? "rgba(239,68,68,0.2)" : "rgba(161,161,170,0.2)";

  return (
    <div className="flex justify-center items-end" style={{ height: 100 }}>
      <div className="relative flex flex-col items-center" style={{ height: 100, width: 24 }}>
        {/* Upper wick */}
        <div style={{ width: 2, height: `${(wickUp / totalH) * 100}%`, backgroundColor: wickColor, borderRadius: 1 }} />
        {/* Body */}
        <div style={{
          width: 16,
          height: `${(body / totalH) * 100}%`,
          backgroundColor: bodyBg,
          border: `2px solid ${bodyColor}`,
          borderRadius: 2,
          minHeight: 4,
        }} />
        {/* Lower wick */}
        <div style={{ width: 2, height: `${(wickDown / totalH) * 100}%`, backgroundColor: wickColor, borderRadius: 1 }} />
      </div>
    </div>
  );
}

function SignalPill({ signal }: { signal: string }) {
  if (signal === "BUY") return <span className="px-2.5 py-0.5 bg-profit/20 border border-profit/30 text-profit text-xs font-bold rounded-full">BUY</span>;
  if (signal === "SELL") return <span className="px-2.5 py-0.5 bg-loss/20 border border-loss/30 text-loss text-xs font-bold rounded-full">SELL</span>;
  return <span className="px-2.5 py-0.5 bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-bold rounded-full">HOLD</span>;
}

export default function Learn() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm h-14 flex items-center px-4 justify-between">
        <Link href="/" className="flex items-center gap-2 font-black">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span>Trade<span className="text-primary">Flow</span></span>
        </Link>
        <Link href="/trade" className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:opacity-90 transition-opacity">
          Trade Now <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="pt-14 max-w-5xl mx-auto px-4 py-10">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-black mb-3">Learn to Read Chart Patterns</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            TradeFlow detects these 8 patterns in real-time. Understanding them helps you trade with confidence — or trust the AI to do it for you.
          </p>
        </div>

        {/* RSI explainer */}
        <div className="bg-card border border-primary/20 rounded-2xl p-5 mb-10">
          <h2 className="font-bold mb-2 text-primary">What is RSI?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            RSI (Relative Strength Index) measures whether an asset is overbought or oversold on a scale of 0–100.
            An RSI above 70 means the asset may be <span className="text-loss font-medium">overbought</span> (consider SELL).
            An RSI below 30 means it may be <span className="text-profit font-medium">oversold</span> (consider BUY).
            RSI between 40–60 is neutral — wait for pattern confirmation.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          {patterns.map((p) => (
            <div
              key={p.name}
              className={`bg-card border rounded-2xl p-5 hover:border-primary/30 transition-colors ${
                p.signal === "BUY" ? "border-profit/20" : p.signal === "SELL" ? "border-loss/20" : "border-border"
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Candle visual */}
                <div className="flex-shrink-0 w-16 flex justify-center">
                  <CandleVisual pattern={p} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="font-bold text-base">{p.name}</h3>
                    <SignalPill signal={p.signal} />
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">Confidence: <span className="text-foreground font-semibold">{p.confidence}</span></div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{p.description}</p>
                  <div className="flex items-start gap-1.5 bg-secondary/50 rounded-lg px-3 py-2">
                    <span className="text-primary text-xs font-bold mt-0.5 flex-shrink-0">TIP</span>
                    <p className="text-xs text-muted-foreground">{p.tip}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 text-center bg-card border border-primary/20 rounded-2xl p-8 glow-gold">
          <h2 className="text-2xl font-black mb-3">Ready to Put This Knowledge to Work?</h2>
          <p className="text-muted-foreground mb-6 text-sm">Enable the Auto-Invest bot to automatically trade when these patterns are detected.</p>
          <Link href="/trade" className="inline-flex items-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-opacity">
            Open Trading Platform <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
