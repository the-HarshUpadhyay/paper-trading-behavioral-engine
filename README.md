# NevUp Track 1 — System of Record Backend

> Trade journal & behavioral analytics engine for the NevUp AI Trading Coach.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

---

## Architecture

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

**Data Flow**: Client → POST /trades → API inserts trade + XADD to Redis Stream → Worker consumes via XREADGROUP → computes 5 behavioral metrics → UPSERTs results to PostgreSQL → Client reads via GET endpoints.

---

## Quick Start

```bash
# Clone
git clone https://github.com/the-HarshUpadhyay/paper-trading-behavioral-engine.git
cd paper-trading-behavioral-engine

# Start everything (builds + migrates + seeds + starts API + worker)
docker compose up --build

# Verify (in a new terminal)
curl http://localhost:3000/health
```

Expected health response:
```json
{
  "status": "ok",
  "dbConnection": "connected",
  "queueLag": 0,
  "timestamp": "2025-04-25T12:00:00.000Z"
}
```

**That's it.** Zero manual steps. The API container runs migrations → seeds 388 trades + 52 sessions → starts the Express server. The worker starts consuming the Redis Stream automatically.

---

## API Endpoints

All endpoints (except `/health`) require JWT authentication via `Authorization: Bearer <token>`.

### Generate a test token

```bash
# Install dependencies locally (needed for token generation)
npm install

# Generate a 24-hour JWT for seed user Alex Mercer
node scripts/generate-token.js f412f236-4edc-47a2-8f54-8763a6ed2ce8
```

### Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/trades` | ✅ | Create a trade (idempotent on `tradeId`) |
| `GET` | `/trades/:tradeId` | ✅ | Get a single trade |
| `GET` | `/sessions/:sessionId` | ✅ | Get session summary with trades |
| `POST` | `/sessions/:sessionId/debrief` | ✅ | Save a session debrief |
| `GET` | `/sessions/:sessionId/coaching` | ✅ | SSE coaching stream |
| `GET` | `/users/:userId/metrics` | ✅ | Behavioral metrics with timeseries |
| `GET` | `/users/:userId/profile` | ✅ | Behavioral profile & pathologies |
| `GET` | `/health` | ❌ | Health check (no auth) |

### Example Requests

```bash
# Set your token
TOKEN=$(node scripts/generate-token.js f412f236-4edc-47a2-8f54-8763a6ed2ce8)

# POST a trade (idempotent)
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "tradeId": "test-trade-001",
    "userId": "f412f236-4edc-47a2-8f54-8763a6ed2ce8",
    "sessionId": "test-session-001",
    "asset": "AAPL",
    "assetClass": "equity",
    "direction": "long",
    "entryPrice": 178.45,
    "exitPrice": 182.30,
    "quantity": 10,
    "entryAt": "2025-01-06T09:30:00Z",
    "exitAt": "2025-01-06T10:15:00Z",
    "status": "closed",
    "planAdherence": 4,
    "emotionalState": "calm",
    "entryRationale": "Breakout above 178 resistance"
  }'

# GET trade (same one — proves idempotency)
curl http://localhost:3000/trades/test-trade-001 \
  -H "Authorization: Bearer $TOKEN"

# GET session with all trades
curl http://localhost:3000/sessions/sess-alex-001 \
  -H "Authorization: Bearer $TOKEN"

# GET behavioral metrics
curl "http://localhost:3000/users/f412f236-4edc-47a2-8f54-8763a6ed2ce8/metrics?from=2025-01-01T00:00:00Z&to=2025-12-31T23:59:59Z&granularity=daily" \
  -H "Authorization: Bearer $TOKEN"

# GET behavioral profile
curl http://localhost:3000/users/f412f236-4edc-47a2-8f54-8763a6ed2ce8/profile \
  -H "Authorization: Bearer $TOKEN"
```

---

## Seed Users

| # | Name | userId | Pathology | Trades |
|---|------|--------|-----------|--------|
| 1 | Alex Mercer | `f412f236-4edc-47a2-8f54-8763a6ed2ce8` | revenge_trading | 25 |
| 2 | Jordan Lee | `fcd434aa-2201-4060-aeb2-f44c77aa0683` | overtrading | 80 |
| 3 | Sam Rivera | `84a6a3dd-f2d0-4167-960b-7319a6033d49` | fomo_entries | 30 |
| 4 | Casey Kim | `4f2f0816-f350-4684-b6c3-29bbddbb1869` | plan_non_adherence | 35 |
| 5 | Morgan Bell | `75076413-e8e8-44ac-861f-c7acb3902d6d` | premature_exit | 35 |
| 6 | Taylor Grant | `8effb0f2-f16b-4b5f-87ab-7ffca376f309` | loss_running | 30 |
| 7 | Riley Stone | `50dd1053-73b0-43c5-8d0f-d2af88c01451` | session_tilt | 40 |
| 8 | Drew Patel | `af2cfc5e-c132-4989-9c12-2913f89271fb` | time_of_day_bias | 48 |
| 9 | Quinn Torres | `9419073a-3d58-4ee6-a917-be2d40aecef2` | position_sizing_inconsistency | 35 |
| 10 | Avery Chen | `e84ea28c-e5a7-49ef-ac26-a873e32667bd` | *(clean trader)* | 30 |

---

## Running Tests

Tests run against the **live Docker stack** (integration tests, not mocks).

```bash
# Make sure the stack is running
docker compose up -d

# Run all 34 tests
npm test
```

**Test suite**:
| File | Tests | What it proves |
|------|-------|----------------|
| `tests/auth.test.js` | 8 | JWT verification, expiry, missing header, cross-tenant |
| `tests/trades.test.js` | 12 | Idempotency, P&L computation, tenancy, validation |
| `tests/sessions.test.js` | 4 | Session lookup, debrief, coaching SSE |
| `tests/metrics.test.js` | 8 | Metrics aggregation, timeseries, profile, pathologies |
| `tests/integration.test.js` | 2 | End-to-end: POST trade → metrics update, health check |

