// src/workers/revengeFlag.js — 90-second window + anxious/fearful check
// Phase 4: Async Pipeline

const { getPool } = require('../plugins/database');

/**
 * Revenge trade detection:
 * If the current trade is a LOSS, find any trades by the same user
 * that were OPENED within 90 seconds after this trade's exit_at
 * AND have emotionalState of 'anxious' or 'fearful'.
 * Flag those subsequent trades as revenge trades.
 *
 * @param {object} trade - Parsed trade data from stream message
 */
async function computeRevengeFlag(trade) {
  // Only process losing trades — we're looking for trades opened AFTER this loss
  if (trade.outcome !== 'loss') return;
  if (!trade.exitAt) return;

  const pool = getPool();

  // Find trades opened within 90s of this losing trade's exit
  const result = await pool.query(
    `SELECT trade_id FROM trades
     WHERE user_id = $1
       AND trade_id != $2
       AND entry_at > $3::timestamptz
       AND entry_at <= ($3::timestamptz + INTERVAL '90 seconds')
       AND emotional_state IN ('anxious', 'fearful')
       AND revenge_flag = false`,
    [trade.userId, trade.tradeId, trade.exitAt]
  );

  if (result.rows.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of result.rows) {
      // Update trade's revenge_flag
      await client.query(
        `UPDATE trades SET revenge_flag = true, updated_at = NOW()
         WHERE trade_id = $1`,
        [row.trade_id]
      );

      // Insert into revenge_trade_flags tracking table
      await client.query(
        `INSERT INTO revenge_trade_flags (trade_id, user_id, flagged_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (trade_id) DO NOTHING`,
        [row.trade_id, trade.userId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = computeRevengeFlag;
