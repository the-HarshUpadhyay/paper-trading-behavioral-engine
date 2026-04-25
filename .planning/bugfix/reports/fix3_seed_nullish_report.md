# Fix 3: Seed Nullish Coalescing — Report

> **Status**: ✅ COMPLETE  
> **Started**: 2026-04-26 00:41 IST  
> **Completed**: 2026-04-26 00:44 IST  
> **Duration**: ~3 minutes (includes full rebuild + re-seed)

---

## Bug Summary

| Field | Value |
|---|---|
| **Severity** | 🔴 CRITICAL (Data corruption) |
| **Tier** | Tier 1: MUST FIX |
| **File** | `src/seed.js` |
| **Lines Changed** | 76–81 |
| **Root Cause** | JavaScript `\|\|` treats `0`, `""`, `false` as falsy — `pnl: 0` becomes `null` |
| **Spec Requirement** | Seed dataset must be loaded exactly as provided |

---

## What Was Wrong

```javascript
// lines 76-81 — BEFORE
trade.outcome || null,        // ← "" becomes null (ok, but fragile)
trade.pnl || null,            // ← BUG: pnl=0 becomes null
trade.planAdherence || null,  // ← planAdherence is 1-5, so 0 shouldn't exist, but fragile
trade.emotionalState || null, // ← "" becomes null (ok, but fragile)
trade.entryRationale || null, // ← "" becomes null (ok for this field)
trade.revengeFlag || false,   // ← false || false = false (works by accident)
```

JavaScript `||` returns the right operand if the left is **falsy** (`0`, `""`, `false`, `null`, `undefined`). The nullish coalescing operator `??` only returns the right operand if the left is **`null` or `undefined`** — preserving `0`, `""`, and `false`.

---

## What Was Fixed

```javascript
// lines 76-81 — AFTER
trade.outcome ?? null,
trade.pnl ?? null,
trade.planAdherence ?? null,
trade.emotionalState ?? null,
trade.entryRationale ?? null,
trade.revengeFlag ?? false,
```

---

## Verification

| Test | Expected | Actual | Status |
|---|---|---|---|
| Total trades seeded | 388 | 388 | ✅ |
| Closed trades with null pnl | 0 | 0 | ✅ |
| Trades with pnl = 0 | 0 (no breakevens in seed data) | 0 | ✅ |
| Health endpoint | `"ok"`, `queueLag: 0` (integer) | Confirmed | ✅ |

### SQL verification queries:
```sql
SELECT COUNT(*) AS total_trades FROM trades;                            -- 388
SELECT COUNT(*) FROM trades WHERE status = 'closed' AND pnl IS NULL;   -- 0
SELECT COUNT(*) FROM trades WHERE pnl = 0;                             -- 0
```

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `??` requires Node 14+ | Project uses Node 20 (Dockerfile: `node:20-alpine`) |
| Seed data has no pnl=0 trades to prove the fix | The fix is defensive — prevents future data corruption if seed data ever includes breakeven trades |
| Re-seed required after fix | Full `docker compose down -v && up --build` performed — clean state confirmed |
