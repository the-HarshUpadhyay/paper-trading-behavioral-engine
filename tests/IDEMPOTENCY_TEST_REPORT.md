# NevUp Track 1 — Idempotency Test Report

> **Project**: System of Record Backend for Trade Journal & Behavioral Analytics  
> **Author**: Harsh Upadhyay  
> **Date**: 2026-04-26  
> **Environment**: Pop!_OS · Docker 29.4.1 · Node.js 20-alpine · PostgreSQL 16 · k6 v0.55.0  
> **Test Runner**: Node.js built-in test runner (`node:test`)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirement Specification](#2-requirement-specification)
3. [Implementation Under Test](#3-implementation-under-test)
4. [Test Architecture & Decisions](#4-test-architecture--decisions)
5. [Test Suite 1: Sequential Integration Tests](#5-test-suite-1-sequential-integration-tests)
6. [Test Suite 2: Concurrent Race Condition Tests](#6-test-suite-2-concurrent-race-condition-tests)
7. [Test Suite 3: Database-Level Uniqueness Tests](#7-test-suite-3-database-level-uniqueness-tests)
8. [Test Suite 4: Stress Escalation Tests](#8-test-suite-4-stress-escalation-tests)
9. [Test Suite 5: k6 Load Test — Sustained Duplicate Bombardment](#9-test-suite-5-k6-load-test--sustained-duplicate-bombardment)
10. [Test Suite 6: Direct Database Verification](#10-test-suite-6-direct-database-verification)
11. [Design Decisions](#11-design-decisions)
12. [Results Summary](#12-results-summary)
13. [Final Verdict](#13-final-verdict)
14. [Appendices](#14-appendices)

---

## 1. Executive Summary

This report documents a **multi-layered test suite** designed to prove that `POST /trades` is fully **idempotent on `tradeId`** — the hardest correctness requirement for a System of Record backend. The tests cover six dimensions:

| Layer | What It Proves | Result |
|---|---|---|
| Sequential integration | Basic duplicate → 200 with identical body | ✅ 4/4 pass |
| Concurrent race condition | 50–100 parallel POSTs → no race conditions | ✅ 5/5 pass |
| DB-level uniqueness | No duplicate rows; tampered payloads rejected | ✅ 2/2 pass |
| Stress escalation | 10/25/50/100 concurrency levels → all pass | ✅ 4/4 pass |
| k6 sustained load | 5,101 duplicate requests over 50s → all 200 | ✅ 100% pass rate |
| Direct DB scan | `total_rows == unique_trade_ids` globally | ✅ 12,651 = 12,651 |

**Verdict**: Idempotency is **proven** at every layer — from unit-level sequential checks through sustained concurrent load of 200 duplicate requests/second.

---

## 2. Requirement Specification

### 2.1 Hard Requirements

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 1 | First POST with new `tradeId` creates a record | HTTP 200 + trade JSON with computed fields |
| 2 | Duplicate POST with same `tradeId` returns HTTP 200 | Never 409 Conflict, never 500 Internal Server Error |
| 3 | Duplicate POST returns the EXACT SAME record | `deepStrictEqual` on all non-volatile fields |
| 4 | No duplicate rows are ever created in the database | `COUNT(*) WHERE trade_id = X` must always equal 1 |
| 5 | Must work correctly under HIGH CONCURRENCY | 50–100 parallel same-`tradeId` POSTs → all pass |
| 6 | Duplicate POST with different payload body must NOT overwrite | Original fields preserved (`ON CONFLICT DO NOTHING`) |

### 2.2 Negative Requirements

| What MUST NOT Happen | Why |
|---|---|
| HTTP 409 Conflict | The spec mandates always-200; conflicts are handled silently |
| HTTP 500 Server Error | Database constraint violations must not bubble up as errors |
| Duplicate rows in `trades` table | Violates System of Record integrity |
| Response body mutation on duplicate | The first-write wins; subsequent payloads are discarded |

### 2.3 Explicitly Out of Scope

- Auth/tenancy enforcement (covered in `tests/auth.test.js` and `tests/trades.test.js`)
- Business logic validation (P&L computation, validation rules)
- Async pipeline behavior (Redis Streams → worker)
- Observability and logging

---

## 3. Implementation Under Test

### 3.1 Idempotency Mechanism

The system uses PostgreSQL's `INSERT ... ON CONFLICT DO NOTHING` — a lock-free, atomic, database-level idempotency guarantee:

```sql
INSERT INTO trades (
  trade_id, user_id, session_id, asset, ...
) VALUES ($1, $2, $3, $4, ...)
ON CONFLICT (trade_id) DO NOTHING
RETURNING *
```

### 3.2 Two-Path Resolution

The `createTrade()` function in `src/services/tradeService.js` follows a two-path pattern:

```
               ┌──────────────────────────────────┐
               │  INSERT ... ON CONFLICT DO NOTHING │
               │         RETURNING *                │
               └──────────┬───────────┬────────────┘
                          │           │
                   rows > 0?     rows == 0?
                   (inserted)    (conflict)
                          │           │
                          ▼           ▼
                 return row       SELECT WHERE
                 from INSERT      trade_id = $1
                 (isNew=true)     (isNew=false)
                          │           │
                          └─────┬─────┘
                                │
                          return 200 +
                          trade JSON
```

**Key properties:**
- **Atomic**: The `ON CONFLICT` clause is resolved entirely within PostgreSQL, not at the application layer
- **Lock-free**: `DO NOTHING` acquires no row locks on conflict — concurrent INSERTs don't block each other
- **No TOCTOU**: There is no SELECT-then-INSERT race; the INSERT itself detects the conflict
- **First-write wins**: The `DO NOTHING` guarantees the original row is never modified by a duplicate

### 3.3 Primary Key Constraint

```sql
CREATE TABLE trades (
    trade_id UUID PRIMARY KEY,  -- ← enforces uniqueness at the DB engine level
    ...
);
```

The `PRIMARY KEY` constraint creates a unique B-tree index. PostgreSQL uses this index for both:
1. The `ON CONFLICT (trade_id)` detection (INSERT path)
2. The fallback `SELECT WHERE trade_id = $1` (conflict path)

### 3.4 Route Handler Contract

```javascript
// src/routes/trades.js, line 76-80
const { trade } = await createTrade(body);
// Always return 200 — both new and duplicate
return res.status(200).json(trade);
```

The route handler does NOT distinguish between new and duplicate — it always returns 200. The `isNew` boolean is available but intentionally unused in the response.

---

## 4. Test Architecture & Decisions

### 4.1 Test Framework Choice

**Decision**: Use Node.js built-in test runner (`node:test`) with `node:assert/strict`.

**Why not Jest**:
- The project already uses `node:test` for all existing tests
- Zero additional dependencies — no `jest` or `@jest/globals` to install
- The built-in test runner supports `describe`, `it`, `before`, `after`, async tests, and TAP output natively on Node 20
- Consistency with the existing test suite (`tests/trades.test.js`, `tests/auth.test.js`, etc.)

### 4.2 HTTP Client Choice

**Decision**: Use the project's existing raw `http.request()` wrapper from `tests/setup.js`.

**Why not Supertest directly**:
- The tests run in a separate container from the API — Supertest's `request(app)` pattern requires in-process access to the Express app
- The raw HTTP client allows testing against the Docker API container over the network, which is more realistic
- The existing test infrastructure provides `POST()`, `GET()`, and `generateToken()` helpers already

### 4.3 Concurrency Model

**Decision**: Use `Promise.all()` with no serialization to fire truly parallel requests.

```javascript
function fireParallel(n, fn) {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}
```

**Why this works**: Node.js's event loop dispatches all N HTTP requests immediately. The OS TCP stack sends them in parallel. This creates real concurrent pressure on the server — not sequential "one at a time" requests. At N=100, the server receives ~100 simultaneous requests within a few milliseconds.

**Why not worker threads or cluster**: HTTP network I/O is already fully parallel in Node.js. Worker threads add complexity without additional concurrency for I/O-bound operations.

### 4.4 Assertion Strategy

**Decision**: Use `deepStrictEqual` on "stable fields" (excluding `createdAt`/`updatedAt`).

```javascript
function stableFields(body) {
  const { createdAt, updatedAt, ...rest } = body;
  return rest;
}
```

**Why exclude timestamps**: The INSERT path returns `NOW()` from the `RETURNING` clause. The conflict path returns the stored timestamps from the original `SELECT`. These may differ by microseconds, which is correct behavior — the timestamps belong to the original record. Comparing them would create false negatives without testing anything meaningful about idempotency.

**What IS compared**: Every business-relevant field: `tradeId`, `userId`, `sessionId`, `asset`, `assetClass`, `direction`, `entryPrice`, `exitPrice`, `quantity`, `entryAt`, `exitAt`, `status`, `outcome`, `pnl`, `planAdherence`, `emotionalState`, `entryRationale`, `revengeFlag`.

### 4.5 Test Data Strategy

**Decision**: Generate a unique `tradeId` (via `crypto.randomUUID()`) per test case, NOT shared across tests.

**Why**: Each test generates its own trade to avoid cross-test contamination. If test A's tradeId leaks into test B, a passing test might be silently relying on stale state. Fresh UUIDs per test guarantee isolation.

**Exception**: Within a single test, the SAME tradeId is reused intentionally — that's the idempotency being tested.

---

## 5. Test Suite 1: Sequential Integration Tests

**File**: `tests/idempotency.test.js` — Suite: *"Idempotency: sequential duplicate detection"*

### Purpose

Validate basic idempotency without concurrency pressure. Proves the two-path resolution (INSERT vs SELECT fallback) works correctly one request at a time.

### Test Cases

| # | Test | Asserts | Result |
|---|---|---|---|
| 1 | First POST → 200, creates record | `status == 200`, `tradeId` matches, `pnl` computed correctly (`(155-150)*10 = 50`), `outcome == 'win'` | ✅ 24ms |
| 2 | Second POST same tradeId → 200 | `status == 200`, `status != 409`, `status != 500` | ✅ 4ms |
| 3 | Second POST returns identical body | `deepStrictEqual(stableFields(first), stableFields(second))` | ✅ 6ms |
| 4 | 3rd, 4th, 5th POST → all 200, all identical | Loop 5 times, compare each body to first | ✅ 15ms |

### What This Catches

- An implementation that returns 409 on conflict
- An implementation that returns different computed fields (`pnl`, `outcome`) on duplicate
- An implementation that creates a new record with different values on each POST

---

## 6. Test Suite 2: Concurrent Race Condition Tests

**File**: `tests/idempotency.test.js` — Suite: *"Idempotency: concurrent duplicate detection (race condition test)"*

### Purpose

The **most critical test suite**. Fires 50–100 truly parallel HTTP requests with the same `tradeId` to expose race conditions in the INSERT path. This is the test that **would fail a naive SELECT-then-INSERT implementation**.

### Why This Matters

A non-idempotent implementation using SELECT-then-INSERT has a Time-of-Check to Time-of-Use (TOCTOU) vulnerability:

```
Thread A: SELECT WHERE trade_id = X  →  NULL (not found)
Thread B: SELECT WHERE trade_id = X  →  NULL (not found)
Thread A: INSERT (trade_id = X)       →  SUCCESS
Thread B: INSERT (trade_id = X)       →  DUPLICATE KEY ERROR (500)
                                      or SECOND ROW CREATED (data corruption)
```

The `ON CONFLICT DO NOTHING` approach eliminates this entirely because the INSERT and conflict detection are atomic at the database engine level.

### Test Cases

| # | Test | Concurrency | Asserts | Result |
|---|---|---|---|---|
| 1 | 50 parallel → all 200 | 50 | Every `results[i].status == 200` | ✅ 137ms |
| 2 | 50 parallel → identical bodies | 50 | `deepStrictEqual` all 50 bodies against baseline | ✅ 51ms |
| 3 | 100 parallel → zero non-200 | 100 | `results.filter(r => r.status !== 200).length == 0` | ✅ 105ms |
| 4 | 100 parallel → no 409 Conflict | 100 | `results.filter(r => r.status === 409).length == 0` | ✅ 100ms |
| 5 | 100 parallel → no 500 Error | 100 | `results.filter(r => r.status >= 500).length == 0` | ✅ 109ms |

### How Race Conditions Are Detected

1. **Status check**: Any 409 or 500 proves the conflict leaked to the client
2. **Body comparison**: If two rows are created, different workers might return different records (different `createdAt`, different `pnl`), causing `deepStrictEqual` to fail
3. **Statistical guarantee**: At N=100, the probability that all 100 requests serialize naturally (no overlap) is astronomically low — concurrent execution is virtually guaranteed

---

## 7. Test Suite 3: Database-Level Uniqueness Tests

**File**: `tests/idempotency.test.js` — Suite: *"Idempotency: DB-level uniqueness (via API)"*

### Purpose

Verify that the database contains exactly ONE row per `tradeId`, and that duplicate POSTs with different payloads don't overwrite the original record.

### Test Cases

| # | Test | Asserts | Result |
|---|---|---|---|
| 1 | After 50 concurrent POSTs, GET returns one record | `GET /trades/:tradeId` returns 200 with correct `tradeId` and `asset` | ✅ 51ms |
| 2 | Duplicate POST does not alter original fields | Send tampered payload (`entryPrice: 999`, `asset: 'BTC/USDT'`), verify response still has original values (`entryPrice: 100`, `asset: 'AAPL'`) | ✅ 8ms |

### The Tamper Resistance Test

This test is particularly important. It sends a second POST with the same `tradeId` but completely different field values:

```javascript
// Original (first POST)
{ tradeId: X, entryPrice: 100, exitPrice: 110, asset: 'AAPL', assetClass: 'equity' }

// Tampered duplicate (second POST)
{ tradeId: X, entryPrice: 999, exitPrice: 9999, asset: 'BTC/USDT', assetClass: 'crypto' }
```

The test asserts that the response to the second POST contains the ORIGINAL values (`entryPrice: 100`, `asset: 'AAPL'`), not the tampered ones. This proves:
- `ON CONFLICT DO NOTHING` — the tampered INSERT is silently discarded
- The SELECT fallback returns the original row
- No partial update or merge occurs

---

## 8. Test Suite 4: Stress Escalation Tests

**File**: `tests/idempotency.test.js` — Suite: *"Idempotency: stress escalation"*

### Purpose

Systematically increase concurrency to find the breaking point. Each level uses a fresh `tradeId` to avoid benefiting from cached responses.

### Results

| Concurrency Level | Total Parallel POSTs | All 200? | All Bodies Identical? | Duration | Result |
|---|---|---|---|---|---|
| 10 | 10 | ✅ | ✅ | 9ms | ✅ PASS |
| 25 | 25 | ✅ | ✅ | 20ms | ✅ PASS |
| 50 | 50 | ✅ | ✅ | 45ms | ✅ PASS |
| 100 | 100 | ✅ | ✅ | 77ms | ✅ PASS |

### Observations

- Latency scales linearly with concurrency (~0.8ms per concurrent request)
- No error spikes at any concurrency level
- The system handles 100 simultaneous same-`tradeId` INSERTs within 77ms — PostgreSQL's `ON CONFLICT` is lock-free and extremely efficient

---

## 9. Test Suite 5: k6 Load Test — Sustained Duplicate Bombardment

**File**: `loadtest/idempotency.js`

### Purpose

Move beyond burst concurrency (100 requests at once) to **sustained concurrent duplicate load** over 50 seconds. This tests the system's behavior under continuous duplicate pressure, not just a single burst.

### Test Configuration

The k6 script uses **three phases**, all targeting the SAME fixed `tradeId`:

| Phase | Duration | Rate | Concurrent VUs | Purpose |
|---|---|---|---|---|
| Warmup | 0–10s | 10/s | ~4 VUs | Establish the record; warmup connection pool |
| Steady | 10–40s | 100/s | ~30 VUs | Sustained duplicate bombardment |
| Burst | 40–50s | 200/s | ~60 VUs | Spike to double rate; stress test |

**Think-time**: 300ms per iteration to force VU overlap (same strategy as the throughput load test).

### Thresholds

```javascript
thresholds: {
  'http_req_failed':           ['rate==0'],      // Zero HTTP failures
  'idempotency_409_conflict':  ['count==0'],     // Zero 409 Conflict
  'idempotency_500_error':     ['count==0'],     // Zero 500 Error
  'idempotency_body_mismatch': ['count==0'],     // Zero body differences
  'idempotency_pass_rate':     ['rate==1'],      // 100% pass rate
  'idempotency_latency':       ['p(95)<150'],    // p95 under 150ms
  'dropped_iterations':        ['count==0'],     // All iterations dispatched
}
```

### Custom Metrics

| Metric | Type | What It Tracks |
|---|---|---|
| `idempotency_latency` | Trend | HTTP duration per duplicate request |
| `idempotency_success` | Counter | Requests that returned 200 + correct body |
| `idempotency_409_conflict` | Counter | Requests that returned 409 (must be zero) |
| `idempotency_500_error` | Counter | Requests that returned 500+ (must be zero) |
| `idempotency_body_mismatch` | Counter | Responses with different core fields than the first (must be zero) |
| `idempotency_pass_rate` | Rate | Percentage of fully correct responses (must be 100%) |

### Body Comparison Strategy

The k6 script captures a "reference body" from the first successful response and compares all subsequent responses against it:

```javascript
const coreFields = {
  tradeId, userId, asset, assetClass, direction,
  entryPrice, exitPrice, quantity, status, outcome, pnl
};

if (referenceBody === null) {
  referenceBody = coreFields;  // First response becomes the reference
} else {
  const match = JSON.stringify(coreFields) === JSON.stringify(referenceBody);
  if (!match) bodyMismatchCount.add(1);  // Threshold will fail the test
}
```

### Results

```
╔══════════════════════════════════════════════════════════════════╗
║             IDEMPOTENCY LOAD TEST RESULTS                      ║
╠══════════════════════════════════════════════════════════════════╣
║  Fixed tradeId: 00b4ec71-1f68-4367-9bf8-4f4c69d7c492           ║
║                                                                ║
║  Total Requests:         5,101                                 ║
║  Successful (200):       5,101                                 ║
║  409 Conflicts:              0  ✅                             ║
║  500 Errors:                 0  ✅                             ║
║  Body Mismatches:            0  ✅                             ║
║  Dropped Iterations:         0  ✅                             ║
║  Pass Rate:            100.0%   ✅                             ║
║  p95 Latency:          2.78ms                                  ║
║                                                                ║
║  VERDICT: IDEMPOTENCY PROVEN ✅                                ║
╚══════════════════════════════════════════════════════════════════╝
```

**5,101 requests** with the **same `tradeId`**, fired over 50 seconds at up to 200/s with 60 concurrent VUs. Every single response was HTTP 200 with the identical trade body. Zero conflicts, zero errors, zero mismatches.

---

## 10. Test Suite 6: Direct Database Verification

### Purpose

Verify at the PostgreSQL level that no duplicate rows exist — independent of the application layer. This catches any scenario where the API returns 200 but silently creates a second row.

### Method

Direct SQL against the Docker PostgreSQL container:

```sql
-- Single tradeId verification
SELECT COUNT(*) FROM trades WHERE trade_id = '<uuid>';
-- Must return exactly 1

-- Global duplicate scan
SELECT trade_id, COUNT(*) AS dup_count
FROM trades
GROUP BY trade_id
HAVING COUNT(*) > 1;
-- Must return 0 rows
```

### Results

```
 total_rows | unique_ids
────────────┼────────────
     12,651 |     12,651
```

**12,651 total rows = 12,651 unique `trade_id` values.** Zero duplicates across the entire database, despite thousands of concurrent duplicate POST attempts.

### Constraint Verification

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'trades' AND constraint_type = 'PRIMARY KEY';

-- Result:
--  constraint_name | constraint_type
-- ─────────────────┼─────────────────
--  trades_pkey     | PRIMARY KEY
```

The PRIMARY KEY constraint on `trade_id` provides a database-engine-level guarantee that no duplicate UUIDs can ever exist in the table, regardless of application logic.

---

## 11. Design Decisions

### 11.1 `ON CONFLICT DO NOTHING` vs `ON CONFLICT DO UPDATE`

**Decision**: `DO NOTHING`, not `DO UPDATE`.

| Approach | Behavior | Risk |
|---|---|---|
| `DO NOTHING` | Silently discard the duplicate. Fallback to SELECT for response. | None — first write always wins. |
| `DO UPDATE SET ... = EXCLUDED.*` | Overwrite the existing record with the new payload. | **Dangerous** — a duplicate with different `entryPrice` would silently mutate the record. Violates System of Record integrity. |

**Why `DO NOTHING`**: A System of Record must preserve the original trade data. If a client retries with a slightly different payload (network corruption, client bug), `DO UPDATE` would silently overwrite financial data. `DO NOTHING` ensures the first valid write is permanent.

The **tamper resistance test** (Suite 3, test 2) specifically validates this decision.

### 11.2 Always-200 vs 200/409 Pattern

**Decision**: Always return HTTP 200, never 409 Conflict.

**Rationale**:
- The spec explicitly mandates: *"Duplicate requests with the SAME tradeId → MUST return HTTP 200"*
- The idempotency contract means the client cannot distinguish between a first request and a duplicate — that's the point
- A 409 response leaks implementation details (the client now knows it was a retry) and forces the client to handle an additional error code
- The route handler intentionally ignores the `isNew` boolean from `createTrade()`

### 11.3 Two Queries vs One Query on Conflict

**Decision**: Use two queries (INSERT with RETURNING, then SELECT on conflict) instead of a single `INSERT ... ON CONFLICT DO UPDATE SET trade_id = EXCLUDED.trade_id RETURNING *`.

**Why not the single-query trick**: The common workaround of `ON CONFLICT DO UPDATE SET trade_id = trade_id RETURNING *` (a no-op update that returns the row) has a subtle problem: it acquires a row lock and increments `xmax`, which can cause issues with MVCC visibility and long-running transactions. With `DO NOTHING`, the INSERT is truly lock-free — concurrent duplicates don't block each other.

**Performance impact**: The fallback SELECT adds ~1ms. At p95 = 2.78ms for the idempotency load test, this overhead is negligible.

### 11.4 UUID Primary Key vs Application-Layer Deduplication

**Decision**: Use the UUID `trade_id` as the PostgreSQL PRIMARY KEY directly.

**Alternatives rejected**:

| Approach | Why Rejected |
|---|---|
| Application-layer deduplication (Redis SET) | Race condition between check and insert. Not atomic. |
| Separate `idempotency_key` column with UNIQUE constraint | Unnecessary — `tradeId` IS the idempotency key |
| SELECT-then-INSERT pattern | TOCTOU vulnerability. The concurrency tests would catch this immediately. |

### 11.5 Per-Test Fresh UUID vs Shared UUID

**Decision**: Generate a unique `tradeId` per test case using `crypto.randomUUID()`.

**Why**: Test isolation. If tests share a `tradeId`, a test that runs after another might pass only because the record was already created by the previous test. Fresh UUIDs guarantee each test is self-contained and order-independent.

### 11.6 k6 Load Test: Fixed tradeId vs Multiple tradeIds

**Decision**: ALL 5,101 k6 requests use the SAME fixed `tradeId`.

**Why**: This is an idempotency test, not a throughput test. The goal is to prove that a single `tradeId` bombarded 5,101 times under sustained concurrent load (up to 200/s) always returns the same response and never creates duplicates.

If we used multiple `tradeId`s, we'd be testing throughput (which is covered by the separate load test report). The idempotency test is specifically about the conflict resolution path.

### 11.7 k6 Three-Phase Design

**Decision**: Warmup → Steady → Burst instead of constant rate.

| Phase | Rate | Purpose |
|---|---|---|
| **Warmup** (10s, 10/s) | Low concurrency | The first request creates the record. Subsequent warmup requests exercise the conflict path at low pressure. This ensures the record exists before the high-concurrency phases begin. |
| **Steady** (30s, 100/s) | Medium concurrency | Sustained duplicate bombardment. 30 seconds is long enough to detect intermittent failures, connection pool exhaustion, or memory leaks. |
| **Burst** (10s, 200/s) | High concurrency | Spike to double the rate. Tests whether the system degrades under sudden duplicate pressure. |

### 11.8 Assertion Depth: `deepStrictEqual` vs Spot Checks

**Decision**: Use `deepStrictEqual` on the full stable body, not just `assert.equal(body.tradeId, expected)`.

**Why**: A spot check on `tradeId` alone would pass even if the response returned a completely different record (e.g., a new row with the same `tradeId` but different `pnl`, `outcome`, or `entryPrice`). `deepStrictEqual` catches subtle mutations in any field — it's the strongest possible assertion that the response hasn't changed.

---

## 12. Results Summary

### 12.1 Node.js Integration & Concurrency Tests

```
TAP version 13
# tests 15
# suites 4
# pass 15
# fail 0
# cancelled 0
# skipped 0
# duration_ms 840.231681
```

| Suite | Tests | Passed | Duration |
|---|---|---|---|
| Sequential duplicate detection | 4 | 4 ✅ | 51ms |
| Concurrent race condition (50–100 parallel) | 5 | 5 ✅ | 503ms |
| DB-level uniqueness (via API) | 2 | 2 ✅ | 59ms |
| Stress escalation (10/25/50/100) | 4 | 4 ✅ | 152ms |
| **Total** | **15** | **15 ✅** | **840ms** |

### 12.2 k6 Sustained Load Test

| Metric | Value | Threshold | Status |
|---|---|---|---|
| Total duplicate requests | 5,101 | — | — |
| HTTP 200 responses | 5,101 (100%) | 100% required | ✅ PASS |
| 409 Conflict responses | 0 | 0 required | ✅ PASS |
| 500+ Error responses | 0 | 0 required | ✅ PASS |
| Body mismatches | 0 | 0 required | ✅ PASS |
| Pass rate | 100.0% | 100% required | ✅ PASS |
| p95 latency | 2.78ms | < 150ms | ✅ PASS |
| Dropped iterations | 0 | 0 required | ✅ PASS |

### 12.3 Database Verification

| Metric | Value | Expected | Status |
|---|---|---|---|
| Total rows in `trades` | 12,651 | — | — |
| Unique `trade_id` values | 12,651 | = total rows | ✅ PASS |
| Duplicate `trade_id` rows | 0 | 0 | ✅ PASS |
| PRIMARY KEY constraint | `trades_pkey` active | Present | ✅ PASS |

---

## 13. Final Verdict

### ✅ Idempotency is PROVEN at every layer.

The `POST /trades` endpoint satisfies all six idempotency requirements:

1. **First write creates**: New `tradeId` → INSERT succeeds → 200 with computed fields. ✅
2. **Duplicate returns 200**: Same `tradeId` → `ON CONFLICT DO NOTHING` → SELECT fallback → 200. ✅
3. **Identical response bodies**: All fields match between first and subsequent responses. ✅
4. **No duplicate rows**: PRIMARY KEY constraint + `ON CONFLICT DO NOTHING` → impossible. ✅
5. **Correct under concurrency**: 100 parallel same-`tradeId` POSTs → all 200, all identical. ✅
6. **Tamper-proof**: Duplicate with different payload → original fields preserved. ✅

The guarantee is **structural**, not behavioral:
- The `PRIMARY KEY` constraint makes duplicates physically impossible at the storage engine level
- `ON CONFLICT DO NOTHING` makes the _detection_ atomic and lock-free
- The SELECT fallback makes the _response_ identical to the original
- No application-layer logic can introduce race conditions because the critical path (duplicate detection) is delegated entirely to PostgreSQL

---

## 14. Appendices

### A. Machine-Readable k6 Results

```json
{
  "tradeId": "00b4ec71-1f68-4367-9bf8-4f4c69d7c492",
  "totalRequests": 5101,
  "successful": 5101,
  "conflicts409": 0,
  "errors500": 0,
  "bodyMismatches": 0,
  "passRate": 1,
  "p95": 2.78,
  "droppedIterations": 0,
  "verdict": "IDEMPOTENCY_PROVEN"
}
```

### B. DB Verification SQL

```sql
-- 1. Single tradeId count (must return 1)
SELECT COUNT(*) FROM trades WHERE trade_id = '<uuid>';

-- 2. Global duplicate scan (must return 0 rows)
SELECT trade_id, COUNT(*) AS dup_count
FROM trades
GROUP BY trade_id
HAVING COUNT(*) > 1;

-- 3. Verify row count = unique count
SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT trade_id) AS unique_ids
FROM trades;
-- total_rows MUST equal unique_ids

-- 4. Verify PRIMARY KEY exists
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'trades' AND constraint_type = 'PRIMARY KEY';
-- Must return trades_pkey
```

### C. Reproduction Commands

```bash
# Run integration + concurrency tests (from project root):
docker run --rm \
  --network paper-trading-behavioral-engine_default \
  -v "$(pwd)/tests:/app/tests" \
  -v "$(pwd)/src:/app/src" \
  -v "$(pwd)/package.json:/app/package.json" \
  -v "$(pwd)/.env.example:/app/.env.example" \
  -w /app \
  -e TEST_BASE_URL=http://api:3000 \
  node:20-alpine sh -c "npm install dotenv && node --test tests/idempotency.test.js"

# Run k6 idempotency load test:
node loadtest/generate_tokens.js > /dev/null
K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_EXPORT=loadtest/reports/idempotency_dashboard.html \
  k6 run loadtest/idempotency.js

# Direct DB verification:
docker compose exec postgres psql -U nevup -d nevup -c \
  "SELECT COUNT(*) AS total, COUNT(DISTINCT trade_id) AS unique_ids FROM trades;"
```

### D. File Index

```
tests/
├── idempotency.test.js          # 15 tests: sequential + concurrent + DB + stress
├── verify-idempotency-db.js     # Direct PostgreSQL duplicate scan script
├── IDEMPOTENCY_TEST_REPORT.md   # This report
└── setup.js                     # Shared test helpers (HTTP client, JWT, constants)

loadtest/
├── idempotency.js               # k6 sustained duplicate bombardment (3 phases)
└── reports/
    ├── idempotency_results.json  # Machine-readable k6 results
    └── idempotency_dashboard.html # Interactive k6 web dashboard
```

### E. What Would FAIL These Tests

For reviewers: here's how each class of broken implementation would be caught:

| Broken Implementation | Which Test Would Fail | How |
|---|---|---|
| SELECT-then-INSERT (TOCTOU race) | Concurrency Suite: 100 parallel → status check | Some requests get 500 (duplicate key violation) |
| INSERT without ON CONFLICT | Concurrency Suite: 100 parallel → status check | PostgreSQL throws `23505 unique_violation` → 500 |
| ON CONFLICT DO UPDATE | DB Uniqueness: tamper resistance | Second POST with different payload overwrites original |
| Return 409 on conflict | Sequential Suite: second POST status check | `assert.notEqual(res.status, 409)` fails |
| Create new record with new UUID | Sequential Suite: body comparison | `deepStrictEqual` fails — different `tradeId` in response |
| Deduplication via Redis (non-atomic) | Concurrency Suite: 100 parallel → body comparison | Redis check + DB insert has TOCTOU gap → occasional duplicates |
