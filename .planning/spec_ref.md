# spec_reference.md
NevUp Hiring Hackathon 2026 — Enforced Specification Reference

This document is the authoritative implementation contract for this repository.
All code, architecture, and decisions MUST comply.

Source: Hackathon Packet :contentReference[oaicite:0]{index=0}

---

# 1. GLOBAL INVARIANTS (HARD FAIL CONDITIONS)

The following violations result in immediate rejection:

- Any hardcoded or mock data in runtime flows
- Missing dockerized execution (`docker compose up` must work without manual steps)
- Missing DECISIONS.md (must explain WHY, not WHAT)
- Unhandled errors (timeouts, retries, fallbacks REQUIRED)
- HTTP 500 responses with empty body
- Cross-tenant data leakage (must return 403)
- Blocking analytics inside write path
- Non-idempotent write API

---

# 2. SYSTEM ARCHITECTURE (MANDATORY MODEL)

Correct architecture:

WRITE PATH → MESSAGE QUEUE → ASYNC ANALYTICS → READ API

Forbidden architecture:

WRITE → COMPUTE METRICS → RESPOND

All behavioral metrics MUST be computed asynchronously.

---

# 3. SHARED DATA CONTRACT (STRICT)

The following schema is NON-NEGOTIABLE.

Trade {
  tradeId: UUIDv4
  userId: UUIDv4

  asset: string
  assetClass: "equity" | "crypto" | "forex"
  direction: "long" | "short"

  entryPrice: decimal(18,8)
  exitPrice: decimal(18,8) | null
  quantity: decimal(18,8)

  entryAt: ISO-8601 UTC
  exitAt: ISO-8601 UTC | null

  status: "open" | "closed" | "cancelled"

  planAdherence: 1–5 | null
  emotionalState: "calm" | "anxious" | "greedy" | "fearful" | "neutral" | null

  entryRationale: string ≤ 500 | null
  sessionId: UUIDv4
}

Violations:
- Renaming fields → FAIL
- Changing enums → FAIL
- Changing types → FAIL

---

# 4. SEED DATA REQUIREMENTS

Mandatory files:

- nevup_seed_dataset.csv
- nevup_seed_dataset.json
- nevup_openapi.yaml

Rules:

- Data must be loaded at startup
- No runtime-generated fake data
- System must work immediately after container start

---

# 5. BEHAVIORAL METRICS (DETERMINISTIC)

All implementations MUST produce identical outputs.

5.1 Plan Adherence Score  
Rolling average of last 10 trades per user

5.2 Revenge Trade Flag  
Condition:
- Trade opens within 90 seconds of a losing close
- emotionalState ∈ { anxious, fearful }

5.3 Session Tilt Index  
loss_following_trades / total_trades_in_session

5.4 Win Rate by Emotional State  
Maintain running win/loss counts per emotionalState

5.5 Overtrading Detector  
Trigger if:
> 10 trades in 30-minute sliding window

Constraint:
- MUST emit event asynchronously
- MUST NOT block write path

---

# 6. WRITE API (CRITICAL REQUIREMENTS)

Endpoint:
POST /trades

Requirements:

- MUST be idempotent on tradeId
- Duplicate request → return HTTP 200 with existing record
- NEVER return 409 or 500 for duplicates

---

# 7. PERFORMANCE REQUIREMENTS

System MUST satisfy:

- 200 concurrent trade-close events/sec
- Sustained for 60 seconds
- Write latency ≤ 150ms (p95)
- Read latency ≤ 200ms (p95)

Proof required:
- Load testing script (k6 or Locust)
- HTML results report

---

# 8. ASYNC PROCESSING (MANDATORY)

Allowed:
- Kafka
- RabbitMQ
- Redis Streams

Forbidden:
- HTTP polling
- Synchronous metric computation

---

# 9. READ API

Endpoint:
GET /users/:id/metrics?from=&to=&granularity=

Requirements:
- Must support filtering
- Must meet latency targets
- Must operate on precomputed analytics

---

# 10. AUTHENTICATION (STRICT JWT CONTRACT)

10.1 Configuration

- Algorithm: HS256
- Expiry: 24 hours
- Shared secret must match across all services

10.2 Payload

{
  "sub": "userId",
  "iat": <timestamp>,
  "exp": <timestamp>,
  "role": "trader",
  "name": "optional"
}

10.3 Validation Rules

Reject with 401:
- Missing token
- Invalid signature
- Expired token
- Malformed token

Reject with 403:
- userId mismatch

---

# 11. TENANCY ENFORCEMENT (CRITICAL)

Rule:

if (jwt.sub !== requestedUserId) {
  return 403;
}

Constraints:

- NEVER return 404
- NEVER allow access
- MUST be enforced on EVERY endpoint

---

# 12. OBSERVABILITY (REQUIRED)

All requests MUST log:

{
  "traceId": "uuid",
  "userId": "jwt.sub",
  "latency": number,
  "statusCode": number
}

Requirements:

- traceId MUST propagate through system
- traceId MUST appear in error responses

---

# 13. MOCK API (CONTRACT TESTING)

Command:

npx @stoplight/prism-cli mock nevup_openapi.yaml --port 4010

Rules:

- Track 3 MUST consume this
- Do NOT invent endpoints
- OpenAPI spec is source of truth

---

# 14. CONTAINERIZATION

Hard requirements:

- docker-compose.yml required
- Single command boot:
  docker compose up
- No manual setup steps
- No hidden dependencies

---

# 15. SUBMISSION REQUIREMENTS

Repository MUST include:

- Live deployment URL
- Public GitHub repo
- OpenAPI spec
- Load test script + report
- DECISIONS.md
- docker-compose.yml

---

# 16. CODE QUALITY RULES

Forbidden:

- console.log usage
- hidden N+1 queries
- tight coupling
- business logic inside controllers

Required:

- structured logging
- separation of concerns
- explicit error handling
- test coverage for critical paths

---

# 17. MENTAL MODEL

System is NOT a CRUD app.

System IS:
A behavioral analytics pipeline with strict contracts.

---

# END OF SPEC