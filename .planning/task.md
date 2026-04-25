# NevUp Track 1 — Task Checklist

> **Status key**: `[ ]` todo · `[/]` in progress · `[x]` done  
> **Companion docs**: [implementation_plan.md](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/implementation_plan.md) · [context.md](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/context.md) · [rules.md](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/rules.md)

---

## Phase 1: Foundation (Hours 0–4)

- [x] Create `package.json` with all dependencies
  - [x] express, pg, ioredis, pino, pino-http, dotenv (no uuid — using crypto.randomUUID)
  - [x] Dev deps: supertest (using built-in node:test runner)
- [x] Create `.env.example` with all env vars documented
- [x] Create `src/config.js` — centralized env var access
- [x] Create `Dockerfile` (Node 20 Alpine, npm ci, migration+seed+server CMD)
- [x] Create `docker-compose.yml` (api, worker, postgres, redis)
  - [x] PostgreSQL healthcheck: `pg_isready -U nevup`
  - [x] Redis healthcheck: `redis-cli ping`
  - [x] Worker depends_on api
  - [x] API depends_on postgres (healthy) + redis (healthy)
- [x] Create migration `001_create_trades.sql`
  - [x] All columns including outcome, pnl, revenge_flag
  - [x] All 5 indexes
  - [x] CHECK constraints for enums
- [x] Create migration `002_create_sessions.sql`
  - [x] sessions table with user_id index
- [x] Create migration `003_create_debriefs.sql`
  - [x] debriefs table with session_id FK
- [x] Create migration `004_create_metrics.sql`
  - [x] plan_adherence_scores
  - [x] revenge_trade_flags with user_id index
  - [x] session_tilt_index
  - [x] win_rate_by_emotion (composite PK)
  - [x] overtrading_events with user_id index
- [x] Create `src/migrate.js` — run SQL files in order
- [x] Create `src/seed.js` — load JSON file, insert sessions + trades
  - [x] Read `given/nevup_seed_dataset.json`
  - [x] Insert all 52 sessions
  - [x] Insert all 388 trades with column mapping
  - [x] Verify row counts after seeding
- [x] Verify: `docker compose up` starts all 4 containers cleanly ✅
- [x] Verify: Seed data loaded (388 trades, 52 sessions) ✅

---

## Phase 2: Auth + Core Middleware (Hours 4–8)

- [x] Create `src/utils/jwt.js` — sign() and verify() with HS256
  - [x] base64url encoding
  - [x] HMAC-SHA256 signature
  - [x] Payload parsing and validation
- [x] Create `src/utils/errors.js` — error response factory
  - [x] Standardized `{ error, message, traceId }` format
  - [x] Helper functions: `unauthorized()`, `forbidden()`, `notFound()`, `badRequest()`
- [x] Create `src/middleware/traceId.js` — UUID per request
  - [x] `req.traceId = crypto.randomUUID()`
- [x] Create `src/middleware/auth.js` — JWT verification
  - [x] Extract token from `Authorization: Bearer <token>`
  - [x] Verify signature
  - [x] Check expiry (`exp < now` → 401)
  - [x] Extract `sub` → `req.userId`
  - [x] Handle missing header → 401
  - [x] Handle malformed token → 401
- [x] Create `src/middleware/tenancy.js` — path + resource tenancy helpers
- [x] Create `src/middleware/errorHandler.js` — global catch-all
  - [x] Always include traceId in error response
  - [x] Log errors with pino
- [x] Create `src/server.js` — Express app bootstrap
  - [x] Middleware chain: traceId → pino-http → json → auth → routes → errorHandler
  - [x] Skip auth for `/health` route
  - [x] Mount health route (other routes commented until Phase 3/5)
  - [x] Listen on PORT (default 3000)
- [x] Create `scripts/generate-token.js` — CLI token generator
  - [x] Accept userId as argument
  - [x] Generate 24-hour JWT
  - [x] Print token to stdout
- [x] Create `src/routes/health.js` — live PG + Redis health check
- [x] Verify: Health no auth → 200 ✅
- [x] Verify: Request without token → 401 ✅
- [x] Verify: Request with expired token → 401 ✅
- [x] Verify: Garbage token → 401 ✅
- [x] Verify: Valid token → auth passes ✅
- [x] Verify: Error bodies have `{ error, message, traceId }` shape ✅

---

## Phase 3: Write API (Hours 8–14)

- [x] Create `src/plugins/database.js` — pg.Pool singleton
  - [x] Pool size: 20 (for load testing headroom)
  - [x] Connection from DATABASE_URL env var
- [x] Create `src/plugins/redis.js` — ioredis client singleton
  - [x] Connection from REDIS_URL env var
- [x] Create `src/services/publisher.js` — XADD to trade:closed stream
  - [x] Create stream and consumer group on first use (MKSTREAM + BUSYGROUP handling)
