# NevUp Track 1 — System of Record Backend

> Trade journal & behavioral analytics engine for the NevUp AI Trading Coach.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

---

## 🚀 Overview

A production-grade backend that ingests closed trades, computes behavioral analytics asynchronously via Redis Streams, and serves queryable metrics — all with strict multi-tenancy, idempotent writes, and structured observability.

NevUp uses this system as the **source of truth for trader behavior** — not just P&L, but psychological patterns like revenge trading, overtrading, and emotional bias. These signals power downstream AI coaching (Track 2) and user-facing insights (Track 3). Behavioral metrics are deterministic — identical inputs produce identical outputs across independent implementations.

**Key guarantees:**

| Guarantee | Implementation |
|---|---|
| Correctness | ACID writes, `DECIMAL(18,8)` P&L, server-computed `outcome` + `pnl` |
| Idempotency | `INSERT ... ON CONFLICT (trade_id) DO NOTHING` — same trade twice → same 200 |
| Multi-tenancy | JWT `sub` === resource `userId` on every endpoint; cross-tenant → 403 |
| Performance | 200 req/s sustained, p95 write = 4.19ms, p95 read = 8.48ms |
| Async Guarantee | All behavioral metrics computed outside the write path via Redis Streams — zero impact on write latency |
| Observability | Structured JSON logs with `traceId`, `userId`, `latency`, `statusCode` on every request |
| No ORM | Raw SQL with parameterized queries via `pg` — no hidden N+1s, full query plan control |

---

## 🏗 Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │             Docker Compose Stack            │
                    │                                             │
  HTTP Client ────▶ │  ┌─────────────────────────────────────┐   │
                    │  │         API Container (Express)      │   │
                    │  │  traceId → pino-http → auth → routes │   │
                    │  │         ↓ INSERT         ↓ XADD      │   │
                    │  └─────────┼───────────────┼────────────┘   │
                    │            ▼               ▼                │
                    │  ┌──────────────┐  ┌──────────────────┐    │
                    │  │ PostgreSQL 16│  │   Redis 7        │    │
                    │  │  388 trades  │  │  trade:closed     │    │
                    │  │  52 sessions │  │  (Stream + AOF)   │    │
                    │  └──────────────┘  └──────┬───────────┘    │
                    │                           │ XREADGROUP     │
                    │  ┌────────────────────────┼────────────┐   │
                    │  │       Worker Container               │   │
                    │  │  Plan Adherence · Revenge Flag       │   │
                    │  │  Session Tilt · Win Rate/Emotion     │   │
                    │  │  Overtrading Detector                │   │
                    │  │         ↓ UPSERT metrics             │   │
                    │  └────────────────────────┼────────────┘   │
                    │                           ▼                │
                    │                     PostgreSQL 16           │
                    └─────────────────────────────────────────────┘
