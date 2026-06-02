import { useState } from "react";
import { Link } from "wouter";
import {
  useGetAccount, useGetAccountStats, useListWithdrawals, useRequestWithdrawal,
  useListDeposits, useCreateDeposit,
  getListWithdrawalsQueryKey, getGetAccountQueryKey, getListDepositsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/AuthContext";
import {
  TrendingUp, Wallet as WalletIcon, ArrowDownToLine, ArrowUpToLine,
  CheckCircle, Clock, XCircle, Loader2, BarChart2, Copy, RefreshCw,
} from "lucide-react";

const PROVIDERS = [
  { id: "MTN", label: "MTN MoMo", short: "MTN", color: "bg-yellow-400/20 border-yellow-400/40 text-yellow-300", active: "bg-yellow-400/30 border-yellow-400 text-yellow-200" },
  { id: "VODAFONE", label: "Vodafone Cash", short: "Vodafone", color: "bg-red-500/20 border-red-500/40 text-red-400", active: "bg-red-500/30 border-red-500 text-red-300" },
  { id: "AIRTELTIGO", label: "AirtelTigo Money", short: "AirtelTigo", color: "bg-blue-500/20 border-blue-500/40 text-blue-400", active: "bg-blue-500/30 border-blue-500 text-blue-300" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") return <span className="flex items-center gap-1 text-xs text-profit"><CheckCircle className="w-3 h-3" /> Completed</span>;
  if (status === "PROCESSING") return <span className="flex items-center gap-1 text-xs text-yellow-400"><Loader2 className="w-3 h-3 animate-spin" /> Processing</span>;
  if (status === "FAILED") return <span className="flex items-center gap-1 text-xs text-loss"><XCircle className="w-3 h-3" /> Failed</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3 h-3" /> Pending</span>;
}

function ProviderBadge({ provider }: { provider: string }) {
  const p = PROVIDERS.find((x) => x.id === provider);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
      provider === "MTN" ? "bg-yellow-400/15 border-yellow-400/30 text-yellow-300" :
      provider === "VODAFONE" ? "bg-red-500/15 border-red-500/30 text-red-400" :
      "bg-blue-500/15 border-blue-500/30 text-blue-400"
    }`}>{p?.short ?? provider}</span>
  );
}

export default function Wallet() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [momoNumber, setMomoNumber] = useState("");
  const [provider, setProvider] = useState("MTN");
  const [submitted, setSubmitted] = useState<{ type: "deposit" | "withdraw"; ref?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const queryClient = useQueryClient();
  const { data: account, refetch: refetchAccount } = useGetAccount({ query: { refetchInterval: 6000 } });
  const { data: stats } = useGetAccountStats();
  const { data: withdrawals, refetch: refetchWithdrawals } = useListWithdrawals({ query: { refetchInterval: 8000 } });
  const { data: deposits, refetch: refetchDeposits } = useListDeposits({ query: { refetchInterval: 8000 } });

  const createDeposit = useCreateDeposit({
    mutation: {
      onSuccess: (data) => {
        setSubmitted({ type: "deposit", ref: data.reference });
        setAmount("");
        setMomoNumber("");
        queryClient.invalidateQueries({ queryKey: getListDepositsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
        refetchDeposits();
        refetchAccount();
      },
    },
  });

  const requestWithdrawal = useRequestWithdrawal({
    mutation: {
      onSuccess: () => {
        setSubmitted({ type: "withdraw" });
        setAmount("");
        setMomoNumber("");
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
        refetchWithdrawals();
        refetchAccount();
      },
    },
  });

  const handleDeposit = () => {
    const a = parseFloat(amount);
    if (!a || a < 10 || !momoNumber || momoNumber.length < 10) return;
    setSubmitted(null);
    createDeposit.mutate({ data: { amount: a, momoNumber, momoProvider: provider as any } });
  };

  const handleWithdraw = () => {
    const a = parseFloat(amount);
    if (!a || a < 10 || !momoNumber || momoNumber.length < 10) return;
    setSubmitted(null);
    requestWithdrawal.mutate({ data: { amount: a, momoNumber, momoProvider: provider as any } });
  };

  const handleTabSwitch = (t: "deposit" | "withdraw") => {
    setTab(t);
    setAmount("");
    setMomoNumber("");
    setSubmitted(null);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalWithdrawn = withdrawals?.filter((w) => w.status === "COMPLETED").reduce((s, w) => s + w.amount, 0) ?? 0;
  const totalDeposited = deposits?.filter((d) => d.status === "COMPLETED").reduce((s, d) => s + d.amount, 0) ?? 0;
  const pendingDeposit = deposits?.find((d) => d.status === "PENDING" || d.status === "PROCESSING");

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
          {user ? (
            <>
              {user.role === "admin" && (
                <Link href="/admin" className="px-3 py-1 bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-md hover:bg-primary/30 transition-colors">Admin</Link>
              )}
              <button onClick={logout} className="px-3 py-1 bg-secondary rounded-md text-xs font-medium hover:bg-secondary/80 transition-colors text-muted-foreground">Logout</button>
            </>
          ) : (
            <Link href="/login" className="px-3 py-1 bg-secondary border border-border text-xs font-medium rounded-md hover:bg-secondary/80 transition-colors">Login</Link>
          )}
        </div>
      </div>

      <div className="pt-14 max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-black mb-1 flex items-center gap-2">
            <WalletIcon className="w-6 h-6 text-primary" /> My Wallet
          </h1>
          <p className="text-muted-foreground text-sm">Deposit & withdraw using MoMo</p>
        </div>

        {/* Balance cards */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <div className="md:col-span-1 bg-card border border-primary/20 rounded-2xl p-5 glow-gold">
            <div className="text-xs text-muted-foreground mb-1">Available Balance</div>
            <div className="text-3xl font-black text-primary mb-1">
              GHS {account?.balance?.toFixed(2) ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">Ready to trade or withdraw</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-muted-foreground mb-1">Total Deposited</div>
            <div className="text-2xl font-black text-foreground mb-1">GHS {totalDeposited.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{deposits?.filter((d) => d.status === "COMPLETED").length ?? 0} deposits</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-muted-foreground mb-1">Total Withdrawn</div>
            <div className="text-2xl font-black text-foreground mb-1">GHS {totalWithdrawn.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{withdrawals?.filter((w) => w.status === "COMPLETED").length ?? 0} withdrawals</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-muted-foreground mb-1">Net Profit</div>
            <div className={`text-2xl font-black mb-1 ${(stats?.totalProfit ?? 0) >= 0 ? "text-profit" : "text-loss"}`}>
              {(stats?.totalProfit ?? 0) >= 0 ? "+" : ""}GHS {stats?.totalProfit?.toFixed(2) ?? "0.00"}
            </div>
            <div className="text-xs text-muted-foreground">Across {stats?.totalTrades ?? 0} trades</div>
          </div>
        </div>

        {/* Pending deposit alert */}
        {pendingDeposit && (
          <div className="mb-6 p-4 bg-yellow-400/10 border border-yellow-400/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
              <div>
                <div className="text-sm font-semibold text-yellow-300">Deposit processing — GHS {parseFloat(pendingDeposit.amount as unknown as string).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Ref: {pendingDeposit.reference} · Will credit within ~20 seconds</div>
              </div>
            </div>
            <button onClick={() => refetchAccount()} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Left — Deposit / Withdraw form */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {/* Tabs */}
            <div className="grid grid-cols-2 border-b border-border">
              <button
                onClick={() => handleTabSwitch("deposit")}
                className={`py-3.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${tab === "deposit" ? "bg-profit/10 text-profit border-b-2 border-profit" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ArrowUpToLine className="w-4 h-4" /> Deposit
              </button>
              <button
                onClick={() => handleTabSwitch("withdraw")}
                className={`py-3.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${tab === "withdraw" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ArrowDownToLine className="w-4 h-4" /> Withdraw
              </button>
            </div>

            <div className="p-6">
              {/* Success messages */}
              {submitted?.type === "deposit" && (
                <div className="mb-4 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit">
                  <div className="flex items-center gap-2 mb-1 font-semibold">
                    <CheckCircle className="w-4 h-4" /> Deposit initiated!
                  </div>
                  <div className="text-xs text-profit/80">
                    Reference: <span className="font-mono font-bold">{submitted.ref}</span>
                    <button onClick={() => handleCopy(submitted.ref ?? "")} className="ml-2 inline-flex items-center gap-0.5 hover:text-profit">
                      <Copy className="w-3 h-3" /> {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="text-xs text-profit/70 mt-1">Your balance will be credited automatically once payment is confirmed (~20 seconds in simulation).</div>
                </div>
              )}
              {submitted?.type === "withdraw" && (
                <div className="mb-4 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> Withdrawal submitted! Typically processed within 5–30 minutes.
                </div>
              )}

              {(createDeposit.isError || requestWithdrawal.isError) && (
                <div className="mb-4 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss">
                  {tab === "deposit" ? "Deposit failed. Please try again." : "Insufficient balance or invalid details."}
                </div>
              )}

              {/* Network selector */}
              <div className="mb-4">
                <label className="text-xs text-muted-foreground font-medium mb-2 block">Mobile Network</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setProvider(p.id)}
                      className={`py-2.5 px-2 border rounded-lg text-xs font-semibold transition-colors ${provider === p.id ? p.active : p.color}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div className="mb-4">
                <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                  Amount (GHS) {tab === "withdraw" && account?.balance ? <span className="text-primary ml-1">Available: GHS {account.balance.toFixed(2)}</span> : null}
                </label>
                <input
                  type="number"
                  min={10}
                  max={tab === "withdraw" ? account?.balance : 10000}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Min. GHS 10"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary transition-colors"
                />
                <div className="flex gap-1.5 mt-2">
                  {(tab === "deposit" ? [50, 100, 200, 500] : [50, 100, 200, account?.balance]).filter(Boolean).map((v, i, arr) => (
                    <button
                      key={i}
                      onClick={() => setAmount(String(typeof v === "number" ? v.toFixed(2) : v))}
                      className="flex-1 py-1 text-xs rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors font-medium"
                    >
                      {tab === "withdraw" && i === arr.length - 1 ? "Max" : `${v}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phone number */}
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

              {tab === "deposit" ? (
                <>
                  <button
                    onClick={handleDeposit}
                    disabled={createDeposit.isPending || !amount || !momoNumber || parseFloat(amount) < 10 || momoNumber.length < 10}
                    className="w-full py-3.5 bg-profit text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {createDeposit.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><ArrowUpToLine className="w-4 h-4" /> Deposit via {PROVIDERS.find((p) => p.id === provider)?.short}</>
                    )}
                  </button>
                  <div className="mt-3 p-3 bg-secondary/40 rounded-lg text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between"><span>Min deposit</span><span className="font-semibold text-foreground">GHS 10</span></div>
                    <div className="flex justify-between"><span>Max deposit</span><span className="font-semibold text-foreground">GHS 10,000</span></div>
                    <div className="flex justify-between"><span>Processing time</span><span className="font-semibold text-foreground">~20 seconds (simulation)</span></div>
                    <div className="flex justify-between"><span>Fee</span><span className="font-semibold text-profit">Free</span></div>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={handleWithdraw}
                    disabled={requestWithdrawal.isPending || !amount || !momoNumber || parseFloat(amount) < 10 || momoNumber.length < 10 || parseFloat(amount) > (account?.balance ?? 0)}
                    className="w-full py-3.5 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {requestWithdrawal.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><ArrowDownToLine className="w-4 h-4" /> Withdraw to {PROVIDERS.find((p) => p.id === provider)?.short}</>
                    )}
                  </button>
                  <div className="mt-3 p-3 bg-secondary/40 rounded-lg text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between"><span>Min withdrawal</span><span className="font-semibold text-foreground">GHS 10</span></div>
                    <div className="flex justify-between"><span>Processing time</span><span className="font-semibold text-foreground">5–30 minutes</span></div>
                    <div className="flex justify-between"><span>Fee</span><span className="font-semibold text-profit">Free</span></div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right — Transaction History */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {/* Sub-tabs */}
            <div className="grid grid-cols-2 border-b border-border">
              <button
                onClick={() => setTab("deposit")}
                className={`py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${tab === "deposit" ? "text-profit border-b-2 border-profit" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ArrowUpToLine className="w-3.5 h-3.5" /> Deposits
              </button>
              <button
                onClick={() => setTab("withdraw")}
                className={`py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${tab === "withdraw" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ArrowDownToLine className="w-3.5 h-3.5" /> Withdrawals
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[460px]">
              {tab === "deposit" ? (
                <>
                  {!deposits?.length && (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      <ArrowUpToLine className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      No deposits yet. Make your first deposit!
                    </div>
                  )}
                  <div className="space-y-2">
                    {deposits?.map((d) => (
                      <div key={d.id} className="flex items-center justify-between bg-background border border-border rounded-xl p-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-bold text-profit">+GHS {d.amount.toFixed(2)}</span>
                            <ProviderBadge provider={d.momoProvider} />
                          </div>
                          <div className="text-xs text-muted-foreground">{d.momoNumber}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">Ref: {d.reference}</div>
                        </div>
                        <div className="text-right">
                          <StatusBadge status={d.status} />
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {new Date(d.createdAt).toLocaleDateString("en-GH")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {!withdrawals?.length && (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      <ArrowDownToLine className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      No withdrawals yet.
                    </div>
                  )}
                  <div className="space-y-2">
                    {withdrawals?.map((w) => (
                      <div key={w.id} className="flex items-center justify-between bg-background border border-border rounded-xl p-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-bold text-loss">−GHS {w.amount.toFixed(2)}</span>
                            <ProviderBadge provider={w.momoProvider} />
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
                </>
              )}
            </div>
          </div>
        </div>

        {/* Performance stats */}
        <div className="mt-6 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h2 className="font-bold text-sm">Trading Performance</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
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
            <div>
              <div className="text-2xl font-black text-profit">GHS {stats?.bestTrade?.toFixed(2) ?? "0.00"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Best Trade</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
