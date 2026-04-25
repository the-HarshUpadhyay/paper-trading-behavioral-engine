// src/workers/sessionTilt.js — Loss-following ratio per session
// Phase 4: Async Pipeline

const { getPool } = require('../plugins/database');

/**
 * Session Tilt Index: ratio of "loss-following" trades to total trades.
 * A trade is "loss-following" if the immediately preceding trade (by exit_at)
 * in the same session was a loss.
 *
 * tilt_index = loss_following_count / total_closed_count
 *
 * @param {object} trade - Parsed trade data from stream message
 */
async function computeSessionTilt(trade) {
  if (!trade.sessionId) return;

  const pool = getPool();

  // Get all closed trades in this session, ordered by exit_at
  const result = await pool.query(
    `SELECT trade_id, outcome FROM trades
     WHERE session_id = $1
       AND status = 'closed'
       AND outcome IS NOT NULL
     ORDER BY exit_at ASC`,
    [trade.sessionId]
  );

  if (result.rows.length < 2) {
    // Need at least 2 trades to compute tilt
    await pool.query(
      `INSERT INTO session_tilt_index (session_id, user_id, tilt_index, total_trades, loss_following, computed_at)
       VALUES ($1, $2, 0, $3, 0, NOW())
       ON CONFLICT (session_id) DO UPDATE SET
         tilt_index = 0,
         total_trades = $3,
         loss_following = 0,
         computed_at = NOW()`,
      [trade.sessionId, trade.userId, result.rows.length]
    );
    return;
  }

  // Walk sequentially: count trades that follow a loss
  let lossFollowing = 0;
  for (let i = 1; i < result.rows.length; i++) {
    if (result.rows[i - 1].outcome === 'loss') {
      lossFollowing++;
    }
  }

  const totalTrades = result.rows.length;
  const tiltIndex = lossFollowing / totalTrades;

  // UPSERT session tilt
  await pool.query(
    `INSERT INTO session_tilt_index (session_id, user_id, tilt_index, total_trades, loss_following, computed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       tilt_index = $3,
       total_trades = $4,
       loss_following = $5,
       computed_at = NOW()`,
    [trade.sessionId, trade.userId, Math.round(tiltIndex * 10000) / 10000, totalTrades, lossFollowing]
  );
}

module.exports = computeSessionTilt;