```

**Data Flow**: `POST /trades` → INSERT to Postgres + `XADD` to Redis Stream → Worker consumes via `XREADGROUP` → computes 5 behavioral metrics → UPSERTs to Postgres → Client queries via `GET` endpoints.

---

## ⚡ Hard Requirements Coverage

| Requirement | Implementation | Proof |
|---|---|---|
| **Idempotent Write** | `INSERT ... ON CONFLICT (trade_id) DO NOTHING`; conflict-path tenancy guard | [`tests/IDEMPOTENCY_TEST_REPORT.md`](tests/IDEMPOTENCY_TEST_REPORT.md) — 12 tests<br>[`loadtest/reports/idempotency_dashboard.html`](loadtest/reports/idempotency_dashboard.html) |
| **Throughput ≥ 200 req/s** | `pg.Pool(max:20)`, async Redis publish, `constant-arrival-rate` k6 executor | [`loadtest/LOAD_TEST_REPORT.md`](loadtest/LOAD_TEST_REPORT.md) — 200 req/s sustained 60s<br>[`loadtest/reports/spec_dashboard.html`](loadtest/reports/spec_dashboard.html) |
| **Write p95 ≤ 150ms** | Connection pooling, indexed conflict resolution, zero sync analytics | Load report — **4.19ms** (35× headroom)<br>[`loadtest/reports/spec_dashboard.html`](loadtest/reports/spec_dashboard.html) |
| **Read p95 ≤ 200ms** | Composite indexes, bitmap scans, in-memory aggregation | Load report — **8.48ms** (23× headroom)<br>[`loadtest/reports/spec_dashboard.html`](loadtest/reports/spec_dashboard.html) |
| **Async Pipeline** | Redis Streams `XADD`/`XREADGROUP`, separate worker container, `XACK` delivery | [`tests/ASYNC_PIPELINE_REPORT.md`](tests/ASYNC_PIPELINE_REPORT.md) — 25 tests<br>[`loadtest/reports/async_pipeline_dashboard.html`](loadtest/reports/async_pipeline_dashboard.html) |
| **Multi-tenancy** | JWT `sub` enforcement at path, body, and resource levels; 403 for cross-tenant | [`tests/MULTI_TENANCY_REPORT.md`](tests/MULTI_TENANCY_REPORT.md) — 43 tests |
| **Observability** | pino-http structured JSON; traceId + userId + latency + statusCode on every log | [`tests/OBSERVABILITY_REPORT.md`](tests/OBSERVABILITY_REPORT.md) — 37 tests |
| **Health Check** | `GET /health` returns `dbConnection`, `queueLag`, `status`, `timestamp` | Observability report — Suite 6 |

> **Note**: Spec fields `latency` and `statusCode` are implemented as `responseTime` (pino-http convention) and `res.statusCode` in structured logs.

---

## 🐳 Running the System

```bash
docker compose up --build
```

**That's it.** The API container runs migrations → seeds 388 trades + 52 sessions → starts Express. The worker starts consuming Redis Streams automatically.

```bash
# Verify
curl http://localhost:3000/health
# → {"status":"ok","dbConnection":"connected","queueLag":0,"timestamp":"..."}
```

Zero manual steps. No `.env` file required. All defaults are set in `docker-compose.yml`.

Seed dataset (388 trades, 52 sessions, 10 traders) is automatically loaded on startup and immediately queryable via the read APIs.

---

## 📡 API Reference

This service fully implements the [OpenAPI 3.0 contract](given/nevup_openapi.yaml) (`given/nevup_openapi.yaml`) with no deviations in schema or field definitions.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/trades` | ✅ | Create a trade (idempotent on `tradeId`) |
| `GET` | `/trades/:tradeId` | ✅ | Get a single trade |
| `GET` | `/sessions/:sessionId` | ✅ | Session summary with trades |
| `POST` | `/sessions/:sessionId/debrief` | ✅ | Save a session debrief |
| `GET` | `/sessions/:sessionId/coaching` | ✅ | SSE coaching stream |
| `GET` | `/users/:userId/metrics` | ✅ | Behavioral metrics with timeseries |
| `GET` | `/users/:userId/profile` | ✅ | Behavioral profile & pathologies |
| `GET` | `/health` | ❌ | Health check (no auth) |

### Quick Test