- [x] Create `src/services/tradeService.js`
  - [x] `createTrade()` — INSERT ON CONFLICT DO NOTHING + fallback SELECT
  - [x] `getTradeById()` — SELECT by trade_id
  - [x] P&L computation: `(exitPrice - entryPrice) * quantity * (direction === 'long' ? 1 : -1)`
  - [x] Outcome computation: `pnl > 0 ? 'win' : 'loss'`
  - [x] camelCase ↔ snake_case column mapping with parseFloat for DECIMALs
- [x] Create `src/routes/trades.js`
  - [x] `POST /trades` — idempotent create
    - [x] Validate request body (10 required fields, enum values, maxLength:500)
    - [x] Tenancy check: `req.body.userId === req.userId`
    - [x] Insert trade
    - [x] Publish to Redis if closed
    - [x] Return 200 with Trade response
  - [x] `GET /trades/:tradeId` — single trade lookup
    - [x] Tenancy check on retrieved trade
    - [x] 403 for cross-tenant (never 404)
    - [x] 404 for truly not found
- [x] Verify: POST a trade → 200 with computed outcome: "win" + pnl: 38.5 ✅
- [x] Verify: POST same tradeId again → 200 with same body (idempotent) ✅
- [x] Verify: POST with wrong userId in JWT → 403 ✅
- [x] Verify: GET /trades/:id → 200 with trade ✅
- [x] Verify: GET /trades/:id with different user's JWT → 403 ✅
- [x] Verify: Redis Stream has 1 message with all trade fields ✅

---

## Phase 4: Async Pipeline (Hours 14–22)