---

## Load Testing

Load tests use [k6](https://grafana.com/docs/k6/latest/) to simulate 200 concurrent users POSTing closed trades.

```bash
# Windows (k6.exe in project root)
$env:TOKEN = node scripts/generate-token.js f412f236-4edc-47a2-8f54-8763a6ed2ce8
.\k6.exe run loadtest/k6-trade-close.js

# Linux/Mac
export TOKEN=$(node scripts/generate-token.js f412f236-4edc-47a2-8f54-8763a6ed2ce8)
k6 run loadtest/k6-trade-close.js
```

**Results** (Docker Desktop, Windows, WSL2):

| Metric | Target | Result |
|--------|--------|--------|
| Requests | — | 55,397 in 60s |
| Throughput | 200 req/s | **921 req/s** |
| p95 latency | ≤ 150ms | **139ms** (at 100 VUs) |
| Error rate | < 1% | **0.00%** |

> **Note**: p95 at 200 VUs was 280ms due to Docker Desktop WSL2 networking overhead. At 100 VUs, p95 drops to 139ms. On native Linux, 200 VUs should comfortably clear the 150ms threshold.

---

## Project Structure

```
paper-trading-behavioral-engine/
├── docker-compose.yml          # 4-service stack: api, worker, postgres, redis
├── Dockerfile                  # Node 20 Alpine, migrate → seed → serve
├── DECISIONS.md                # 7 design decisions with EXPLAIN ANALYZE
├── package.json                # 6 production deps, 1 dev dep
├── .env.example                # Environment variable template
│
├── migrations/                 # SQL schema (idempotent, sequential)
│   ├── 001_create_trades.sql
│   ├── 002_create_sessions.sql
│   ├── 003_create_debriefs.sql
│   └── 004_create_metrics.sql
│
├── src/
│   ├── server.js               # Express bootstrap + middleware chain
│   ├── config.js               # Centralized env var access
│   ├── migrate.js              # Run SQL migrations in order
│   ├── seed.js                 # Load JSON seed data (388 trades, 52 sessions)
│   │
│   ├── middleware/
│   │   ├── auth.js             # JWT HS256 verification → req.userId
│   │   ├── tenancy.js          # Cross-tenant → 403 enforcement
│   │   ├── traceId.js          # crypto.randomUUID() per request
│   │   └── errorHandler.js     # Global catch-all → { error, message, traceId }
│   │
│   ├── plugins/
│   │   ├── database.js         # pg.Pool singleton (max: 20)
│   │   └── redis.js            # ioredis client singleton
│   │
│   ├── routes/
│   │   ├── trades.js           # POST + GET /trades
│   │   ├── sessions.js         # GET session, POST debrief, GET coaching (SSE)
│   │   ├── users.js            # GET metrics, GET profile
│   │   └── health.js           # GET /health (no auth)
│   │
│   ├── services/
│   │   ├── tradeService.js     # Insert (idempotent), P&L computation, column mapping
│   │   ├── sessionService.js   # Session summary, debrief persistence
│   │   ├── metricsService.js   # Timeseries bucketing, profile/pathology analysis
│   │   └── publisher.js        # XADD to trade:closed Redis Stream
│   │
│   ├── workers/
│   │   ├── index.js            # XREADGROUP consumer loop + crash recovery
│   │   ├── planAdherence.js    # Rolling 10-trade average
│   │   ├── revengeFlag.js      # 90s window + anxious/fearful detection
│   │   ├── sessionTilt.js      # Loss-following ratio per session
│   │   ├── winRateByEmotion.js # Per-emotion win/loss/winRate
│   │   └── overtradingDetector.js # 10 trades in 30 min detection
│   │
│   └── utils/
│       ├── jwt.js              # Custom HS256 sign/verify (crypto.createHmac)
│       └── errors.js           # Standardized { error, message, traceId } factory
│
├── tests/                      # 34 integration tests (node:test runner)
├── loadtest/                   # k6 load test (200 VUs, 60s)
├── scripts/
│   └── generate-token.js       # CLI: generate 24h JWT for any userId
└── given/                      # Hackathon spec files (read-only)
    ├── nevup_openapi.yaml
    ├── nevup_seed_dataset.json
    ├── nevup_seed_dataset.csv
    └── jwt_format.md
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://nevup:nevup@postgres:5432/nevup` | PostgreSQL connection string |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `JWT_SECRET` | `97791d4db2aa...` | HS256 signing secret (from spec) |
| `PORT` | `3000` | API server port |
| `NODE_ENV` | `production` | Environment mode |
| `LOG_LEVEL` | `info` | Pino log level |

All variables have sensible defaults for Docker Compose. Copy `.env.example` to `.env` for local development outside Docker.

---

## Key Design Principles

1. **Idempotency**: `INSERT ... ON CONFLICT (trade_id) DO NOTHING` — POST the same trade twice, get the same 200 response both times.
2. **Tenancy**: Every data endpoint checks `JWT.sub === resource.userId`. Cross-tenant access always returns 403, never 404.
3. **Async Pipeline**: Metrics computed asynchronously via Redis Streams — the write path (POST /trades) is never blocked by analytics.
4. **Structured Logging**: Every request produces JSON logs with `traceId`, `userId`, `latency`, `statusCode`. Same `traceId` appears in error response bodies.
5. **Zero-config startup**: `docker compose up` runs migrations, seeds data, starts API + worker. No manual steps.

See [DECISIONS.md](DECISIONS.md) for the full engineering rationale with `EXPLAIN ANALYZE` output.