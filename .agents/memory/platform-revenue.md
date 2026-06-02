---
name: Platform revenue model
description: How TradeFlow tracks admin profit from user trades
---

**Model:** On real (non-demo) trade close in trades.ts:
- WIN → platform earns `stake * 0.15` recorded as `WIN_CUT`
- LOSS → platform earns full `stake` recorded as `LOSS_KEEP`

Payout rate is 85%, so on a GHS 100 win, user gets GHS 85 and platform keeps GHS 15.

**Why:** Mirrors Olymp Trade's house-edge model. Demo trades are completely excluded from revenue tracking.

**How to apply:** Revenue insert happens in the setTimeout trade close handler in trades.ts. Auto-invest trades go through the same route so they're also tracked. Always check `isDemo` before recording revenue.
