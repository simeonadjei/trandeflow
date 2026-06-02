import { useState } from "react";
import { Link } from "wouter";
import {
  useGetAccount, useGetAccountStats, useListWithdrawals, useRequestWithdrawal,
  getListWithdrawalsQueryKey, getGetAccountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Wallet as WalletIcon, ArrowDownToLine, CheckCircle, Clock, XCircle, Loader2, BarChart2 } from "lucide-react";

const PROVIDERS = [
  { id: "MTN", label: "MTN MoMo", color: "bg-yellow-400/20 border-yellow-400/40 text-yellow-300" },
  { id: "VODAFONE", label: "Vodafone Cash", color: "bg-red-500/20 border-red-500/40 text-red-400" },
  { id: "AIRTELTIGO", label: "AirtelTigo Money", color: "bg-blue-500/20 border-blue-500/40 text-blue-400" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") return <span className="flex items-center gap-1 text-xs text-profit"><CheckCircle className="w-3 h-3" /> Completed</span>;
  if (status === "PROCESSING") return <span className="flex items-center gap-1 text-xs text-yellow-400"><Loader2 className="w-3 h-3 animate-spin" /> Processing</span>;
  if (status === "FAILED") return <span className="flex items-center gap-1 text-xs text-loss"><XCircle className="w-3 h-3" /> Failed</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3 h-3" /> Pending</span>;
}

export default function Wallet() {
  const [amount, setAmount] = useState("");
  const [momoNumber, setMomoNumber] = useState("");
  const [provider, setProvider] = useState("MTN");
  const [submitted, setSubmitted] = useState(false);

  const queryClient = useQueryClient();
  const { data: account } = useGetAccount({ query: { refetchInterval: 10000 } });
  const { data: stats } = useGetAccountStats();
  const { data: withdrawals, refetch } = useListWithdrawals();

  const requestWithdrawal = useRequestWithdrawal({
    mutation: {
      onSuccess: () => {
        setSubmitted(true);
        setAmount("");
        setMomoNumber("");
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
        refetch();
        setTimeout(() => setSubmitted(false), 4000);
      },
    },
  });

  const handleWithdraw = () => {
    const a = parseFloat(amount);
    if (!a || a < 10 || !momoNumber || momoNumber.length < 10) return;
    requestWithdrawal.mutate({ data: { amount: a, momoNumber, momoProvider: provider as any } });
  };

  const totalWithdrawn = withdrawals?.filter((w) => w.status === "COMPLETED").reduce((s, w) => s + w.amount, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm h-14 flex items-center px-4 justify-between">
        <Link href="/" className="flex items-center gap-2 font-black">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span>Trade<span className="text-primary">Flow</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/trade" className="px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:opacity-90 transition-opacity">Trade</Link>
        </div>
      </div>

      <div className="pt-14 max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-black mb-1 flex items-center gap-2">
            <WalletIcon className="w-6 h-6 text-primary" /> My Wallet
          </h1>
          <p className="text-muted-foreground text-sm">Manage your balance and withdraw to MoMo</p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {/* Balance card */}
          <div className="bg-card border border-primary/20 rounded-2xl p-5 glow-gold">
            <div className="text-xs text-muted-foreground mb-1">Real Balance</div>
            <div className="text-3xl font-black text-primary mb-1">
              GHS {account?.balance?.toFixed(2) ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">Available for trading & withdrawal</div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-muted-foreground mb-1">Total Profit</div>
            <div className={`text-3xl font-black mb-1 ${(stats?.totalProfit ?? 0) >= 0 ? "text-profit" : "text-loss"}`}>
              {(stats?.totalProfit ?? 0) >= 0 ? "+" : ""}GHS {stats?.totalProfit?.toFixed(2) ?? "0.00"}
            </div>
            <div className="text-xs text-muted-foreground">Across {stats?.totalTrades ?? 0} trades</div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-muted-foreground mb-1">Total Withdrawn</div>
            <div className="text-3xl font-black text-foreground mb-1">
              GHS {totalWithdrawn.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">{withdrawals?.filter((w) => w.status === "COMPLETED").length ?? 0} successful withdrawals</div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Win Rate", value: `${account?.winRate?.toFixed(1) ?? 0}%`, good: true },
            { label: "Today's Profit", value: `GHS ${stats?.todayProfit?.toFixed(2) ?? "0.00"}`, good: (stats?.todayProfit ?? 0) >= 0 },
            { label: "Win Streak", value: `${stats?.streak ?? 0} trades`, good: true },
            { label: "Best Trade", value: `GHS ${stats?.bestTrade?.toFixed(2) ?? "0.00"}`, good: true },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3">
              <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
              <div className={`font-bold ${s.good ? "text-profit" : "text-loss"}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Withdrawal Form */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-bold mb-5 flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-primary" /> Withdraw to MoMo
            </h2>

            {submitted && (
              <div className="mb-4 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2">
                <CheckCircle className="w-4 h-4" /> Withdrawal request submitted successfully!
              </div>
            )}

            {requestWithdrawal.isError && (
              <div className="mb-4 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss">
                Failed to process withdrawal. Please try again.
              </div>
            )}

            {/* Provider selector */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground font-medium mb-2 block">Mobile Network</label>
              <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    className={`py-2.5 px-2 border rounded-lg text-xs font-semibold transition-colors ${provider === p.id ? p.color : "bg-secondary border-border text-muted-foreground hover:border-primary/30"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Amount (GHS)</label>
              <input
                type="number"
                min={10}
                max={account?.balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Min. GHS 10"
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary transition-colors"
              />
              <div className="flex gap-1.5 mt-2">
                {[50, 100, 200, account?.balance].filter(Boolean).map((v, i) => (
                  <button
                    key={i}
                    onClick={() => setAmount(String(typeof v === 'number' ? v.toFixed(2) : v))}
                    className="flex-1 py-1 text-xs rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors font-medium"
                  >
                    {i === 3 ? "Max" : `${v}`}
                  </button>
                ))}
              </div>
            </div>

            {/* MoMo number */}
            <div className="mb-6">
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">MoMo Phone Number</label>
              <input
                type="tel"
                value={momoNumber}
                onChange={(e) => setMomoNumber(e.target.value)}
                placeholder="e.g. 0241234567"
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <button
              onClick={handleWithdraw}
              disabled={requestWithdrawal.isPending || !amount || !momoNumber || parseFloat(amount) < 10}
              className="w-full py-3.5 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {requestWithdrawal.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
              ) : (
                <><ArrowDownToLine className="w-4 h-4" /> Withdraw to {PROVIDERS.find((p) => p.id === provider)?.label}</>
              )}
            </button>

            <p className="text-xs text-muted-foreground text-center mt-3">
              Minimum withdrawal: GHS 10 — Typically processed within 5-30 minutes
            </p>
          </div>

          {/* Withdrawal History */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-bold mb-5 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Withdrawal History
            </h2>

            {!withdrawals?.length && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                <WalletIcon className="w-10 h-10 mx-auto mb-3 opacity-20" />
                No withdrawals yet. Make your first withdrawal above.
              </div>
            )}

            <div className="space-y-3">
              {withdrawals?.map((w) => (
                <div key={w.id} className="flex items-center justify-between bg-background border border-border rounded-xl p-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold">GHS {w.amount.toFixed(2)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        w.momoProvider === "MTN" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-300" :
                        w.momoProvider === "VODAFONE" ? "bg-red-500/15 border-red-500/30 text-red-400" :
                        "bg-blue-500/15 border-blue-500/30 text-blue-400"
                      }`}>{w.momoProvider}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{w.momoNumber}</div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={w.status} />
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(w.createdAt).toLocaleDateString("en-GH")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-6 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h2 className="font-bold text-sm">Trading Performance</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-black text-primary">{account?.winRate?.toFixed(0) ?? 0}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Win Rate</div>
            </div>
            <div>
              <div className="text-2xl font-black">{account?.totalTrades ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Trades</div>
            </div>
            <div>
              <div className="text-2xl font-black text-profit">+GHS {stats?.avgReturn?.toFixed(2) ?? "0.00"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Avg Return</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
