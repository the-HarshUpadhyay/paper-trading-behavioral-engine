-- migrations/002_create_sessions.sql
-- Sessions table for session summaries and debrief linkage

CREATE TABLE IF NOT EXISTS sessions (
    session_id  UUID PRIMARY KEY,
    user_id     UUID NOT NULL,
    date        TIMESTAMPTZ NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
