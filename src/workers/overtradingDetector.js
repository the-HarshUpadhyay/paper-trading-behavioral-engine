// src/workers/overtradingDetector.js — 10 trades in 30 minutes detection
// Phase 4: Async Pipeline

const { getPool } = require('../plugins/database');

/**
 * Overtrading detection: if a user has more than 10 trades within
 * a 30-minute window ending at the current trade's entry_at,
 * emit an overtrading event.
 *
 * @param {object} trade - Parsed trade data from stream message
 */
async function computeOvertrading(trade) {
  if (!trade.entryAt) return;

  const pool = getPool();

  // Count trades by this user in the 30 minutes before this trade's entry
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM trades
     WHERE user_id = $1
       AND entry_at >= ($2::timestamptz - INTERVAL '30 minutes')
       AND entry_at <= $2::timestamptz`,
    [trade.userId, trade.entryAt]
  );

  const tradeCount = result.rows[0].count;

  if (tradeCount > 10) {
    // Check if we already emitted an event for this window (avoid duplicates)
    const existing = await pool.query(
      `SELECT event_id FROM overtrading_events
       WHERE user_id = $1
         AND window_end = $2::timestamptz`,
      [trade.userId, trade.entryAt]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO overtrading_events (user_id, window_start, window_end, trade_count, emitted_at)
         VALUES ($1, $2::timestamptz - INTERVAL '30 minutes', $2::timestamptz, $3, NOW())`,
        [trade.userId, trade.entryAt, tradeCount]
      );
    }
  }
}

module.exports = computeOvertrading;
