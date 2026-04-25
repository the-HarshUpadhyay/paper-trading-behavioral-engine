# NevUp Hackathon 2026 — JWT Format Specification

## Overview

All three tracks share a single JWT-based authentication scheme. This document defines
the canonical token structure every track must implement and validate identically.

---

## Token Structure

JWTs are signed using **HS256** (HMAC-SHA256). All three tracks use the same signing secret,
shared in the kick-off email alongside this document.

### Header

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

### Payload (Claims)

```json
{
  "sub":   "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "iat":   1736150400,
  "exp":   1736236800,
  "role":  "trader",
  "name":  "Alex Mercer"
}
```

| Claim  | Type    | Required | Description |
|--------|---------|----------|-------------|
| `sub`  | string (UUIDv4) | ✅ Yes | The authenticated user's `userId`. Must match the `userId` in all data operations. This is the tenancy enforcement key. |
| `iat`  | integer (Unix timestamp) | ✅ Yes | Issued-at time (UTC). |
| `exp`  | integer (Unix timestamp) | ✅ Yes | Expiry time (UTC). Tokens expire after **24 hours**. |
| `role` | string  | ✅ Yes | Always `"trader"` for hackathon participants. Reserved for future roles. |
| `name` | string  | ❌ Optional | Human-readable display name. Not used for auth decisions. |

---

## Token Lifetime

| Property       | Value        |
|----------------|--------------|
| Algorithm      | HS256        |
| Expiry         | 24 hours     |
| Renewal        | Re-issue on login — no refresh tokens required for hackathon scope |
| Clock skew     | 0 seconds tolerance — use UTC strictly |

---

## Row-Level Tenancy Rule

This is the **single most important auth rule** across all tracks:

> **The `sub` claim (userId) in the JWT must exactly match the `userId` in the data
> being accessed. Any mismatch must return HTTP 403 — never 404.**

### Implementation requirement (Track 1)

```
if (jwt.sub !== requestedUserId) {
  return HTTP 403 { error: "FORBIDDEN", message: "Cross-tenant access denied." }
}
```

Every endpoint that takes a `userId` path parameter must enforce this. Reviewers will
run an automated test that:
1. Issues a JWT for User A
2. Makes a request for User B's data using User A's token
3. Expects HTTP 403

Returning 404 or 200 instead of 403 is an automatic point deduction.

---

## Generating a Test Token (for development)

Use this Node.js snippet to mint tokens during development:

```javascript
const crypto = require('crypto');

const SIGNING_SECRET = '97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02';

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJWT(payload) {
  const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = base64url(JSON.stringify(payload));
  const sigData = `${header}.${body}`;
  const sig     = crypto.createHmac('sha256', SIGNING_SECRET)
                        .update(sigData).digest('base64')
                        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${sigData}.${sig}`;
}

// Example — mint a 24-hour token for userId from seed dataset
const now = Math.floor(Date.now() / 1000);
const token = signJWT({
  sub:  'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // replace with actual userId from seed data
  iat:  now,
  exp:  now + 86400,
  role: 'trader',
  name: 'Alex Mercer',
});

console.log(token);
```

Or use **jwt.io** (free, browser-based) with the same secret to inspect and generate tokens manually.

---

## Sending the Token

Include the token in the `Authorization` header on every request:

```
Authorization: Bearer <token>
```

Example curl:

```bash
curl -H "Authorization: Bearer eyJhbGci..." \
     http://localhost:4010/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890/metrics?from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&granularity=daily
```

---

## Validation Checklist (all tracks must implement)

- [ ] Verify signature using HS256 + shared secret
- [ ] Reject tokens where `exp` is in the past → HTTP 401
- [ ] Reject requests with no `Authorization` header → HTTP 401
- [ ] Reject malformed tokens (bad base64, missing claims) → HTTP 401
- [ ] Enforce `sub === userId` for every data endpoint → HTTP 403 on mismatch
- [ ] Include `traceId` in all 401/403 error responses (from structured log)

---

## Structured Log Fields (reminder)

Every request must emit a structured JSON log with:

```json
{
  "traceId":    "uuid-per-request",
  "userId":     "from jwt.sub",
  "latency":    142,
  "statusCode": 200
}
```

The `traceId` from the log must match the `traceId` returned in error response bodies,
enabling end-to-end request tracing.
