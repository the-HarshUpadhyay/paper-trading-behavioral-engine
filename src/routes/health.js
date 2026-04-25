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

    // Get pending message count as queue lag (integer)
    try {
      const pending = await r.xpending(config.stream.name, config.stream.group);
      // XPENDING returns [totalPending, minId, maxId, [[consumer, count], ...]]
      queueLag = pending && pending[0] ? parseInt(pending[0], 10) : 0;
    } catch {
      // Stream or consumer group may not exist yet — that's ok
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
