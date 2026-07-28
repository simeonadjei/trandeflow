import { useCallback, useEffect, useRef } from "react";

export type TradeNotifEvent =
  | { type: "placed"; symbol: string; direction: "UP" | "DOWN"; amount: number }
  | { type: "win"; symbol: string; profit: number }
  | { type: "loss"; symbol: string; amount: number };

function isSupported() {
  return "Notification" in window;
}

export function useNotifications() {
  const granted = useRef(isSupported() && Notification.permission === "granted");

  const requestPermission = useCallback(async () => {
    if (!isSupported()) return false;
    if (Notification.permission === "granted") {
      granted.current = true;
      return true;
    }
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    granted.current = result === "granted";
    return granted.current;
  }, []);

  const notify = useCallback((event: TradeNotifEvent) => {
    if (!isSupported() || !granted.current) return;

    let title = "";
    let body = "";
    let icon = "/favicon.ico";

    if (event.type === "placed") {
      title = `🤖 Bot placed ${event.direction} trade`;
      body = `${event.symbol} — USDT ${event.amount.toFixed(4)} at risk`;
    } else if (event.type === "win") {
      title = `✅ Auto-trade WON!`;
      body = `${event.symbol} — +USDT ${event.profit.toFixed(4)} added to your spot balance`;
    } else {
      title = `❌ Auto-trade lost`;
      body = `${event.symbol} — USDT ${event.amount.toFixed(4)} lost`;
    }

    try {
      const n = new Notification(title, { body, icon, silent: false });
      setTimeout(() => n.close(), 6000);
    } catch {
      // Notification API unavailable in this context
    }
  }, []);

  return { requestPermission, notify };
}

type TradeSnapshot = {
  id: number;
  status: string;
  isAuto: boolean;
  symbol: string;
  direction: "UP" | "DOWN";
  amount: number;
  profit: number | null;
};

export function useAutoTradeNotifications(
  trades: TradeSnapshot[] | undefined,
  autoEnabled: boolean,
  notify: (e: TradeNotifEvent) => void,
) {
  const prevRef = useRef<Map<number, TradeSnapshot>>(new Map());
  const initialLoad = useRef(true);

  useEffect(() => {
    if (!trades) return;

    const current = new Map(trades.map((t) => [t.id, t]));

    if (initialLoad.current) {
      prevRef.current = current;
      initialLoad.current = false;
      return;
    }

    if (!autoEnabled) {
      prevRef.current = current;
      return;
    }

    for (const [id, trade] of current) {
      const prev = prevRef.current.get(id);

      // New auto-trade appeared (was not in previous snapshot)
      if (!prev && trade.isAuto && trade.status === "OPEN") {
        notify({ type: "placed", symbol: trade.symbol, direction: trade.direction, amount: trade.amount });
        continue;
      }

      // Trade transitioned from OPEN → WIN or LOSS
      if (prev?.status === "OPEN" && trade.status === "WIN" && trade.isAuto) {
        notify({ type: "win", symbol: trade.symbol, profit: trade.profit ?? 0 });
      } else if (prev?.status === "OPEN" && trade.status === "LOSS" && trade.isAuto) {
        notify({ type: "loss", symbol: trade.symbol, amount: trade.amount });
      }
    }

    prevRef.current = current;
  }, [trades, autoEnabled, notify]);
}
