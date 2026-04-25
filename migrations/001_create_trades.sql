-- migrations/001_create_trades.sql
-- Trades table with all fields including computed columns (outcome, pnl, revenge_flag)

CREATE TABLE IF NOT EXISTS trades (
    trade_id        UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    session_id      UUID NOT NULL,
    asset           VARCHAR(20) NOT NULL,
    asset_class     VARCHAR(10) NOT NULL CHECK (asset_class IN ('equity', 'crypto', 'forex')),
    direction       VARCHAR(5)  NOT NULL CHECK (direction IN ('long', 'short')),
    entry_price     DECIMAL(18,8) NOT NULL,
    exit_price      DECIMAL(18,8),
    quantity        DECIMAL(18,8) NOT NULL,
    entry_at        TIMESTAMPTZ NOT NULL,
    exit_at         TIMESTAMPTZ,
    status          VARCHAR(10) NOT NULL CHECK (status IN ('open', 'closed', 'cancelled')),
    outcome         VARCHAR(4)  CHECK (outcome IN ('win', 'loss')),
    pnl             DECIMAL(18,8),
    plan_adherence  INTEGER CHECK (plan_adherence BETWEEN 1 AND 5),
    emotional_state VARCHAR(10) CHECK (emotional_state IN ('calm', 'anxious', 'greedy', 'fearful', 'neutral')),
    entry_rationale VARCHAR(500),
    revenge_flag    BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_trades_user_id       ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_status    ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_user_entry_at  ON trades(user_id, entry_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_exit_at   ON trades(user_id, exit_at);
CREATE INDEX IF NOT EXISTS idx_trades_session        ON trades(session_id);
