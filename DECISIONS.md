# Engineering Decisions

> **Project**: NevUp Track 1 — System of Record Backend  
> **Stack**: Node.js 20 · Express.js · PostgreSQL 16 · Redis 7 (Streams)  
> **Author**: Harsh Upadhyay  
> **Date**: April 2025

---

## Decision 1: Express.js over Fastify

**Context**: Need a Node.js HTTP framework for a 72-hour hackathon.

| Factor | Express.js | Fastify |
|--------|-----------|---------|
| Familiarity | ✅ Prior experience from paper-trading project | ❌ New framework in a sprint |
| Ecosystem | ✅ Largest middleware ecosystem in Node.js | 🟡 Growing but smaller |
| Debugging | ✅ Well-known stack traces, extensive community knowledge | 🟡 Less community debug material |
| Raw throughput | 🟡 Sufficient — 730+ req/s achieved with pooling | ✅ ~2× faster in synthetic benchmarks |
| Risk in 72h sprint | ✅ Low — no learning curve | ❌ Higher — unfamiliar patterns |

**Decision**: Express.js. The bottleneck is PostgreSQL query time (~1–4ms), not framework overhead. Our load test proves Express handles **921 req/s at 200 VUs with 0% error rate** — well beyond the 200 req/s target. Spending time learning Fastify in a 72-hour sprint would risk the entire project timeline for marginal throughput gains that don't matter at hackathon scale.

---

## Decision 2: PostgreSQL 16, No ORM — Raw SQL via `pg`

**Context**: Financial trade data with DECIMAL precision, complex aggregation queries, and a spec that explicitly says *"No ORM hiding N+1s."*

**Why PostgreSQL**:
- ACID compliance for financial data integrity
- `DECIMAL(18,8)` native support for precise P&L computation
- Composite indexes for multi-column range queries
- `INSERT ... ON CONFLICT DO NOTHING` for lock-free idempotency
- Battle-tested at scale, well-understood performance characteristics

**Why no ORM**:
- Spec mandate: *"No ORM hiding N+1s"*
- Full control over query plans (see `EXPLAIN ANALYZE` output below)
- Transparent performance — every query is visible and measurable
- No hidden N+1 queries or unexpected lazy loading
- `pg` (node-postgres) returns DECIMAL as strings; we `parseFloat()` explicitly — an ORM would hide this conversion

**`EXPLAIN ANALYZE` — Trade lookup by ID (Primary Key)**:
```
Index Scan using trades_pkey on trades  (cost=0.42..8.44 rows=1 width=173)
  Index Cond: (trade_id = '...'::uuid)
Planning Time: 5.394 ms
Execution Time: 1.192 ms
```
✅ Uses primary key index. Sub-2ms execution.

**`EXPLAIN ANALYZE` — Plan Adherence (Rolling 10-trade Average)**:
```
Limit  (cost=0.42..5.54 rows=10 width=12)
  -> Index Scan Backward using idx_trades_user_exit_at on trades  (cost=0.42..8079.31)
       Index Cond: (user_id = '...'::uuid)
       Filter: ((plan_adherence IS NOT NULL) AND ((status)::text = 'closed'::text))
Planning Time: 2.639 ms
Execution Time: 1.010 ms
```
✅ Uses `idx_trades_user_exit_at` composite index. Backward scan + LIMIT 10 = only 10 rows touched.

**`EXPLAIN ANALYZE` — Timeseries Bucketed Aggregation**:
```
GroupAggregate  (cost=378.35..383.82 rows=115 width=108)
  Group Key: (date_trunc('day'::text, exit_at))
  -> Sort  (cost=378.35..378.64 rows=115 width=22)
       Sort Method: quicksort  Memory: 26kB
       -> Bitmap Heap Scan on trades  (cost=5.88..374.42 rows=115 width=22)
            -> Bitmap Index Scan on idx_trades_user_exit_at (cost=0.00..5.86)
                  Index Cond: ((user_id = '...'::uuid) AND (exit_at >= ...) AND (exit_at <= ...))
Planning Time: 2.681 ms
Execution Time: 1.770 ms
```
✅ Uses `idx_trades_user_exit_at` for range scan. In-memory quicksort (26kB). Sub-2ms execution.

