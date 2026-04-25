# NevUp Track 1 — Context Document

> **Purpose**: Single source of truth for all hackathon spec details. Reference this instead of re-reading the raw spec files.  
> **Source files**: `nevup_openapi.yaml`, `jwt_format.md`, `nevup_seed_dataset.csv`, `nevup_seed_dataset.json`

---

## 1. API Contract (All 7 Endpoints)

### 1.1 POST /trades

**Auth**: Required  
**Idempotent**: Yes — duplicates on `tradeId` return 200 with existing record, never 409/500

**Request body** (`TradeInput`):
```json
{
  "tradeId": "uuid",          // REQUIRED — idempotency key
  "userId": "uuid",           // REQUIRED — must match JWT sub
  "sessionId": "uuid",        // REQUIRED
  "asset": "AAPL",            // REQUIRED
  "assetClass": "equity",     // REQUIRED — enum: equity, crypto, forex
  "direction": "long",        // REQUIRED — enum: long, short
  "entryPrice": 178.45,       // REQUIRED — decimal(18,8)
  "exitPrice": 182.30,        // nullable — null if open
  "quantity": 10,             // REQUIRED — decimal(18,8)
  "entryAt": "ISO-8601",      // REQUIRED
  "exitAt": "ISO-8601",       // nullable — null if open
  "status": "closed",         // REQUIRED — enum: open, closed, cancelled
  "planAdherence": 4,         // nullable — 1-5, null if not closed
  "emotionalState": "calm",   // nullable — enum: calm, anxious, greedy, fearful, neutral
  "entryRationale": "string"  // nullable — max 500 chars
}
```

**Response** (`Trade` — extends TradeInput with computed fields):
```json
{
  // ...all TradeInput fields...
  "outcome": "win",           // COMPUTED — "win" | "loss" | null (if open)
  "pnl": 38.50,              // COMPUTED — null if open
  "revengeFlag": false,       // COMPUTED — boolean
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

**Status codes**: 200 (created or existing), 400, 401, 403

---

### 1.2 GET /trades/{tradeId}

**Auth**: Required  
**Tenancy**: trade.userId must match JWT sub → 403 on mismatch (NEVER 404 for cross-tenant)

**Response**: `Trade` object (same as POST response)

**Status codes**: 200, 401, 403, 404

---

### 1.3 GET /sessions/{sessionId}

**Auth**: Required  
**Tenancy**: session.userId must match JWT sub → 403

**Response** (`SessionSummary`):
```json
{
  "sessionId": "uuid",
  "userId": "uuid",
  "date": "ISO-8601",
  "notes": "string | null",
  "tradeCount": 5,
  "winRate": 0.8,             // 0.0 – 1.0
  "totalPnl": 312.50,
  "trades": [ /* Trade[] */ ]
}
```

**Status codes**: 200, 401, 403, 404

---

### 1.4 POST /sessions/{sessionId}/debrief

**Auth**: Required  
**Tenancy**: session.userId must match JWT sub → 403

**Request body** (`DebriefInput`):
```json
{
  "overallMood": "calm",           // REQUIRED — same enum as emotionalState
  "keyMistake": "string | null",   // max 1000 chars
  "keyLesson": "string | null",    // max 1000 chars
  "planAdherenceRating": 4,        // REQUIRED — 1-5
  "willReviewTomorrow": true       // default: false
}
```

**Response**:
```json
{
  "debriefId": "uuid",
  "sessionId": "uuid",
  "savedAt": "ISO-8601"
}
```

**Status codes**: 201, 400, 401, 403

---

### 1.5 GET /sessions/{sessionId}/coaching (SSE)

**Auth**: Required  
**Content-Type**: `text/event-stream`

**SSE event format**:
```
event: token
data: {"token": "You", "index": 0}

event: token
data: {"token": " showed", "index": 1}

