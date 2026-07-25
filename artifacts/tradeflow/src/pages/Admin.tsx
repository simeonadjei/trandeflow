import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../lib/AuthContext";
import { apiBase } from "../lib/api";
import {
  TrendingUp, Users, BarChart2, DollarSign, ArrowUpToLine, ArrowDownToLine,
  Activity, LogOut, RefreshCw, ShieldCheck, Clock, Loader2, Menu, X,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";

interface AdminStats {
  totalUsers: number; totalTrades: number; openTrades: number;
  totalDeposited: number; totalWithdrawn: number;
  platformRevenue: number; revenueFromWinCut: number; revenueFromLosses: number;
}
interface AdminUser { id: number; name: string; email: string; role: string; createdAt: string; }
interface AdminTrade { id: number; symbol: string; direction: string; amount: number; profit: number | null; status: string; isAuto: boolean; isDemo: boolean; createdAt: string; }
interface AdminEarning { id: number; tradeId: number | null; amount: number; type: string; symbol: string; createdAt: string; }
interface AdminDeposit { id: number; amount: number; momoProvider: string; momoNumber: string; status: string; reference: string; createdAt: string; }
interface AdminWithdrawal { id: number; amount: number; momoProvider: string; momoNumber: string; status: string; createdAt: string; }

type Tab = "overview" | "users" | "trades" | "earnings" | "deposits" | "withdrawals";

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }: {
  icon: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMPLETED: "text-profit bg-profit/15 border-profit/30",
    WIN: "text-profit bg-profit/15 border-profit/30",
    PROCESSING: "text-yellow-400 bg-yellow-400/15 border-yellow-400/30",
    OPEN: "text-yellow-400 bg-yellow-400/15 border-yellow-400/30",
    PENDING: "text-muted-foreground bg-secondary border-border",
    LOSS: "text-loss bg-loss/15 border-loss/30",
    FAILED: "text-loss bg-loss/15 border-loss/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${map[status] ?? "text-muted-foreground bg-secondary border-border"}`}>
      {status}
    </span>
  );
}

