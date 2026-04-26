#!/usr/bin/env node
// tests/verify-idempotency-db.js — Direct DB verification that no duplicates exist
//
// Usage (against running Docker PostgreSQL):
//   node tests/verify-idempotency-db.js [tradeId]
//
// If tradeId is omitted, checks ALL trades for duplicate trade_ids.

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://nevup:nevup@localhost:5432/nevup';
const tradeId = process.argv[2]; // optional

async function verify() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║          DB IDEMPOTENCY VERIFICATION                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    if (tradeId) {
      // ── Single tradeId verification ─────────────────────────────────
      const result = await pool.query(
        `SELECT COUNT(*) AS count FROM trades WHERE trade_id = $1`,
        [tradeId]
      );
      const count = parseInt(result.rows[0].count, 10);

      console.log(`║  tradeId: ${tradeId}  ║`);
      console.log(`║  COUNT(*): ${count}                                              ║`);
      console.log(`║  Status: ${count === 1 ? 'PASS ✅ — exactly 1 record' : count === 0 ? 'WARN ⚠️ — no record found' : `FAIL ❌ — ${count} DUPLICATES`}       ║`);

      if (count > 1) {
        // Show the duplicates
        const dupes = await pool.query(
          `SELECT trade_id, created_at, entry_price, status FROM trades WHERE trade_id = $1 ORDER BY created_at`,
          [tradeId]
        );
        console.log('║                                                              ║');
        console.log('║  DUPLICATE RECORDS:                                          ║');
        for (const row of dupes.rows) {
          console.log(`║    ${row.trade_id} | ${row.created_at} | ${row.entry_price} | ${row.status} ║`);
        }
        process.exitCode = 1;
      }
    } else {
      // ── Global duplicate scan ───────────────────────────────────────
      const result = await pool.query(`
        SELECT trade_id, COUNT(*) AS count
        FROM trades
        GROUP BY trade_id
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 20
      `);

      const totalTrades = await pool.query('SELECT COUNT(*) AS count FROM trades');
      const uniqueTrades = await pool.query('SELECT COUNT(DISTINCT trade_id) AS count FROM trades');

      console.log(`║  Total rows:    ${totalTrades.rows[0].count.toString().padStart(8)}                                ║`);
      console.log(`║  Unique IDs:    ${uniqueTrades.rows[0].count.toString().padStart(8)}                                ║`);
      console.log(`║  Duplicates:    ${result.rows.length.toString().padStart(8)}                                ║`);
      console.log(`║                                                              ║`);

      if (result.rows.length === 0) {
        console.log('║  Status: PASS ✅ — zero duplicate trade_ids                ║');
      } else {
        console.log('║  Status: FAIL ❌ — DUPLICATES FOUND                        ║');
        console.log('║                                                              ║');
        for (const row of result.rows) {
          console.log(`║  trade_id=${row.trade_id} count=${row.count}  ║`);
        }
        process.exitCode = 1;
      }
    }

    console.log('╚══════════════════════════════════════════════════════════════╝');

    // ── Raw SQL for manual verification ─────────────────────────────
    console.log('\n-- Copy-paste SQL for manual verification:\n');

    if (tradeId) {
      console.log(`-- Single tradeId check:`);
      console.log(`SELECT COUNT(*) FROM trades WHERE trade_id = '${tradeId}';`);
      console.log(`-- Must return exactly 1\n`);
    }

    console.log(`-- Global duplicate scan:`);
    console.log(`SELECT trade_id, COUNT(*) AS dup_count`);
    console.log(`FROM trades`);
    console.log(`GROUP BY trade_id`);
    console.log(`HAVING COUNT(*) > 1;`);
    console.log(`-- Must return 0 rows\n`);

    console.log(`-- Verify PRIMARY KEY constraint exists:`);
    console.log(`SELECT constraint_name, constraint_type`);
    console.log(`FROM information_schema.table_constraints`);
    console.log(`WHERE table_name = 'trades' AND constraint_type = 'PRIMARY KEY';`);
    console.log(`-- Must return trades_pkey\n`);

  } finally {
    await pool.end();
  }
}

verify().catch(err => {
  console.error('Verification failed:', err.message);
  process.exitCode = 1;
});
