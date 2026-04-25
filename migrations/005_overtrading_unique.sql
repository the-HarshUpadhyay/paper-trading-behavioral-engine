-- 005_overtrading_unique.sql — Add UNIQUE constraint on (user_id, window_end)
-- Prevents TOCTOU race condition duplicates in overtrading_events

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_overtrading_user_window'
  ) THEN
    ALTER TABLE overtrading_events
      ADD CONSTRAINT uq_overtrading_user_window UNIQUE (user_id, window_end);
  END IF;
END $$;