export default function Admin() {
  const [, navigate] = useLocation();
  const { user, token, logout, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [trades, setTrades] = useState<AdminTrade[]>([]);
  const [earnings, setEarnings] = useState<AdminEarning[]>([]);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  const apiFetch = async (path: string) => {
    const res = await fetch(`${apiBase}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, u, t, e, d, w] = await Promise.all([
        apiFetch("/admin/stats"), apiFetch("/admin/users"), apiFetch("/admin/trades"),
        apiFetch("/admin/earnings"), apiFetch("/admin/deposits"), apiFetch("/admin/withdrawals"),
      ]);
      setStats(s); setUsers(u); setTrades(t); setEarnings(e); setDeposits(d); setWithdrawals(w);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!isAdmin) { navigate("/login"); return; }
    loadAll();
    const iv = setInterval(() => apiFetch("/admin/stats").then(setStats).catch(() => {}), 15000);
    return () => clearInterval(iv);
  }, [isAdmin]);

  if (!isAdmin) return null;

  const TABS: { id: Tab; label: string; short: string; icon: any }[] = [
    { id: "overview",     label: "Overview",          short: "Overview",    icon: BarChart2 },
    { id: "users",        label: `Users (${users.length})`, short: "Users", icon: Users },
    { id: "trades",       label: `Trades (${trades.length})`, short: "Trades", icon: Activity },
    { id: "earnings",     label: "Earnings",           short: "Earnings",   icon: DollarSign },
    { id: "deposits",     label: "Deposits",           short: "Deposits",   icon: ArrowUpToLine },
    { id: "withdrawals",  label: "Withdrawals",        short: "Withdraws",  icon: ArrowDownToLine },
  ];

  const selectTab = (t: Tab) => { setTab(t); setDrawerOpen(false); };

  const revenueChartData = [
    { name: "Wins", value: stats?.revenueFromWinCut ?? 0, color: "#22c55e" },
    { name: "Losses", value: stats?.revenueFromLosses ?? 0, color: "#ef4444" },
  ];
  const winTrades = trades.filter(t => t.status === "WIN" && !t.isDemo).length;
  const lossTrades = trades.filter(t => t.status === "LOSS" && !t.isDemo).length;
  const tradeChartData = [
    { name: "WIN", value: winTrades, color: "#22c55e" },
    { name: "LOSS", value: lossTrades, color: "#ef4444" },
    { name: "OPEN", value: trades.filter(t => t.status === "OPEN").length, color: "#f59e0b" },
  ];

  const sidebarW = sidebarCollapsed ? "w-14" : "w-52";

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── TOP NAVBAR ── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-3 gap-3">
        {/* Hamburger (mobile only) */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-black text-sm">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="hidden xs:inline">Trade<span className="text-primary">Flow</span></span>
        </Link>
        <span className="px-2 py-0.5 bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-full flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          <span className="hidden sm:inline">Admin</span>
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Current tab label (mobile) */}
        <span className="md:hidden text-xs font-semibold text-muted-foreground capitalize">{tab}</span>

        {/* Refresh button */}
        <button
          onClick={loadAll}
          className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>

        {/* User + logout (desktop) */}
        <span className="hidden sm:inline text-xs text-muted-foreground">{user?.name}</span>
        <button
          onClick={() => { logout(); navigate("/login"); }}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-secondary transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>

      {/* ── MOBILE DRAWER OVERLAY ── */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <div className="relative z-10 w-64 bg-card border-r border-border flex flex-col h-full shadow-2xl">
            {/* Drawer header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border">
              <span className="font-bold text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> Admin Panel
              </span>
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Tabs */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTab(t.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-left transition-colors ${tab === t.id ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                >
                  <t.icon className="w-4 h-4 shrink-0" /> {t.label}
                </button>
              ))}
            </nav>
            {/* Drawer footer */}
            <div className="p-4 border-t border-border">
              <div className="text-xs text-muted-foreground mb-2">{user?.email}</div>
              <button
                onClick={() => { logout(); navigate("/login"); }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-loss border border-loss/30 rounded-lg hover:bg-loss/10 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BODY: sidebar + content ── */}
      <div className="pt-14 flex min-h-screen">

        {/* Desktop sidebar */}
        <div className={`hidden md:flex fixed top-14 left-0 bottom-0 ${sidebarW} border-r border-border bg-card/50 flex-col transition-all duration-200 overflow-hidden`}>
          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="absolute -right-3 top-4 z-10 w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center hover:bg-primary/20 transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>

          <nav className="flex-1 overflow-y-auto p-2 space-y-1 mt-2">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={sidebarCollapsed ? t.label : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${tab === t.id ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
              >
                <t.icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{t.label}</span>}
              </button>
            ))}
          </nav>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className={`flex-1 ${sidebarCollapsed ? "md:ml-14" : "md:ml-52"} transition-all duration-200 min-w-0`}>
          {/* Mobile horizontal tab scroll bar */}
          <div className="md:hidden flex overflow-x-auto gap-1.5 px-3 py-2 border-b border-border bg-card/50 scrollbar-none">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${tab === t.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
              >
                <t.icon className="w-3 h-3" /> {t.short}
              </button>
            ))}
          </div>

          <div className="p-4 md:p-6">
            {loading && !stats ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {/* ── OVERVIEW ── */}
                {tab === "overview" && stats && (
                  <div className="space-y-5">
                    <div>
                      <h1 className="text-lg md:text-xl font-black mb-0.5">Platform Overview</h1>
                      <p className="text-xs text-muted-foreground">Real-time monitoring · auto-refreshes every 15s</p>
                    </div>

                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                      <StatCard icon={Users}          label="Subscribers"     value={stats.totalUsers.toString()}               sub={`${stats.totalUsers} registered`}   color="text-primary" />
                      <StatCard icon={Activity}       label="Total Trades"    value={stats.totalTrades.toString()}              sub={`${stats.openTrades} open`}         color="text-yellow-400" />
                      <StatCard icon={ArrowUpToLine}  label="Deposited"       value={`GHS ${stats.totalDeposited.toFixed(2)}`}  sub="Completed"                          color="text-profit" />
                      <StatCard icon={ArrowDownToLine}label="Withdrawn"       value={`GHS ${stats.totalWithdrawn.toFixed(2)}`} sub="Completed"                          color="text-loss" />
                    </div>

                    {/* Revenue highlight */}
                    <div className="bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/30 rounded-2xl p-4 md:p-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-primary/20 rounded-xl flex items-center justify-center shrink-0">
                          <DollarSign className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Total Net Profit</div>
                          <div className="text-2xl md:text-3xl font-black text-primary">GHS {stats.platformRevenue.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Charts */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-card border border-border rounded-xl p-4">
                        <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Revenue Split</h3>
                        <ResponsiveContainer width="100%" height={180}>
                          <PieChart>
                            <Pie data={revenueChartData} dataKey="value" cx="50%" cy="50%" outerRadius={65}>
                              {revenueChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Pie>
                            <Legend iconSize={8} formatter={v => <span className="text-xs text-muted-foreground">{v}</span>} />
                            <Tooltip formatter={(v: number) => `GHS ${v.toFixed(2)}`} contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", borderRadius: 8, fontSize: 11 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="bg-card border border-border rounded-xl p-4">
                        <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Trade Outcomes</h3>
                        <ResponsiveContainer width="100%" height={180}>
                          <PieChart>
                            <Pie data={tradeChartData} dataKey="value" cx="50%" cy="50%" outerRadius={65}>
                              {tradeChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Pie>
                            <Legend iconSize={8} formatter={v => <span className="text-xs text-muted-foreground">{v}</span>} />
                            <Tooltip formatter={(v: number) => `${v} trades`} contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", borderRadius: 8, fontSize: 11 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Recent trades */}
                    <div className="bg-card border border-border rounded-xl p-4">
                      <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Recent Trades</h3>
                      <div className="space-y-0">
                        {trades.slice(0, 8).map(t => (
                          <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-xs shrink-0">{t.symbol}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${t.direction === "UP" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>{t.direction}</span>
                              {t.isDemo && <span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 text-xs shrink-0">DEMO</span>}
                              {t.isAuto && <span className="px-1 py-0.5 rounded bg-primary/15 text-primary text-xs shrink-0">AUTO</span>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground">GHS {t.amount.toFixed(0)}</span>
                              {t.profit !== null && <span className={`text-xs font-semibold ${t.profit >= 0 ? "text-profit" : "text-loss"}`}>{t.profit >= 0 ? "+" : ""}GHS {t.profit.toFixed(0)}</span>}
                              <StatusPill status={t.status} />
                            </div>
                          </div>
                        ))}
                        {trades.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">No trades yet</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── USERS ── */}
                {tab === "users" && (
                  <div>
                    <h1 className="text-lg font-black mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Subscribers ({users.length})</h1>
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[400px]">
                          <thead className="border-b border-border bg-secondary/30">
                            <tr>
                              {["#", "Name", "Email", "Role", "Joined"].map(h => (
                                <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {users.map(u => (
                              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                                <td className="px-3 py-3 text-xs text-muted-foreground">{u.id}</td>
                                <td className="px-3 py-3 font-semibold text-sm">{u.name}</td>
                                <td className="px-3 py-3 text-xs text-muted-foreground">{u.email}</td>
                                <td className="px-3 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${u.role === "admin" ? "bg-primary/20 border-primary/40 text-primary" : "bg-secondary border-border text-muted-foreground"}`}>{u.role}</span>
                                </td>
                                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString("en-GH")}</td>
                              </tr>
                            ))}
                            {users.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">No users yet</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TRADES ── */}
                {tab === "trades" && (
                  <div>
                    <h1 className="text-lg font-black mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> All Trades ({trades.length})</h1>
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[560px]">
                          <thead className="border-b border-border bg-secondary/30">
                            <tr>{["#", "Symbol", "Dir", "Amount", "Profit", "Status", "Type", "Date"].map(h => (
                              <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {trades.map(t => (
                              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{t.id}</td>
                                <td className="px-3 py-2.5 font-semibold text-xs">{t.symbol}</td>
                                <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.direction === "UP" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>{t.direction}</span></td>
                                <td className="px-3 py-2.5 text-xs">GHS {t.amount.toFixed(0)}</td>
                                <td className="px-3 py-2.5 text-xs">{t.profit !== null ? <span className={t.profit >= 0 ? "text-profit font-semibold" : "text-loss font-semibold"}>{t.profit >= 0 ? "+" : ""}GHS {t.profit.toFixed(0)}</span> : "—"}</td>
                                <td className="px-3 py-2.5"><StatusPill status={t.status} /></td>
                                <td className="px-3 py-2.5">
                                  <div className="flex gap-1">
                                    {t.isDemo && <span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 text-xs">DEMO</span>}
                                    {t.isAuto && <span className="px-1 py-0.5 rounded bg-primary/15 text-primary text-xs">AUTO</span>}
                                    {!t.isDemo && !t.isAuto && <span className="text-xs text-muted-foreground">Real</span>}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{new Date(t.createdAt).toLocaleDateString("en-GH")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── EARNINGS ── */}
                {tab === "earnings" && (
                  <div>
                    <h1 className="text-lg font-black mb-1 flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" /> Trade Earnings</h1>
                    <p className="text-xs text-muted-foreground mb-4">Net profit and loss from all real trades</p>

                    <div className="grid grid-cols-2 gap-3 mb-5">
                      <div className="bg-gradient-to-br from-primary/20 to-transparent border border-primary/30 rounded-xl p-3 text-center">
                        <div className="text-xs text-muted-foreground mb-1">Net Profit</div>
                        <div className="text-lg font-black text-primary">GHS {(stats?.platformRevenue ?? 0).toFixed(2)}</div>
                      </div>
                      <div className="bg-card border border-border rounded-xl p-3 text-center">
                        <div className="text-xs text-muted-foreground mb-1">Total Trades</div>
                        <div className="text-lg font-black text-yellow-400">{stats?.totalTrades ?? 0}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── DEPOSITS ── */}
                {tab === "deposits" && (
                  <div>
                    <h1 className="text-lg font-black mb-4 flex items-center gap-2"><ArrowUpToLine className="w-5 h-5 text-profit" /> All Deposits</h1>
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[480px]">
                          <thead className="border-b border-border bg-secondary/30">
                            <tr>{["#", "Amount", "Network", "Phone", "Ref", "Status", "Date"].map(h => (
                              <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {deposits.map(d => (
                              <tr key={d.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.id}</td>
                                <td className="px-3 py-2.5 font-bold text-profit text-xs">+GHS {d.amount.toFixed(2)}</td>
                                <td className="px-3 py-2.5 text-xs font-semibold">{d.momoProvider}</td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.momoNumber}</td>
                                <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground truncate max-w-[80px]">{d.reference}</td>
                                <td className="px-3 py-2.5"><StatusPill status={d.status} /></td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{new Date(d.createdAt).toLocaleDateString("en-GH")}</td>
                              </tr>
                            ))}
                            {deposits.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground text-sm">No deposits yet</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── WITHDRAWALS ── */}
                {tab === "withdrawals" && (
                  <div>
                    <h1 className="text-lg font-black mb-4 flex items-center gap-2"><ArrowDownToLine className="w-5 h-5 text-primary" /> All Withdrawals</h1>
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[420px]">
                          <thead className="border-b border-border bg-secondary/30">
                            <tr>{["#", "Amount", "Network", "Phone", "Status", "Date"].map(h => (
                              <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {withdrawals.map(w => (
                              <tr key={w.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{w.id}</td>
                                <td className="px-3 py-2.5 font-bold text-loss text-xs">−GHS {w.amount.toFixed(2)}</td>
                                <td className="px-3 py-2.5 text-xs font-semibold">{w.momoProvider}</td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{w.momoNumber}</td>
                                <td className="px-3 py-2.5"><StatusPill status={w.status} /></td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{new Date(w.createdAt).toLocaleDateString("en-GH")}</td>
                              </tr>
                            ))}
                            {withdrawals.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No withdrawals yet</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
