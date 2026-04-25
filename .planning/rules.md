# NevUp Track 1 — Development Rules

> **Purpose**: Enforced consistency rules for the 72-hour hackathon build. Every developer action must comply with these rules. Violations risk automated test failures, point deductions, or deployment issues.  
> **Companion docs**: [implementation_plan.md](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/implementation_plan.md) · [context.md](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/context.md) · [task.md](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/task.md)

---

## 1. Code Style Rules

### 1.1 Naming Conventions

| Element | Convention | Example |
|---|---|---|
| **Files** | camelCase | `tradeService.js`, `errorHandler.js` |
| **DB columns** | snake_case | `trade_id`, `entry_price`, `emotional_state` |
| **JS variables** | camelCase | `tradeId`, `entryPrice`, `emotionalState` |
| **API request/response** | camelCase | `{ "tradeId": "...", "assetClass": "equity" }` |
| **Constants** | UPPER_SNAKE | `JWT_SECRET`, `DATABASE_URL` |
| **Functions** | camelCase verbs | `createTrade()`, `verifyToken()`, `getMetrics()` |

> [!IMPORTANT]
> **The API speaks camelCase. The database speaks snake_case.** Every service function must translate between these two conventions. This mapping is defined in [context.md § 4.2](file:///C:/Users/harsh/.gemini/antigravity/brain/39b0720b-8b72-43ff-8cbd-2b5c3afe3298/context.md).

### 1.2 Column Mapping Helper

Every route handler that reads from or writes to the database MUST use a consistent mapping function:

```javascript
// DB row → API response (snake_case → camelCase)
function toApiResponse(row) {
  return {
    tradeId: row.trade_id,
    userId: row.user_id,
    sessionId: row.session_id,
    asset: row.asset,
    assetClass: row.asset_class,
    direction: row.direction,
    entryPrice: parseFloat(row.entry_price),
    exitPrice: row.exit_price ? parseFloat(row.exit_price) : null,
    quantity: parseFloat(row.quantity),
    entryAt: row.entry_at,
    exitAt: row.exit_at,
    status: row.status,
    outcome: row.outcome,
    pnl: row.pnl ? parseFloat(row.pnl) : null,
    planAdherence: row.plan_adherence,
    emotionalState: row.emotional_state,
    entryRationale: row.entry_rationale,
    revengeFlag: row.revenge_flag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

**Rationale**: PostgreSQL `DECIMAL` columns are returned as strings by `pg`. We must `parseFloat()` all numeric fields before returning to the client. Forgetting this will cause type mismatches in automated tests.

### 1.3 Error Response Format

**EVERY error response** must follow this exact shape:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description.",
  "traceId": "uuid-from-request"
}
```

**Standard error codes:**
| Code | HTTP Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `TOKEN_EXPIRED` | 401 | JWT `exp` is in the past |
| `FORBIDDEN` | 403 | Cross-tenant access (`sub !== userId`) |
| `NOT_FOUND` | 404 | Resource doesn't exist (own data only) |
| `BAD_REQUEST` | 400 | Invalid request body or query params |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

> [!CAUTION]
> **Never return 404 for cross-tenant access. Always return 403.** This is explicitly tested by automated reviewers. The spec states: *"Cross-tenant reads always return 403 — never 404."*

### 1.4 Tenancy Check Pattern

Every data endpoint MUST enforce tenancy. Use this exact pattern:

```javascript
// For path-param endpoints (GET /users/:userId/metrics)
if (req.params.userId !== req.userId) {
  return res.status(403).json({
    error: 'FORBIDDEN',
    message: 'Cross-tenant access denied.',
    traceId: req.traceId,
  });
}

// For resource-lookup endpoints (GET /trades/:tradeId)
const trade = await tradeService.getTradeById(tradeId);
if (!trade) {
  // Check if it exists for another user before returning 404
  const exists = await tradeService.tradeExists(tradeId);
  if (exists) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Cross-tenant access denied.',
      traceId: req.traceId,
    });
  }
  return res.status(404).json({
    error: 'TRADE_NOT_FOUND',
    message: 'Trade with the given tradeId does not exist.',
    traceId: req.traceId,
  });
}
if (trade.user_id !== req.userId) {
  return res.status(403).json({
    error: 'FORBIDDEN',
    message: 'Cross-tenant access denied.',
    traceId: req.traceId,
  });
}
```

> [!NOTE]
> For resource-lookup endpoints, there are TWO places to check tenancy:
> 1. **After fetching**: Does the resource belong to the requesting user?
> 2. **On "not found"**: Does the resource exist for a DIFFERENT user? → 403, not 404.
> 
> A simpler approach: always query without a user_id filter, then check ownership after fetching.

### 1.5 Structured Logging

Every request MUST produce a structured JSON log entry containing:

```json
{
  "traceId": "uuid-per-request",
  "userId": "from jwt.sub (or 'anonymous' for /health)",
  "latency": 142,
  "statusCode": 200,
  "method": "POST",
  "url": "/trades",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Rules:**
- Use `pino-http` middleware for automatic request/response logging
- Inject `traceId` and `userId` into the pino logger context via `req.log`
- The `traceId` in logs MUST match the `traceId` in error responses
- Never use `console.log` — always use `req.log` or the pino logger instance
- Log level: `info` for requests, `error` for unhandled errors, `warn` for expected failures (401/403)

---

## 2. Safety & Stability Checks

### 2.1 Pre-Commit Checks

Before committing ANY code:

- [ ] `docker compose build` succeeds
- [ ] `docker compose up` starts all 4 containers
- [ ] Health endpoint returns 200
- [ ] At least one smoke test passes (POST /trades → 200)

### 2.2 Pre-Deploy Checks

Before deploying to production:

- [ ] All automated tests pass: `npm test`
- [ ] Load test passes: p95 ≤ 150ms, error rate < 1%
- [ ] `docker compose up` from clean state works (no leftover volumes)
- [ ] Seed data loads correctly: 388 trades, 52 sessions
- [ ] Health endpoint returns `"status": "ok"`
- [ ] Cross-tenant test: JWT for User A → GET User B's data → 403
- [ ] Idempotency test: POST same tradeId twice → both return 200

### 2.3 Database Safety Rules

| Rule | Rationale |
|---|---|
| Never `DROP TABLE` without `IF EXISTS` | Migrations must be re-runnable |
| Always use `ON CONFLICT` for upserts | Prevent duplicate key errors under concurrency |
| Never `DELETE` seed data | Reviewers expect the seed data to be queryable |
| Always use parameterized queries (`$1`, `$2`) | SQL injection prevention |
| Never use `SELECT *` in production queries | Explicit column lists prevent breaking changes |
| Always `parseFloat()` DECIMAL columns before JSON response | PG returns DECIMAL as strings |
| Migration order must be sequential and never skip numbers | `migrate.js` runs them in filename order |

### 2.4 Redis Safety Rules

| Rule | Rationale |
|---|---|
| Always `XACK` after successful processing | Prevents reprocessing |
| Never `XACK` on error | Failed messages stay in PEL for retry |
| Create consumer group with `MKSTREAM` | Stream is auto-created if it doesn't exist |
| Use `BLOCK 5000` in XREADGROUP | Don't busy-loop, but check often enough |
| AOF must be enabled | Messages survive Redis restart |

### 2.5 Docker Safety Rules

| Rule | Rationale |
|---|---|
| API container runs migrations + seed BEFORE starting server | Ensures DB is ready |
| Worker depends on API service (not just postgres) | API runs migrations first |
| Use health checks with retries on PG and Redis | Prevents startup race conditions |
| Pin image versions (`node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine`) | Reproducible builds |
| Use `npm ci --production` in Dockerfile | Deterministic installs, no dev deps |
| Don't mount `node_modules` as a volume | Host OS incompatibilities |

---

## 3. Hackathon Compliance Rules

These rules are derived directly from the hackathon spec and scoring criteria. Violating ANY of these will result in point deductions.

### 3.1 API Compliance

| # | Rule | Source | Consequence if violated |
|---|---|---|---|
| C1 | `POST /trades` must be idempotent on `tradeId` | OpenAPI spec line 42-43 | Automated test failure |
| C2 | Duplicate trades return 200, never 409 or 500 | OpenAPI spec line 42-43 | Automated test failure |
| C3 | Cross-tenant access returns 403, never 404 | jwt_format.md § Row-Level Tenancy | Automatic point deduction |
| C4 | All error responses include `{ error, message, traceId }` | OpenAPI ErrorResponse schema | Automated test failure |
| C5 | `GET /health` requires NO authentication | OpenAPI `security: []` | Automated test failure |
| C6 | Health returns `"status": "ok"`, not `"healthy"` | OpenAPI HealthResponse schema | Schema validation failure |
| C7 | All 7 endpoints must exist and return valid responses | OpenAPI paths | Missing endpoint = 0 points for that feature |
| C8 | Trade response includes `outcome`, `pnl`, `revengeFlag` | OpenAPI Trade schema | Schema validation failure |
| C9 | Metrics `revengeTrades` is integer COUNT, not array | OpenAPI BehavioralMetrics | Schema validation failure |
| C10 | Metrics `timeseries` array is required | OpenAPI BehavioralMetrics | Schema validation failure |

### 3.2 Auth Compliance

| # | Rule | Source |
|---|---|---|
| A1 | HS256 algorithm only | jwt_format.md |
| A2 | Shared secret: `97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02` | jwt_format.md |
| A3 | `exp` in the past → 401 | jwt_format.md validation checklist |
| A4 | Missing Authorization header → 401 | jwt_format.md validation checklist |
| A5 | Malformed tokens → 401 | jwt_format.md validation checklist |
| A6 | `sub === userId` on every data endpoint → 403 on mismatch | jwt_format.md § Row-Level Tenancy |
| A7 | 0 seconds clock skew tolerance — UTC strictly | jwt_format.md |

### 3.3 Performance Compliance

| # | Rule | Target |
|---|---|---|
| P1 | 200 concurrent trade-close writes/sec | p95 ≤ 150ms |
| P2 | Metric read under seeded dataset | p95 ≤ 200ms |
| P3 | No ORM — raw SQL only | Explicit in spec |
| P4 | `EXPLAIN ANALYZE` output in DECISIONS.md | Scoring criterion |

### 3.4 Observability Compliance

| # | Rule | Source |
|---|---|---|
| O1 | Structured JSON logs on every request | Scoring criterion |
| O2 | `traceId` in logs matches `traceId` in error responses | jwt_format.md § Structured Log Fields |
| O3 | `userId` from JWT in every log entry | jwt_format.md § Structured Log Fields |
| O4 | Latency in every log entry | jwt_format.md § Structured Log Fields |

### 3.5 Deployment Compliance

| # | Rule | Source |
|---|---|---|
| D1 | `docker compose up` must work with zero manual steps | Submission requirement |
| D2 | Live deployment URL must be accessible | Submission requirement |
| D3 | Seed data must be loaded on startup | Scoring criterion |
| D4 | README must explain how to run locally | Scoring criterion |

---

## 4. Development Workflow Rules

### 4.1 Git Commit Strategy

- Commit after each **phase completion** (not per-file)
- Use conventional commit messages:
  ```
  feat(phase1): foundation - docker, migrations, seed data
  feat(phase2): auth middleware - JWT, tenancy, traceId
  feat(phase3): write API - POST/GET trades, idempotency
  feat(phase4): async pipeline - Redis Streams, 5 metric workers
  feat(phase5): read API - sessions, metrics, health, profile
  feat(phase6): testing - automated test suite
  feat(phase7): loadtest - k6 script, performance optimization
  feat(phase8): polish - DECISIONS.md, README, deployment
  ```
- Tag milestones: `v0.1-foundation`, `v0.2-auth`, etc.

### 4.2 Docker Rebuild Cadence

- Rebuild after EVERY `package.json` change: `docker compose build`
- Use `docker compose up --build` when changing Dockerfile
- For code-only changes: volume mount `src/` in dev mode (add dev docker-compose override)

### 4.3 Testing Cadence

| After | Run |
|---|---|
| Every route implementation | Smoke test: curl the endpoint manually |
| Phase completion | Full `npm test` |
| Before load testing | All unit + integration tests |
| Before deployment | Full suite + load test |

### 4.4 Database Reset Procedure

When you need to start fresh:
```bash
docker compose down -v     # remove volumes (deletes DB data)
docker compose up --build  # rebuild + migrate + seed
```

**Never** modify seed data after initial loading. If metrics seem wrong, check the worker logic, not the data.

---

## 5. Anti-Patterns to Avoid

### 5.1 Code Anti-Patterns

| ❌ Don't | ✅ Do | Why |
|---|---|---|
| `console.log()` for logging | Use `pino` / `req.log` | Structured JSON required for scoring |
| Return 404 for another user's data | Return 403 | Spec mandate — automated test |
| Use Sequelize/Prisma/TypeORM | Use raw `pg` queries | Spec: "No ORM hiding N+1s" |
| Hardcode the JWT secret in code | Read from `process.env.JWT_SECRET` | 12-factor app |
| Use `SELECT *` | Use explicit column lists | Prevents leaking internal fields |
| Parse JWT with `jsonwebtoken` library | Use custom `crypto.createHmac` | Shows understanding; library is fine too, but custom shows depth |
| Skip tenancy check on any endpoint | Check on EVERY data endpoint | Automated test for every endpoint |

### 5.2 Architecture Anti-Patterns

| ❌ Don't | ✅ Do | Why |
|---|---|---|
| Compute metrics synchronously in POST /trades | Use Redis Streams async pipeline | Write path must be fast (p95 ≤ 150ms) |
| Run worker in same process as API | Separate Docker container | Isolation, independent failure |
| Skip health check dependencies in compose | Use `condition: service_healthy` | Race conditions on startup |
| Store computed metrics only in Redis | Store in PostgreSQL | Durability, queryability |
| Use a single PG connection | Use `pg.Pool` with 20+ connections | Concurrent load test requires pooling |

### 5.3 Hackathon Anti-Patterns

| ❌ Don't | ✅ Do | Why |
|---|---|---|
| Polish UI before all endpoints work | Get all 7 endpoints working first | Missing endpoints = 0 points |
| Spend time on fancy error pages | Focus on correct JSON responses | Reviewers test via API, not browser |
| Over-engineer for production scale | Build for hackathon scope (388 trades, 10 users) | 72 hours is tight |
| Skip DECISIONS.md | Write it — it's a scoring criterion | Shows engineering thinking |
| Deploy last-minute | Deploy by hour 52, test by hour 60 | Last-minute deploys always break |

---

## 6. Quick Reference: Response Status Codes

| Endpoint | Success | Auth Fail | Tenancy Fail | Not Found | Bad Input |
|---|---|---|---|---|---|
| `POST /trades` | 200 | 401 | 403 | — | 400 |
| `GET /trades/:id` | 200 | 401 | 403 | 404 | — |
| `GET /sessions/:id` | 200 | 401 | 403 | 404 | — |
| `POST /sessions/:id/debrief` | **201** | 401 | 403 | — | 400 |
| `GET /sessions/:id/coaching` | 200 | 401 | 403 | 404 | — |
| `GET /users/:id/metrics` | 200 | 401 | 403 | — | 400 |
| `GET /users/:id/profile` | 200 | 401 | 403 | 404 | — |
| `GET /health` | 200 | — | — | — | — |

> [!WARNING]
> Note that `POST /trades` returns **200** (not 201) for both new and existing trades. Only `POST /sessions/:id/debrief` returns **201**.
