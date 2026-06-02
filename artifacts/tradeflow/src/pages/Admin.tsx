import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../lib/AuthContext";
import {
  TrendingUp, Users, BarChart2, DollarSign, ArrowUpToLine, ArrowDownToLine,
  Activity, LogOut, RefreshCw, ShieldCheck, Clock, CheckCircle, XCircle,
  Loader2, TrendingDown, Wallet,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

interface AdminStats {
  totalUsers: number;
  totalTrades: number;
  openTrades: number;
  totalDeposited: number;
  totalWithdrawn: number;
  platformRevenue: number;
  revenueFromWinCut: number;
  revenueFromLosses: number;
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
      <div className={`text-2xl font-black ${color}`}>{value}</div>
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
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${map[status] ?? "text-muted-foreground bg-secondary border-border"}`}>
      {status}
    </span>
  );
}

export default function Admin() {
  const [, navigate] = useLocation();
  const { user, token, logout, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [trades, setTrades] = useState<AdminTrade[]>([]);
  const [earnings, setEarnings] = useState<AdminEarning[]>([]);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  const apiFetch = async (path: string) => {
    const res = await fetch(`/api${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, u, t, e, d, w] = await Promise.all([
        apiFetch("/admin/stats"),
        apiFetch("/admin/users"),
        apiFetch("/admin/trades"),
        apiFetch("/admin/earnings"),
        apiFetch("/admin/deposits"),
        apiFetch("/admin/withdrawals"),
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

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: BarChart2 },
    { id: "users", label: `Users (${users.length})`, icon: Users },
    { id: "trades", label: `Trades (${trades.length})`, icon: Activity },
    { id: "earnings", label: "Platform Earnings", icon: DollarSign },
    { id: "deposits", label: "Deposits", icon: ArrowUpToLine },
    { id: "withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
  ];

  const revenueChartData = [
    { name: "Win Cut (15%)", value: stats?.revenueFromWinCut ?? 0, color: "#f59e0b" },
    { name: "Loss Revenue", value: stats?.revenueFromLosses ?? 0, color: "#22c55e" },
  ];

  const winTrades = trades.filter((t) => t.status === "WIN" && !t.isDemo).length;
  const lossTrades = trades.filter((t) => t.status === "LOSS" && !t.isDemo).length;
  const tradeChartData = [
    { name: "WIN", value: winTrades, color: "#22c55e" },
    { name: "LOSS", value: lossTrades, color: "#ef4444" },
    { name: "OPEN", value: trades.filter(t => t.status === "OPEN").length, color: "#f59e0b" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-4 justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 font-black">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span>Trade<span className="text-primary">Flow</span></span>
          </Link>
          <span className="px-2 py-0.5 bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-full flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Admin
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground text-xs">{user?.name}</span>
          <button onClick={() => { logout(); navigate("/login"); }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-secondary transition-colors">
            <LogOut className="w-3 h-3" /> Logout
          </button>
        </div>
      </div>

      <div className="pt-14 flex">
        {/* Sidebar */}
        <div className="fixed top-14 left-0 bottom-0 w-52 border-r border-border bg-card/50 p-3 flex flex-col gap-1 overflow-y-auto">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${tab === t.id ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
              <t.icon className="w-4 h-4 shrink-0" /> {t.label}
            </button>
          ))}
          <div className="mt-auto pt-3 border-t border-border">
            <button onClick={loadAll} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="ml-52 flex-1 p-6 overflow-y-auto">
          {loading && !stats ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* OVERVIEW */}
              {tab === "overview" && stats && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-xl font-black mb-1">Platform Overview</h1>
                    <p className="text-sm text-muted-foreground">Real-time monitoring of all activity</p>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard icon={Users} label="Total Subscribers" value={stats.totalUsers.toString()} sub="Registered users" color="text-primary" />
                    <StatCard icon={Activity} label="Total Trades" value={stats.totalTrades.toString()} sub={`${stats.openTrades} open now`} color="text-yellow-400" />
                    <StatCard icon={ArrowUpToLine} label="Total Deposited" value={`GHS ${stats.totalDeposited.toFixed(2)}`} sub="Completed deposits" color="text-profit" />
                    <StatCard icon={ArrowDownToLine} label="Total Withdrawn" value={`GHS ${stats.totalWithdrawn.toFixed(2)}`} sub="Completed withdrawals" color="text-loss" />
                  </div>

                  {/* Platform Revenue highlight */}
                  <div className="bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/30 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center">
                        <DollarSign className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground font-medium">Total Platform Revenue</div>
                        <div className="text-3xl font-black text-primary">GHS {stats.platformRevenue.toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-background/40 rounded-xl p-3">
                        <div className="text-xs text-muted-foreground mb-1">From Win Cut (15%)</div>
                        <div className="font-black text-yellow-400">GHS {stats.revenueFromWinCut.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">Platform earns 15% on user wins</div>
                      </div>
                      <div className="bg-background/40 rounded-xl p-3">
                        <div className="text-xs text-muted-foreground mb-1">From User Losses</div>
                        <div className="font-black text-profit">GHS {stats.revenueFromLosses.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">Platform keeps losing stakes</div>
                      </div>
                    </div>
                  </div>

                  {/* Charts */}
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="bg-card border border-border rounded-xl p-4">
                      <h3 className="font-bold text-sm mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Revenue Breakdown</h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={revenueChartData} dataKey="value" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: GHS ${value.toFixed(0)}`} labelLine={false}>
                            {revenueChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => `GHS ${v.toFixed(2)}`} contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", borderRadius: 8, fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-4">
                      <h3 className="font-bold text-sm mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Trade Outcomes</h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={tradeChartData} dataKey="value" cx="50%" cy="50%" outerRadius={70}>
                            {tradeChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Pie>
                          <Legend formatter={(v) => <span className="text-xs text-muted-foreground">{v}</span>} />
                          <Tooltip formatter={(v: number) => `${v} trades`} contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", borderRadius: 8, fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Recent activity */}
                  <div className="bg-card border border-border rounded-xl p-4">
                    <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Recent Trades</h3>
                    <div className="space-y-2">
                      {trades.slice(0, 8).map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-xs py-2 border-b border-border last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{t.symbol}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.direction === "UP" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>{t.direction}</span>
                            {t.isDemo && <span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 text-xs">DEMO</span>}
                            {t.isAuto && <span className="px-1 py-0.5 rounded bg-primary/15 text-primary text-xs">AUTO</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">GHS {t.amount.toFixed(2)}</span>
                            {t.profit !== null && <span className={t.profit >= 0 ? "text-profit font-semibold" : "text-loss font-semibold"}>{t.profit >= 0 ? "+" : ""}GHS {t.profit.toFixed(2)}</span>}
                            <StatusPill status={t.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* USERS */}
              {tab === "users" && (
                <div>
                  <h1 className="text-xl font-black mb-5 flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Subscribers ({users.length})</h1>
                  <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-secondary/30">
                        <tr>
                          {["ID", "Name", "Email", "Role", "Joined"].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                            <td className="px-4 py-3 text-muted-foreground text-xs">#{u.id}</td>
                            <td className="px-4 py-3 font-semibold">{u.name}</td>
                            <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${u.role === "admin" ? "bg-primary/20 border-primary/40 text-primary" : "bg-secondary border-border text-muted-foreground"}`}>{u.role}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString("en-GH")}</td>
                          </tr>
                        ))}
                        {users.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No users yet</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TRADES */}
              {tab === "trades" && (
                <div>
                  <h1 className="text-xl font-black mb-5 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> All Trades ({trades.length})</h1>
                  <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="border-b border-border bg-secondary/30">
                        <tr>
                          {["ID", "Symbol", "Direction", "Amount", "Profit", "Status", "Type", "Date"].map((h) => (
                            <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t) => (
                          <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                            <td className="px-3 py-2.5 text-muted-foreground text-xs">#{t.id}</td>
                            <td className="px-3 py-2.5 font-semibold">{t.symbol}</td>
                            <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.direction === "UP" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>{t.direction}</span></td>
                            <td className="px-3 py-2.5">GHS {t.amount.toFixed(2)}</td>
                            <td className="px-3 py-2.5">{t.profit !== null ? <span className={t.profit >= 0 ? "text-profit font-semibold" : "text-loss font-semibold"}>{t.profit >= 0 ? "+" : ""}GHS {t.profit.toFixed(2)}</span> : "—"}</td>
                            <td className="px-3 py-2.5"><StatusPill status={t.status} /></td>
                            <td className="px-3 py-2.5 flex items-center gap-1 flex-wrap">
                              {t.isDemo && <span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 text-xs">DEMO</span>}
                              {t.isAuto && <span className="px-1 py-0.5 rounded bg-primary/15 text-primary text-xs">AUTO</span>}
                              {!t.isDemo && !t.isAuto && <span className="text-xs text-muted-foreground">Real</span>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString("en-GH")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* EARNINGS */}
              {tab === "earnings" && (
                <div>
                  <h1 className="text-xl font-black mb-2 flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" /> Platform Earnings</h1>
                  <p className="text-sm text-muted-foreground mb-5">
                    The platform earns <strong className="text-primary">15% cut on every user win</strong> and <strong className="text-profit">keeps 100% of losing stakes</strong>.
                  </p>

                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-gradient-to-br from-primary/20 to-transparent border border-primary/30 rounded-xl p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
                      <div className="text-2xl font-black text-primary">GHS {(stats?.platformRevenue ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1">Win Cut (15%)</div>
                      <div className="text-2xl font-black text-yellow-400">GHS {(stats?.revenueFromWinCut ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1">Loss Revenue</div>
                      <div className="text-2xl font-black text-profit">GHS {(stats?.revenueFromLosses ?? 0).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[500px]">
                      <thead className="border-b border-border bg-secondary/30">
                        <tr>
                          {["ID", "Trade #", "Symbol", "Revenue Type", "Amount", "Date"].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-xs text-muted-foreground font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {earnings.map((e) => (
                          <tr key={e.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">#{e.id}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.tradeId ? `#${e.tradeId}` : "—"}</td>
                            <td className="px-4 py-2.5 font-semibold">{e.symbol || "—"}</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${e.type === "WIN_CUT" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-400" : "bg-profit/15 border-profit/30 text-profit"}`}>
                                {e.type === "WIN_CUT" ? "Win Cut 15%" : "Loss Kept"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-bold text-profit">+GHS {e.amount.toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleDateString("en-GH")}</td>
                          </tr>
                        ))}
                        {earnings.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No earnings recorded yet — trades will generate revenue as they close.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* DEPOSITS */}
              {tab === "deposits" && (
                <div>
                  <h1 className="text-xl font-black mb-5 flex items-center gap-2"><ArrowUpToLine className="w-5 h-5 text-profit" /> All Deposits</h1>
                  <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead className="border-b border-border bg-secondary/30">
                        <tr>{["ID", "Amount", "Network", "Phone", "Reference", "Status", "Date"].map((h) => <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {deposits.map((d) => (
                          <tr key={d.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">#{d.id}</td>
                            <td className="px-3 py-2.5 font-bold text-profit">+GHS {d.amount.toFixed(2)}</td>
                            <td className="px-3 py-2.5"><span className="text-xs font-semibold">{d.momoProvider}</span></td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.momoNumber}</td>
                            <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{d.reference}</td>
                            <td className="px-3 py-2.5"><StatusPill status={d.status} /></td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("en-GH")}</td>
                          </tr>
                        ))}
                        {deposits.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No deposits yet</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* WITHDRAWALS */}
              {tab === "withdrawals" && (
                <div>
                  <h1 className="text-xl font-black mb-5 flex items-center gap-2"><ArrowDownToLine className="w-5 h-5 text-primary" /> All Withdrawals</h1>
                  <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead className="border-b border-border bg-secondary/30">
                        <tr>{["ID", "Amount", "Network", "Phone", "Status", "Date"].map((h) => <th key={h} className="text-left px-3 py-3 text-xs text-muted-foreground font-semibold">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {withdrawals.map((w) => (
                          <tr key={w.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">#{w.id}</td>
                            <td className="px-3 py-2.5 font-bold text-loss">−GHS {w.amount.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-xs font-semibold">{w.momoProvider}</td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{w.momoNumber}</td>
                            <td className="px-3 py-2.5"><StatusPill status={w.status} /></td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(w.createdAt).toLocaleDateString("en-GH")}</td>
                          </tr>
                        ))}
                        {withdrawals.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No withdrawals yet</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
