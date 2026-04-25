// src/services/metricsService.js — Aggregate behavioral metrics + timeseries
// Phase 5: Read API

const { getPool } = require('../plugins/database');

/**
 * Get the BehavioralMetrics for a user within a time range.
 * Returns the exact BehavioralMetrics schema from the OpenAPI spec.
 *
 * @param {string} userId
 * @param {string} from - ISO-8601 start
 * @param {string} to - ISO-8601 end
 * @param {string} granularity - 'hourly' | 'daily' | 'rolling30d'
 * @returns {object} BehavioralMetrics
 */
async function getUserMetrics(userId, from, to, granularity) {
  const pool = getPool();

  // 1. Plan Adherence Score (latest rolling average)
  const paResult = await pool.query(
    `SELECT score FROM plan_adherence_scores WHERE user_id = $1`,
    [userId]
  );
  const planAdherenceScore = paResult.rows.length > 0
    ? parseFloat(paResult.rows[0].score)
    : null;

  // 2. Session Tilt Index (average across sessions in range)
  const tiltResult = await pool.query(
    `SELECT AVG(tilt_index)::decimal(5,4) AS avg_tilt
     FROM session_tilt_index sti
     JOIN sessions s ON s.session_id = sti.session_id
     WHERE sti.user_id = $1
       AND s.date >= $2::timestamptz
       AND s.date <= $3::timestamptz`,
    [userId, from, to]
  );
  const sessionTiltIndex = tiltResult.rows[0].avg_tilt
    ? parseFloat(tiltResult.rows[0].avg_tilt)
    : 0;

  // 3. Win Rate by Emotional State
  const wreResult = await pool.query(
    `SELECT emotional_state, wins, losses, win_rate
     FROM win_rate_by_emotion WHERE user_id = $1`,
    [userId]
  );
  const winRateByEmotionalState = {};
  for (const row of wreResult.rows) {
    winRateByEmotionalState[row.emotional_state] = {
      wins: parseInt(row.wins, 10),
      losses: parseInt(row.losses, 10),
      winRate: parseFloat(row.win_rate),
    };
  }

  // 4. Revenge trades count in range
  const revengeResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM revenge_trade_flags
     WHERE user_id = $1
       AND flagged_at >= $2::timestamptz
       AND flagged_at <= $3::timestamptz`,
    [userId, from, to]
  );
  const revengeTrades = revengeResult.rows[0].count;

  // 5. Overtrading events count in range
  const otResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM overtrading_events
     WHERE user_id = $1
       AND emitted_at >= $2::timestamptz
       AND emitted_at <= $3::timestamptz`,
    [userId, from, to]
  );
  const overtradingEvents = otResult.rows[0].count;

  // 6. Timeseries — bucketed trade stats
  const truncExpr = granularity === 'hourly' ? 'hour'
    : granularity === 'daily' ? 'day'
    : 'month'; // rolling30d approximation

  const tsResult = await pool.query(
    `SELECT
       date_trunc($1, exit_at) AS bucket,
       COUNT(*)::int AS trade_count,
       CASE WHEN COUNT(*) > 0
         THEN COUNT(*) FILTER (WHERE outcome = 'win')::decimal / COUNT(*)
         ELSE 0
       END AS win_rate,
       COALESCE(SUM(pnl), 0) AS pnl,
       COALESCE(AVG(plan_adherence), 0) AS avg_plan_adherence
     FROM trades
     WHERE user_id = $2
       AND status = 'closed'
       AND exit_at >= $3::timestamptz
       AND exit_at <= $4::timestamptz
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [truncExpr, userId, from, to]
  );

  const timeseries = tsResult.rows.map(row => ({
    bucket: row.bucket instanceof Date ? row.bucket.toISOString() : row.bucket,
    tradeCount: parseInt(row.trade_count, 10),
    winRate: Math.round(parseFloat(row.win_rate) * 10000) / 10000,
    pnl: Math.round(parseFloat(row.pnl) * 100) / 100,
    avgPlanAdherence: Math.round(parseFloat(row.avg_plan_adherence) * 100) / 100,
  }));

  return {
    userId,
    granularity,
    from,
    to,
    planAdherenceScore,
    sessionTiltIndex,
    winRateByEmotionalState,
    revengeTrades,
    overtradingEvents,
    timeseries,
  };
}

/**
 * Get the BehavioralProfile for a user.
 * Analyzes metric tables to identify dominant pathologies.
 *
 * @param {string} userId
 * @returns {object} BehavioralProfile
 */
async function getUserProfile(userId) {
  const pool = getPool();
  const pathologies = [];
  const strengths = [];

  // 1. Check revenge trading
  const revengeResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM revenge_trade_flags WHERE user_id = $1`,
    [userId]
  );
  const revengeCount = revengeResult.rows[0].count;
  if (revengeCount > 0) {
    // Get evidence trades
    const evidenceTrades = await pool.query(
      `SELECT trade_id FROM revenge_trade_flags WHERE user_id = $1 LIMIT 10`,
      [userId]
    );
    // Get evidence sessions
    const evidenceSessions = await pool.query(
      `SELECT DISTINCT t.session_id FROM trades t
       JOIN revenge_trade_flags rf ON rf.trade_id = t.trade_id
       WHERE rf.user_id = $1 LIMIT 5`,
      [userId]
    );
    pathologies.push({
      pathology: 'revenge_trading',
      confidence: Math.min(revengeCount / 10, 1.0),
      evidenceSessions: evidenceSessions.rows.map(r => r.session_id),
      evidenceTrades: evidenceTrades.rows.map(r => r.trade_id),
    });
  }

  // 2. Check overtrading
  const otResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM overtrading_events WHERE user_id = $1`,
    [userId]
  );
  if (otResult.rows[0].count > 0) {
    pathologies.push({
      pathology: 'overtrading',
      confidence: Math.min(otResult.rows[0].count / 5, 1.0),
      evidenceSessions: [],
      evidenceTrades: [],
    });
  }

  // 3. Check plan non-adherence (score < 3)
  const paResult = await pool.query(
    `SELECT score FROM plan_adherence_scores WHERE user_id = $1`,
    [userId]
  );
  if (paResult.rows.length > 0) {
    const score = parseFloat(paResult.rows[0].score);
    if (score < 3) {
      // Get evidence: trades with low planAdherence
      const lowPaTrades = await pool.query(
        `SELECT trade_id, session_id FROM trades
         WHERE user_id = $1 AND plan_adherence IS NOT NULL AND plan_adherence <= 2
         ORDER BY exit_at DESC LIMIT 10`,
        [userId]
      );
      pathologies.push({
        pathology: 'plan_non_adherence',
        confidence: Math.min((3 - score) / 2, 1.0),
        evidenceSessions: [...new Set(lowPaTrades.rows.map(r => r.session_id))].slice(0, 5),
        evidenceTrades: lowPaTrades.rows.map(r => r.trade_id),
      });
    } else {
      strengths.push('Strong plan adherence discipline');
    }
  }

  // 4. Check session tilt
  const tiltResult = await pool.query(
    `SELECT session_id, tilt_index FROM session_tilt_index
     WHERE user_id = $1 AND tilt_index > 0.5
     ORDER BY tilt_index DESC LIMIT 5`,
    [userId]
  );
  if (tiltResult.rows.length > 0) {
    pathologies.push({
      pathology: 'session_tilt',
      confidence: Math.min(parseFloat(tiltResult.rows[0].tilt_index), 1.0),
      evidenceSessions: tiltResult.rows.map(r => r.session_id),
      evidenceTrades: [],
    });
  }

  // 5. Determine strengths from emotional state analysis
  const wreResult = await pool.query(
    `SELECT emotional_state, wins, losses, win_rate FROM win_rate_by_emotion
     WHERE user_id = $1`,
    [userId]
  );
  for (const row of wreResult.rows) {
    const wr = parseFloat(row.win_rate);
    const total = parseInt(row.wins, 10) + parseInt(row.losses, 10);
    if (wr >= 0.6 && total >= 5) {
      strengths.push(`High win rate when ${row.emotional_state} (${Math.round(wr * 100)}%)`);
    }
  }

  // 6. Peak performance window
  const peakResult = await pool.query(
    `SELECT
       EXTRACT(HOUR FROM entry_at)::int AS hour,
       COUNT(*)::int AS trades,
       COUNT(*) FILTER (WHERE outcome = 'win')::decimal /
         NULLIF(COUNT(*), 0) AS win_rate
     FROM trades
     WHERE user_id = $1 AND status = 'closed' AND outcome IS NOT NULL
     GROUP BY hour
     HAVING COUNT(*) >= 3
     ORDER BY win_rate DESC
     LIMIT 1`,
    [userId]
  );

  let peakPerformanceWindow = null;
  if (peakResult.rows.length > 0) {
    const hour = peakResult.rows[0].hour;
    peakPerformanceWindow = {
      startHour: hour,
      endHour: (hour + 1) % 24,
      winRate: Math.round(parseFloat(peakResult.rows[0].win_rate) * 10000) / 10000,
    };
  }

  return {
    userId,
    generatedAt: new Date().toISOString(),
    dominantPathologies: pathologies,
    strengths: strengths.length > 0 ? strengths : ['No significant strengths identified yet'],
    peakPerformanceWindow,
  };
}

module.exports = { getUserMetrics, getUserProfile };
