# Fix 4: Overtrading Detector TOCTOU Race — Report

> **Status**: ✅ COMPLETE
> **Tier**: 2 (High Value)
> **Commit**: `a6fbdad`

## Bug Summary
| Field | Value |
|---|---|
| **Severity** | 🟠 |
| **Files** | src/workers/overtradingDetector.js, migrations/005_overtrading_unique.sql |
| **Lines Changed** | 29–44 (worker), 1–11 (migration) |
| **Root Cause** | TOCTOU race: check-then-insert allows duplicate events under concurrency |
| **Spec Requirement** | Accurate overtrading event count in metrics pipeline |

## What Was Wrong
```javascript
const existing = await pool.query(
  `SELECT event_id FROM overtrading_events WHERE user_id = $1 AND window_end = $2`
);
if (existing.rows.length === 0) {
  await pool.query(`INSERT INTO overtrading_events ...`);
}
```

## What Was Fixed
1. New migration `005_overtrading_unique.sql` — adds `UNIQUE(user_id, window_end)` constraint
2. Replaced check-then-insert with atomic `INSERT ... ON CONFLICT (user_id, window_end) DO NOTHING`

## Verification
| Test | Expected | Actual | Status |
|---|---|---|---|
| `\d overtrading_events` | shows UNIQUE constraint | `uq_overtrading_user_window` present | ✅ |
| `npm test` | 34/34 pass | 34/34 pass | ✅ |

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Migration on existing data | Idempotent `DO $$ IF NOT EXISTS` block |
| Concurrent inserts | `ON CONFLICT DO NOTHING` — atomically safe |
