# NevUp Track 1 — Bugfix Task Checklist

> **Status key**: `[ ]` todo · `[/]` in progress · `[x]` done  
> **Source**: [definitive_audit.md](file:///C:/Users/harsh/.gemini/antigravity/brain/344eb425-05d5-470c-99c5-6f87e9f42e26/definitive_audit.md)  
> **Workflow**: [workflow.md](file:///c:/Users/harsh/paper-trading-behavioral-engine/.planning/bugfix/workflow.md)

---

## 🔴 Tier 1: MUST FIX (Real Spec Violations)

### Fix 1: `queueLag` returns string instead of integer
- [x] Replace `XINFO GROUPS` parsing with `XPENDING` in `src/routes/health.js`
- [x] `XPENDING` returns `[totalPending, minId, maxId, consumerList]` — use `parseInt(pending[0], 10)`
- [x] Fallback to `0` on any error (stream doesn't exist yet, no consumer group, etc.)
- [x] Smoke test: `curl http://localhost:3000/health` → verify `"queueLag": 0` (integer, not `"0-0"`) ✅

### Fix 2: Redis publish failure — no retry, no structured log
- [x] Add 2-attempt retry loop in `src/services/tradeService.js` `createTrade()` (lines 122–129)
- [x] 500ms delay between retries
- [x] On final failure: log with pino at `error` level including `tradeId`, `userId`, `attempt`, `err`
- [x] Create module-level pino logger (service layer has no access to `req.log`)
- [x] Trade still returns 200 — do NOT fail the request
- [x] Smoke test: POST trade → 200 with computed outcome/pnl ✅

### Fix 3: `seed.js` uses `||` instead of `??` — falsifies zero values
- [x] Line 77: `trade.outcome || null` → `trade.outcome ?? null`
- [x] Line 78: `trade.pnl || null` → `trade.pnl ?? null`
- [x] Line 79: `trade.planAdherence || null` → `trade.planAdherence ?? null`
- [x] Line 80: `trade.emotionalState || null` → `trade.emotionalState ?? null`
- [x] Line 81: `trade.entryRationale || null` → `trade.entryRationale ?? null`
- [x] Line 82: `trade.revengeFlag || false` → `trade.revengeFlag ?? false`
- [x] Smoke test: `docker compose down -v && docker compose up --build` → 388 trades, 0 closed with null pnl ✅

### ── TIER 1 GATE CHECK ──
- [x] `curl /health` → `queueLag` is a number (not string) ✅ `queueLag: 0`
- [x] `npm test` → all 34 tests pass (no regressions) ✅ 34/34 pass
- [x] `docker compose logs api 2>&1 | head -5` → no console.error lines from tradeService ✅
- [ ] Commit: `fix(audit-t1): queueLag type, publish retry, seed nullish coalescing`

---

## 🟠 Tier 2: HIGH VALUE (Strongly Recommended)

### Fix 4: Overtrading detector TOCTOU race condition
- [x] Create `migrations/005_overtrading_unique.sql`
  - [x] `ALTER TABLE overtrading_events ADD CONSTRAINT uq_overtrading_user_window UNIQUE (user_id, window_end)`
  - [x] Wrap in `DO $$ BEGIN ... IF NOT EXISTS ... END $$` for idempotency
- [x] Update `src/workers/overtradingDetector.js`
  - [x] Remove the `SELECT ... WHERE user_id AND window_end` check (lines 31–36)
  - [x] Remove the `if (existing.rows.length === 0)` guard (line 38)
  - [x] Replace with single `INSERT ... ON CONFLICT (user_id, window_end) DO NOTHING`
- [x] Smoke test: `npm test` → 34/34 pass, zero regressions ✅

### Fix 5: Structured pino logging for API-side plugins
- [x] `src/plugins/database.js`:
  - [x] Add `const pino = require('pino')` and `const logger = pino(...)` at top
  - [x] Replace line 26 `console.error(...)` → `logger.error({ err: err.message }, 'Unexpected pool error')`
- [x] `src/plugins/redis.js`:
  - [x] Add `const pino = require('pino')` and `const logger = pino(...)` at top
  - [x] Replace line 25 `console.error(...)` → `logger.error({ err: err.message }, 'Redis connection error')`
- [x] Smoke test: `npm test` → 34/34 pass, zero `console.error` in API plugins ✅

### ── TIER 2 GATE CHECK ──
- [x] `docker compose exec postgres psql -U nevup -d nevup -c "\d overtrading_events"` → shows `uq_overtrading_user_window` ✅
- [x] `npm test` → all 34 tests pass (no regressions) ✅
- [x] `docker compose logs api 2>&1` → all lines structured JSON, no `console.error` ✅
- [x] Commit: `fix(audit-t2): overtrading dedup, structured API logs` ✅ `a6fbdad`

---

## 🔴 Tier 3: POST-AUDIT FIXES (Second-Pass Audit)

> **Source**: [definitive_audit_v2.md](file:///C:/Users/harsh/.gemini/antigravity/brain/943ffbd0-270f-4ec9-9b05-2909c1557edc/definitive_audit_v2.md)

### Fix 6: `exitPrice` null coercion — `||` treats `0` as falsy 🔴
- [x] `src/services/tradeService.js` line 106:
  - [x] `input.exitPrice || null` → `input.exitPrice ?? null`
- [x] Smoke test: `npm test` → 34/34 pass ✅

### Fix 7: `entryRationale` empty string destroyed 🟠
- [x] `src/services/tradeService.js` line 115:
  - [x] `input.entryRationale || null` → `input.entryRationale ?? null`
- [x] Also fix remaining `||` on adjacent nullable INSERT params (zero-risk consistency):
  - [x] Line 109: `input.exitAt || null` → `input.exitAt ?? null`
  - [x] Line 113: `input.planAdherence || null` → `input.planAdherence ?? null`
  - [x] Line 114: `input.emotionalState || null` → `input.emotionalState ?? null`
- [x] Smoke test: `npm test` → 34/34 pass ✅

### Fix 8: Publisher nullish consistency 🟠
- [x] `src/services/publisher.js` XADD fields:
  - [x] Line 58: `trade.outcome || ''` → `trade.outcome ?? ''`
  - [x] Line 59: `String(trade.pnl || 0)` → `String(trade.pnl ?? 0)`
  - [x] Line 60: `String(trade.planAdherence || '')` → `String(trade.planAdherence ?? '')`
  - [x] Line 61: `trade.emotionalState || ''` → `trade.emotionalState ?? ''`
- [x] Smoke test: `npm test` → 34/34 pass ✅

### ── TIER 3 GATE CHECK ──
- [ ] `npm test` → all 34 tests pass (no regressions)
- [ ] No remaining `||` on data fields in `tradeService.js` INSERT params or `publisher.js` XADD fields
- [ ] Commit: `fix(audit-t3): nullish coalescing in tradeService + publisher`

---

## ✅ Post-Fix Verification

- [ ] Full clean rebuild: `docker compose down -v && docker compose up --build`
- [ ] 388 trades seeded, 52 sessions
- [ ] `npm test` → all pass
- [ ] `curl /health` → integer `queueLag`
- [ ] Final `git push origin main --force`

