// src/plugins/redis.js — ioredis client singleton
// Phase 3: Write API

const Redis = require('ioredis');
const pino = require('pino');
const config = require('../config');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let client;

/**
 * Get the shared ioredis client (lazy-initialized).
 * @returns {Redis}
 */
function getRedis() {
  if (!client) {
    client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Exponential backoff: 100ms, 200ms, 400ms, ... max 5s
        const delay = Math.min(times * 100, 5000);
        return delay;
      },
    });

    client.on('error', (err) => {
      logger.error({ err: err.message }, 'Redis connection error');
    });
  }
  return client;
}

/**
 * Gracefully close the Redis connection (for shutdown)
 */
async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getRedis, closeRedis };
