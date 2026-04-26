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
    secret: (() => {
      if (!process.env.JWT_SECRET) {
        throw new Error('FATAL: JWT_SECRET environment variable is required but not set.');
      }
      return process.env.JWT_SECRET;
    })(),
    expiresInSeconds: 86400, // 24 hours
  },

  stream: {
    name: 'trade:closed',
    group: 'metric-workers',
    consumer: `worker-${process.pid}`,
  },
};

module.exports = config;
