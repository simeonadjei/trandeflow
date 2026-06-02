---
name: Auth system
description: JWT auth setup for TradeFlow — token storage, admin seed, route structure
---

JWT tokens signed with SESSION_SECRET (env var). bcryptjs for hashing.

**Routes:** POST /api/auth/login, /api/auth/register, /api/auth/forgot-password, /api/auth/reset-password, GET /api/auth/me. Admin routes: GET /api/admin/stats|users|trades|earnings|deposits|withdrawals.

**Admin seed:** admin@tradeflow.gh / Admin@2024 — seeded in auth.ts `ensureAdmin()` on server start.

**Frontend:** AuthContext stores token + user in localStorage keys `tf_token` / `tf_user`. Auth routes are plain fetch (not Orval codegen).

**Why:** Auth/admin routes bypass the OpenAPI spec and codegen — they use direct fetch from AuthContext and Admin page.

**How to apply:** When adding new admin endpoints, add to admin.ts and use `requireAdmin` middleware. Auth routes use `requireAuth`. No openapi.yaml changes needed.
