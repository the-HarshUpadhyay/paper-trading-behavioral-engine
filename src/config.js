// src/config.js — Centralized environment variable access
// Phase 1: Foundation

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://nevup:nevup@localhost:5432/nevup',
    pool: {
      min: 2,
      max: 20, // sized for 200 VU load test headroom
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || '97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02',
    expiresInSeconds: 86400, // 24 hours
  },

  stream: {
    name: 'trade:closed',
    group: 'metric-workers',
    consumer: `worker-${process.pid}`,
  },
};

module.exports = config;
