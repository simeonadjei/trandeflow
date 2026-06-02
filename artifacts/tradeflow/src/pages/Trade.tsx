import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  useListAssets, useGetCandles, useAnalyzePattern, useListTrades,
  usePlaceTrade, useToggleAutoInvest, useGetAutoInvestStatus, useGetAccount,
  getListTradesQueryKey, getGetAccountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotifications, useAutoTradeNotifications } from "../lib/useNotifications";
import { TrendingUp, TrendingDown, ChevronDown, ArrowUpCircle, ArrowDownCircle, Bot, Clock, CheckCircle, XCircle, Settings, Activity, Bell, BellOff } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar, Line
} from "recharts";

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === "BUY") return <span className="px-2 py-0.5 bg-profit/20 border border-profit/30 text-profit text-xs font-bold rounded-full">BUY</span>;
  if (signal === "SELL") return <span className="px-2 py-0.5 bg-loss/20 border border-loss/30 text-loss text-xs font-bold rounded-full">SELL</span>;
  return <span className="px-2 py-0.5 bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-bold rounded-full">HOLD</span>;
}

function CandleChart({ candles, symbol }: { candles: any[]; symbol: string }) {
  const [liveCandles, setLiveCandles] = useState(candles);

  useEffect(() => {
    setLiveCandles(candles);
  }, [candles]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveCandles((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        const move = (Math.random() - 0.48) * last.close * 0.001;
        const newClose = last.close + move;
        return [
          ...prev.slice(0, -1),
          { ...last, close: newClose, high: Math.max(last.high, newClose), low: Math.min(last.low, newClose) },
        ];
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const chartData = liveCandles.map((c) => ({
    time: formatTime(c.time),
    price: c.close,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    isGreen: c.close >= c.open,
    bodyTop: Math.max(c.open, c.close),
    bodyBot: Math.min(c.open, c.close),
    bodyH: Math.abs(c.close - c.open),
  }));

  const prices = liveCandles.map((c) => c.close);
  const minP = Math.min(...prices) * 0.9995;
  const maxP = Math.max(...prices) * 1.0005;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#666" }} tickLine={false} axisLine={false} interval={9} />
          <YAxis
            domain={[minP, maxP]}
            tick={{ fontSize: 9, fill: "#666" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v > 100 ? v.toFixed(1) : v.toFixed(5)}
            width={60}
          />
          <Tooltip
            contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#888" }}
            itemStyle={{ color: "#22c55e" }}
            formatter={(v: number) => [v > 100 ? v.toFixed(2) : v.toFixed(5), "Price"]}
          />
          <Area dataKey="price" stroke="#22c55e" strokeWidth={1.5} fill="url(#priceGrad)" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradeTimer({ closedAt, duration, createdAt }: { closedAt: string | null; duration: number; createdAt: string }) {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = (Date.now() - new Date(createdAt).getTime()) / 1000;
    return Math.max(0, duration - elapsed);
  });

  useEffect(() => {
    if (closedAt) return;
    const iv = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [closedAt]);

  if (closedAt) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-400">
      <Clock className="w-3 h-3" />
      {Math.ceil(remaining)}s
    </span>
  );
}

export default function Trade() {
  const [selectedSymbol, setSelectedSymbol] = useState("EURUSD");
  const [amount, setAmount] = useState(50);
  const [duration, setDuration] = useState(60);
  const [showAssets, setShowAssets] = useState(false);
  const [autoSettings, setAutoSettings] = useState({ stake: 10, maxDaily: 10 });
  const [showSettings, setShowSettings] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  const queryClient = useQueryClient();
  const { requestPermission, notify } = useNotifications();

  const { data: assets } = useListAssets();
  const { data: candles } = useGetCandles(selectedSymbol, { query: { enabled: !!selectedSymbol } });
  const { data: pattern } = useAnalyzePattern(selectedSymbol, { query: { enabled: !!selectedSymbol, refetchInterval: 15000 } });
  const { data: trades, refetch: refetchTrades } = useListTrades({ query: { refetchInterval: 5000 } });
  const { data: autoStatus, refetch: refetchAuto } = useGetAutoInvestStatus();
  const { data: account } = useGetAccount({ query: { refetchInterval: 8000 } });

  // Map trades into lightweight snapshots for notification tracking
  const tradeSnapshots = trades?.map((t) => ({
    id: t.id,
    status: t.status,
    isAuto: t.isAuto ?? false,
    symbol: t.symbol,
    direction: t.direction as "UP" | "DOWN",
    amount: t.amount,
    profit: t.profit,
  }));

  useAutoTradeNotifications(tradeSnapshots, autoStatus?.enabled ?? false, notify);

  const placeTrade = usePlaceTrade({
    mutation: {
      onSuccess: () => {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
          refetchTrades();
        }, 1000);
      },
    },
  });

  const toggleAuto = useToggleAutoInvest({
    mutation: {
      onSuccess: async () => {
        refetchAuto();
        // When enabling, ask for notification permission
        if (!autoStatus?.enabled) {
          const granted = await requestPermission();
          setNotifPermission(granted ? "granted" : "denied");
        }
      },
    },
  });

  const selectedAsset = assets?.find((a) => a.symbol === selectedSymbol);
  const openTrades = trades?.filter((t) => t.status === "OPEN") ?? [];
  const closedTrades = trades?.filter((t) => t.status !== "OPEN").slice(0, 15) ?? [];

  const handleTrade = (direction: "UP" | "DOWN") => {
    placeTrade.mutate({ data: { symbol: selectedSymbol, direction, amount, duration } });
  };

  const signalColor = pattern?.signal === "BUY" ? "text-profit" : pattern?.signal === "SELL" ? "text-loss" : "text-yellow-400";

  return (
    <div className="min-h-screen bg-background text-foreground pt-0">
      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm h-14 flex items-center px-4 justify-between">
        <Link href="/" className="flex items-center gap-2 font-black">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span>Trade<span className="text-primary">Flow</span></span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {account && <span className="font-bold text-primary">GHS {account.balance.toFixed(2)}</span>}
          <Link href="/wallet" className="px-3 py-1 bg-secondary rounded-md text-xs font-medium hover:bg-secondary/80 transition-colors">Wallet</Link>
          <Link href="/" className="px-3 py-1 bg-secondary rounded-md text-xs font-medium hover:bg-secondary/80 transition-colors">Home</Link>
        </div>
      </div>

      <div className="pt-14 grid grid-cols-1 lg:grid-cols-3 min-h-screen">
        {/* Left — Chart + Pattern */}
        <div className="lg:col-span-2 border-r border-border flex flex-col">
          {/* Asset selector */}
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowAssets(!showAssets)}
                className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm font-semibold hover:border-primary/40 transition-colors"
              >
                <span>{selectedSymbol}</span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              {showAssets && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-card border border-border rounded-xl shadow-xl z-10 py-1 max-h-64 overflow-y-auto">
                  {assets?.map((a) => (
                    <button
                      key={a.symbol}
                      onClick={() => { setSelectedSymbol(a.symbol); setShowAssets(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary transition-colors ${a.symbol === selectedSymbol ? "text-primary" : ""}`}
                    >
                      <div>
                        <div className="font-semibold">{a.symbol}</div>
                        <div className="text-xs text-muted-foreground">{a.name}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-medium ${a.changePercent >= 0 ? "text-profit" : "text-loss"}`}>
                          {a.changePercent >= 0 ? "+" : ""}{a.changePercent.toFixed(2)}%
                        </div>
                        <div className="text-xs text-muted-foreground">{a.payout}% payout</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedAsset && (
              <>
                <span className="font-mono text-xl font-bold">
                  {selectedAsset.price.toFixed(selectedAsset.price > 100 ? 2 : 5)}
                </span>
                <span className={`text-sm font-medium ${selectedAsset.changePercent >= 0 ? "text-profit" : "text-loss"}`}>
                  {selectedAsset.changePercent >= 0 ? <TrendingUp className="inline w-3.5 h-3.5 mr-0.5" /> : <TrendingDown className="inline w-3.5 h-3.5 mr-0.5" />}
                  {selectedAsset.changePercent >= 0 ? "+" : ""}{selectedAsset.changePercent.toFixed(2)}%
                </span>
                <span className="ml-auto text-xs text-muted-foreground">Payout: <span className="text-primary font-bold">{selectedAsset.payout}%</span></span>
              </>
            )}
          </div>

          {/* Chart */}
          <div className="p-4">
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 bg-profit rounded-full live-pulse" />
                <span className="text-xs text-muted-foreground font-medium">LIVE CHART — {selectedSymbol}</span>
              </div>
              {candles && candles.length > 0 ? (
                <CandleChart candles={candles} symbol={selectedSymbol} />
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Loading chart...</div>
              )}
            </div>
          </div>

          {/* Pattern Analysis */}
          {pattern && (
            <div className="px-4 pb-4">
              <div className={`bg-card border rounded-xl p-4 ${pattern.signal === "BUY" ? "border-profit/30" : pattern.signal === "SELL" ? "border-loss/30" : "border-yellow-400/30"}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pattern Analysis</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{pattern.pattern}</span>
                      <SignalBadge signal={pattern.signal} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-black ${signalColor}`}>{pattern.confidence}%</div>
                    <div className="text-xs text-muted-foreground">Confidence</div>
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="h-1.5 bg-secondary rounded-full mb-3">
                  <div
                    className={`h-full rounded-full transition-all ${pattern.signal === "BUY" ? "bg-profit" : pattern.signal === "SELL" ? "bg-loss" : "bg-yellow-400"}`}
                    style={{ width: `${pattern.confidence}%` }}
                  />
                </div>

                <p className="text-sm text-muted-foreground mb-3">{pattern.reason}</p>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-secondary/50 rounded-lg p-2">
                    <div className="text-muted-foreground mb-0.5">RSI</div>
                    <div className={`font-bold ${pattern.rsi > 70 ? "text-loss" : pattern.rsi < 30 ? "text-profit" : "text-foreground"}`}>{pattern.rsi}</div>
                  </div>
                  <div className="bg-secondary/50 rounded-lg p-2">
                    <div className="text-muted-foreground mb-0.5">Trend</div>
                    <div className="font-bold">{pattern.trend}</div>
                  </div>
                  <div className="bg-secondary/50 rounded-lg p-2">
                    <div className="text-muted-foreground mb-0.5">Support</div>
                    <div className="font-bold text-profit">{pattern.supportLevel?.toFixed(4)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Closed Trades */}
          <div className="px-4 pb-4 flex-1">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Trade History
            </h3>
            <div className="space-y-2">
              {closedTrades.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">No trades yet. Place your first trade!</div>
              )}
              {closedTrades.map((t) => (
                <div key={t.id} className={`flex items-center justify-between bg-card border rounded-lg px-3 py-2.5 text-sm ${t.status === "WIN" ? "border-profit/20" : "border-loss/20"}`}>
                  <div className="flex items-center gap-2">
                    {t.status === "WIN"
                      ? <CheckCircle className="w-3.5 h-3.5 text-profit" />
                      : <XCircle className="w-3.5 h-3.5 text-loss" />
                    }
                    <div>
                      <span className="font-semibold">{t.symbol}</span>
                      <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded font-medium ${t.direction === "UP" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>
                        {t.direction}
                      </span>
                      {t.isAuto && <span className="ml-1 text-xs text-muted-foreground">[Auto]</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${t.profit !== null && t.profit >= 0 ? "text-profit" : "text-loss"}`}>
                      {t.profit !== null ? `${t.profit >= 0 ? "+" : ""}GHS ${t.profit.toFixed(2)}` : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">GHS {t.amount.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Trade Panel */}
        <div className="flex flex-col border-t lg:border-t-0 border-border">
          {/* Trade Controls */}
          <div className="p-4 border-b border-border">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Place Trade
            </h3>

            {/* Amount */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Stake Amount (GHS)</label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono font-semibold focus:outline-none focus:border-primary transition-colors"
              />
              <div className="flex gap-1.5 mt-2">
                {[10, 25, 50, 100].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className={`flex-1 py-1 text-xs rounded font-medium transition-colors ${amount === v ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div className="mb-6">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Duration</label>
              <div className="flex gap-1.5">
                {[{ l: "1 min", v: 60 }, { l: "3 min", v: 180 }, { l: "5 min", v: 300 }].map((d) => (
                  <button
                    key={d.v}
                    onClick={() => setDuration(d.v)}
                    className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${duration === d.v ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
            </div>

            {/* Potential payout */}
            {selectedAsset && (
              <div className="bg-profit/10 border border-profit/20 rounded-lg p-3 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">If you win:</span>
                  <span className="font-bold text-profit">+GHS {(amount * selectedAsset.payout / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-muted-foreground">Payout rate:</span>
                  <span className="font-semibold">{selectedAsset.payout}%</span>
                </div>
              </div>
            )}

            {/* Trade Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleTrade("UP")}
                disabled={placeTrade.isPending}
                className="flex flex-col items-center gap-1.5 py-4 bg-profit/15 border border-profit/30 rounded-xl font-bold text-profit hover:bg-profit/25 transition-colors disabled:opacity-50"
              >
                <ArrowUpCircle className="w-7 h-7" />
                <span className="text-sm">UP</span>
                <span className="text-xs font-normal text-profit/70">Price goes higher</span>
              </button>
              <button
                onClick={() => handleTrade("DOWN")}
                disabled={placeTrade.isPending}
                className="flex flex-col items-center gap-1.5 py-4 bg-loss/15 border border-loss/30 rounded-xl font-bold text-loss hover:bg-loss/25 transition-colors disabled:opacity-50"
              >
                <ArrowDownCircle className="w-7 h-7" />
                <span className="text-sm">DOWN</span>
                <span className="text-xs font-normal text-loss/70">Price goes lower</span>
              </button>
            </div>
          </div>

          {/* Auto-Invest */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                <span className="font-bold text-sm">Auto-Invest Bot</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowSettings(!showSettings)} className="p-1 rounded hover:bg-secondary transition-colors">
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={() => toggleAuto.mutate({ data: { enabled: !autoStatus?.enabled, stakeAmount: autoSettings.stake, maxDailyTrades: autoSettings.maxDaily } })}
                  className={`relative w-10 h-5 rounded-full transition-colors ${autoStatus?.enabled ? "bg-profit" : "bg-secondary"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${autoStatus?.enabled ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
            </div>

            {autoStatus?.enabled && (
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs text-profit">
                  <div className="w-1.5 h-1.5 bg-profit rounded-full live-pulse" />
                  Bot is active — trading automatically
                </div>
                {notifPermission === "granted" ? (
                  <span className="flex items-center gap-1 text-xs text-profit">
                    <Bell className="w-3 h-3" /> Alerts ON
                  </span>
                ) : notifPermission === "denied" ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <BellOff className="w-3 h-3" /> Alerts blocked
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      const granted = await requestPermission();
                      setNotifPermission(granted ? "granted" : "denied");
                    }}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Bell className="w-3 h-3" /> Enable alerts
                  </button>
                )}
              </div>
            )}

            {showSettings && (
              <div className="space-y-3 mt-3 p-3 bg-card border border-border rounded-lg text-sm">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Stake per trade (GHS)</label>
                  <input
                    type="number"
                    value={autoSettings.stake}
                    onChange={(e) => setAutoSettings((s) => ({ ...s, stake: Number(e.target.value) }))}
                    className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max trades/day</label>
                  <input
                    type="number"
                    value={autoSettings.maxDaily}
                    onChange={(e) => setAutoSettings((s) => ({ ...s, maxDaily: Number(e.target.value) }))}
                    className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs mt-3">
              <div className="bg-card border border-border rounded-lg p-2">
                <div className="text-muted-foreground">Trades Today</div>
                <div className="font-bold">{autoStatus?.tradesToday ?? 0} / {autoStatus?.maxDailyTrades ?? 10}</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-2">
                <div className="text-muted-foreground">Auto Stake</div>
                <div className="font-bold text-primary">GHS {autoStatus?.stakeAmount?.toFixed(2) ?? "10.00"}</div>
              </div>
            </div>
          </div>

          {/* Open Trades */}
          <div className="p-4 flex-1">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Open Trades ({openTrades.length})
            </h3>
            <div className="space-y-2">
              {openTrades.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-xs">No open trades</div>
              )}
              {openTrades.map((t) => (
                <div key={t.id} className="bg-card border border-yellow-400/20 rounded-lg px-3 py-2.5 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{t.symbol}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${t.direction === "UP" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>
                        {t.direction}
                      </span>
                    </div>
                    <TradeTimer closedAt={t.closedAt} duration={t.duration} createdAt={t.createdAt} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>GHS {t.amount.toFixed(2)}</span>
                    <span>Entry: {t.entryPrice.toFixed(t.entryPrice > 100 ? 2 : 5)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
