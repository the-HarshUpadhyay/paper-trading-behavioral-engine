-- migrations/004_create_metrics.sql
-- All 5 behavioral metric tables

-- 1. Plan Adherence Scores (rolling 10-trade average)
CREATE TABLE IF NOT EXISTS plan_adherence_scores (
    user_id     UUID PRIMARY KEY,
    score       DECIMAL(5,2) NOT NULL,
    trade_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Revenge Trade Flags (individual trade flags)
CREATE TABLE IF NOT EXISTS revenge_trade_flags (
    trade_id    UUID PRIMARY KEY REFERENCES trades(trade_id),
    user_id     UUID NOT NULL,
    flagged_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenge_flags_user ON revenge_trade_flags(user_id);

-- 3. Session Tilt Index (per-session loss-following ratio)
CREATE TABLE IF NOT EXISTS session_tilt_index (
    session_id      UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    tilt_index      DECIMAL(5,4) NOT NULL,
    total_trades    INTEGER NOT NULL,
    loss_following  INTEGER NOT NULL,
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_tilt_user ON session_tilt_index(user_id);

-- 4. Win Rate by Emotional State (per-user, per-emotion counters)
CREATE TABLE IF NOT EXISTS win_rate_by_emotion (
    user_id         UUID NOT NULL,
    emotional_state VARCHAR(10) NOT NULL CHECK (emotional_state IN ('calm', 'anxious', 'greedy', 'fearful', 'neutral')),
    wins            INTEGER DEFAULT 0,
    losses          INTEGER DEFAULT 0,
    total           INTEGER DEFAULT 0,
    win_rate        DECIMAL(5,4) DEFAULT 0,
    PRIMARY KEY (user_id, emotional_state)
);

-- 5. Overtrading Events (burst detection: >10 trades in 30 minutes)
CREATE TABLE IF NOT EXISTS overtrading_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    trade_count     INTEGER NOT NULL,
    emitted_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overtrading_user ON overtrading_events(user_id);
