import { useState } from "react";
import { Link } from "wouter";
import { TrendingUp, Loader2, AlertCircle, CheckCircle, ArrowLeft } from "lucide-react";
import { apiBase } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [resetToken, setResetToken] = useState("");

  // Reset password step
  const [step, setStep] = useState<"request" | "reset">("request");
  const [newPassword, setNewPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      setDone(true);
      if (data.resetToken) setResetToken(data.resetToken);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Reset failed"); return; }
      setResetDone(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 font-black text-xl mb-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            <span>Trade<span className="text-primary">Flow</span></span>
          </Link>
          <p className="text-muted-foreground text-sm mt-1">Reset your password</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          {resetDone ? (
            <div className="text-center py-4">
              <CheckCircle className="w-12 h-12 text-profit mx-auto mb-3" />
              <h3 className="font-bold text-lg mb-1">Password Reset!</h3>
              <p className="text-sm text-muted-foreground mb-4">Your password has been updated successfully.</p>
              <Link href="/login" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90">
                Sign In Now
              </Link>
            </div>
          ) : done && resetToken ? (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit">
                <CheckCircle className="w-4 h-4 inline mr-1" /> Reset token generated. Enter your new password below.
              </div>
              <div className="p-2 bg-secondary rounded text-xs font-mono break-all text-muted-foreground">Token: {resetToken}</div>
              {error && <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss"><AlertCircle className="w-4 h-4" /> {error}</div>}
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1.5 block">New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 6 characters" required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Resetting...</> : "Reset Password"}
              </button>
            </form>
          ) : done ? (
            <div className="text-center py-4">
              <CheckCircle className="w-12 h-12 text-profit mx-auto mb-3" />
              <h3 className="font-bold text-lg mb-1">Email Sent!</h3>
              <p className="text-sm text-muted-foreground">If <strong>{email}</strong> is registered, you'll receive reset instructions.</p>
            </div>
          ) : (
            <form onSubmit={handleRequest} className="space-y-4">
              {error && <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss"><AlertCircle className="w-4 h-4" /> {error}</div>}
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Email address</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : "Send Reset Link"}
              </button>
              <Link href="/login" className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-3 h-3" /> Back to login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
