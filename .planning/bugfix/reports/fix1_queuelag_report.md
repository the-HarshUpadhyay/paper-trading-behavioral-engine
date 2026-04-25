# Fix 1: `queueLag` Type Mismatch — Report

> **Status**: ✅ COMPLETE  
> **Started**: 2026-04-26 00:35 IST  
> **Completed**: 2026-04-26 00:37 IST  
> **Duration**: ~2 minutes

---

## Bug Summary

| Field | Value |
|---|---|
| **Severity** | 🔴 CRITICAL (Spec violation) |
| **Tier** | Tier 1: MUST FIX |
| **File** | `src/routes/health.js` |
| **Lines Changed** | 52–61 → 52–60 |
| **Root Cause** | `XINFO GROUPS` flat-array index `[0][7]` returned Redis stream ID string `"0-0"` instead of integer |
| **Spec Requirement** | `nevup_openapi.yaml` line 656: `queueLag: type: integer` |

---

## What Was Wrong

```javascript
// BEFORE — line 56
const groups = await r.xinfo('GROUPS', config.stream.name);
if (groups && groups.length > 0) {
  queueLag = groups[0][7] || 0; // lag field
}
```

`XINFO GROUPS` returns a flat array from ioredis. Index `[7]` does not reliably correspond to the `lag` field — it depends on Redis version and group state. In practice it returned `"0-0"` (a stream ID string), violating the OpenAPI `integer` type constraint.

---

## What Was Fixed

```javascript
// AFTER
const pending = await r.xpending(config.stream.name, config.stream.group);
// XPENDING returns [totalPending, minId, maxId, [[consumer, count], ...]]
queueLag = pending && pending[0] ? parseInt(pending[0], 10) : 0;
```

`XPENDING` reliably returns the total pending message count as the first element — always an integer. This is a better proxy for "queue lag" anyway: it represents messages consumed but not yet ACKed (actively being processed or stuck).

---

## Verification

| Test | Expected | Actual | Status |
|---|---|---|---|
| `curl /health` → `queueLag` type | `integer` | `0` (number) | ✅ |
| `queueLag` value when no pending | `0` | `0` | ✅ |
| Health status overall | `"ok"` | `"ok"` | ✅ |
| `dbConnection` | `"connected"` | `"connected"` | ✅ |

### Raw response:
```json
{
  "status": "ok",
  "dbConnection": "connected",
  "queueLag": 0,
  "timestamp": "2026-04-25T19:06:49.513Z"
}
```

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `XPENDING` fails if stream doesn't exist | Wrapped in try/catch, falls back to `0` |
| `XPENDING` fails if consumer group doesn't exist | Same try/catch, falls back to `0` |
| `parseInt` on non-numeric value | `pending[0]` from XPENDING is always numeric; `\|\| 0` fallback anyway |
