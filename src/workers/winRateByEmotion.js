// src/workers/winRateByEmotion.js — Per-emotion win/loss/winRate
// Phase 4: Async Pipeline

const { getPool } = require('../plugins/database');

/**
 * Win Rate by Emotional State: maintains running win/loss counters
 * per (user_id, emotional_state) pair. Recomputes win_rate on each update.
 *
 * @param {object} trade - Parsed trade data from stream message
 */
async function computeWinRateByEmotion(trade) {
  // Skip trades without emotional state or outcome
  if (!trade.emotionalState || !trade.outcome) return;

  const pool = getPool();
  const isWin = trade.outcome === 'win';

  // UPSERT: increment wins or losses, recalculate totals and win_rate
  await pool.query(
    `INSERT INTO win_rate_by_emotion (user_id, emotional_state, wins, losses, total, win_rate)
     VALUES ($1, $2, $3, $4, 1, $5)
     ON CONFLICT (user_id, emotional_state) DO UPDATE SET
       wins = win_rate_by_emotion.wins + $3,
       losses = win_rate_by_emotion.losses + $4,
       total = win_rate_by_emotion.total + 1,
       win_rate = CASE
         WHEN (win_rate_by_emotion.total + 1) > 0
         THEN (win_rate_by_emotion.wins + $3)::decimal / (win_rate_by_emotion.total + 1)
         ELSE 0
       END`,
    [
      trade.userId,
      trade.emotionalState,
      isWin ? 1 : 0,  // $3: wins increment
      isWin ? 0 : 1,  // $4: losses increment
      isWin ? 1.0 : 0, // $5: initial win_rate for new row
    ]
  );
}

module.exports = computeWinRateByEmotion;
