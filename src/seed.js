// src/seed.js — Load nevup_seed_dataset.json, insert sessions + trades
// Phase 1: Foundation

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const SEED_FILE = path.join(__dirname, '..', 'given', 'nevup_seed_dataset.json');

async function seed() {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    ...config.database.pool,
  });

  try {
    // Check if already seeded (idempotent)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM trades');
    if (rows[0].count > 0) {
      console.log(`[seed] Database already has ${rows[0].count} trades, skipping seed`);
      return;
    }

    console.log('[seed] Loading seed dataset...');
    const raw = fs.readFileSync(SEED_FILE, 'utf8');
    const dataset = JSON.parse(raw);

    let sessionCount = 0;
    let tradeCount = 0;

    // Use a transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const trader of dataset.traders) {
        for (const session of trader.sessions) {
          // Insert session
          await client.query(
            `INSERT INTO sessions (session_id, user_id, date, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (session_id) DO NOTHING`,
            [session.sessionId, session.userId, session.date, session.notes || null]
          );
          sessionCount++;

          // Insert trades for this session
          for (const trade of session.trades) {
            await client.query(
              `INSERT INTO trades (
                trade_id, user_id, session_id, asset, asset_class, direction,
                entry_price, exit_price, quantity, entry_at, exit_at, status,
                outcome, pnl, plan_adherence, emotional_state, entry_rationale,
                revenge_flag, created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, NOW(), NOW()
              )
              ON CONFLICT (trade_id) DO NOTHING`,
              [
                trade.tradeId,
                trade.userId,
                trade.sessionId,
                trade.asset,
                trade.assetClass,
                trade.direction,
                trade.entryPrice,
                trade.exitPrice,
                trade.quantity,
                trade.entryAt,
                trade.exitAt,
                trade.status,
                trade.outcome || null,
                trade.pnl || null,
                trade.planAdherence || null,
                trade.emotionalState || null,
                trade.entryRationale || null,
                trade.revengeFlag || false,
              ]
            );
            tradeCount++;
          }
        }
      }

      await client.query('COMMIT');
      console.log(`[seed] ✓ Inserted ${sessionCount} sessions, ${tradeCount} trades`);

      // Verify counts
      const tradeResult = await pool.query('SELECT COUNT(*)::int AS count FROM trades');
      const sessionResult = await pool.query('SELECT COUNT(*)::int AS count FROM sessions');
      console.log(`[seed] Verification — trades: ${tradeResult.rows[0].count}, sessions: ${sessionResult.rows[0].count}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[seed] Seeding failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  seed();
}

module.exports = seed;
