import { Link, useLocation } from "wouter";
import { TrendingUp, BarChart2, Wallet, BookOpen, Menu, X } from "lucide-react";
import { useState } from "react";
import { useGetAccount } from "@workspace/api-client-react";

export default function Navbar() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { data: account } = useGetAccount();

  const links = [
    { href: "/trade", label: "Trade", icon: BarChart2 },
    { href: "/wallet", label: "Wallet", icon: Wallet },
    { href: "/learn", label: "Learn", icon: BookOpen },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-black text-lg tracking-tight">
          <TrendingUp className="w-5 h-5 text-primary" />
          <span className="text-foreground">Trade<span className="text-primary">Flow</span></span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                location === l.href
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <l.icon className="w-3.5 h-3.5" />
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          {account && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Balance:</span>
              {account.mexcConnected
                ? <span className="font-bold text-primary">{(account.mexcFreeUsdt ?? 0).toFixed(4)} USDT</span>
                : <span className="font-bold text-primary">GHS {account.balance.toFixed(2)}</span>
              }
            </div>
          )}
          <Link href="/trade" className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity">
            Trade Now
          </Link>
        </div>

        <button className="md:hidden p-1" onClick={() => setOpen(!open)}>
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-background px-4 py-3 space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location === l.href ? "bg-primary/15 text-primary" : "text-muted-foreground"
              }`}
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </Link>
          ))}
          {account && (
            <div className="pt-2 border-t border-border mt-2 text-sm">
              <span className="text-muted-foreground">Balance: </span>
              {account.mexcConnected
                ? <span className="font-bold text-primary">{(account.mexcFreeUsdt ?? 0).toFixed(4)} USDT</span>
                : <span className="font-bold text-primary">GHS {account.balance.toFixed(2)}</span>
              }
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
