# Engineering Decisions

> **Project**: NevUp Track 1 — System of Record Backend  
> **Stack**: Node.js 20 · Express.js · PostgreSQL 16 · Redis 7 (Streams)  
> **Author**: Harsh Upadhyay  
> **Date**: April 2026

---

## 1. Idempotency Strategy

### Decision: `INSERT ... ON CONFLICT (trade_id) DO NOTHING` + SELECT fallback

### Why

The spec requires: *"Duplicate submissions must return HTTP 200 with the existing record — not 500 or 409."* This eliminates `INSERT ... ON CONFLICT DO UPDATE` (which mutates data) and application-layer `SELECT-then-INSERT` (which has a TOCTOU race window under concurrency).

### How It Works

```sql
INSERT INTO trades (...) VALUES (...) ON CONFLICT (trade_id) DO NOTHING RETURNING *;
-- If row returned → new insert (isNew = true)
-- If no row returned → conflict; SELECT WHERE trade_id = $1 (isNew = false)
```

**Lock-free**: `DO NOTHING` acquires no row-level lock on conflict. Under 200 req/s with duplicate `tradeId`s, there is zero contention — the insert either succeeds or silently skips.

### Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| `ON CONFLICT DO UPDATE` | Mutates existing data; violates idempotency semantics |
| `SELECT` then `INSERT` | TOCTOU race under concurrency (two threads both see "not found", both insert) |
| Unique exception catch | Requires catching database errors; non-portable, fragile |
| Application-level distributed lock | Adds Redis dependency to the critical write path; overkill for single-PG |

### Security Hardening

During testing, a cross-tenant data leak was discovered on the conflict path: if User B submits a trade with User A's `tradeId`, the `SELECT` fallback returns User A's trade. Fixed by adding a tenancy check on `isNew === false`:

```javascript
if (!isNew && trade.userId !== req.userId) {
  return res.status(403).json(errors.forbidden('Cross-tenant access denied.', req.traceId));
}
```

**Proof**: [`tests/IDEMPOTENCY_TEST_REPORT.md`](tests/IDEMPOTENCY_TEST_REPORT.md) — 15 tests including concurrent duplicate writes and DB-level uniqueness verification.

---

## 2. Throughput Design

### Decision: Target 200 req/s with connection pooling and async publish

### Why 200 req/s

The spec defines the hard throughput floor. But rather than tuning for exactly 200, the design ensures headroom — measured p95 write latency is **4.19ms** (35× below the 150ms threshold), leaving room for production variability.

### Connection Pooling

```javascript
const pool = new Pool({ min: 2, max: 20, idleTimeoutMillis: 30000 });
```

- **`max: 20`**: Sized for 150+ concurrent VUs. Each VU holds a connection for ~4ms (insert) then releases. With `max: 20`, the pool handles `20 connections / 4ms = 5,000` theoretical req/s before exhaustion.
- **`min: 2`**: Keeps warm connections ready, avoiding cold-start latency on the first request after idle.
- **No `max: 100` over-provisioning**: PostgreSQL has finite backend process memory. Over-provisioning pools is a common footgun.

### Async Publish (Non-blocking)

The API write path does two operations:

1. `INSERT INTO trades` — synchronous, critical path (~4ms)
2. `XADD` to Redis Stream — **fire-and-forget**, does not block the HTTP response

If Redis is down, the trade is persisted (Postgres is the source of truth). The worker will process it when Redis recovers. This decoupling is why write p95 is 4.19ms, not 50ms+.

### DB Constraints

`EXPLAIN ANALYZE` for the idempotent insert:

```
Insert on trades  (cost=0.00..0.01 rows=1 width=897)
  Conflict Resolution: NOTHING
  Conflict Arbiter Indexes: trades_pkey
  Planning Time: 0.982 ms
  Execution Time: 4.337 ms
```

The primary key index handles conflict detection — no additional unique constraint needed.

**Proof**: [`loadtest/LOAD_TEST_REPORT.md`](loadtest/LOAD_TEST_REPORT.md) — 200 req/s sustained for 60s, 0% errors, 150–152 concurrent VUs.

---

## 3. Async Pipeline Choice

### Decision: Redis Streams over Kafka / RabbitMQ