- [x] Create `src/workers/index.js` — worker entry point
  - [x] Create consumer group `metric-workers` on `trade:closed` stream
  - [x] XREADGROUP loop with BLOCK 5000
  - [x] Process messages through all 5 metric handlers
  - [x] XACK after successful processing
  - [x] Error handling: log + skip (don't XACK → retry from PEL)
  - [x] Pending message recovery on startup (crash resilience)
  - [x] Graceful shutdown on SIGTERM/SIGINT
- [x] Create `src/workers/planAdherence.js`
  - [x] Query last 10 closed trades by exit_at
  - [x] AVG(plan_adherence) → score 2.40
  - [x] UPSERT into plan_adherence_scores
- [x] Create `src/workers/revengeFlag.js`
  - [x] Check if triggering trade is a loss
  - [x] Find trades within 90s of exit_at with anxious/fearful emotional state
  - [x] UPDATE trades SET revenge_flag = true (in transaction)
  - [x] INSERT into revenge_trade_flags
- [x] Create `src/workers/sessionTilt.js`
  - [x] Get all closed trades in session by exit_at
  - [x] Walk sequentially, count loss-following trades
  - [x] Calculate tilt_index
  - [x] UPSERT into session_tilt_index
- [x] Create `src/workers/winRateByEmotion.js`
  - [x] Single atomic UPSERT — increment + recalculate in SQL
  - [x] UPSERT wins/losses/win_rate for the emotional_state
- [x] Create `src/workers/overtradingDetector.js`
  - [x] COUNT trades in 30-minute window before entry_at
  - [x] If > 10 → INSERT into overtrading_events (deduplicated)
- [x] Verify: POST closed trade → worker picks up within seconds ✅
- [x] Verify: Worker processes all 5 metric handlers ✅
- [x] Verify: Metrics appear in DB tables (plan_adherence, win_rate, tilt) ✅

---

## Phase 5: Read API (Hours 22–30)

- [x] Create `src/services/sessionService.js`
  - [x] `getSessionById()` — session + all trades + computed winRate/totalPnl
  - [x] Compute winRate, totalPnl from closed trades
  - [x] `saveDebrief()` — INSERT debrief, return { debriefId, sessionId, savedAt }
- [x] Create `src/services/metricsService.js`
  - [x] `getUserMetrics()` — aggregates all 5 metric tables
  - [x] Timeseries bucketing: hourly, daily, rolling30d via date_trunc
  - [x] Timeseries SQL: `SELECT date_trunc($granularity, exit_at) as bucket, COUNT(*), ...`
  - [x] Win rate by emotion: full table for user
  - [x] Revenge trades: COUNT from revenge_trade_flags in range
  - [x] Overtrading events: COUNT from overtrading_events in range
  - [x] `getUserProfile()` — pathology analysis with evidence
- [x] Create `src/routes/sessions.js`
  - [x] `GET /sessions/:sessionId` — session summary with trades ✅
    - [x] Tenancy check on session
    - [x] Return SessionSummary with trades array
  - [x] `POST /sessions/:sessionId/debrief` — save debrief ✅
    - [x] Validate request body (maxLength 1000 for keyMistake/keyLesson)
    - [x] Tenancy check on session
    - [x] Return 201 with debriefId + sessionId + savedAt
  - [x] `GET /sessions/:sessionId/coaching` — SSE streaming ✅
    - [x] Set SSE headers (text/event-stream)
    - [x] Stream contextual coaching message token by token
    - [x] Send `done` event with full message
- [x] Create `src/routes/users.js`
  - [x] `GET /users/:userId/metrics` — behavioral metrics ✅
    - [x] Tenancy check via enforcePathTenancy middleware
    - [x] Validate required query params (from, to, granularity)
    - [x] Return BehavioralMetrics with timeseries (5 buckets)
  - [x] `GET /users/:userId/profile` — behavioral profile ✅
    - [x] Tenancy check via enforcePathTenancy
    - [x] Return BehavioralProfile with pathologies, evidence, peakWindow
- [x] Create `src/routes/health.js` (done in Phase 2)
  - [x] `GET /health` — no auth
  - [x] Ping PostgreSQL (`SELECT 1`)
  - [x] Ping Redis (`PING`)
  - [x] Check stream lag (`XINFO GROUPS trade:closed`)
  - [x] Return `{ status: "ok"|"degraded", dbConnection, queueLag, timestamp }`
- [x] Verify: All 8 endpoints return spec-compliant responses ✅
- [x] Verify: Tenancy enforcement on all endpoints (403 on cross-tenant) ✅

---

## Phase 6: Testing (Hours 30–40)

- [ ] Create `tests/setup.js` — test helpers
  - [ ] Test DB setup/teardown
  - [ ] JWT generation for test users
  - [ ] HTTP client wrapper (supertest)
- [ ] Create `tests/trades.test.js`
  - [ ] POST trade → 200
  - [ ] POST same tradeId → 200, identical body (idempotency)
  - [ ] POST with invalid body → 400
  - [ ] POST with wrong userId → 403
  - [ ] GET existing trade → 200
  - [ ] GET non-existent trade → 404
  - [ ] GET another user's trade → 403
- [ ] Create `tests/auth.test.js`
  - [ ] No Authorization header → 401
  - [ ] Expired JWT → 401
  - [ ] Malformed JWT → 401
  - [ ] Valid JWT → passes (200 on health)
  - [ ] JWT for User A, GET User B's data → 403
- [ ] Create `tests/sessions.test.js`
  - [ ] GET session → 200 with trades array
  - [ ] GET non-existent session → 404
  - [ ] GET another user's session → 403
  - [ ] POST debrief → 201
  - [ ] POST debrief with invalid body → 400
- [ ] Create `tests/metrics.test.js`
  - [ ] GET metrics for seeded user → correct values
  - [ ] Verify Alex Mercer has revenge trade flags
  - [ ] Verify Jordan Lee has overtrading events
  - [ ] Timeseries has correct bucket counts
- [ ] Create `tests/integration.test.js`
  - [ ] POST closed trade → wait 2s → GET metrics → verify updated
  - [ ] Full flow: create → compute → read
- [ ] Verify: All tests pass
- [ ] Verify: `npm test` exits cleanly

---

## Phase 7: Load Testing (Hours 40–48)

- [ ] Create `loadtest/k6-trade-close.js`
  - [ ] 200 VUs, 60s duration
  - [ ] Threshold: p95 < 150ms
  - [ ] Threshold: error rate < 1%
  - [ ] Each VU generates unique tradeId
  - [ ] POST to /trades with status: closed
- [ ] Create `loadtest/run.sh` — dockerized k6 runner
- [ ] Run load test
- [ ] If p95 > 150ms:
  - [ ] Increase PG pool size
  - [ ] Add prepared statements
  - [ ] Check EXPLAIN ANALYZE for slow queries
  - [ ] Remove unnecessary middleware for hot path
- [ ] Save HTML report to `loadtest/results/`
- [ ] Verify: p95 ≤ 150ms
- [ ] Verify: Error rate < 1%

---

## Phase 8: Polish + Deploy (Hours 48–72)

- [ ] Create `DECISIONS.md` with 7 decisions
  - [ ] Decision 1: Express.js over Fastify
  - [ ] Decision 2: PostgreSQL 16, no ORM
  - [ ] Decision 3: Redis Streams over Kafka/RabbitMQ
  - [ ] Decision 4: Separate worker container
  - [ ] Decision 5: Application-layer tenancy
  - [ ] Decision 6: Structured logging approach
  - [ ] Decision 7: Seeding strategy
  - [ ] Include `EXPLAIN ANALYZE` for key queries
- [ ] Create comprehensive `README.md`
  - [ ] Quick start: `docker compose up`
  - [ ] Architecture diagram
  - [ ] API endpoints summary
  - [ ] Running tests
  - [ ] Running load tests
  - [ ] Environment variables
- [ ] Deploy to chosen platform
  - [ ] Push to Git
  - [ ] Deploy docker-compose stack
  - [ ] Verify health endpoint is live
  - [ ] Run smoke tests against live URL
- [ ] Final verification
  - [ ] All 7 endpoints return correct responses
  - [ ] Idempotency works
  - [ ] Cross-tenant → 403
  - [ ] Load test passes on deployed instance
  - [ ] Structured JSON logs visible
  - [ ] README is clear and complete
