import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useListAssets, useGetCandles, useAnalyzePattern, useListTrades,
  usePlaceTrade, useGetAccount, useUpdateAccountSettings,
  getListTradesQueryKey, getGetAccountQueryKey,
  getGetCandlesQueryKey, getAnalyzePatternQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotifications } from "../lib/useNotifications";
import { useDemoMode } from "../lib/DemoModeContext";
import { useAuth } from "../lib/AuthContext";
import { apiBase } from "../lib/api";
import { TrendingUp, TrendingDown, ChevronDown, Clock, CheckCircle, XCircle, FlaskConical, Zap, StopCircle, Activity, ArrowUpToLine, ArrowDownToLine, ShieldCheck, ChevronUp, Wallet, RefreshCw } from "lucide-react";
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
  const [tradePercent, setTradePercent] = useState(50);
  const [showAssets, setShowAssets] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminPanelOpen, setAdminPanelOpen] = useState(true);
  const [lossLimitInput, setLossLimitInput] = useState("");
  const [lossLimitSaving, setLossLimitSaving] = useState(false);
  const [lossLimitSaved, setLossLimitSaved] = useState(false);

  const { isDemo, toggleDemo } = useDemoMode();
  const { user, logout, token, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { notify, requestPermission } = useNotifications();
  // Request notification permission once on mount (silently)
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      requestPermission();
    }
  }, []);

  // Poll session status every second; fire notification when a trade closes
  const prevSessionRef = useRef<any>(null);
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await fetch(`${apiBase}/api/session/status`).then(r => r.json());
        // Detect a newly closed trade by lastResult changing
        const prev = prevSessionRef.current;
        if (
          prev &&
          data.sessionTrades > prev.sessionTrades &&
          data.lastResult
        ) {
          const won = data.lastResult === "WIN";
          const profitAmt = Math.abs(data.lastProfit ?? 0);
          const sym: string = data.asset ?? data.symbol ?? "";
          if (won) {
            notify({ type: "win", symbol: sym, profit: profitAmt });
          } else {
            notify({ type: "loss", symbol: sym, amount: profitAmt });
          }
          // Refresh account balance immediately so MEXC USDT balance updates
          queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        }
        prevSessionRef.current = data;
        setSession(data);
      } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 1000);
    return () => clearInterval(iv);
  }, [notify]);

  // Fetch admin stats every 15s when logged in as admin
  useEffect(() => {
    if (!isAdmin || !token) return;
    const fetchStats = () =>
      fetch(`${apiBase}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setAdminStats(d); })
        .catch(() => {});
    fetchStats();
    const iv = setInterval(fetchStats, 15_000);
    return () => clearInterval(iv);
  }, [isAdmin, token]);

  const { data: assets } = useListAssets();
  const { data: candles } = useGetCandles(selectedSymbol, { query: { enabled: !!selectedSymbol, queryKey: getGetCandlesQueryKey(selectedSymbol) } });
  const { data: pattern } = useAnalyzePattern(selectedSymbol, { query: { enabled: !!selectedSymbol, refetchInterval: 15000, queryKey: getAnalyzePatternQueryKey(selectedSymbol) } });
  const { data: trades, refetch: refetchTrades } = useListTrades({ query: { refetchInterval: 3000, queryKey: getListTradesQueryKey() } });
  const { data: account } = useGetAccount({ query: { refetchInterval: 3000, queryKey: getGetAccountQueryKey() } });
  const updateSettings = useUpdateAccountSettings();

  // Sync loss limit input from server once on load
  useEffect(() => {
    if (account?.dailyLossLimit !== undefined && lossLimitInput === "") {
      setLossLimitInput(account.dailyLossLimit === 0 ? "" : String(account.dailyLossLimit));
    }
  }, [account?.dailyLossLimit]);

  // In real mode: use MEXC free USDT as the effective balance.
  const realEffectiveBalance = account?.mexcConnected && account?.mexcFreeUsdt != null
    ? account.mexcFreeUsdt
    : (account?.balance ?? 0);

  const handleStartSession = async () => {
    // Guard: must have at least 1 USDT free on MEXC before bot can run
    if (!isDemo && !realBalanceSufficient) {
      return; // button is disabled anyway, but belt-and-suspenders
    }
    setSessionLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradePercent }),
      });
      const data = await res.json();
      setSession(data.status);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleStopSession = async () => {
    setSessionLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/session/stop`, { method: "POST" });
      const data = await res.json();
      setSession(data.status);
    } finally {
      setSessionLoading(false);
    }
  };

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

  const selectedAsset = assets?.find((a) => a.symbol === selectedSymbol);
  // In real mode with MEXC connected, show free USDT as the display balance
  const displayBalance = isDemo
    ? (account?.demoBalance ?? 0)
    : realEffectiveBalance;
  const displayCurrency = isDemo ? "GHS" : (account?.mexcConnected ? "USDT" : "GHS");

  // Stake is always derived from the % slider — minimum 1 unit
  const amount = Math.max(1, parseFloat(((displayBalance * tradePercent) / 100).toFixed(2)));

  // When the user types a manual amount, back-calculate the matching %
  const handleManualAmount = (val: number) => {
    if (!val || val <= 0 || displayBalance <= 0) return;
    const pct = Math.min(100, Math.max(1, Math.round((val / displayBalance) * 100)));
    setTradePercent(pct);
  };
  const modeTrades = trades?.filter((t) => (isDemo ? t.isDemo : !t.isDemo)) ?? [];
  const openTrades = modeTrades.filter((t) => t.status === "OPEN");
  const closedTrades = modeTrades.filter((t) => t.status !== "OPEN").slice(0, 15);

  const handleTrade = (direction: "UP" | "DOWN") => {
    placeTrade.mutate({ data: { symbol: selectedSymbol, direction, amount, duration: 60, isDemo } });
  };

  const tradeBlocked = placeTrade.isPending || (
    isDemo ? (displayBalance < amount || displayBalance <= 0) : false
  );

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
          {/* Demo / Real toggle */}
          <button
            onClick={toggleDemo}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              isDemo
                ? "bg-purple-500/20 border-purple-500/50 text-purple-300 hover:bg-purple-500/30"
                : "bg-profit/10 border-profit/30 text-profit hover:bg-profit/20"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {isDemo ? "DEMO" : "REAL"}
          </button>

          {/* Balance + session profit */}
          <div className="text-right">
            <div className={`font-bold text-sm ${isDemo ? "text-purple-300" : "text-primary"}`}>
              {displayCurrency} {displayBalance.toFixed(2)}
            </div>
            <div className="text-[10px] leading-none flex items-center justify-end gap-1">
              {!isDemo && session?.active && (
                <span className={session.sessionProfit >= 0 ? "text-profit font-semibold" : "text-loss font-semibold"}>
                  {session.sessionProfit >= 0 ? "+" : ""}USDT {(session.sessionProfit ?? 0).toFixed(4)}
                </span>
              )}
              <span className="text-muted-foreground">{isDemo ? "Demo" : "Real"}</span>
            </div>
          </div>

          <Link href="/wallet?tab=deposit" className="px-3 py-1 bg-profit/20 border border-profit/40 text-profit text-xs font-bold rounded-md hover:bg-profit/30 transition-colors flex items-center gap-1">
            <ArrowUpToLine className="w-3 h-3" /> Deposit
          </Link>
          <Link href="/wallet?tab=withdraw" className="px-3 py-1 bg-primary/20 border border-primary/40 text-primary text-xs font-bold rounded-md hover:bg-primary/30 transition-colors flex items-center gap-1">
            <ArrowDownToLine className="w-3 h-3" /> Withdraw
          </Link>
          <Link href="/" className="px-3 py-1 bg-secondary rounded-md text-xs font-medium hover:bg-secondary/80 transition-colors">Home</Link>
          {user ? (
            <div className="flex items-center gap-2">
              {user.role === "admin" && (
                <Link href="/admin" className="px-3 py-1 bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-md hover:bg-primary/30 transition-colors">Admin</Link>
              )}
              <button onClick={logout} className="px-3 py-1 bg-secondary rounded-md text-xs font-medium hover:bg-secondary/80 transition-colors text-muted-foreground">Logout</button>
            </div>
          ) : (
            <Link href="/login" className="px-3 py-1 bg-primary text-primary-foreground text-xs font-bold rounded-md hover:opacity-90 transition-opacity">Login</Link>
          )}
        </div>
      </div>

      {/* Admin stats panel — shown below top bar when logged in as admin */}
      {isAdmin && (
        <div className="fixed top-14 left-0 right-0 z-40 border-b border-primary/20 bg-primary/5 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1.5 text-primary text-xs font-bold shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>ADMIN</span>
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            {adminStats ? (
              <>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">Spot Balance</span>
                  <span className="text-xs font-bold text-primary">
                    {account?.mexcConnected
                      ? `${(account.mexcFreeUsdt ?? 0).toFixed(4)} USDT`
                      : `GHS ${(account?.balance ?? 0).toFixed(2)}`}
                  </span>
                </div>
                <div className="w-px h-4 bg-border shrink-0" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">Trades</span>
                  <span className="text-xs font-bold">{adminStats.totalTrades}</span>
                  <span className="text-[10px] text-yellow-400">{adminStats.openTrades} open</span>
                </div>
                <div className="w-px h-4 bg-border shrink-0" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">Deposited</span>
                  <span className="text-xs font-bold text-profit">GHS {adminStats.totalDeposited.toFixed(2)}</span>
                </div>
                <div className="w-px h-4 bg-border shrink-0" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">Withdrawn</span>
                  <span className="text-xs font-bold text-loss">GHS {adminStats.totalWithdrawn.toFixed(2)}</span>
                </div>
                <div className="w-px h-4 bg-border shrink-0" />
                <Link href="/admin" className="text-[10px] font-bold text-primary border border-primary/30 rounded px-2 py-0.5 hover:bg-primary/20 transition-colors shrink-0">
                  Full Admin →
                </Link>
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">Loading stats…</span>
            )}
            <div className="flex-1" />
            <button onClick={() => setAdminPanelOpen(o => !o)} className="text-muted-foreground hover:text-foreground shrink-0">
              <ChevronUp className={`w-3.5 h-3.5 transition-transform ${adminPanelOpen ? "" : "rotate-180"}`} />
            </button>
          </div>
        </div>
      )}

      {/* Demo mode banner */}
      {isDemo && (
        <div className={`fixed ${isAdmin ? "top-[88px]" : "top-14"} left-0 right-0 z-39 bg-purple-500/15 border-b border-purple-500/30 px-4 py-2 flex items-center justify-between`}>
          <div className="flex items-center gap-2 text-xs text-purple-300">
            <FlaskConical className="w-3.5 h-3.5" />
            <span className="font-semibold">DEMO MODE</span>
            <span className="text-purple-400/70">— You're trading with virtual GHS. No real money at risk.</span>
          </div>
          <button
            onClick={toggleDemo}
            className="text-xs text-purple-300 hover:text-purple-100 font-semibold border border-purple-500/40 rounded px-2 py-0.5 hover:bg-purple-500/20 transition-colors"
          >
            Switch to Real →
          </button>
        </div>
      )}

      {/* Calculate top padding based on active banners */}
      <div className={`${isAdmin && isDemo ? "pt-[128px]" : isAdmin || isDemo ? "pt-[92px]" : "pt-14"} grid grid-cols-1 lg:grid-cols-3 min-h-screen`}>
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
                    <div className={`font-bold ${(pattern.rsi ?? 50) > 70 ? "text-loss" : (pattern.rsi ?? 50) < 30 ? "text-profit" : "text-foreground"}`}>{pattern.rsi}</div>
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
                    <div className={`font-bold ${t.profit != null && t.profit >= 0 ? "text-profit" : "text-loss"}`}>
                      {t.profit != null
                        ? `${t.profit >= 0 ? "+" : ""}${t.isAuto ? "USDT" : (isDemo ? "GHS" : displayCurrency)} ${t.profit.toFixed(t.isAuto ? 4 : 2)}`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.isAuto ? "USDT" : (isDemo ? "GHS" : displayCurrency)} {t.amount.toFixed(t.isAuto ? 4 : 2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Trade Panel */}
        <div className="flex flex-col border-t lg:border-t-0 border-border">
          {/* Trade Controls */}
          <div className={`p-4 border-b border-border ${isDemo ? "bg-purple-500/5" : ""}`}>
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <TrendingUp className={`w-4 h-4 ${isDemo ? "text-purple-400" : "text-primary"}`} />
              Place Trade
              {isDemo && (
                <span className="ml-1 px-2 py-0.5 bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs rounded-full font-semibold flex items-center gap-1">
                  <FlaskConical className="w-3 h-3" /> DEMO
                </span>
              )}
            </h3>

            {/* Bot stake % selector */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-muted-foreground font-medium">Trade with (% of balance)</label>
                <span className="text-xs font-mono font-bold text-primary">{tradePercent}%</span>
              </div>
              {/* Quick % presets */}
              <div className="flex gap-1.5 mb-2">
                {[10, 25, 50, 75, 100].map((v) => (
                  <button
                    key={v}
                    onClick={() => setTradePercent(v)}
                    className={`flex-1 py-1.5 text-xs rounded-lg font-bold transition-colors ${tradePercent === v ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
              {/* Slider */}
              <input
                type="range"
                min={1}
                max={100}
                value={tradePercent}
                onChange={(e) => setTradePercent(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              {/* GHS preview */}
              <div className="flex justify-between text-[11px] mt-1.5">
                <span className="text-muted-foreground">Stake per trade:</span>
                <span className="font-mono font-semibold text-foreground">
                  {displayCurrency} {((displayBalance * tradePercent) / 100).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Stake amount — linked to % slider above */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                Stake per trade ({displayCurrency})
                <span className="ml-1.5 text-primary font-bold">{tradePercent}% of balance</span>
              </label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => handleManualAmount(Number(e.target.value))}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono font-semibold focus:outline-none focus:border-primary transition-colors"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Adjust the % slider above to change this, or type an amount to sync the slider.
              </p>
            </div>

            {/* Daily loss limit */}
            {!isDemo && (
              <div className="mb-4 border border-border rounded-lg p-3 bg-card/50">
                <div className="flex items-center gap-1.5 mb-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-xs font-semibold text-muted-foreground">Balance Loss Limit</span>
                  {(account?.dailyLossLimit ?? 0) > 0 && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-yellow-400/15 border border-yellow-400/30 text-yellow-400 font-semibold">
                      Active: {account!.dailyLossLimit}%
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      placeholder="e.g. 40"
                      value={lossLimitInput}
                      onChange={(e) => { setLossLimitInput(e.target.value); setLossLimitSaved(false); }}
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 pr-7 text-sm font-mono focus:outline-none focus:border-primary transition-colors"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">%</span>
                  </div>
                  <button
                    disabled={lossLimitSaving}
                    onClick={async () => {
                      setLossLimitSaving(true);
                      try {
                        const val = parseFloat(lossLimitInput) || 0;
                        await updateSettings.mutateAsync({ data: { dailyLossLimit: val } });
                        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
                        setLossLimitSaved(true);
                        setTimeout(() => setLossLimitSaved(false), 2000);
                      } finally {
                        setLossLimitSaving(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {lossLimitSaving ? "…" : lossLimitSaved ? "✓" : "Save"}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Bot stops when balance drops by this % from session start. E.g. 40 = stop if $100 falls to $60. Set to 0 to disable.
                </p>
              </div>
            )}

            {/* Payout info */}
            {selectedAsset && (
              <div className="bg-profit/10 border border-profit/20 rounded-lg p-3 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">If you win:</span>
                  <span className="font-bold text-profit">+{displayCurrency} {amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-muted-foreground">Duration · Payout:</span>
                  <span className="font-semibold">1 min · 100%</span>
                </div>
              </div>
            )}

            {/* ── Manual UP / DOWN trade buttons ── */}
            {(() => {
              const isMexcSymbol = selectedSymbol === "BTCUSD" || selectedSymbol === "ETHUSD";
              const isRealMexc = !isDemo && account?.mexcConnected;
              const upIsReal = isRealMexc && isMexcSymbol;
              return (
                <div className="mb-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleTrade("UP")}
                      disabled={tradeBlocked}
                      className="py-3 rounded-xl font-black text-sm tracking-wide bg-profit hover:bg-profit/90 text-white transition-all disabled:opacity-40 flex flex-col items-center justify-center gap-0.5 shadow-md shadow-profit/20"
                    >
                      <TrendingUp className="w-4 h-4" />
                      <span>▲ UP</span>
                      {upIsReal && (
                        <span className="text-[9px] font-normal opacity-80">Real MEXC</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleTrade("DOWN")}
                      disabled={tradeBlocked}
                      className="py-3 rounded-xl font-black text-sm tracking-wide bg-loss hover:bg-loss/90 text-white transition-all disabled:opacity-40 flex flex-col items-center justify-center gap-0.5 shadow-md shadow-loss/20"
                    >
                      <TrendingDown className="w-4 h-4" />
                      <span>▼ DOWN</span>
                      {isRealMexc && isMexcSymbol && (
                        <span className="text-[9px] font-normal opacity-80">Simulated</span>
                      )}
                    </button>
                  </div>
                  {isDemo && displayBalance < amount && (
                    <p className="text-[11px] text-center text-yellow-400">
                      Need ≥ {displayCurrency} {amount} demo balance
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Spot Balance — shown below trade buttons in real mode */}
            {!isDemo && account?.mexcConnected && (
              <div className="mb-4 bg-card border border-primary/20 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    <Wallet className="w-3.5 h-3.5 text-primary" />
                    Spot Balance (MEXC)
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-primary">
                      {(account.mexcFreeUsdt ?? 0).toFixed(4)} USDT
                    </div>
                    <div className="text-[10px] text-muted-foreground">Free to trade</div>
                  </div>
                </div>
                {(account.mexcLockedUsdt ?? 0) > 0 && (
                  <div className="flex justify-between text-[11px] border-t border-border pt-1.5 mt-1.5">
                    <span className="text-muted-foreground">In Orders</span>
                    <span className="font-mono font-semibold text-yellow-400">{(account.mexcLockedUsdt ?? 0).toFixed(4)} USDT</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Bot TRADE / STOP Button ── */}
            <div className="border-t border-border pt-3 mt-1 space-y-3">

              {/* Signal strength bars — only show when session active */}
              {session?.active && session?.phase !== "idle" && (
                <div className="bg-card border border-border rounded-xl p-3 space-y-2">
                  {/* Status message */}
                  {/* Pre-trade: big confidence display */}
                  {session.phase === "pre-trade" ? (
                    <div className="text-center py-2">
                      <div className="text-4xl font-black text-profit mb-1">
                        {session.winConfidence}%
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">Win confidence</div>
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold mb-3 ${
                        session.direction === "UP"
                          ? "bg-profit/20 border border-profit/40 text-profit"
                          : "bg-loss/20 border border-loss/40 text-loss"
                      }`}>
                        {session.direction === "UP" ? "▲ UP" : "▼ DOWN"} on {session.asset}
                      </div>
                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Zap className="w-3.5 h-3.5 text-yellow-400" />
                        <span>Trading in <span className="font-bold text-yellow-400">{session.preTradeIn}s</span></span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {session.phase === "analyzing" || session.phase === "waiting" ? (
                        <div className="w-1.5 h-1.5 bg-primary rounded-full live-pulse shrink-0" />
                      ) : session.lastResult === "WIN" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-profit shrink-0" />
                      ) : session.lastResult === "LOSS" ? (
                        <XCircle className="w-3.5 h-3.5 text-loss shrink-0" />
                      ) : (
                        <Zap className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                      )}
                      <span className={`text-xs font-semibold ${
                        session.phase === "trading" ? "text-yellow-400" :
                        session.lastResult === "WIN" ? "text-profit" :
                        session.lastResult === "LOSS" ? "text-loss" : "text-muted-foreground"
                      }`}>
                        {session.message || "Initialising…"}
                      </span>
                    </div>
                  )}

                  {/* Trading countdown */}
                  {session.phase === "trading" && session.countdown > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {session.direction === "UP" ? "▲ UP" : "▼ DOWN"} on <span className="text-foreground font-semibold">{session.asset}</span>
                        <span className="ml-1.5 text-[10px] text-profit/70">{session.winConfidence}% confidence</span>
                      </span>
                      <span className="font-mono font-bold text-yellow-400">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {session.countdown}s
                      </span>
                    </div>
                  )}

                  {/* Signal score bars */}
                  {(session.upScore > 0 || session.downScore > 0) && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-profit w-16">UP  {session.upScore}/8</span>
                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-profit rounded-full transition-all" style={{ width: `${(session.upScore / 8) * 100}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-loss w-16">DN  {session.downScore}/8</span>
                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-loss rounded-full transition-all" style={{ width: `${(session.downScore / 8) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Session stats */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <div className="bg-background rounded-lg p-1.5 text-center">
                      <div className="text-[10px] text-muted-foreground">Trades</div>
                      <div className="font-bold text-xs">{session.sessionTrades}</div>
                    </div>
                    <div className="bg-background rounded-lg p-1.5 text-center">
                      <div className="text-[10px] text-muted-foreground">Won</div>
                      <div className="font-bold text-xs text-profit">{session.sessionWins}</div>
                    </div>
                    <div className="bg-background rounded-lg p-1.5 text-center">
                      <div className="text-[10px] text-muted-foreground">Profit</div>
                      <div className={`font-bold text-xs ${session.sessionProfit >= 0 ? "text-profit" : "text-loss"}`}>
                        {session.sessionProfit >= 0 ? "+" : ""}USDT {session.sessionProfit.toFixed(4)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!session?.active ? (
                <button
                  onClick={handleStartSession}
                  disabled={sessionLoading || isDemo}
                  className="w-full py-3.5 rounded-xl font-black text-sm tracking-wide bg-primary hover:bg-primary/90 text-primary-foreground transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
                >
                  <Activity className="w-4 h-4" />
                  {sessionLoading ? "Starting…" : "START AUTO BOT"}
                </button>
              ) : (
                <button
                  onClick={handleStopSession}
                  disabled={sessionLoading}
                  className="w-full py-3.5 rounded-xl font-black text-sm tracking-wide bg-loss hover:bg-loss/90 text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-loss/20"
                >
                  <StopCircle className="w-4 h-4" />
                  {sessionLoading ? "Stopping…" : "STOP BOT"}
                </button>
              )}

              {isDemo && (
                <p className="text-center text-xs text-muted-foreground">Bot runs in <strong className="text-foreground">Real</strong> mode only. Use UP/DOWN above to trade in demo.</p>
              )}
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
                    <TradeTimer closedAt={t.closedAt ?? null} duration={t.duration} createdAt={t.createdAt} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>USDT {t.amount.toFixed(4)}</span>
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
