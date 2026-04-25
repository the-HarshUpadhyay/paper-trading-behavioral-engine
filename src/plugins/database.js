// src/plugins/database.js — pg.Pool singleton
// Phase 3: Write API

const { Pool } = require('pg');
const config = require('../config');

let pool;

/**
 * Get the shared pg.Pool instance (lazy-initialized).
 * Pool max is set to 20 for load test headroom.
 * @returns {Pool}
 */
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.connectionString,
      min: config.database.pool.min,
      max: config.database.pool.max,
      idleTimeoutMillis: config.database.pool.idleTimeoutMillis,
      connectionTimeoutMillis: config.database.pool.connectionTimeoutMillis,
    });

    // Log pool errors (don't crash the process)
    pool.on('error', (err) => {
      console.error('[database] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Gracefully close the pool (for shutdown)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, closePool };
