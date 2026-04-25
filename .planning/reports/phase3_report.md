# Phase 3: Write API — Report

> **Status**: ✅ COMPLETE  
> **Started**: 2026-04-25 19:23 IST  
> **Completed**: 2026-04-25 19:27 IST  
> **Duration**: ~4 minutes

---

## Objective

Implement the core write path: idempotent `POST /trades` and `GET /trades/:tradeId` with full validation, P&L computation, tenancy enforcement, and Redis Stream publishing.

---

## What Was Built

| File | Lines | Purpose |
|---|---|---|
| `src/plugins/database.js` | 42 | Lazy pg.Pool singleton, pool max 20 |
| `src/plugins/redis.js` | 42 | Lazy ioredis singleton, exponential backoff retry |
| `src/services/publisher.js` | 64 | XADD to `trade:closed` stream, MKSTREAM on first use |
| `src/services/tradeService.js` | 152 | Idempotent insert, P&L compute, snake↔camel mapping |
| `src/routes/trades.js` | 108 | POST + GET with validation, tenancy, error handling |

---

## Key Implementation Details

### Idempotency Flow
```
POST /trades { tradeId: X }
  ├── INSERT ... ON CONFLICT (trade_id) DO NOTHING RETURNING *
  ├── IF rows returned → new trade (publish to Redis if closed)
  ├── IF no rows → SELECT existing trade  
  └── ALWAYS return 200 (spec mandate — never 409 or 201)
```

### P&L Computation
```javascript
const multiplier = direction === 'long' ? 1 : -1;
const pnl = (exitPrice - entryPrice) * quantity * multiplier;
const outcome = pnl > 0 ? 'win' : 'loss';
```
Verified: `(182.30 - 178.45) * 10 * 1 = 38.50` → `outcome: "win"` ✅

### Validation Checks (10 required fields + 5 enum/range checks)
- Required: tradeId, userId, sessionId, asset, assetClass, direction, entryPrice, quantity, entryAt, status
- Enums: assetClass (equity/crypto/forex), direction (long/short), status (open/closed/cancelled), emotionalState (5 values)
- Range: planAdherence 1-5, entryRationale maxLength 500

### Redis Stream Message
```
Stream: trade:closed
Message: 16 flat key-value pairs (tradeId, userId, sessionId, asset, direction, entryPrice, exitPrice, quantity, entryAt, exitAt, status, outcome, pnl, planAdherence, emotionalState)
Consumer group: metric-workers (auto-created with MKSTREAM)
```

---

## Issues Encountered

**None.** All code worked on first deploy. Zero debugging needed.

---

## Gate Check Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| POST new trade | 200 + computed fields | 200 `outcome:"win", pnl:38.5` | ✅ |
| POST same tradeId again | 200 + identical body | 200 + same `tradeId`, `pnl`, `outcome` | ✅ |
| POST with wrong userId | 403 | 403 `"Cross-tenant access denied."` | ✅ |
| GET existing trade | 200 | 200 with all 21 fields | ✅ |
| GET with wrong user JWT | 403 (not 404!) | 403 `"Cross-tenant access denied."` | ✅ |
| Redis Stream | 1 message | `XINFO STREAM` shows length:1, groups:1 | ✅ |

---

## Metrics

| Metric | Value |
|---|---|
| Files created/modified | 6 (5 new + server.js mount) |
| Total new lines | ~408 |
| Docker rebuilds | 1 |
| Issues encountered | 0 |
| Time to gate check | ~4 minutes |

---

## Cumulative Progress

| Phase | Status | Duration |
|---|---|---|
| Phase 1: Foundation | ✅ | ~25 min |
| Phase 2: Auth + Middleware | ✅ | ~10 min |
| Phase 3: Write API | ✅ | ~4 min |
| **Total** | **3/8 phases done** | **~39 min** |
