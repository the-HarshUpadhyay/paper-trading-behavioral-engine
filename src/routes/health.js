// src/routes/health.js — GET /health (no auth required)
// Phase 2: Auth + Core Middleware

const { Router } = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const config = require('../config');

const router = Router();

// Lazy-initialize connections (reused across requests)
let pool;
let redis;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.connectionString,
      ...config.database.pool,
    });
  }
  return pool;
}

function getRedis() {
  if (!redis) {
    redis = new Redis(config.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }
  return redis;
}

router.get('/health', async (req, res) => {
  let dbConnection = 'disconnected';
  let queueLag = 0;
  let status = 'ok';

  // Check PostgreSQL
  try {
    await getPool().query('SELECT 1');
    dbConnection = 'connected';
  } catch {
    dbConnection = 'disconnected';
    status = 'degraded';
  }

  // Check Redis and get queue lag
  try {
    const r = getRedis();
    if (r.status !== 'ready') await r.connect();
    await r.ping();

    // Try to get stream lag from consumer group info
    try {
      const groups = await r.xinfo('GROUPS', config.stream.name);
      if (groups && groups.length > 0) {
        queueLag = groups[0][7] || 0; // lag field
      }
    } catch {
      // Stream may not exist yet — that's ok
      queueLag = 0;
    }
  } catch {
    status = 'degraded';
  }

  const statusCode = status === 'ok' ? 200 : 503;
  res.status(statusCode).json({
    status,
    dbConnection,
    queueLag,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
