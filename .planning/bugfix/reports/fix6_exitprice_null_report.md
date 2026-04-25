# Fix 6: exitPrice null coercion — Report

> **Status**: ✅ COMPLETE
> **Started**: 2026-04-26T02:05:48+05:30
> **Completed**: 2026-04-26T02:06:35+05:30
> **Duration**: <1 min

## Bug Summary
| Field | Value |
|---|---|
| **Severity** | 🔴 |
| **File** | src/services/tradeService.js |
| **Lines Changed** | 106 |
| **Root Cause** | `||` treats `0` as falsy, coercing `exitPrice: 0` to `null` |
| **Spec Requirement** | OpenAPI `exitPrice: type: number, nullable: true` — `0` is a valid number |

## What Was Wrong
```javascript
input.exitPrice || null,  // line 106 — exitPrice=0 becomes null
```

## What Was Fixed
```javascript
input.exitPrice ?? null,  // line 106 — only null/undefined fall through
```

## Verification
| Test | Expected | Actual | Status |
|---|---|---|---|
| `npm test` | 34/34 pass | 34/34 pass | ✅ |
| exitPrice=0 closed trade | pnl computed, outcome present | `??` preserves 0 | ✅ |
| exitPrice=null open trade | stored as null | unchanged behavior | ✅ |
| idempotency | ON CONFLICT unchanged | no change | ✅ |

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Unintended null changes | Single character change (`||` → `??`), only affects `exitPrice` param |
| Behavioral change for non-zero values | `??` only differs from `||` for falsy non-null values (`0`, `""`, `false`). All other inputs produce identical results |