### Why Redis Streams

| Factor | Redis Streams | Kafka | RabbitMQ |
|---|---|---|---|
| Docker complexity | 1 container | 3+ (ZooKeeper/KRaft + broker) | 1 + mgmt UI |
| At-least-once delivery | ✅ `XREADGROUP` + `XACK` | ✅ | ✅ |
| Persistence | ✅ AOF (`--appendonly yes`) | ✅ | ✅ |
| Crash recovery | ✅ PEL auto-retry | ✅ | ✅ |
| Operational overhead | Minimal | Significant | Moderate |
| Already needed | ✅ (caching/pub-sub) | ❌ | ❌ |

At hackathon scale (10 traders, 388 trades), Kafka's partition management and topic configuration are pure overhead. Redis Streams provides identical delivery guarantees with a single additional command (`XADD`).

### Why Not Synchronous

If metrics were computed inside `POST /trades`, every write would pay the cost of 5 metric queries (~10ms each). That's 50ms added to every write — pushing p95 from 4ms to 54ms. Still under the 150ms threshold, but wasteful.

More importantly, synchronous computation **couples** the write path to the analytics path. A bug in the overtrading detector would crash trade ingestion. Async decoupling means the write path has zero dependencies on metric logic.

### Consumer Design

```javascript
// Worker: XREADGROUP with BLOCK 5000
const messages = await redis.xreadgroup('GROUP', group, consumer,
  'BLOCK', 5000, 'COUNT', 10, 'STREAMS', stream, '>');
```

- **`BLOCK 5000`**: Efficient polling — no busy-loop, no CPU waste
- **`COUNT 10`**: Batch reads for efficiency
- **`XACK` after success**: At-least-once delivery — unacked messages retry on restart
- **`restart: on-failure`**: Docker auto-restarts crashed workers

**Proof**: [`tests/ASYNC_PIPELINE_REPORT.md`](tests/ASYNC_PIPELINE_REPORT.md) — 32 tests covering delivery guarantees, worker crash recovery, and metric computation correctness.

---

## 4. Read Model Design

### Decision: Query directly from PostgreSQL with composite indexes

### Why Not a Materialized View / Separate Read Store

At 388 trades across 10 users, the data volume is small enough that real-time aggregation is sub-10ms. A materialized view would add staleness. A separate read store (e.g., Elasticsearch) would add operational complexity without measurable benefit.

### Indexing Strategy

```sql
-- Composite index for user-scoped time-range queries
CREATE INDEX idx_trades_user_exit_at ON trades (user_id, exit_at);

-- Primary key for O(1) trade lookup
-- trades_pkey ON trades (trade_id)  -- automatic from PRIMARY KEY
```

The composite index `(user_id, exit_at)` serves three query patterns:

1. **Timeseries bucketing**: `WHERE user_id = $1 AND exit_at BETWEEN $2 AND $3`
2. **Rolling averages**: `WHERE user_id = $1 ORDER BY exit_at DESC LIMIT 10`
3. **Session queries**: `WHERE session_id = $1` (falls back to seq scan on 388 rows — acceptable)

### EXPLAIN ANALYZE

**Timeseries bucketed aggregation** (the heaviest query):
```
GroupAggregate  (cost=378.35..383.82)
  → Sort  (cost=378.35..378.64)  Sort Method: quicksort  Memory: 26kB
    → Bitmap Heap Scan on trades  (cost=5.88..374.42)
      → Bitmap Index Scan on idx_trades_user_exit_at
Planning Time: 2.681 ms
Execution Time: 1.770 ms
```

26kB in-memory quicksort. Sub-2ms execution. No disk spill.

**Trade lookup** (primary key):
```
Index Scan using trades_pkey  (cost=0.42..8.44 rows=1)
Planning Time: 5.394 ms
Execution Time: 1.192 ms
```

Sub-2ms. Zero wasted I/O.

### Performance Guarantee

The read path serves 100 req/s at p95 = **8.48ms** — 23× below the 200ms threshold. Even the 6-query aggregation endpoint (`GET /users/:userId/metrics`) completes in <10ms because every query hits an index.

---

## 5. Multi-Tenancy Enforcement

### Decision: Application-layer tenancy at three levels, returning 403 (not 404) for cross-tenant access

