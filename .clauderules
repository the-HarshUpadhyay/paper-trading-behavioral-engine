# NevUp Track 1 — Development Rules for AI Assistant
# This file is read by the AI at the start of every session.
# It enforces consistency, safety, and hackathon compliance.

## Identity & Context

You are building the **NevUp Track 1: System of Record Backend** for a 72-hour hackathon.
Stack: Node.js 20 + Express.js + PostgreSQL 16 + Redis 7 (Streams).
All planning docs live in `.planning/`. Read them before writing code.

## Mandatory Startup

Before writing ANY code in a session:
1. Read `.planning/task.md` to know what's done and what's next.
2. Read `.planning/rules.md` for the compliance rules.
3. Read `.planning/context.md` ONLY for the section relevant to the current task.
4. Read `.planning/workflow.md` for the phase execution protocol.
5. Never start a phase without completing the previous phase's gate check.

## Code Style — Absolute Rules

### Naming
- Files: camelCase (`tradeService.js`)
- DB columns: snake_case (`trade_id`, `entry_price`)
- JS variables: camelCase (`tradeId`, `entryPrice`)
- API request/response fields: camelCase (matches OpenAPI spec)
- Constants: UPPER_SNAKE (`JWT_SECRET`, `DATABASE_URL`)
- Every service function must convert snake_case DB rows to camelCase API responses

### Error Responses
Every error response MUST have this exact shape:
```json
{"error": "ERROR_CODE", "message": "Human-readable.", "traceId": "uuid"}
```
Never omit traceId. Never add extra fields. Never change the shape.

### Logging
- NEVER use console.log(). Use pino logger or req.log.
- Every request must produce a structured JSON log with: traceId, userId, latency, statusCode, method, url.
- The traceId in logs MUST match the traceId in error response bodies.

### SQL
- NEVER use an ORM. Raw SQL via pg (node-postgres) only.
- NEVER use SELECT *. Always list columns explicitly.
- ALWAYS use parameterized queries ($1, $2). Never concatenate strings.
- ALWAYS parseFloat() DECIMAL columns before putting them in JSON responses.
- Migrations must be idempotent (use IF NOT EXISTS, ON CONFLICT, etc.)

### Auth
- JWT algorithm: HS256 only.
- Secret: read from process.env.JWT_SECRET, never hardcode in source.
- Expired token → 401. Missing header → 401. Malformed → 401.
- Cross-tenant access → 403. NEVER return 404 for another user's data.
- Health endpoint (/health) requires NO authentication.

## Hackathon Compliance — Hard Rules

These will be checked by automated reviewers. Breaking ANY of these = point deduction.

1. POST /trades is idempotent on tradeId. Duplicates return 200, never 409 or 500.
2. Cross-tenant access returns 403, NEVER 404.
3. All error responses include { error, message, traceId }.
4. GET /health requires NO authentication (security: [] in OpenAPI).
5. Health returns "status": "ok", NOT "healthy" or "up".
6. Trade response includes computed fields: outcome, pnl, revengeFlag, createdAt, updatedAt.
7. Metrics revengeTrades is an integer COUNT, not an array of objects.
8. Metrics overtradingEvents is an integer COUNT, not an array.
9. Metrics timeseries array is REQUIRED in the response.
10. All 7 endpoints must exist: POST /trades, GET /trades/:id, GET /sessions/:id, POST /sessions/:id/debrief, GET /sessions/:id/coaching, GET /users/:id/metrics, GET /users/:id/profile.
11. POST /sessions/:id/debrief returns 201. POST /trades returns 200.
12. docker compose up must work with zero manual steps.

## Safety Rules — Preventing Regressions

### Before modifying any file:
- Check if there are existing tests that cover this file.
- If yes, run tests after modification to ensure no regression.
- If changing database schema, consider impact on seed data.

### Before creating new files:
- Check if a placeholder already exists in the skeleton.
- If yes, replace the placeholder content. Do NOT create a duplicate file.

### Database safety:
- Never DROP TABLE without IF EXISTS.
- Never DELETE seed data. It must persist for reviewer testing.
- Always use ON CONFLICT for upserts to prevent duplicate key errors.
- Migration files are numbered sequentially. Never skip or reorder.

### Docker safety:
- Pin image versions: node:20-alpine, postgres:16-alpine, redis:7-alpine.
- API container runs migrations + seed BEFORE starting the server.
- Worker container depends on API (API runs migrations first).
- Use healthchecks with retries on PG and Redis.
- Use npm ci --production in Dockerfile (not npm install).

### Redis safety:
- Always XACK after successful message processing.
- Never XACK on error (message stays in PEL for retry).
- Create consumer group with MKSTREAM option.
- AOF must be enabled (--appendonly yes).

## Response Format Rules

### Trade response (POST /trades, GET /trades/:id):
Must include ALL of: tradeId, userId, sessionId, asset, assetClass, direction,
entryPrice, exitPrice, quantity, entryAt, exitAt, status, outcome, pnl,
planAdherence, emotionalState, entryRationale, revengeFlag, createdAt, updatedAt.

### Session response (GET /sessions/:id):
Must include: sessionId, userId, date, notes, tradeCount, winRate, totalPnl, trades[].

### Metrics response (GET /users/:id/metrics):
Must include: userId, granularity, from, to, planAdherenceScore, sessionTiltIndex,
winRateByEmotionalState, revengeTrades (integer), overtradingEvents (integer), timeseries[].

### Health response (GET /health):
Must include exactly: status ("ok"|"degraded"), dbConnection ("connected"|"disconnected"),
queueLag (integer), timestamp (ISO-8601).

### Debrief response (POST /sessions/:id/debrief):
Must include: debriefId, sessionId, savedAt. Status code: 201.

## Task Tracking

After completing any task:
1. Update .planning/task.md: change [ ] to [x] for completed items.
2. If starting a task, mark it as [/].
3. Never skip updating the checklist.

## Anti-Patterns — Things to NEVER Do

- Never use console.log for logging (use pino).
- Never return 404 for cross-tenant access (always 403).
- Never use an ORM (Sequelize, Prisma, TypeORM, Knex query builder).
- Never compute metrics synchronously in POST /trades (use async Redis pipeline).
- Never run the worker in the same process as the API server.
- Never use SELECT * in queries.
- Never skip tenancy checks on any data endpoint.
- Never hardcode the JWT secret in source code.
- Never use string concatenation for SQL (always parameterized).
- Never deploy without running the full test suite first.

## File Organization

- Source code: src/
- SQL migrations: migrations/ (numbered 001, 002, etc.)
- Tests: tests/
- Load tests: loadtest/
- CLI scripts: scripts/
- Planning docs: .planning/ (read-only during development)
- Hackathon specs: given/ (read-only, never modify)
- Docker: Dockerfile + docker-compose.yml at root

## Dependency Whitelist

Only these npm packages should be used:
- express (HTTP framework)
- pg (PostgreSQL client)
- ioredis (Redis client)
- pino (structured JSON logger)
- pino-http (Express request logging middleware)
- dotenv (environment variables)
- Dev only: vitest OR node:test (testing), supertest (HTTP test client)

Do NOT add packages without explicit approval. No ORMs, no express-validator
(use manual validation), no jsonwebtoken (use custom crypto.createHmac).
