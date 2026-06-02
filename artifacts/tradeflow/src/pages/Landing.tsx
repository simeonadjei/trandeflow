import { Link } from "wouter";
import { useListAssets, useGetAccountStats } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Shield, Zap, Smartphone, BarChart2, ArrowRight, ChevronRight, Star } from "lucide-react";

function TickerBar() {
  const { data: assets } = useListAssets();
  if (!assets?.length) return null;

  const doubled = [...assets, ...assets];
  return (
    <div className="bg-card border-b border-border overflow-hidden py-2">
      <div className="flex ticker-track gap-8 w-max">
        {doubled.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="font-semibold text-foreground">{a.symbol}</span>
            <span className="font-mono text-xs text-muted-foreground">{a.price.toFixed(a.price > 100 ? 2 : 5)}</span>
            <span className={`text-xs font-medium ${a.changePercent >= 0 ? "text-profit" : "text-loss"}`}>
              {a.changePercent >= 0 ? "+" : ""}{a.changePercent.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const testimonials = [
  { name: "Ama Owusu", location: "Accra", text: "TradeFlow's pattern analysis helped me understand when to enter. I made GHS 420 in my first week.", stars: 5 },
  { name: "Kofi Asante", location: "Kumasi", text: "The auto-invest feature is incredible. It trades for me while I work and sends profits straight to my MTN MoMo.", stars: 5 },
  { name: "Efua Mensah", location: "Takoradi", text: "I was skeptical at first but the pattern signals are very accurate. Withdrew GHS 1,200 last month no issues.", stars: 5 },
];

export default function Landing() {
  const { data: stats } = useGetAccountStats();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-black text-lg">
            <TrendingUp className="w-5 h-5 text-primary" />
            <span>Trade<span className="text-primary">Flow</span></span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/learn" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors">Learn</Link>
            <Link href="/trade" className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity">
              Start Trading
            </Link>
          </div>
        </div>
      </nav>

      <TickerBar />

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
        <div className="absolute top-20 right-20 w-72 h-72 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-48 h-48 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-primary text-xs font-semibold mb-6">
            <div className="w-1.5 h-1.5 bg-primary rounded-full live-pulse" />
            Live Trading Platform — Ghana
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-tight mb-6">
            Study Patterns.
            <br />
            <span className="text-primary">Invest Smart.</span>
            <br />
            Withdraw to MoMo.
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            TradeFlow analyses chart patterns in real-time to signal the best moments to invest — then automatically trades for you. Withdraw your profits directly to MTN, Vodafone, or AirtelTigo MoMo anytime.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/trade" className="flex items-center justify-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground font-bold rounded-lg hover:opacity-90 transition-opacity text-base glow-gold">
              Start Trading Now <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/learn" className="flex items-center justify-center gap-2 px-8 py-3.5 bg-secondary text-secondary-foreground font-semibold rounded-lg hover:bg-secondary/80 transition-colors text-base">
              Learn Patterns <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Stats row */}
          <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Active Traders", value: "24,800+" },
              { label: "Total Paid Out", value: "GHS 4.2M+" },
              { label: "Avg Win Rate", value: "68%" },
              { label: "Patterns Detected", value: "12 Types" },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-black text-primary">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black mb-3">Everything You Need to Trade Smart</h2>
            <p className="text-muted-foreground">Three powerful features working together to grow your money.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: BarChart2,
                color: "text-primary",
                bg: "bg-primary/10",
                title: "AI Pattern Analysis",
                desc: "Our engine scans 12 candlestick patterns — Hammer, Doji, Engulfing, Shooting Star and more — and tells you exactly when to buy or sell with a confidence score.",
              },
              {
                icon: Zap,
                color: "text-accent-foreground",
                bg: "bg-accent/20",
                title: "Auto-Invest Bot",
                desc: "Enable the bot, set your stake amount, and let it trade for you. It acts only on high-confidence signals so it minimises unnecessary losses while maximising wins.",
              },
              {
                icon: Smartphone,
                color: "text-yellow-400",
                bg: "bg-yellow-400/10",
                title: "MoMo Withdrawals",
                desc: "Withdraw profits directly to MTN MoMo, Vodafone Cash, or AirtelTigo Money. Minimum GHS 10. Processed within minutes — no bank account needed.",
              },
            ].map((f) => (
              <div key={f.title} className="bg-card border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
                <div className={`w-11 h-11 ${f.bg} rounded-xl flex items-center justify-center mb-4`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-card/50 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black mb-3">How TradeFlow Works</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Deposit & Fund", desc: "Add funds to your account and set your trading stake amount." },
              { step: "02", title: "Read the Signal", desc: "The AI scans patterns and shows you BUY or SELL signals with confidence levels." },
              { step: "03", title: "Win & Withdraw", desc: "Collect your profits and send them straight to your MoMo wallet." },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="text-5xl font-black text-primary/20 mb-3">{s.step}</div>
                <h3 className="font-bold mb-2">{s.title}</h3>
                <p className="text-muted-foreground text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black mb-3">What Ghanaian Traders Say</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div key={t.name} className="bg-card border border-border rounded-2xl p-6">
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">"{t.text}"</p>
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.location}, Ghana</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-gradient-to-br from-card to-card/50 border border-primary/20 rounded-3xl p-10 glow-gold">
            <h2 className="text-3xl font-black mb-4">Ready to Start Earning?</h2>
            <p className="text-muted-foreground mb-8">Join thousands of Ghanaians growing their income with smart trading.</p>
            <Link href="/trade" className="inline-flex items-center gap-2 px-10 py-4 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-opacity text-lg">
              Open Trading Platform <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm text-foreground">TradeFlow</span>
        </div>
        <p>Trading involves risk. Only invest what you can afford to lose. Past performance does not guarantee future results.</p>
        <div className="flex items-center justify-center gap-4 mt-3">
          <Link href="/trade" className="hover:text-foreground transition-colors">Trade</Link>
          <Link href="/wallet" className="hover:text-foreground transition-colors">Wallet</Link>
          <Link href="/learn" className="hover:text-foreground transition-colors">Learn</Link>
        </div>
      </footer>
    </div>
  );
}
