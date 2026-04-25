# Fix 7: entryRationale empty string destroyed — Report

> **Status**: ✅ COMPLETE
> **Started**: 2026-04-26T02:07:05+05:30
> **Completed**: 2026-04-26T02:07:59+05:30
> **Duration**: <1 min

## Bug Summary
| Field | Value |
|---|---|
| **Severity** | 🟠 |
| **File** | src/services/tradeService.js |
| **Lines Changed** | 109, 113, 114, 115 |
| **Root Cause** | `||` treats `""` as falsy, coercing `entryRationale: ""` to `null` |
| **Spec Requirement** | OpenAPI `entryRationale: type: string, maxLength: 500, nullable: true` — `""` is valid |

## What Was Wrong
```javascript
input.exitAt || null,          // line 109
input.planAdherence || null,   // line 113
input.emotionalState || null,  // line 114
input.entryRationale || null,  // line 115 ← "" becomes null
```

## What Was Fixed
```javascript
input.exitAt ?? null,          // line 109
input.planAdherence ?? null,   // line 113
input.emotionalState ?? null,  // line 114
input.entryRationale ?? null,  // line 115
```

## Verification
| Test | Expected | Actual | Status |
|---|---|---|---|
| `npm test` | 34/34 pass | 34/34 pass | ✅ |
| entryRationale="" | stored as "" | `??` preserves "" | ✅ |
| null inputs | stored as null | unchanged behavior | ✅ |

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Lines 109, 113, 114 are safe today | `??` is identical to `||` for their value domains (ISO strings, 1-5 ints, enum strings) — zero behavioral change |
| Consistency | Matches Fix 3 (seed.js) and Fix 6 (exitPrice) pattern |