```bash
# Generate a 24-hour JWT for seed user Alex Mercer
TOKEN=$(node scripts/generate-token.js f412f236-4edc-47a2-8f54-8763a6ed2ce8)

# POST a trade (idempotent — submit twice, get same 200)
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"tradeId":"test-001","userId":"f412f236-4edc-47a2-8f54-8763a6ed2ce8","sessionId":"sess-001","asset":"AAPL","assetClass":"equity","direction":"long","entryPrice":178.45,"exitPrice":182.30,"quantity":10,"entryAt":"2025-01-06T09:30:00Z","exitAt":"2025-01-06T10:15:00Z","status":"closed","planAdherence":4,"emotionalState":"calm","entryRationale":"Breakout above 178 resistance"}'

# GET behavioral metrics
curl "http://localhost:3000/users/f412f236-4edc-47a2-8f54-8763a6ed2ce8/metrics?from=2025-01-01T00:00:00Z&to=2025-12-31T23:59:59Z&granularity=daily" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🔐 Authentication & Tenancy

- **JWT (HS256)**: All endpoints except `/health` require `Authorization: Bearer <token>`
- **Tenancy enforcement**: Three layers — path-level, body-level, and resource-level
- **Cross-tenant rule**: Always returns **403 Forbidden**, never 404 (prevents existence leaks)
- **Conflict-path guard**: Even the idempotency `ON CONFLICT` fallback enforces tenancy — a [CVE-level data leak](tests/MULTI_TENANCY_REPORT.md#5-vulnerability-discovered--fixed) was discovered and patched during security testing

```
JWT.sub  ─┬─ Path:     req.params.userId === req.userId      (GET /users/:userId/*)
           ├─ Body:     req.body.userId === req.userId        (POST /trades)
           └─ Resource: trade.userId === req.userId           (GET /trades/:tradeId)
                        Fail at any layer → 403 FORBIDDEN
```

---

## 🧪 Testing Strategy

Tests run against the **live Docker stack** — no mocks.

```bash
# Integration tests (inside Docker container)
docker run --rm \
  --network paper-trading-behavioral-engine_default \
  -v "$(pwd)/tests:/app/tests" -v "$(pwd)/src:/app/src" \
  -v "$(pwd)/package.json:/app/package.json" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /app -e TEST_BASE_URL=http://api:3000 \
  node:20-alpine sh -c "npm install dotenv && node --test tests/*.test.js"
```

| Suite | Tests | What It Proves |
|-------|-------|----------------|
| [`auth.test.js`](tests/auth.test.js) | 8 | JWT verification, expiry, missing header |
| [`trades.test.js`](tests/trades.test.js) | 12 | Idempotency, P&L computation, validation |
| [`idempotency.test.js`](tests/idempotency.test.js) | 12 | Concurrent duplicate writes, DB-level verification |
| [`sessions.test.js`](tests/sessions.test.js) | 4 | Session lookup, debrief, coaching SSE |
| [`metrics.test.js`](tests/metrics.test.js) | 8 | Aggregation, timeseries, profile, pathologies |
| [`integration.test.js`](tests/integration.test.js) | 2 | End-to-end: POST → metrics pipeline |
| [`async-pipeline.test.js`](tests/async-pipeline.test.js) | 25 | Redis Streams delivery, worker idempotency, crash recovery |
| [`multi-tenancy.test.js`](tests/multi-tenancy.test.js) | 43 | Cross-tenant reads/writes, JWT tampering, UUID guessing |
| [`observability.test.js`](tests/observability.test.js) | 37 | Structured logs, trace propagation, latency accuracy |
| **Total** | **151** | |

**Load tests**: k6 scripts in [`loadtest/`](loadtest/) — see [`LOAD_TEST_REPORT.md`](loadtest/LOAD_TEST_REPORT.md) for methodology and results.

---

## 📊 Proof & Reports

| Report | Location | Summary |
|--------|----------|---------|
| Idempotency | [`tests/IDEMPOTENCY_TEST_REPORT.md`](tests/IDEMPOTENCY_TEST_REPORT.md)<br>[`loadtest/reports/idempotency_dashboard.html`](loadtest/reports/idempotency_dashboard.html) | 15 tests: concurrent duplicates, DB uniqueness, response equivalence |
| Async Pipeline | [`tests/ASYNC_PIPELINE_REPORT.md`](tests/ASYNC_PIPELINE_REPORT.md)<br>[`loadtest/reports/async_pipeline_dashboard.html`](loadtest/reports/async_pipeline_dashboard.html) | 32 tests: Redis Streams delivery, metric computation, crash recovery |
| Multi-Tenancy | [`tests/MULTI_TENANCY_REPORT.md`](tests/MULTI_TENANCY_REPORT.md) | 43 tests: cross-tenant isolation, JWT tampering, conflict-path data leak fix |
| Observability | [`tests/OBSERVABILITY_REPORT.md`](tests/OBSERVABILITY_REPORT.md) | 37 tests: structured JSON logs, traceId propagation, health endpoint |
| Load Test | [`loadtest/LOAD_TEST_REPORT.md`](loadtest/LOAD_TEST_REPORT.md)<br>[`loadtest/reports/spec_dashboard.html`](loadtest/reports/spec_dashboard.html) | 200 req/s × 60s, p95 write = 4.19ms, p95 read = 8.48ms, 0% errors |

---

## 📈 Performance Summary

| Metric | Target | Achieved |
|--------|--------|----------|
| Write throughput | ≥ 200 req/s | **200 req/s** sustained (constant-arrival-rate) |
| Write p95 latency | ≤ 150ms | **4.19ms** |
| Read p95 latency | ≤ 200ms | **8.48ms** |
| Error rate | < 1% | **0.000%** |
| Concurrent VUs | Multiple | **150–152 VUs** |
| Trade lookup | < 10ms | **1.19ms** (PK index scan) |
| Timeseries query | < 10ms | **1.77ms** (bitmap index scan) |
| Idempotent insert | < 10ms | **4.34ms** (ON CONFLICT DO NOTHING) |

---

## 📁 Project Structure

```
paper-trading-behavioral-engine/
├── docker-compose.yml              # 4-service stack: api, worker, postgres, redis
├── Dockerfile                      # Node 20 Alpine — migrate → seed → serve
├── DECISIONS.md                    # Engineering rationale with EXPLAIN ANALYZE
│
├── src/
│   ├── server.js                   # Express app + middleware chain
│   ├── config.js                   # Centralized config
│   ├── migrate.js                  # SQL migration runner
│   ├── seed.js                     # JSON seed loader (388 trades, 52 sessions)
│   ├── middleware/                  # auth · tenancy · traceId · errorHandler
│   ├── routes/                     # trades · sessions · users · health
│   ├── services/                   # tradeService · sessionService · metricsService · publisher
│   ├── workers/                    # XREADGROUP consumer + 5 metric computations
│   ├── plugins/                    # pg.Pool + ioredis singletons
│   └── utils/                      # jwt (HS256) · errors factory
│
├── tests/                          # 151 integration tests + 4 detailed reports
├── loadtest/                       # k6 scripts + LOAD_TEST_REPORT.md
├── migrations/                     # 5 SQL schemas (idempotent, sequential)
├── scripts/                        # Token generation CLI
└── given/                          # OpenAPI spec + seed dataset + JWT format
```

---

## Seed Users

| # | Name | Pathology | Trades |
|---|------|-----------|--------|
| 1 | Alex Mercer | revenge_trading | 25 |
| 2 | Jordan Lee | overtrading | 80 |
| 3 | Sam Rivera | fomo_entries | 30 |
| 4 | Casey Kim | plan_non_adherence | 35 |
| 5 | Morgan Bell | premature_exit | 35 |
| 6 | Taylor Grant | loss_running | 30 |
| 7 | Riley Stone | session_tilt | 40 |
| 8 | Drew Patel | time_of_day_bias | 48 |
| 9 | Quinn Torres | position_sizing_inconsistency | 35 |
| 10 | Avery Chen | *(clean trader)* | 30 |

---

## 🧩 Key Design Choices

- **PostgreSQL** as source of truth — ACID + strong consistency for financial data
- **Redis Streams** for async event processing — at-least-once delivery via `XREADGROUP`/`XACK`
- **`ON CONFLICT DO NOTHING`** for idempotency — atomic, lock-free, race-safe
- **Structured logging** via pino — production-grade JSON observability with traceId correlation
- **Raw SQL** via `pg` — no ORM hiding N+1 queries (spec constraint)
- **Application-layer tenancy** — explicit `if/return 403` over invisible RLS row filtering

See [DECISIONS.md](DECISIONS.md) for the full engineering rationale with `EXPLAIN ANALYZE` output.

---

## 🌐 Deployment

**Live API URL**: [`http://57.159.31.142:3000`](http://57.159.31.142:3000)  
**K6 Load Test Report**: [`http://57.159.31.142:8080`](http://57.159.31.142:8080)

The service is deployed on an Azure VM (Ubuntu 24.04, Standard B2als_v2) running the same `docker compose up --build` stack. The deployment is identical to what you get locally — same containers, same compose file, zero platform-specific changes.

```bash
# Verify live deployment
curl http://57.159.31.142:3000/health
# → {"status":"ok","dbConnection":"connected","queueLag":0,"timestamp":"..."}
```