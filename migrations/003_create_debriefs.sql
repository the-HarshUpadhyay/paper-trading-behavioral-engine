-- migrations/003_create_debriefs.sql
-- Debriefs table for post-session reflections

CREATE TABLE IF NOT EXISTS debriefs (
    debrief_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID NOT NULL REFERENCES sessions(session_id),
    overall_mood            VARCHAR(10) NOT NULL CHECK (overall_mood IN ('calm', 'anxious', 'greedy', 'fearful', 'neutral')),
    key_mistake             TEXT,
    key_lesson              TEXT,
    plan_adherence_rating   INTEGER NOT NULL CHECK (plan_adherence_rating BETWEEN 1 AND 5),
    will_review_tomorrow    BOOLEAN DEFAULT false,
    saved_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debriefs_session ON debriefs(session_id);
