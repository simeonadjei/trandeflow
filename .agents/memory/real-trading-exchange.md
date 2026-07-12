---
name: Real trading exchange
description: Which crypto exchange APIs are reachable from this Replit host, and the real-trading architecture used in TradeFlow's bot.
---

## Exchange reachability from this host
- Binance (`api.binance.com`) and Bybit (`api.bybit.com`) return HTTP 451/403 on *public* endpoints — geo-blocked at the network level regardless of account/API key validity. Do not attempt Binance/Bybit direct integration from this environment.
- KuCoin's public endpoints (candles, ticker, symbols) are reachable (200), but its **signed/authenticated** endpoints (e.g. `/api/v1/accounts`) return error code `400302` — KuCoin also geo-blocks by the *server's* outbound IP for private calls, independent of the account's own region. This Replit host's outbound IP resolves to the US, which KuCoin restricts. Confirmed with real API key/secret/passphrase — this is a hard network-level block, not an auth or config error.
- Net effect: no exchange tested so far (Binance, Bybit, KuCoin) supports authenticated/private real-trading calls directly from this Replit host. Public market-data endpoints work on KuCoin/OKX/Coinbase, but placing real signed orders requires an outbound path with a non-restricted IP (e.g. a proxy/VPN with an allowed region, or hosting the trading execution elsewhere).

**Why:** Discovered via direct curl test (451 "restricted location" error) after the user had already created and funded a Binance account — cost real rework. Check reachability with a plain `curl` to the exchange's public ping/time endpoint *before* committing a user to an exchange signup flow.

## TradeFlow real-trading architecture (KuCoin)
- Long-only: real spot trading can't short without margin/futures (extra risk + separate account enablement), so the bot only trades bullish (UP) 8/8 signals on BTC-USDT / ETH-USDT. DOWN signals are skipped entirely.
- Trading balance is KuCoin's real free USDT balance (fetched live via signed `/api/v1/accounts`), NOT the app's GHS `balance` column — that field is reserved for Paystack deposits/withdrawals only. Realized crypto P&L accumulates in `accounts.realizedPnlUsd`, kept separate from GHS figures to avoid mixing currencies in the UI.
- Trade lifecycle: real market buy (`funds=stake`) → poll order until filled for avgPrice/dealSize → monitor up to 5s, re-checking signal + price every ~1s → exit (real market sell) on whichever comes first: signal reversal, take-profit (+0.4%), stop-loss (-0.3%), or window expiry. No forced/guaranteed outcomes.
- KuCoin signing requires 3 secrets: API key, API secret, and a user-chosen passphrase (itself HMAC-signed with the secret) — different from Binance's 2-value scheme.
