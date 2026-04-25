// src/services/sessionService.js — Session + debrief queries
// Phase 5: Read API

const { getPool } = require('../plugins/database');
const { rowToTrade } = require('./tradeService');

/**
 * Get a session by ID with all its trades.
 * Returns the SessionSummary shape from the OpenAPI spec.
 *
 * @param {string} sessionId
 * @returns {object|null} SessionSummary or null
 */
async function getSessionById(sessionId) {
  const pool = getPool();

  // Get session
  const sessionResult = await pool.query(
    `SELECT session_id, user_id, date, notes, created_at
     FROM sessions WHERE session_id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) return null;

  const session = sessionResult.rows[0];

  // Get all trades in this session
  const tradesResult = await pool.query(
    `SELECT trade_id, user_id, session_id, asset, asset_class, direction,
      entry_price, exit_price, quantity, entry_at, exit_at, status,
      outcome, pnl, plan_adherence, emotional_state, entry_rationale,
      revenge_flag, created_at, updated_at
     FROM trades
     WHERE session_id = $1
     ORDER BY entry_at ASC`,
    [sessionId]
  );

  const trades = tradesResult.rows.map(rowToTrade);

  // Compute summary fields from trades
  const closedTrades = trades.filter(t => t.status === 'closed' && t.outcome);
  const tradeCount = trades.length;
  const wins = closedTrades.filter(t => t.outcome === 'win').length;
  const winRate = closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 10000) / 10000 : 0;
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  return {
    sessionId: session.session_id,
    userId: session.user_id,
    date: session.date instanceof Date ? session.date.toISOString() : session.date,
    notes: session.notes || null,
    tradeCount,
    winRate,
    totalPnl: Math.round(totalPnl * 100000000) / 100000000,
    trades,
  };
}

/**
 * Save a debrief for a session.
 * Returns { debriefId, sessionId, savedAt }.
 *
 * @param {string} sessionId
 * @param {object} input - DebriefInput from request body
 * @returns {{ debriefId: string, sessionId: string, savedAt: string }}
 */
async function saveDebrief(sessionId, input) {
  const pool = getPool();

  const result = await pool.query(
    `INSERT INTO debriefs (
      session_id, overall_mood, key_mistake, key_lesson,
      plan_adherence_rating, will_review_tomorrow, saved_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING debrief_id, session_id, saved_at`,
    [
      sessionId,
      input.overallMood,
      input.keyMistake || null,
      input.keyLesson || null,
      input.planAdherenceRating,
      input.willReviewTomorrow || false,
    ]
  );

  const row = result.rows[0];
  return {
    debriefId: row.debrief_id,
    sessionId: row.session_id,
    savedAt: row.saved_at instanceof Date ? row.saved_at.toISOString() : row.saved_at,
  };
}

module.exports = { getSessionById, saveDebrief };
