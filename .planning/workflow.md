# NevUp Track 1 — Development Workflow

> **How we build**: This document defines the exact workflow for every development session. Follow it strictly to avoid regressions, missed specs, and wasted time.

---

## Session Startup Protocol

Every time we start a new coding session, do this FIRST:

```
1. READ  .planning/task.md          → What's done? What's next?
2. READ  .planning/rules.md         → Refresh constraints
3. READ  .planning/context.md       → Only the section relevant to current phase
4. CHECK docker compose ps          → Are containers running?
5. CHECK last git log               → What was the last commit?
```

**Never start coding without knowing what phase you're in.**

---

## Phase Execution Workflow

### Step 1: Identify Current Phase

Check `task.md` for the first uncompleted `[ ]` item. That's where we start.

### Step 2: Implement (Build Loop)

For each file in the current phase:

```
┌─────────────────────────────────────┐
│  1. Read the placeholder file       │
│  2. Read context.md for spec        │
│  3. Write implementation            │
│  4. Smoke test (curl / manual)      │
│  5. Update task.md: [ ] → [x]       │
│  6. Move to next file               │
└─────────────────────────────────────┘
```

### Step 3: Phase Gate (Verify Before Moving On)

Before starting the next phase, run ALL phase gate checks:

| Phase | Gate Check |
|---|---|
| Phase 1: Foundation | `docker compose up` → all 4 containers healthy, 388 trades in DB |
| Phase 2: Auth | curl with no token → 401, expired → 401, valid → passes |
| Phase 3: Write API | POST trade → 200, POST duplicate → 200 same body, wrong user → 403 |
| Phase 4: Pipeline | POST closed trade → worker logs metric computation → DB has metrics |
| Phase 5: Read API | All 7 endpoints return spec-compliant JSON |
| Phase 6: Testing | `npm test` → all green |
| Phase 7: Load Test | k6 report → p95 ≤ 150ms, error rate < 1% |
| Phase 8: Deploy | Live URL returns health check |

**Do NOT skip gate checks. A broken Phase 1 cascades into broken everything.**

### Step 4: Commit & Push

**MANDATORY after every phase gate check passes.** Never leave work uncommitted.

```bash
git add -A
git commit -m "feat(phaseN): <short description>

<bullet list of what was built>
<gate check results>"
git push origin main
```

**Commit message convention:**
```
feat(phase1): foundation — Docker stack, migrations, seed data
feat(phase2): auth + middleware — JWT, tenancy, error handling
feat(phase3): write API — POST/GET trades, idempotency, Redis publisher
feat(phase4): async pipeline — 5 metric workers, XREADGROUP consumer
feat(phase5): read API — sessions, debriefs, coaching SSE, metrics, profile
feat(phase6): testing — unit + integration tests
feat(phase7): load testing — k6 200VU, p95 verification
feat(phase8): deploy + polish — README, DECISIONS.md, live URL
```

> ⚠️ **Rule**: If you forget to commit after a phase, commit before starting the next one. Never have 2+ phases in a single commit (unless catching up).

---

## File Implementation Order (Within Each Phase)

### Phase 1: Foundation
```
1. package.json          → dependencies locked
2. .env.example          → env vars documented
3. src/config.js         → reads env vars
4. migrations/001-004    → all SQL schema
5. src/migrate.js        → runs migrations
6. src/seed.js           → loads JSON data
7. Dockerfile            → builds container
8. docker-compose.yml    → orchestrates stack
── GATE: docker compose up → healthy ──
```

### Phase 2: Auth + Middleware
```
1. src/utils/jwt.js          → sign/verify primitives
2. src/utils/errors.js       → error factory
3. src/middleware/traceId.js  → UUID per request
4. src/middleware/auth.js     → JWT verification
5. src/middleware/tenancy.js  → ownership check helper  
6. src/middleware/errorHandler.js → catch-all
7. src/server.js             → Express bootstrap + middleware chain
8. scripts/generate-token.js → test token CLI
── GATE: auth works via curl ──
```

### Phase 3: Write API
```
1. src/plugins/database.js       → pg.Pool
2. src/plugins/redis.js          → ioredis client
3. src/services/publisher.js     → XADD helper
4. src/services/tradeService.js  → insert + get logic
5. src/routes/trades.js          → POST + GET routes
── GATE: idempotency + tenancy verified ──
```

### Phase 4: Async Pipeline
```
1. src/workers/planAdherence.js      → metric 1
2. src/workers/revengeFlag.js        → metric 2
3. src/workers/sessionTilt.js        → metric 3
4. src/workers/winRateByEmotion.js   → metric 4
5. src/workers/overtradingDetector.js → metric 5
6. src/workers/index.js              → consumer group loop
── GATE: POST trade → metrics appear in DB ──
```

### Phase 5: Read API
```
1. src/services/sessionService.js  → session + debrief logic
2. src/services/metricsService.js  → aggregation + timeseries
3. src/routes/sessions.js          → 3 endpoints
4. src/routes/users.js             → 2 endpoints
5. src/routes/health.js            → health check
── GATE: all 7 endpoints return spec-compliant responses ──
```

### Phase 6–8: Testing, Load Testing, Polish
```
Follow task.md checklist items in order.
```

---

## Error Recovery Procedures

### Container won't start
```bash
docker compose down -v          # nuke volumes
docker compose build --no-cache # rebuild from scratch
docker compose up               # fresh start
```

### Migration fails
```bash
# Check which migration failed
docker compose logs api | grep -i error
# Fix the SQL file
# Then: docker compose down -v && docker compose up --build
```

### Seed data wrong count
```bash
# Connect to DB directly
docker compose exec postgres psql -U nevup -d nevup
SELECT COUNT(*) FROM trades;    -- should be 388
SELECT COUNT(*) FROM sessions;  -- should be 52
```

### Worker not processing
```bash
# Check if stream exists
docker compose exec redis redis-cli XINFO STREAM trade:closed
# Check consumer group
docker compose exec redis redis-cli XINFO GROUPS trade:closed
# Check pending messages
docker compose exec redis redis-cli XPENDING trade:closed metric-workers
```

### Tests failing
```bash
# Run single test for debugging
npm test -- tests/trades.test.js
# Check if DB has seed data
docker compose exec postgres psql -U nevup -d nevup -c "SELECT COUNT(*) FROM trades"
```

---

## Communication Protocol

When asking the AI to work on something, use this format:

```
Phase: [1-8]
Task: [specific task from task.md]
Context: [any additional info]
```

Example:
```
Phase: 3
Task: Implement src/services/tradeService.js
Context: POST /trades must be idempotent. See context.md § 1.1
```

This ensures the AI reads the right context and follows the right rules.

---

## Time Tracking

Update this table as you complete phases:

| Phase | Planned | Actual | Duration | Commit |
|---|---|---|---|---|
| 1. Foundation | 4h | 18:42–18:57 IST | ~25 min | f4a816d |
| 2. Auth | 4h | 19:02–19:12 IST | ~10 min | f4a816d |
| 3. Write API | 6h | 19:23–19:27 IST | ~4 min | f4a816d |
| 4. Pipeline | 8h | 19:31–19:35 IST | ~4 min | f4a816d |
| 5. Read API | 8h | 19:36–19:40 IST | ~4 min | f4a816d |
| 6. Testing | 10h | — | — | — |
| 7. Load Test | 8h | — | — | — |
| 8. Deploy | 12h | — | — | — |
| **Total** | **60h** | | **~47 min so far** | |
