import { useState } from "react";
import { Link } from "wouter";
import {
  useGetAccount, useListDeposits, useListWithdrawals,
  getGetAccountQueryKey, getListDepositsQueryKey, getListWithdrawalsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "../lib/AuthContext";
import {
  TrendingUp, ArrowUpToLine, ArrowDownToLine, CheckCircle, Clock,
  XCircle, Loader2, RefreshCw, ExternalLink, Wallet as WalletIcon,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED")  return <span className="flex items-center gap-1 text-xs text-profit"><CheckCircle className="w-3 h-3" /> Completed</span>;
  if (status === "PROCESSING") return <span className="flex items-center gap-1 text-xs text-yellow-400"><Loader2 className="w-3 h-3 animate-spin" /> Processing</span>;
  if (status === "FAILED")     return <span className="flex items-center gap-1 text-xs text-loss"><XCircle className="w-3 h-3" /> Failed</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3 h-3" /> Pending</span>;
}

export default function Wallet() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"deposit" | "withdraw">(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    return p === "withdraw" ? "withdraw" : "deposit";
  });

  const { data: account, refetch: refetchAccount } = useGetAccount({
    query: { refetchInterval: 4000, queryKey: getGetAccountQueryKey() },
  });
  const { data: deposits }    = useListDeposits({    query: { refetchInterval: 5000, queryKey: getListDepositsQueryKey() } });
  const { data: withdrawals } = useListWithdrawals({ query: { refetchInterval: 5000, queryKey: getListWithdrawalsQueryKey() } });

  const spotBalance  = account?.mexcFreeUsdt ?? null;
  const totalBalance = account?.mexcBalanceUsdt ?? null;

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
        {/* Spot Balance card */}
        <div className="bg-card border border-primary/20 rounded-2xl p-6 mb-6 glow-gold">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
              <WalletIcon className="w-3.5 h-3.5 text-primary" />
              MEXC Spot Wallet
            </div>
            <button
              onClick={() => refetchAccount()}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          <div className="text-center py-2">
            <div className="text-xs text-muted-foreground mb-1">Free to Trade</div>
            <div className="text-4xl font-black text-primary">
              {spotBalance != null ? `${spotBalance.toFixed(4)} USDT` : "—"}
            </div>
            {totalBalance != null && (
              <div className="mt-1 text-xs text-muted-foreground">
                Total portfolio ≈ <span className="text-foreground font-semibold">{totalBalance.toFixed(4)} USDT</span>
              </div>
            )}
          </div>
          {/* Breakdown */}
          {account?.mexcBreakdown && account.mexcBreakdown.length > 0 && (
            <div className="mt-4 space-y-1.5 border-t border-border pt-3">
              {account.mexcBreakdown.filter(b => b.free + b.locked > 0).map(b => (
                <div key={b.asset} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{b.asset}</span>
                  <span className="font-mono font-semibold">
                    {b.asset === "USDT"
                      ? `${b.free.toFixed(4)} free${b.locked > 0 ? ` · ${b.locked.toFixed(4)} locked` : ""}`
                      : `${(b.free + b.locked).toFixed(6)} ≈ ${b.valueUsdt.toFixed(4)} USDT`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 bg-card border border-border rounded-xl overflow-hidden mb-5">
          <button
            onClick={() => setTab("deposit")}
            className={`py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${tab === "deposit" ? "bg-profit/10 text-profit border-b-2 border-profit" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ArrowUpToLine className="w-4 h-4" /> Deposit
          </button>
          <button
            onClick={() => setTab("withdraw")}
            className={`py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${tab === "withdraw" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ArrowDownToLine className="w-4 h-4" /> Withdraw
          </button>
        </div>

        {/* MEXC P2P Info card */}
        <div className="bg-card border border-border rounded-2xl p-5 mb-5 space-y-4">
          {tab === "deposit" ? (
            <>
              <div>
                <h3 className="font-bold text-base mb-1 flex items-center gap-2">
                  <ArrowUpToLine className="w-4 h-4 text-profit" />
                  Deposit via MEXC P2P
                </h3>
                <p className="text-sm text-muted-foreground">
                  Add funds to your MEXC Spot wallet using P2P trading. Buy USDT from a peer using your local
                  payment method (bank transfer, mobile money, etc.) — MEXC connects you with verified merchants.
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2.5 p-3 bg-secondary/50 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-profit text-white flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5">1</span>
                  <span>Open MEXC and go to <strong>Buy Crypto → P2P Trading</strong></span>
                </div>
                <div className="flex items-start gap-2.5 p-3 bg-secondary/50 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-profit text-white flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5">2</span>
                  <span>Select <strong>USDT</strong> and choose a payment method (bank, MoMo, etc.)</span>
                </div>
                <div className="flex items-start gap-2.5 p-3 bg-secondary/50 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-profit text-white flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5">3</span>
                  <span>Complete the payment — USDT will appear in your Spot wallet automatically</span>
                </div>
              </div>

              <a
                href="https://www.mexc.com/en-US/trade/p2p"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 bg-profit hover:opacity-90 text-white font-black rounded-xl transition-opacity flex items-center justify-center gap-2 text-sm"
              >
                <ArrowUpToLine className="w-4 h-4" />
                Deposit on MEXC P2P
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </a>

              <p className="text-center text-xs text-muted-foreground">
                Opens MEXC in a new tab. Your USDT balance here refreshes automatically once received.
              </p>
            </>
          ) : (
            <>
              <div>
                <h3 className="font-bold text-base mb-1 flex items-center gap-2">
                  <ArrowDownToLine className="w-4 h-4 text-primary" />
                  Withdraw via MEXC P2P
                </h3>
                <p className="text-sm text-muted-foreground">
                  Cash out your USDT by selling it to a peer on MEXC P2P. Receive payment directly to your bank
                  account or mobile money wallet.
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2.5 p-3 bg-secondary/50 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5">1</span>
                  <span>Open MEXC and go to <strong>Sell Crypto → P2P Trading</strong></span>
                </div>
                <div className="flex items-start gap-2.5 p-3 bg-secondary/50 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5">2</span>
                  <span>Select <strong>USDT</strong> and pick your preferred payment method</span>
                </div>
                <div className="flex items-start gap-2.5 p-3 bg-secondary/50 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5">3</span>
                  <span>Confirm the order — a merchant sends you the cash, then USDT is released</span>
                </div>
              </div>

              <a
                href="https://www.mexc.com/en-US/trade/p2p"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 bg-primary hover:opacity-90 text-primary-foreground font-black rounded-xl transition-opacity flex items-center justify-center gap-2 text-sm"
              >
                <ArrowDownToLine className="w-4 h-4" />
                Withdraw on MEXC P2P
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </a>

              <p className="text-center text-xs text-muted-foreground">
                Opens MEXC in a new tab. Your balance here will reflect any changes after selling.
              </p>
            </>
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
                      {tx.sign}{tx.amount.toFixed(2)} USDT
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