### Why Enforced at Every Endpoint

A single unprotected endpoint is a data breach. Tenancy is not a "middleware you add to some routes" — it's a system invariant. The implementation enforces it at three distinct layers:

| Layer | Mechanism | Where |
|---|---|---|
| **Path-level** | `req.params.userId !== req.userId → 403` | `GET /users/:userId/*` |
| **Body-level** | `req.body.userId !== req.userId → 403` | `POST /trades` |
| **Resource-level** | `trade.userId !== req.userId → 403` | `GET /trades/:id`, sessions |

### Why 403, Not 404

Returning 404 for "exists but not yours" leaks existence information — an attacker learns that a `tradeId` is valid. The spec explicitly mandates: *"Cross-tenant reads always return 403 — never 404."*

The 403 response contains only `{ error, message, traceId }` — **zero resource fields**. This is validated by `assertNoDataLeakage()` in the test suite, which JSON-serializes the entire response body and scans for victim identifiers.

### Why Not PostgreSQL RLS

| Factor | Application-Layer | PostgreSQL RLS |
|---|---|---|
| Connection pooling | ✅ Works with `pg.Pool` | ❌ Requires `SET LOCAL` per connection |
| Debuggability | ✅ Explicit if/return 403 | 🟡 Invisible row filtering |
| Testability | ✅ Mock `req.userId` | 🟡 Requires DB-level test setup |
| Defense-in-depth | Single layer | ✅ DB-level enforcement |

For production, RLS would be added as a second layer. For the hackathon, application-layer tenancy is simpler, fully testable, and proven correct by 43 automated security tests.

**Proof**: [`tests/MULTI_TENANCY_REPORT.md`](tests/MULTI_TENANCY_REPORT.md) — 43 tests across 8 attack dimensions including JWT tampering, UUID guessing, and concurrent cross-tenant isolation.

---

## 6. Observability Design

### Decision: pino + pino-http for structured JSON logs with traceId propagation

### Why Structured JSON

Plain-text logs (`morgan`, `console.log`) are human-readable but machine-hostile. Structured JSON logs are required for:

1. **Log aggregation** (ELK, Datadog, CloudWatch Logs Insights) — direct JSON ingestion
2. **Alerting rules** — query `statusCode >= 500` or `responseTime > 1000`
3. **Distributed tracing** — filter by `traceId` across API + worker containers

### Why traceId Propagation

Every request generates a `crypto.randomUUID()` in the traceId middleware. This UUID appears in:

1. **Structured log** — via pino-http `customProps`
2. **Error response body** — `{ error, message, traceId }`
3. **Downstream services** — available on `req.traceId` for forwarding

An operator receiving a user's error response can search logs by `traceId` and find the full context: userId, latency, status code, URL, and (for 500s) the stack trace.

### Required Fields on Every Log

| Field | Source | Purpose |
|---|---|---|
| `traceId` | `crypto.randomUUID()` | Request correlation |
| `userId` | JWT `sub` or `"anonymous"` | Audit trail, per-user debugging |
| `responseTime` | pino-http timer | Latency monitoring, SLA enforcement |
| `res.statusCode` | Express response | Error rate computation, alerting |

### Why Not Morgan

Morgan outputs access-log strings: `POST /trades 200 14ms`. This is not JSON-parseable, has no `traceId`, no `userId`, and cannot be queried in log aggregation systems. The spec requires machine-parseable structured logs.

**Proof**: [`tests/OBSERVABILITY_REPORT.md`](tests/OBSERVABILITY_REPORT.md) — 37 tests verifying JSON structure, trace correlation, latency accuracy, and concurrent log integrity.

---

## 7. Docker-First Deployment

### Decision: Single `docker compose up --build` with zero manual steps

### Why Single Command

Every manual step is a reviewer friction point. The spec says *"Graders will run `docker compose up`."* The implementation ensures:

1. **`Dockerfile CMD`**: `node src/migrate.js && node src/seed.js && node src/server.js`
2. **Migrations**: Idempotent SQL (`CREATE TABLE IF NOT EXISTS`) — safe to re-run
3. **Seeding**: Checks `SELECT COUNT(*) FROM trades` — skips if data exists
4. **Worker**: Separate container, `depends_on: api (service_started)`, auto-connects to same PG/Redis
5. **Healthchecks**: Postgres and Redis have `healthcheck` directives — API waits for healthy deps

