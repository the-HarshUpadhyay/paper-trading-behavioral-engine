# NevUp Track 1 — Bugfix Context

> **Purpose**: Exact code references and spec details for each bug. Read the section for the bug you're fixing, not the whole document.  
> **Source**: [definitive_audit.md](file:///C:/Users/harsh/.gemini/antigravity/brain/344eb425-05d5-470c-99c5-6f87e9f42e26/definitive_audit.md)

---

## Fix 1: `queueLag` Type Mismatch

### What's wrong
[src/routes/health.js](file:///c:/Users/harsh/paper-trading-behavioral-engine/src/routes/health.js) lines 53–61 use `XINFO GROUPS` to get queue lag. The ioredis response is a flat array and the code grabs `groups[0][7]` — which is a Redis stream ID string like `"0-0"`, not an integer.

### Spec requirement
`nevup_openapi.yaml` lines 656-657:
```yaml
queueLag:
  type: integer
  description: Message queue lag in milliseconds.
```

Health response example: `queueLag: 12`

### Fix approach
Replace `XINFO GROUPS` with `XPENDING`, which returns `[totalPending, minId, maxId, [[consumer, count]]]`. The first element (`totalPending`) is the integer count of unprocessed messages — a direct, reliable integer.

### Exact code change
Replace the try/catch block that computes `queueLag` (approximately lines 53–61) with:
```javascript
try {
  const pending = await r.xpending(config.stream.name, config.stream.group);
  queueLag = pending && pending[0] ? parseInt(pending[0], 10) : 0;
} catch {
  queueLag = 0; // stream or group doesn't exist yet
}
```

### Variable needed
`r` is the local Redis variable (check what variable name is used in the health route). `config.stream.name` = `'trade:closed'`, `config.stream.group` = `'metric-workers'`.

---

## Fix 2: Redis Publish Failure — Silent Data Loss

### What's wrong
[src/services/tradeService.js](file:///c:/Users/harsh/paper-trading-behavioral-engine/src/services/tradeService.js) lines 122–129:
```javascript
if (trade.status === 'closed') {
  try {
    await publishTradeClose(trade);
  } catch (err) {
    console.error('[tradeService] Failed to publish trade to stream:', err.message);
  }
}
```

If Redis is down, the trade is persisted (correct) but the metric pipeline never receives it (permanent data loss), and the error is logged to unstructured stderr.

### Fix approach
1. Retry once with 500ms delay (simple, no external deps)
2. On final failure, log with pino (structured JSON) including tradeId for traceability
3. Do NOT fail the request — trade is already in PG

### Exact code change
Replace lines 122–129 with:
```javascript
if (trade.status === 'closed') {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await publishTradeClose(trade);
      break;
    } catch (err) {
      if (attempt === 2) {
        logger.error({
          tradeId: trade.tradeId,
          userId: trade.userId,
          attempt,
          err: err.message,
        }, 'Failed to publish trade to stream after retries');
      } else {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
}
```

### Also add at top of file
```javascript
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
```

---

## Fix 3: `seed.js` Falsy Value Bug

### What's wrong
[src/seed.js](file:///c:/Users/harsh/paper-trading-behavioral-engine/src/seed.js) lines 77–82:
```javascript
trade.outcome || null,        // line 77
trade.pnl || null,            // line 78 ← BUG: pnl=0 becomes null
trade.planAdherence || null,  // line 79
trade.emotionalState || null, // line 80
trade.entryRationale || null, // line 81
trade.revengeFlag || false,   // line 82 ← BUG: false becomes false (ok), but 0 would become false
```

JavaScript `||` treats `0`, `""`, `false` as falsy. A breakeven trade with `pnl: 0` gets stored as `null`.

### Fix approach
Replace `||` with `??` (nullish coalescing). `??` only falls through on `null` or `undefined` — preserves `0`, `""`, and `false`.

### Exact code change
Lines 77–82:
```javascript
trade.outcome ?? null,
trade.pnl ?? null,
trade.planAdherence ?? null,
trade.emotionalState ?? null,
trade.entryRationale ?? null,
trade.revengeFlag ?? false,
```

### Requires re-seed
After this fix, you must nuke volumes and rebuild: `docker compose down -v && docker compose up --build`

---

## Fix 4: Overtrading TOCTOU Race

### What's wrong
[src/workers/overtradingDetector.js](file:///c:/Users/harsh/paper-trading-behavioral-engine/src/workers/overtradingDetector.js) lines 31–44 use check-then-insert:
```javascript
const existing = await pool.query(`SELECT event_id FROM overtrading_events WHERE user_id = $1 AND window_end = $2`);
if (existing.rows.length === 0) {
  await pool.query(`INSERT INTO overtrading_events ...`);
}
```

Two concurrent replays can both pass the SELECT and both INSERT → duplicate events. The `overtrading_events` table has no unique constraint on `(user_id, window_end)`.

### Fix approach
1. Add `UNIQUE(user_id, window_end)` constraint via new migration
2. Replace check-then-insert with single `INSERT ... ON CONFLICT DO NOTHING`

### Migration file
`migrations/005_overtrading_unique.sql`:
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_overtrading_user_window'
  ) THEN
    ALTER TABLE overtrading_events
      ADD CONSTRAINT uq_overtrading_user_window UNIQUE (user_id, window_end);
  END IF;
END $$;
```

### Worker code change
Replace lines 29–44 with:
```javascript
if (tradeCount > 10) {
  await pool.query(
    `INSERT INTO overtrading_events (user_id, window_start, window_end, trade_count, emitted_at)
     VALUES ($1, $2::timestamptz - INTERVAL '30 minutes', $2::timestamptz, $3, NOW())
     ON CONFLICT (user_id, window_end) DO NOTHING`,
    [trade.userId, trade.entryAt, tradeCount]
  );
}
```

---

## Fix 5: Structured API Logs for Plugins

### What's wrong
[src/plugins/database.js](file:///c:/Users/harsh/paper-trading-behavioral-engine/src/plugins/database.js) line 26 and [src/plugins/redis.js](file:///c:/Users/harsh/paper-trading-behavioral-engine/src/plugins/redis.js) line 25 use `console.error`. These run in the API process, so `docker compose logs api` shows unstructured lines among structured pino-http JSON.

### Fix approach
Add module-level pino logger to each plugin. Replace `console.error` with `logger.error`.

### database.js change
Add at top:
```javascript
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
```
Replace line 26:
```javascript
logger.error({ err: err.message }, 'Unexpected pool error');
```

### redis.js change
Add at top:
```javascript
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
```
Replace line 25:
```javascript
logger.error({ err: err.message }, 'Redis connection error');
```