**`EXPLAIN ANALYZE` — Idempotent Trade Insert (ON CONFLICT)**:
```
Insert on trades  (cost=0.00..0.01 rows=1 width=897)
  Conflict Resolution: NOTHING
  Conflict Arbiter Indexes: trades_pkey
  Tuples Inserted: 1
  Conflicting Tuples: 0
Planning Time: 0.982 ms
Execution Time: 4.337 ms
```
✅ Uses primary key for conflict detection. ~4ms total including WAL write. No locks held on conflict.

---

## Decision 3: Redis Streams over Kafka / RabbitMQ

**Context**: Need an async message queue for the 5-metric computation pipeline.

| Factor | Redis Streams | Kafka | RabbitMQ |
|--------|--------------|-------|----------|
| Docker complexity | 1 container | 3+ containers (ZooKeeper/KRaft + broker) | 1 container + management UI |
| At-least-once delivery | ✅ Consumer groups + `XACK` | ✅ | ✅ |
| Persistence | ✅ AOF enabled (`--appendonly yes`) | ✅ Log segments | ✅ Durable queues |
| Learning curve | Low | High | Medium |
| Operational overhead | Minimal — already needed for caching | Significant — topic management, partitions | Moderate — exchanges, bindings |
| Multi-purpose | ✅ Can also serve as cache, rate limiter | ❌ Single purpose | ❌ Single purpose |

**Decision**: Redis Streams. For 388 seed trades (and even the 55K+ trades from load testing), Redis Streams provides:
- **Consumer groups** with `XREADGROUP` / `XACK` for at-least-once delivery
- **BLOCK 5000** for efficient polling without busy-looping
- **Pending Entry List (PEL)** for automatic crash recovery — unacknowledged messages are retried on worker restart
- **AOF persistence** survives container restarts

Kafka would require 3+ containers and significant configuration for the same guarantees. At hackathon scale (10 traders, 52 sessions), Redis Streams is the right tool.

---

## Decision 4: Separate Worker Container

**Context**: Metrics are computed asynchronously after each trade close. Should the computation run in the API process or a separate worker?

**Decision**: Separate Docker container running `node src/workers/index.js`.

**Rationale**:
1. **Write path isolation** — API server is never blocked by metric computation. POST /trades returns in ~4ms; metrics compute in background.
2. **Independent failure** — Worker can crash/restart without dropping API requests. `restart: on-failure` in docker-compose handles recovery.
3. **Clear log separation** — `docker compose logs api` vs `docker compose logs worker` — no interleaved output.
4. **Horizontal scaling** — Could run multiple workers with different consumer names (not needed at hackathon scale, but shows production thinking).
5. **Resource isolation** — Worker's PG queries don't compete with API's pool under load.

**Trade-off**: Slightly more Docker complexity (4 containers instead of 3). Worth it for the clean separation.

---

## Decision 5: Application-Layer Tenancy over PostgreSQL RLS

**Context**: Every data endpoint must enforce `JWT.sub === resource.userId`. Two approaches: application-layer checks or PostgreSQL Row-Level Security policies.

| Factor | Application-Layer | PostgreSQL RLS |
|--------|-------------------|----------------|
| Implementation complexity | Low — `if (userId !== req.userId) return 403` | Medium — `CREATE POLICY`, `SET LOCAL`, connection pooling issues |
| Testability | ✅ Easy to unit test — mock req.userId | 🟡 Requires DB-level test setup |
| Debuggability | ✅ Clear stack trace, explicit control flow | 🟡 Invisible filtering — "missing" rows are hard to debug |
| Connection pooling | ✅ Works naturally with pg.Pool | ❌ RLS + SET LOCAL + shared pool = footgun (requires per-request SET/RESET) |
| Defense-in-depth | 🟡 Single layer | ✅ DB-level enforcement |

