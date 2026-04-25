# Phase 4: Async Pipeline — Report

> **Status**: ✅ COMPLETE  
> **Started**: 2026-04-25 19:31 IST  
> **Completed**: 2026-04-25 19:35 IST  
> **Duration**: ~4 minutes

---

## Objective

Build the Redis Streams consumer loop and all 5 behavioral metric workers. Goal: POST a closed trade → worker consumes the message → metrics appear in the database automatically.

---

## What Was Built

| File | Lines | Purpose |
|---|---|---|
| `src/workers/index.js` | 170 | Consumer group loop: XREADGROUP + XACK + PEL recovery |
| `src/workers/planAdherence.js` | 47 | Rolling 10-trade average of planAdherence |
| `src/workers/revengeFlag.js` | 66 | 90s window + anxious/fearful detection |
| `src/workers/sessionTilt.js` | 68 | Loss-following ratio per session |
| `src/workers/winRateByEmotion.js` | 40 | Atomic UPSERT win/loss counters per emotion |
| `src/workers/overtradingDetector.js` | 49 | >10 trades in 30min burst detection |

---

## Architecture

```
POST /trades (status: closed)
  → tradeService.createTrade()
    → INSERT into trades table
    → publisher.publishTradeClose()
      → XADD trade:closed {16 fields}
        → Worker (XREADGROUP BLOCK 5000)
          → planAdherence.compute()
          → revengeFlag.compute()
          → sessionTilt.compute()
          → winRateByEmotion.compute()
          → overtradingDetector.compute()
          → XACK (on success)
```

### Crash Resilience
- On startup, worker processes pending entries (PEL) before reading new messages
- Failed metrics don't XACK → message retries automatically
- Graceful shutdown on SIGTERM/SIGINT closes Redis + PG connections

---

## Metric Algorithm Details

| Metric | Algorithm | SQL Strategy |
|---|---|---|
| Plan Adherence | AVG of last 10 closed trades' planAdherence | UPSERT by user_id |
| Revenge Flag | Loss → find entries within 90s with anxious/fearful | Transaction: UPDATE trades + INSERT flags |
| Session Tilt | Walk session trades by exit_at, count loss-following | UPSERT by session_id |
| Win Rate by Emotion | Increment win/loss per (user_id, emotion) | Single atomic UPSERT with SQL math |
| Overtrading | COUNT in 30-min window before entry_at | INSERT if >10, deduplicate by window_end |

---

## E2E Pipeline Test Results

### Trade 1: Win (AAPL long, $178.45→$182.30)
| Metric | Value |
|---|---|
| plan_adherence | 2.40 (10-trade avg from seed data) |
| win_rate (calm) | 1/0/1 = 100% |
| session_tilt | 0.0000 (1 trade, no loss-following) |
| revenge_flags | 0 (not a loss) |
| overtrading | 0 (1 trade in window) |

### Trade 2: Loss (TSLA long, $250→$245, anxious)
| Metric | Value |
|---|---|
| plan_adherence | 2.40 (still 10-trade avg) |
| win_rate (anxious) | 0/1/1 = 0% |
| session_tilt | 0.0000 (2 trades, no trade follows the loss yet) |
| revenge_flags | 0 (no subsequent trades in 90s) |
| overtrading | 0 (2 trades in window) |

---

## Issues Encountered

**None.** Zero debugging. Worker picked up both the pending message (from Phase 3) and the new message on first run.

---

## Cumulative Progress

| Phase | Status | Duration |
|---|---|---|
| Phase 1: Foundation | ✅ | ~25 min |
| Phase 2: Auth + Middleware | ✅ | ~10 min |
| Phase 3: Write API | ✅ | ~4 min |
| Phase 4: Async Pipeline | ✅ | ~4 min |
| **Total** | **4/8 phases done** | **~43 min** |
