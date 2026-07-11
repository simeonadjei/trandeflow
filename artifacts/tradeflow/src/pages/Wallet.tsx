import { useState } from "react";
import { Link } from "wouter";
import {
  useGetAccount, useListDeposits, useCreateDeposit, useListWithdrawals, useRequestWithdrawal,
  getGetAccountQueryKey, getListDepositsQueryKey, getListWithdrawalsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/AuthContext";
import { TrendingUp, ArrowUpToLine, ArrowDownToLine, CheckCircle, Clock, XCircle, Loader2, RefreshCw, Smartphone } from "lucide-react";

const PROVIDERS = [
  { id: "MTN",        label: "MTN MoMo",         color: "border-yellow-400 text-yellow-300 bg-yellow-400/10",  inactive: "border-border text-muted-foreground" },
  { id: "VODAFONE",   label: "Vodafone Cash",     color: "border-red-400 text-red-300 bg-red-400/10",           inactive: "border-border text-muted-foreground" },
  { id: "AIRTELTIGO", label: "AirtelTigo Money",  color: "border-blue-400 text-blue-300 bg-blue-400/10",        inactive: "border-border text-muted-foreground" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED")  return <span className="flex items-center gap-1 text-xs text-profit"><CheckCircle className="w-3 h-3" /> Paid</span>;
  if (status === "PROCESSING") return <span className="flex items-center gap-1 text-xs text-yellow-400"><Loader2 className="w-3 h-3 animate-spin" /> Processing</span>;
  if (status === "FAILED")     return <span className="flex items-center gap-1 text-xs text-loss"><XCircle className="w-3 h-3" /> Failed</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3 h-3" /> Pending</span>;
}

export default function Wallet() {
  const { user, logout } = useAuth();
  const [tab, setTab]           = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount]     = useState("");
  const [phone, setPhone]       = useState("");
  const [provider, setProvider] = useState("MTN");
  const [prompt, setPrompt]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: account, refetch: refetchAccount } = useGetAccount({ query: { refetchInterval: 4000 } });
  const { data: deposits,     refetch: refetchDeposits }     = useListDeposits({    query: { refetchInterval: 5000 } });
  const { data: withdrawals,  refetch: refetchWithdrawals }  = useListWithdrawals({ query: { refetchInterval: 5000 } });

  const createDeposit = useCreateDeposit({
    mutation: {
      onSuccess: (data: any) => {
        setPrompt(data.displayStatus ?? "Check your phone and approve the MoMo prompt.");
        setAmount("");
        queryClient.invalidateQueries({ queryKey: getListDepositsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
        refetchDeposits();
        refetchAccount();
      },
      onError: (e: any) => setError(e?.response?.data?.error ?? "Deposit failed. Try again."),
    },
  });

  const requestWithdrawal = useRequestWithdrawal({
    mutation: {
      onSuccess: () => {
        setPrompt("Withdrawal submitted — you'll receive the MoMo payment shortly.");
        setAmount("");
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
        refetchWithdrawals();
        refetchAccount();
      },
      onError: (e: any) => setError(e?.response?.data?.error ?? "Withdrawal failed."),
    },
  });

  const amt     = parseFloat(amount) || 0;
  const balance = account?.balance ?? 0;
  const canGo   = amt >= 10 && phone.length >= 10 && (tab === "deposit" || amt <= balance);

  function handleGo() {
    setError(null);
    setPrompt(null);
    if (tab === "deposit") {
      createDeposit.mutate({ data: { amount: amt, momoNumber: phone, momoProvider: provider as any } });
    } else {
      requestWithdrawal.mutate({ data: { amount: amt, momoNumber: phone, momoProvider: provider as any } });
    }
  }

  const history = tab === "deposit"
    ? (deposits ?? []).map(d => ({ id: d.id, amount: d.amount, label: d.momoNumber, status: d.status, date: d.createdAt, sign: "+" }))
    : (withdrawals ?? []).map(w => ({ id: w.id, amount: w.amount, label: w.momoNumber, status: w.status, date: w.createdAt, sign: "−" }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm h-14 flex items-center px-4 justify-between">
        <Link href="/" className="flex items-center gap-2 font-black">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span>Trade<span className="text-primary">Flow</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/trade" className="px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:opacity-90">Trade</Link>
          {user ? (
            <>
              {user.role === "admin" && (
                <Link href="/admin" className="px-3 py-1 bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-md">Admin</Link>
              )}
              <button onClick={logout} className="px-3 py-1 bg-secondary rounded-md text-xs text-muted-foreground hover:bg-secondary/80">Logout</button>
            </>
          ) : (
            <Link href="/login" className="px-3 py-1 bg-secondary border border-border text-xs rounded-md hover:bg-secondary/80">Login</Link>
          )}
        </div>
      </div>

      <div className="pt-14 max-w-lg mx-auto px-4 py-8">
        {/* Balance */}
        <div className="bg-card border border-primary/20 rounded-2xl p-6 mb-6 text-center glow-gold">
          <div className="text-xs text-muted-foreground mb-1">Available Balance</div>
          <div className="text-4xl font-black text-primary">GHS {balance.toFixed(2)}</div>
          <button onClick={() => refetchAccount()} className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 bg-card border border-border rounded-xl overflow-hidden mb-5">
          <button
            onClick={() => { setTab("deposit"); setPrompt(null); setError(null); }}
            className={`py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${tab === "deposit" ? "bg-profit/10 text-profit border-b-2 border-profit" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ArrowUpToLine className="w-4 h-4" /> Deposit
          </button>
          <button
            onClick={() => { setTab("withdraw"); setPrompt(null); setError(null); }}
            className={`py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${tab === "withdraw" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ArrowDownToLine className="w-4 h-4" /> Withdraw
          </button>
        </div>

        {/* Form card */}
        <div className="bg-card border border-border rounded-2xl p-5 mb-5">

          {/* Feedback */}
          {prompt && (
            <div className="mb-4 p-3 bg-profit/10 border border-profit/30 rounded-xl flex items-start gap-3">
              <Smartphone className="w-4 h-4 text-profit shrink-0 mt-0.5" />
              <p className="text-sm text-profit">{prompt}</p>
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 bg-loss/10 border border-loss/30 rounded-xl text-sm text-loss">{error}</div>
          )}

          {/* Network */}
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-2 block font-medium">Mobile Network</label>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={`py-2.5 border rounded-lg text-xs font-semibold transition-all ${provider === p.id ? p.color : p.inactive}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">
              Amount (GHS)
              {tab === "withdraw" && <span className="ml-1 text-primary">Max: {balance.toFixed(2)}</span>}
            </label>
            <input
              type="number"
              min={10}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 100"
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary"
            />
            <div className="flex gap-1.5 mt-2">
              {(tab === "deposit" ? [50, 100, 200, 500] : [50, 100, 200, balance]).map((v, i, arr) => (
                <button
                  key={i}
                  onClick={() => setAmount(String(typeof v === "number" ? parseFloat(v.toFixed(2)) : v))}
                  className="flex-1 py-1 text-xs rounded bg-secondary hover:bg-secondary/80 font-medium"
                >
                  {tab === "withdraw" && i === arr.length - 1 ? "Max" : `${v}`}
                </button>
              ))}
            </div>
          </div>

          {/* Phone */}
          <div className="mb-5">
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">MoMo Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="e.g. 0241234567"
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary"
            />
          </div>

          {/* CTA */}
          <button
            onClick={handleGo}
            disabled={!canGo || createDeposit.isPending || requestWithdrawal.isPending}
            className={`w-full py-3.5 font-bold rounded-xl transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 ${
              tab === "deposit"
                ? "bg-profit text-white hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90"
            }`}
          >
            {(createDeposit.isPending || requestWithdrawal.isPending) ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending request…</>
            ) : tab === "deposit" ? (
              <><ArrowUpToLine className="w-4 h-4" /> Deposit via {PROVIDERS.find(p => p.id === provider)?.label}</>
            ) : (
              <><ArrowDownToLine className="w-4 h-4" /> Withdraw to MoMo</>
            )}
          </button>

          {tab === "deposit" && (
            <p className="text-center text-xs text-muted-foreground mt-3">
              A MoMo prompt will appear on your phone. Approve it to credit your balance instantly.
            </p>
          )}
        </div>

        {/* History */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-bold text-muted-foreground uppercase tracking-wide">
            {tab === "deposit" ? "Deposit History" : "Withdrawal History"}
          </div>
          <div className="divide-y divide-border">
            {history.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No transactions yet</div>
            ) : (
              history.map(tx => (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className={`font-bold text-sm ${tx.sign === "+" ? "text-profit" : "text-loss"}`}>
                      {tx.sign}GHS {tx.amount.toFixed(2)}
                    </span>
                    <div className="text-xs text-muted-foreground mt-0.5">{tx.label}</div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={tx.status} />
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(tx.date).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
