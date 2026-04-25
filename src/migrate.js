// src/migrate.js — Run SQL migration files in order
// Phase 1: Foundation

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function migrate() {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    ...config.database.pool,
  });

  try {
    // Read all .sql files, sorted by filename (001, 002, etc.)
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`[migrate] Found ${files.length} migration files`);

    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`[migrate] Running ${file}...`);
      await pool.query(sql);
      console.log(`[migrate] ✓ ${file} complete`);
    }

    console.log(`[migrate] All ${files.length} migrations complete`);
  } catch (err) {
    console.error('[migrate] Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly (not imported)
if (require.main === module) {
  migrate();
}

module.exports = migrate;
