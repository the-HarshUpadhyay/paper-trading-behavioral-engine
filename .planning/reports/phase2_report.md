# Phase 2: Auth + Core Middleware — Report

> **Status**: ✅ COMPLETE  
> **Started**: 2026-04-25 19:02 IST  
> **Completed**: 2026-04-25 19:12 IST  
> **Duration**: ~10 minutes

---

## Objective

Implement JWT HS256 verification, tenancy enforcement, traceId generation, structured logging, and the full Express middleware chain. Goal: all auth scenarios return correct status codes with spec-compliant error bodies.

---

## What Was Built

| File | Lines | Purpose |
|---|---|---|
| `src/utils/jwt.js` | 122 | Custom HS256 sign/verify using `crypto.createHmac` |
| `src/utils/errors.js` | 62 | Error factory producing `{ error, message, traceId }` |
| `src/middleware/traceId.js` | 17 | `crypto.randomUUID()` per request |
| `src/middleware/auth.js` | 61 | JWT extraction, verification, `/health` skip |
| `src/middleware/tenancy.js` | 46 | `enforcePathTenancy()` + `checkResourceTenancy()` |
| `src/middleware/errorHandler.js` | 36 | Global catch-all with pino logging |
| `src/server.js` | 90 | Full middleware chain + route mounting scaffold |
| `src/routes/health.js` | 68 | Live PG/Redis health check with queue lag |
| `scripts/generate-token.js` | 43 | CLI tool listing all 10 seed user IDs |

---

## Design Decisions Made

1. **No `jsonwebtoken` package** — Built custom sign/verify with `crypto.createHmac('sha256', secret)` per the hackathon's JWT format spec. Zero external JWT dependencies.

2. **Two tenancy helpers** — 
   - `enforcePathTenancy('userId')` — Express middleware for `/users/:userId/*` routes. Reads from `req.params`.
   - `checkResourceTenancy(resource, userId, traceId)` — Returns null or error object. Used in handlers after DB fetch (e.g., GET /trades/:id where the userId isn't in the URL).

3. **Middleware chain order** — `traceId → pino-http → json → auth → routes → 404 → errorHandler`. TraceId goes first so pino-http can include it in logs.

4. **Health endpoint owns its own connections** — Lazy-initializes separate `pg.Pool` and `ioredis` instances so it doesn't depend on plugins that aren't wired yet. Will refactor to shared pool in Phase 3.

5. **Auth skips /health by path check** — The auth middleware checks `req.path === '/health'` internally rather than using separate route stacks. Simpler than conditional middleware mounting.

---

## Implementation Notes

### JWT Validation Order
```
1. Check token exists and is a string
2. Split into 3 parts (header.payload.signature)
3. Verify HMAC-SHA256 signature
4. Decode and validate header (alg must be HS256)
5. Decode payload
6. Check required claims: sub, iat, exp, role
7. Check expiry: exp < now → reject (0s clock skew)
```

### Error Response Consistency
Every error in the system — auth failures, tenancy violations, validation errors, 404s, 500s — produces the **exact same shape**:
```json
{"error": "ERROR_CODE", "message": "Human-readable.", "traceId": "uuid"}
```
This is enforced by:
- `errors.js` factory functions for deliberate errors
- `errorHandler.js` catch-all for unexpected errors
- 404 catch-all route in `server.js`

### Token Generator Usability
The `scripts/generate-token.js` prints all 10 seed user IDs with trader names and behavioral pathologies when run without args. This makes manual testing faster — no need to look up UUIDs.

---

## Issues Encountered

**None.** Phase 2 had zero issues. All code worked on first deploy.

---

## Gate Check Results

| Test | Method | Expected | Actual | Status |
|---|---|---|---|---|
| Health (no auth) | `GET /health` | 200 | 200 `{"status":"ok","dbConnection":"connected","queueLag":0}` | ✅ |
| No token | `GET /trades/123` | 401 | 401 `{"error":"UNAUTHORIZED","message":"Missing Authorization header."}` | ✅ |
| Expired token | `GET /trades/123` | 401 | 401 `{"error":"TOKEN_EXPIRED","message":"Token has expired."}` | ✅ |
| Garbage token | `Bearer not.a.real.token` | 401 | 401 `{"error":"UNAUTHORIZED","message":"Invalid signature"}` | ✅ |
| Valid token | `Bearer <valid>` | Auth passes | 404 (route not mounted — correct) | ✅ |
| Error body shape | All errors | `{ error, message, traceId }` | Exact match on all 4 error cases | ✅ |

---

## Structured Logging Verification

Server startup log (pino JSON):
```json
{"level":30,"time":1777124149646,"pid":1,"hostname":"0f49c0553304","port":3000,"env":"production","msg":"API server started"}
```
Confirms pino is active with structured JSON output including PID and hostname.

---

## Metrics

| Metric | Value |
|---|---|
| Files created | 9 |
| Total lines of code | ~545 |
| Dependencies added | 0 (all from Phase 1) |
| Docker rebuilds | 1 |
| Issues encountered | 0 |
| Time to gate check pass | ~10 minutes |

---

## Readiness for Phase 3

Phase 2 laid the foundation for all route handlers:
- ✅ Auth middleware extracts `req.userId` on every authenticated request
- ✅ `enforcePathTenancy()` ready for `/users/:userId/*` routes
- ✅ `checkResourceTenancy()` ready for post-fetch ownership checks
- ✅ `errors.forbidden()` returns 403 (never 404) for cross-tenant access
- ✅ Error handler catches any unhandled throws
- ✅ traceId flows from request → log → error response

Phase 3 needs: `database.js` pool, `redis.js` client, `tradeService.js`, `publisher.js`, `trades.js` routes.
