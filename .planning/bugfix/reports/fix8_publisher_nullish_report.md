# Fix 8: Publisher nullish consistency — Report

> **Status**: ✅ COMPLETE
> **Started**: 2026-04-26T02:08:28+05:30
> **Completed**: 2026-04-26T02:09:33+05:30
> **Duration**: ~1 min

## Bug Summary
| Field | Value |
|---|---|
| **Severity** | 🟠 |
| **File** | src/services/publisher.js |
| **Lines Changed** | 58, 59, 60, 61 |
| **Root Cause** | `||` on XADD fields — fragile for `pnl=0` edge case |
| **Spec Requirement** | Consistency with seed.js (Fix 3) and tradeService.js (Fix 6, 7) |

## What Was Wrong
```javascript
'outcome', trade.outcome || '',
'pnl', String(trade.pnl || 0),
'planAdherence', String(trade.planAdherence || ''),
'emotionalState', trade.emotionalState || '',
```

## What Was Fixed
```javascript
'outcome', trade.outcome ?? '',
'pnl', String(trade.pnl ?? 0),
'planAdherence', String(trade.planAdherence ?? ''),
'emotionalState', trade.emotionalState ?? '',
```

## Verification
| Test | Expected | Actual | Status |
|---|---|---|---|
| `npm test` | 34/34 pass | 34/34 pass | ✅ |
| Integration: trade→metrics flow | passes | passes | ✅ |

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Publisher only called for closed trades | No active data loss before fix — this is defensive hardening |
| pnl=0 edge case | `0 ?? 0` → `0`, same as `0 || 0` → `0` — identical output today |
