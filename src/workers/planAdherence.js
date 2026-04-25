// src/workers/planAdherence.js — Rolling 10-trade average of planAdherence
// Phase 4: Async Pipeline

const { getPool } = require('../plugins/database');

/**
 * Compute rolling 10-trade average of planAdherence for a user.
 * Takes the last 10 closed trades (by exit_at) that have a planAdherence rating.
 * UPSERTs the result into plan_adherence_scores.
 *
 * @param {object} trade - Parsed trade data from stream message
 */
async function computePlanAdherence(trade) {
  const pool = getPool();

  // Get last 10 closed trades with planAdherence ratings
  const result = await pool.query(
    `SELECT plan_adherence FROM trades
     WHERE user_id = $1
       AND status = 'closed'
       AND plan_adherence IS NOT NULL
     ORDER BY exit_at DESC
     LIMIT 10`,
    [trade.userId]
  );

  if (result.rows.length === 0) return;

  // Compute average
  const values = result.rows.map(r => parseInt(r.plan_adherence, 10));
  const score = values.reduce((sum, v) => sum + v, 0) / values.length;

  // UPSERT into plan_adherence_scores
  await pool.query(
    `INSERT INTO plan_adherence_scores (user_id, score, trade_count, computed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       score = $2,
       trade_count = $3,
       computed_at = NOW()`,
    [trade.userId, Math.round(score * 100) / 100, values.length]
  );
}

module.exports = computePlanAdherence;
