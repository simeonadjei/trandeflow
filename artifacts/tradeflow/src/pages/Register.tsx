import { useState } from "react";
import { Link, useLocation } from "wouter";
import { TrendingUp, Eye, EyeOff, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { apiBase } from "../lib/api";

export default function Register() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed"); return; }
      login(data.token, data.user);
      navigate("/trade");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3;
  const strengthLabel = ["", "Weak", "Good", "Strong"][strength];
  const strengthColor = ["", "bg-loss", "bg-yellow-400", "bg-profit"][strength];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 font-black text-xl mb-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            <span>Trade<span className="text-primary">Flow</span></span>
          </Link>
          <p className="text-muted-foreground text-sm mt-1">Create your free account</p>
        </div>

        {/* Perks */}
        <div className="mb-5 grid grid-cols-3 gap-2 text-center text-xs">
          {["GHS 1,000 bonus", "GHS 10K demo", "Free MoMo"].map((p) => (
            <div key={p} className="bg-profit/10 border border-profit/20 rounded-lg py-2 text-profit font-semibold flex items-center justify-center gap-1">
              <CheckCircle className="w-3 h-3" /> {p}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Full Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kwame Mensah" required
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Password</label>
            <div className="relative">
              <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 characters" required
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm pr-10 focus:outline-none focus:border-primary transition-colors" />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {password.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${strengthColor}`} style={{ width: `${(strength / 3) * 100}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{strengthLabel}</span>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</> : "Create Account"}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline font-semibold">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
