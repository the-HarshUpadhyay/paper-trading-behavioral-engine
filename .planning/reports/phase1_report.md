# Phase 1: Foundation — Report

> **Status**: ✅ COMPLETE  
> **Started**: 2026-04-25 18:42 IST  
> **Completed**: 2026-04-25 18:57 IST  
> **Duration**: ~15 minutes (code) + ~10 minutes (Docker pull/build)

---

## Objective

Set up the Docker stack, database schema, migration runner, and seed data loader. Goal: `docker compose up` produces 4 healthy containers with 388 trades and 52 sessions in PostgreSQL.

---

## What Was Built

| File | Lines | Purpose |
|---|---|---|
| `package.json` | 32 | 6 prod deps, 1 dev dep, npm scripts |
| `.env.example` | 12 | All 6 environment variables documented |
| `src/config.js` | 37 | Centralized env access, pool sizing (max 20), stream config |
| `migrations/001_create_trades.sql` | 31 | 21 columns, 5 indexes, CHECK constraints |
| `migrations/002_create_sessions.sql` | 12 | Sessions table + user_id index |
| `migrations/003_create_debriefs.sql` | 14 | Debriefs with FK + mood/rating constraints |
| `migrations/004_create_metrics.sql` | 53 | All 5 metric tables |
| `src/migrate.js` | 44 | Sequential SQL runner, exit(1) on failure |
| `src/seed.js` | 89 | JSON loader, transactional, idempotent (ON CONFLICT) |
| `src/server.js` | 24 | Minimal Express stub (expanded in Phase 2) |
| `src/workers/index.js` | 27 | Minimal worker stub (expanded in Phase 4) |
| `Dockerfile` | 16 | Node 20 Alpine, migrate→seed→server CMD |
| `docker-compose.yml` | 62 | 4 services with healthchecks + volumes |
| `.dockerignore` | 8 | Excludes node_modules, tests, planning docs |
| `.gitignore` | 5 | Excludes node_modules, .env, logs |

---

## Design Decisions Made

1. **No `uuid` package** — Node 20 has `crypto.randomUUID()` built-in, saves a dependency.
2. **`npm ci --production || npm install --production`** — Dockerfile falls back to `npm install` when no lock file exists yet.
3. **Pool max = 20** — Sized for the 200 VU load test in Phase 7 (1 connection per ~10 VUs with pipelining).
4. **Seed idempotency** — Checks `SELECT COUNT(*) FROM trades` before seeding; ON CONFLICT DO NOTHING on every insert. Safe to restart containers repeatedly.
5. **Worker stub** — Uses `setInterval(noop, 30000)` to keep process alive. Handles SIGTERM/SIGINT gracefully.

---

## Issues Encountered

### Docker Image Pull Failures
- **Problem**: `postgres:16-alpine` has a ~100MB layer (`0d3e610f9e0f`) that kept failing with `short read: unexpected EOF`.
- **Root cause**: Unstable network dropping large downloads.
- **Resolution**: Retried `docker pull postgres:16-alpine` — succeeded on 3rd attempt.
- **Time lost**: ~5 minutes of retries.

### docker-compose.yml `version` Warning
- **Problem**: Docker Compose V2 warned: `the attribute 'version' is obsolete`.
- **Resolution**: Removed `version: "3.8"` from the file.

### PowerShell Exit Code
- **Problem**: `docker compose up --build -d` reported exit code 1 in PowerShell even though all containers started successfully.
- **Root cause**: PowerShell treats Docker's stderr progress output as an error.
- **Resolution**: Ignored — verified container state via `docker compose ps` instead.

---

## Gate Check Results

| Check | Expected | Actual | Status |
|---|---|---|---|
| Container: postgres | healthy | `Up (healthy)` on :5432 | ✅ |
| Container: redis | healthy | `Up (healthy)` on :6379 | ✅ |
| Container: api | running | `Up` on :3000 | ✅ |
| Container: worker | running | `Up` on :3000 (internal) | ✅ |
| Migrations | 4 files | All 4 ran successfully | ✅ |
| Trades count | 388 | 388 | ✅ |
| Sessions count | 52 | 52 | ✅ |
| `GET /health` | `{"status":"ok"}` | `{"status":"ok","dbConnection":"connected","queueLag":0}` | ✅ |

---

## Lessons for Next Phase

- Docker rebuilds are fast (~10s) after initial image pull — don't hesitate to rebuild often.
- The `docker compose logs api --no-log-prefix` command is the fastest way to debug startup issues.
- Seed idempotency works perfectly — container restarts don't duplicate data.