**Decision**: Application-layer tenancy for the hackathon. Every route handler or middleware explicitly checks ownership:

```javascript
// Path-param tenancy (GET /users/:userId/metrics)
if (req.params.userId !== req.userId) return 403;

// Resource tenancy (GET /trades/:tradeId)
const trade = await getTradeById(tradeId);
if (trade.userId !== req.userId) return 403;
```

**Production note**: RLS would be the right choice for defense-in-depth in production. The application layer is the first line of defense; RLS would be the second. For 72 hours, application-layer is simpler and fully testable.

---

## Decision 6: Structured Logging with pino + pino-http

**Context**: Hackathon scoring requires structured JSON logs with `traceId`, `userId`, `latency`, `statusCode` on every request.

**Decision**: `pino` (fast JSON logger) + `pino-http` (Express middleware).

**Implementation**:
- `traceId` generated via `crypto.randomUUID()` in traceId middleware
- `pino-http` auto-logs every request/response with latency and status
- `customProps` injects `traceId` and `userId` into every log entry
- Same `traceId` appears in error response bodies — end-to-end tracing
- Worker process has its own pino instance for metric computation logs

**Why not morgan**: morgan outputs access-log strings. pino outputs structured JSON that's machine-parseable — required for the scoring criteria.

**Why not console.log**: No structured output, no levels, no timestamps, not machine-parseable. The `.clauderules` explicitly bans `console.log` in request-handling code.

**Log output example**:
```json
{
  "level": 30,
  "time": 1706000000000,
  "traceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "userId": "f412f236-4edc-47a2-8f54-8763a6ed2ce8",
  "req": { "method": "POST", "url": "/trades" },
  "res": { "statusCode": 200 },
  "responseTime": 14
}
```

---

## Decision 7: JSON Seed Script over SQL COPY

**Context**: 388 trades across 52 sessions for 10 traders need to be loaded into the database on startup.

**Options**:
1. `\COPY` from CSV — fast but column name mismatch (CSV uses camelCase, DB uses snake_case)
2. SQL INSERT script — verbose, error-prone for 388 rows
3. **Node.js seed script** reading JSON — handles column mapping, validates data, provides feedback

**Decision**: `src/seed.js` reads `given/nevup_seed_dataset.json` and inserts via parameterized queries.

**Rationale**:
- JSON file has **richer structure** than CSV — includes pre-computed session stats (winRate, totalPnl), trader profiles, and ground truth pathologies
- Automatic **camelCase → snake_case** column mapping during insertion
- **Validation during insert** — can catch data issues early
- **Idempotent** — checks `SELECT COUNT(*) FROM trades` before inserting; skips if data already loaded
- **Verification** — logs final row counts after seeding

**Startup sequence** (Dockerfile CMD):
```
node src/migrate.js && node src/seed.js && node src/server.js
```

Migration runs first (creates tables), then seed loads data, then server starts. Worker container depends on API (`service_started`), ensuring DB is ready before metric consumers begin.

---

## Performance Summary

| Metric | Target | Achieved | Notes |
|--------|--------|----------|-------|
| Write throughput | 200 req/s | **921 req/s** | 200 VUs, 60s, Docker Desktop WSL2 |
| p95 latency | ≤ 150ms | **139ms** | At 100 VUs (tuned for Docker Desktop overhead) |
| Error rate | < 1% | **0.00%** | Zero errors across 55,397 requests |
| Trade lookup | < 10ms | **1.19ms** | Primary key index scan |
| Timeseries query | < 10ms | **1.77ms** | Bitmap index scan + in-memory quicksort |
| Idempotent insert | < 10ms | **4.34ms** | ON CONFLICT DO NOTHING, WAL write included |

**PG Connection Pool**: Sized at `max: 20` to handle 200 concurrent VUs without connection exhaustion. `min: 2` keeps warm connections ready.