No `.env` file, no `npm install`, no `node migrate.js` manual step. Clone and run.

### Container Architecture

| Container | Role | Restart Policy |
|---|---|---|
| `api` | Express.js + pino-http | Default (no restart) |
| `worker` | Redis Stream consumer + metric UPSERTs | `on-failure` |
| `postgres` | PostgreSQL 16 + data volume | Default |
| `redis` | Redis 7 + AOF persistence | Default |

---

## 8. Framework Choice

### Decision: Express.js over Fastify

### Why

| Factor | Express.js | Fastify |
|---|---|---|
| Familiarity | ✅ Prior experience | ❌ New framework in a sprint |
| Ecosystem | ✅ Largest in Node.js | 🟡 Growing |
| Raw throughput | 🟡 Sufficient | ✅ ~2× faster synthetically |
| Risk in 72h sprint | ✅ Low | ❌ Higher |

The bottleneck is PostgreSQL query time (~4ms), not framework overhead. Express handles **200+ req/s at p95 = 4.19ms** — well beyond the target. Spending time learning Fastify would risk the timeline for gains that are invisible at the database-bound scale.

---

## 9. Raw SQL via `pg` — No ORM

### Decision: Direct SQL queries via `node-postgres`

### Why

The spec mandates: *"No ORM hiding N+1s."* Beyond compliance:

- **Full query plan control**: Every query has an `EXPLAIN ANALYZE` in this document
- **Transparent DECIMAL handling**: `pg` returns `DECIMAL(18,8)` as strings; we `parseFloat()` explicitly. An ORM would hide this precision-critical conversion
- **No hidden queries**: Every database interaction is a single, visible SQL statement
- **Hackathon simplicity**: No migration DSL, no model definitions, no ORM configuration

---

## 10. Trade-offs & Limitations

### Intentionally Simplified

| Simplification | Why | Production Fix |
|---|---|---|
| Application-layer tenancy only | Simpler, fully testable in 72h | Add PostgreSQL RLS as defense-in-depth |
| Single worker instance | Sufficient for 10 traders | Multiple workers with unique consumer names |
| No rate limiting | Out of scope for hackathon | Redis-based sliding window limiter |
| No HTTPS | Docker-internal traffic | TLS termination at load balancer |
| Hardcoded JWT secret | From spec, not a real secret | Environment-injected secret rotation |
| No graceful shutdown | Not tested under signal handling | `SIGTERM` handler with connection draining |

### Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| SSE coaching is stub text, not AI-generated | Coaching responses are deterministic | Would integrate with Track 2's AI engine in production |
| No pagination on session trades | Fine for ≤80 trades per user | Add `LIMIT/OFFSET` or cursor-based pagination |
| Seed data check uses `COUNT(*)` | Slow on very large tables | Use `EXISTS` subquery or flag table |
| Worker processes all metrics serially | Fine for 388 trades | Batch parallel processing with `Promise.all()` |

### What Would Change in Production

1. **PostgreSQL RLS**: Second tenancy layer at the database level
2. **Connection pooler**: PgBouncer in front of PostgreSQL for 1000+ VU scale
3. **Horizontal workers**: Multiple consumer instances with partition-like consumer names
4. **Distributed tracing**: OpenTelemetry spans propagated to Jaeger/Tempo
5. **CI/CD pipeline**: Run all 161 tests + load test on every PR
6. **Secrets management**: Vault or AWS Secrets Manager for JWT secret rotation

---

## Performance Evidence

`EXPLAIN ANALYZE` output for critical queries:

| Query | Index Used | Execution Time |
|---|---|---|
| Trade lookup (PK) | `trades_pkey` | 1.19ms |
| Rolling 10-trade average | `idx_trades_user_exit_at` (backward scan) | 1.01ms |
| Timeseries aggregation | `idx_trades_user_exit_at` (bitmap) | 1.77ms |
| Idempotent insert | `trades_pkey` (conflict arbiter) | 4.34ms |

All queries sub-5ms. All use index scans. Zero sequential table scans on the critical path.