event: done
data: {"fullMessage": "You showed strong discipline today..."}
```

**Status codes**: 200, 401, 403, 404

> [!NOTE]
> This is primarily a Track 2/3 endpoint. For Track 1, implement a stub that streams a hardcoded coaching message token-by-token.

---

### 1.6 GET /users/{userId}/metrics

**Auth**: Required  
**Tenancy**: path userId must match JWT sub → 403

**Query params** (ALL REQUIRED):
| Param | Type | Example |
|---|---|---|
| `from` | ISO-8601 date-time | `2025-01-01T00:00:00Z` |
| `to` | ISO-8601 date-time | `2025-03-31T23:59:59Z` |
| `granularity` | enum | `hourly`, `daily`, `rolling30d` |

**Response** (`BehavioralMetrics`):
```json
{
  "userId": "uuid",
  "granularity": "daily",
  "from": "2025-01-01T00:00:00Z",
  "to": "2025-03-31T23:59:59Z",
  "planAdherenceScore": 3.2,
  "sessionTiltIndex": 0.35,
  "winRateByEmotionalState": {
    "calm": { "wins": 42, "losses": 18, "winRate": 0.7 },
    "anxious": { "wins": 5, "losses": 15, "winRate": 0.25 }
  },
  "revengeTrades": 7,
  "overtradingEvents": 3,
  "timeseries": [
    {
      "bucket": "2025-01-06T00:00:00Z",
      "tradeCount": 5,
      "winRate": 0.4,
      "pnl": 1779.11,
      "avgPlanAdherence": 2.4
    }
  ]
}
```

**Key details**:
- `revengeTrades` = integer COUNT (not array)
- `overtradingEvents` = integer COUNT (not array)
- `timeseries` = bucketed by granularity (required)
- `winRateByEmotionalState` = map of emotion → {wins, losses, winRate}

---

### 1.7 GET /users/{userId}/profile

**Auth**: Required  
**Tenancy**: userId must match JWT sub → 403

**Response** (`BehavioralProfile`):
```json
{
  "userId": "uuid",
  "generatedAt": "ISO-8601",
  "dominantPathologies": [
    {
      "pathology": "revenge_trading",
      "confidence": 0.85,
      "evidenceSessions": ["session-uuid-1", "session-uuid-2"],
      "evidenceTrades": ["trade-uuid-1", "trade-uuid-2"]
    }
  ],
  "strengths": ["Disciplined morning entries", "Good position sizing"],
  "peakPerformanceWindow": {
    "startHour": 9,
    "endHour": 11,
    "winRate": 0.72
  }
}
```

**Pathology enum**: `revenge_trading`, `overtrading`, `fomo_entries`, `plan_non_adherence`, `premature_exit`, `loss_running`, `session_tilt`, `time_of_day_bias`, `position_sizing_inconsistency`

> [!NOTE]
> For Track 1, implement a simplified version that computes pathologies from the metric tables rather than requiring AI analysis (that's Track 2's job).

---

### 1.8 GET /health

**Auth**: NOT required (`security: []`)

**Response** (`HealthResponse`):
```json
{
  "status": "ok",               // enum: ok, degraded
  "dbConnection": "connected",  // enum: connected, disconnected
  "queueLag": 12,               // integer — milliseconds
  "timestamp": "ISO-8601"
}
```

**Status codes**: 200 (ok), 503 (degraded)

---

### 1.9 Error Response Format (all endpoints)

```json
{
  "error": "TRADE_NOT_FOUND",
  "message": "Trade with the given tradeId does not exist.",
  "traceId": "uuid-per-request"
}
```

All three fields are **required** on every error response.

---

## 2. JWT Specification

### Token structure:
```
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: { "sub": "userId-uuid", "iat": unix, "exp": unix, "role": "trader", "name": "optional" }
```

### Signing secret:
```
97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02
```

### Rules:
- **Algorithm**: HS256 (HMAC-SHA256)
- **Expiry**: 24 hours
- **Clock skew**: 0 seconds tolerance — UTC strictly
- **Tenancy**: `sub` claim must exactly match `userId` in data → 403 on mismatch (NEVER 404)
- **Sending**: `Authorization: Bearer <token>`

### Validation checklist:
1. Verify signature using HS256 + shared secret
2. Reject tokens where `exp < now()` → 401
3. Reject requests with no Authorization header → 401
4. Reject malformed tokens (bad base64, missing claims) → 401
5. Enforce `sub === userId` for every data endpoint → 403 on mismatch
6. Include `traceId` in all 401/403 error responses

---

## 3. Database Schema

### 3.1 trades
```sql
CREATE TABLE trades (
    trade_id        UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    session_id      UUID NOT NULL,
    asset           VARCHAR(20) NOT NULL,
    asset_class     VARCHAR(10) NOT NULL CHECK (asset_class IN ('equity','crypto','forex')),
    direction       VARCHAR(5) NOT NULL CHECK (direction IN ('long','short')),
    entry_price     DECIMAL(18,8) NOT NULL,
    exit_price      DECIMAL(18,8),
    quantity        DECIMAL(18,8) NOT NULL,
    entry_at        TIMESTAMPTZ NOT NULL,
    exit_at         TIMESTAMPTZ,
    status          VARCHAR(10) NOT NULL CHECK (status IN ('open','closed','cancelled')),
    outcome         VARCHAR(4) CHECK (outcome IN ('win','loss')),
    pnl             DECIMAL(18,8),
    plan_adherence  INTEGER CHECK (plan_adherence BETWEEN 1 AND 5),
    emotional_state VARCHAR(10) CHECK (emotional_state IN ('calm','anxious','greedy','fearful','neutral')),
    entry_rationale VARCHAR(500),
    revenge_flag    BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_user_status ON trades(user_id, status);
CREATE INDEX idx_trades_user_entry_at ON trades(user_id, entry_at);
CREATE INDEX idx_trades_user_exit_at ON trades(user_id, exit_at);
CREATE INDEX idx_trades_session ON trades(session_id);
```

### 3.2 sessions
```sql
CREATE TABLE sessions (
    session_id  UUID PRIMARY KEY,
    user_id     UUID NOT NULL,
    date        TIMESTAMPTZ NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
```

### 3.3 debriefs
```sql
CREATE TABLE debriefs (
    debrief_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID NOT NULL REFERENCES sessions(session_id),
    overall_mood            VARCHAR(10) NOT NULL CHECK (overall_mood IN ('calm','anxious','greedy','fearful','neutral')),
    key_mistake             TEXT,
    key_lesson              TEXT,
    plan_adherence_rating   INTEGER NOT NULL CHECK (plan_adherence_rating BETWEEN 1 AND 5),
    will_review_tomorrow    BOOLEAN DEFAULT false,
    saved_at                TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 plan_adherence_scores
```sql
CREATE TABLE plan_adherence_scores (
    user_id     UUID PRIMARY KEY,
    score       DECIMAL(5,2) NOT NULL,
    trade_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.5 revenge_trade_flags
```sql
CREATE TABLE revenge_trade_flags (
    trade_id    UUID PRIMARY KEY REFERENCES trades(trade_id),
    user_id     UUID NOT NULL,
    flagged_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_revenge_flags_user ON revenge_trade_flags(user_id);
```

### 3.6 session_tilt_index
```sql
CREATE TABLE session_tilt_index (
    session_id      UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    tilt_index      DECIMAL(5,4) NOT NULL,
    total_trades    INTEGER NOT NULL,
    loss_following  INTEGER NOT NULL,
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.7 win_rate_by_emotion
```sql
CREATE TABLE win_rate_by_emotion (
    user_id         UUID NOT NULL,
    emotional_state VARCHAR(10) NOT NULL,
    wins            INTEGER DEFAULT 0,
    losses          INTEGER DEFAULT 0,
    total           INTEGER DEFAULT 0,
    win_rate        DECIMAL(5,4) DEFAULT 0,
    PRIMARY KEY (user_id, emotional_state)
);
```

### 3.8 overtrading_events
```sql
CREATE TABLE overtrading_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    trade_count     INTEGER NOT NULL,
    emitted_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_overtrading_user ON overtrading_events(user_id);
```

---

## 4. Seed Data Analysis

### 4.1 Overview
| Stat | Value |
|---|---|
| Total trades | 388 |
| Total traders | 10 |
| Total sessions | 52 |
| Date range | 2025-01-06 → 2025-02-13 |
| All trades status | `closed` |
| Format | camelCase (CSV), structured JSON |

### 4.2 Column Mapping (camelCase → snake_case)
| CSV/JSON Field | DB Column | Notes |
|---|---|---|
| `tradeId` | `trade_id` | UUID primary key |
| `userId` | `user_id` | |
| `traderName` | — | Not stored in DB |
| `sessionId` | `session_id` | |
| `asset` | `asset` | |
| `assetClass` | `asset_class` | |
| `direction` | `direction` | |
| `entryPrice` | `entry_price` | |
| `exitPrice` | `exit_price` | |
| `quantity` | `quantity` | |
| `entryAt` | `entry_at` | |
| `exitAt` | `exit_at` | |
| `status` | `status` | |
| `outcome` | `outcome` | Pre-computed in seed data |
| `pnl` | `pnl` | Pre-computed in seed data |
| `planAdherence` | `plan_adherence` | |
| `emotionalState` | `emotional_state` | |
| `entryRationale` | `entry_rationale` | Can be `null`/"" |
| `revengeFlag` | `revenge_flag` | Pre-computed boolean |
| `groundTruthPathologies` | — | Track 2 label, not stored |

### 4.3 Traders & Pathologies
| # | Trader | userId | Pathology | Sessions | Trades |
|---|---|---|---|---|---|
| 1 | Alex Mercer | `f412f236-4edc-47a2-8f54-8763a6ed2ce8` | revenge_trading | 5 | 25 |
| 2 | Jordan Lee | `fcd434aa-2201-4060-aeb2-f44c77aa0683` | overtrading | 5 | 80 |
| 3 | Sam Rivera | `84a6a3dd-f2d0-4167-960b-7319a6033d49` | fomo_entries | 5 | 30 |
| 4 | Casey Kim | `4f2f0816-f350-4684-b6c3-29bbddbb1869` | plan_non_adherence | 5 | 35 |
| 5 | Morgan Bell | `75076413-e8e8-44ac-861f-c7acb3902d6d` | premature_exit | 5 | 35 |
| 6 | Taylor Grant | `8effb0f2-f16b-4b5f-87ab-7ffca376f309` | loss_running | 5 | 30 |
| 7 | Riley Stone | `50dd1053-73b0-43c5-8d0f-d2af88c01451` | session_tilt | 5 | 40 |
| 8 | Drew Patel | `af2cfc5e-c132-4989-9c12-2913f89271fb` | time_of_day_bias | 5 | 48 |
| 9 | Quinn Torres | `9419073a-3d58-4ee6-a917-be2d40aecef2` | position_sizing_inconsistency | 5 | 35 |
| 10 | Avery Chen | `e84ea28c-e5a7-49ef-ac26-a873e32667bd` | *(none — clean trader)* | 5 | 30 |

### 4.4 JSON Structure (for seeding)
```
{
  "meta": { version, traderCount: 10, totalSessions: 52, totalTrades: 388 },
  "groundTruthLabels": [ { userId, name, pathologies[] } ],
  "traders": [
    {
      "userId", "name",
      "profile": { riskTolerance, preferredAssets, averageSessionDuration },
      "groundTruthPathologies": [],
      "description": "...",
      "stats": { totalSessions, totalTrades, avgPlanAdherence },
      "sessions": [
        {
          "sessionId", "userId", "date", "notes",
          "tradeCount", "winRate", "totalPnl",
          "trades": [ { ...trade fields... } ]
        }
      ]
    }
  ]
}
```

> [!TIP]
> Use the JSON file for seeding — it has pre-computed `winRate` and `totalPnl` per session, saving you from recomputing them.

---

## 5. Behavioral Metric Algorithms

### 5.1 Plan Adherence Score
- **Input**: Last 10 closed trades for user (by exit_at DESC)
- **Algorithm**: `AVG(plan_adherence)` of those trades
- **Storage**: `plan_adherence_scores` table (UPSERT by user_id)

### 5.2 Revenge Trade Flag
- **Trigger**: A closed trade that is a loss
- **Check**: Any trade by same user entered within 90 seconds of this trade's exit_at, AND emotional_state IN ('anxious', 'fearful')
- **Action**: Mark the subsequent trade's `revenge_flag = true` in trades table, INSERT into `revenge_trade_flags`

### 5.3 Session Tilt Index
- **Input**: All closed trades in the same session, ordered by exit_at
- **Algorithm**: Walk through trades sequentially; if previous trade was a loss, current trade is "loss-following"
- **Formula**: `tilt_index = loss_following_count / total_closed_count`
- **Storage**: `session_tilt_index` table (UPSERT by session_id)

### 5.4 Win Rate by Emotional State
- **Input**: The closed trade's emotional_state and outcome
- **Algorithm**: Increment wins or losses for that emotion; recalculate `win_rate = wins / (wins + losses)`
- **Storage**: `win_rate_by_emotion` table (UPSERT by user_id + emotional_state)

### 5.5 Overtrading Detector
- **Trigger**: Any new trade entry
- **Check**: `COUNT(*) FROM trades WHERE user_id = $1 AND entry_at >= ($2 - INTERVAL '30 minutes')` > 10
- **Action**: INSERT into `overtrading_events` with window details

---

## 6. Docker Configuration

### docker-compose.yml services:
| Service | Image | Port | Depends On |
|---|---|---|---|
| `api` | Custom (Dockerfile) | 3000:3000 | postgres (healthy), redis (healthy) |
| `worker` | Same image, different CMD | — | api |
| `postgres` | `postgres:16-alpine` | 5432 | — |
| `redis` | `redis:7-alpine` | 6379 | — |

### Environment variables:
| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://nevup:nevup@postgres:5432/nevup` | PG connection string |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `JWT_SECRET` | `97791d4db...` | HS256 signing secret |
| `PORT` | `3000` | API server port |
| `NODE_ENV` | `production` | Environment |
| `LOG_LEVEL` | `info` | Pino log level |

---

## 7. Project File Map

```
nevup-track1/
├── docker-compose.yml
├── Dockerfile
├── DECISIONS.md
├── README.md
├── package.json
├── .env.example
├── given/                          # provided files (read-only)
│   ├── nevup_openapi.yaml
│   ├── nevup_seed_dataset.csv
│   ├── nevup_seed_dataset.json
│   └── jwt_format.md
├── migrations/
│   ├── 001_create_trades.sql
│   ├── 002_create_sessions.sql
│   ├── 003_create_debriefs.sql
│   └── 004_create_metrics.sql
├── src/
│   ├── server.js
│   ├── config.js
│   ├── migrate.js
│   ├── seed.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── tenancy.js
│   │   ├── traceId.js
│   │   └── errorHandler.js
│   ├── plugins/
│   │   ├── database.js
│   │   └── redis.js
│   ├── routes/
│   │   ├── trades.js
│   │   ├── sessions.js
│   │   ├── users.js
│   │   └── health.js
│   ├── services/
│   │   ├── tradeService.js
│   │   ├── sessionService.js
│   │   ├── metricsService.js
│   │   └── publisher.js
│   ├── workers/
│   │   ├── index.js
│   │   ├── planAdherence.js
│   │   ├── revengeFlag.js
│   │   ├── sessionTilt.js
│   │   ├── winRateByEmotion.js
│   │   └── overtradingDetector.js
│   └── utils/
│       ├── jwt.js
│       └── errors.js
├── tests/
│   ├── setup.js
│   ├── trades.test.js
│   ├── auth.test.js
│   ├── sessions.test.js
│   ├── metrics.test.js
│   └── integration.test.js
├── loadtest/
│   ├── k6-trade-close.js
│   ├── run.sh
│   └── results/
└── scripts/
    └── generate-token.js
```
