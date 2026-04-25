// src/services/tradeService.js — Insert logic, idempotency, P&L computation
// Phase 3: Write API

const { getPool } = require('../plugins/database');
const { publishTradeClose } = require('./publisher');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ── Column Mapping ──────────────────────────────────────────────────────────

/**
 * Convert a snake_case DB row to a camelCase API response.
 * Also parseFloat() all DECIMAL columns for clean JSON output.
 */
function rowToTrade(row) {
  return {
    tradeId: row.trade_id,
    userId: row.user_id,
    sessionId: row.session_id,
    asset: row.asset,
    assetClass: row.asset_class,
    direction: row.direction,
    entryPrice: parseFloat(row.entry_price),
    exitPrice: row.exit_price != null ? parseFloat(row.exit_price) : null,
    quantity: parseFloat(row.quantity),
    entryAt: row.entry_at instanceof Date ? row.entry_at.toISOString() : row.entry_at,
    exitAt: row.exit_at != null
      ? (row.exit_at instanceof Date ? row.exit_at.toISOString() : row.exit_at)
      : null,
    status: row.status,
    outcome: row.outcome || null,
    pnl: row.pnl != null ? parseFloat(row.pnl) : null,
    planAdherence: row.plan_adherence != null ? parseInt(row.plan_adherence, 10) : null,
    emotionalState: row.emotional_state || null,
    entryRationale: row.entry_rationale || null,
    revengeFlag: row.revenge_flag || false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// ── P&L Computation ─────────────────────────────────────────────────────────

/**
 * Compute P&L and outcome for a closed trade.
 * P&L = (exitPrice - entryPrice) * quantity for long
 * P&L = (entryPrice - exitPrice) * quantity for short
 */
function computePnlAndOutcome(trade) {
  if (trade.status !== 'closed' || trade.exitPrice == null) {
    return { pnl: null, outcome: null };
  }

  const multiplier = trade.direction === 'long' ? 1 : -1;
  const pnl = (trade.exitPrice - trade.entryPrice) * trade.quantity * multiplier;
  const outcome = pnl > 0 ? 'win' : 'loss';

  return { pnl: Math.round(pnl * 100000000) / 100000000, outcome };
}

// ── Create Trade ────────────────────────────────────────────────────────────

/**
 * Idempotent trade creation.
 * 1. Compute P&L and outcome if closed
 * 2. INSERT ... ON CONFLICT (trade_id) DO NOTHING RETURNING *
 * 3. If inserted → new trade (publish to Redis if closed)
 * 4. If conflict → SELECT existing trade
 * 5. Always return 200 with trade
 *
 * @param {object} input - camelCase trade input from request body
 * @returns {{ trade: object, isNew: boolean }}
 */
async function createTrade(input) {
  const pool = getPool();

  // Compute derived fields
  const { pnl, outcome } = computePnlAndOutcome(input);

  // INSERT with ON CONFLICT for idempotency
  const insertResult = await pool.query(
    `INSERT INTO trades (
      trade_id, user_id, session_id, asset, asset_class, direction,
      entry_price, exit_price, quantity, entry_at, exit_at, status,
      outcome, pnl, plan_adherence, emotional_state, entry_rationale,
      revenge_flag, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      false, NOW(), NOW()
    )
    ON CONFLICT (trade_id) DO NOTHING
    RETURNING trade_id, user_id, session_id, asset, asset_class, direction,
      entry_price, exit_price, quantity, entry_at, exit_at, status,
      outcome, pnl, plan_adherence, emotional_state, entry_rationale,
      revenge_flag, created_at, updated_at`,
    [
      input.tradeId,
      input.userId,
      input.sessionId,
      input.asset,
      input.assetClass,
      input.direction,
      input.entryPrice,
      input.exitPrice ?? null,
      input.quantity,
      input.entryAt,
      input.exitAt ?? null,
      input.status,
      outcome,
      pnl,
      input.planAdherence ?? null,
      input.emotionalState ?? null,
      input.entryRationale ?? null,
    ]
  );

  // New trade inserted
  if (insertResult.rows.length > 0) {
    const trade = rowToTrade(insertResult.rows[0]);

    // Publish to Redis Stream if trade is closed (retry once on failure)
    if (trade.status === 'closed') {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await publishTradeClose(trade);
          break;
        } catch (err) {
          if (attempt === 2) {
            // Final failure — structured log, don't fail the request
            logger.error({
              tradeId: trade.tradeId,
              userId: trade.userId,
              attempt,
              err: err.message,
            }, 'Failed to publish trade to stream after retries');
          } else {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    return { trade, isNew: true };
  }

  // Duplicate — fetch existing record
  const existingResult = await pool.query(
    `SELECT trade_id, user_id, session_id, asset, asset_class, direction,
      entry_price, exit_price, quantity, entry_at, exit_at, status,
      outcome, pnl, plan_adherence, emotional_state, entry_rationale,
      revenge_flag, created_at, updated_at
    FROM trades WHERE trade_id = $1`,
    [input.tradeId]
  );

  return { trade: rowToTrade(existingResult.rows[0]), isNew: false };
}

// ── Get Trade by ID ─────────────────────────────────────────────────────────

/**
 * Fetch a single trade by tradeId.
 * Returns null if not found, or the trade object.
 *
 * Tenancy is NOT checked here — caller must verify.
 *
 * @param {string} tradeId
 * @returns {object|null}
 */
async function getTradeById(tradeId) {
  const pool = getPool();

  const result = await pool.query(
    `SELECT trade_id, user_id, session_id, asset, asset_class, direction,
      entry_price, exit_price, quantity, entry_at, exit_at, status,
      outcome, pnl, plan_adherence, emotional_state, entry_rationale,
      revenge_flag, created_at, updated_at
    FROM trades WHERE trade_id = $1`,
    [tradeId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToTrade(result.rows[0]);
}

module.exports = { createTrade, getTradeById, rowToTrade, computePnlAndOutcome };
