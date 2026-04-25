// src/server.js — Express app bootstrap, middleware chain, route mounting
// Phase 2: Auth + Core Middleware

const express = require('express');
const pinoHttp = require('pino-http');
const pino = require('pino');
const config = require('./config');

// Middleware
const traceIdMiddleware = require('./middleware/traceId');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

// Create pino logger instance
const logger = pino({ level: config.logLevel });

// Create Express app
const app = express();

// ── Middleware Chain ─────────────────────────────────────────────────────────
// Order matters: traceId first, then logging, then body parsing, then auth

// 1. Attach traceId to every request
app.use(traceIdMiddleware);

// 2. Structured JSON logging with pino-http
app.use(pinoHttp({
  logger,
  // Customize the log object to include our traceId and userId
  customProps: (req) => ({
    traceId: req.traceId,
    userId: req.userId || 'anonymous',
  }),
  // Customize serializers to control what's logged
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      traceId: req.raw?.traceId,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
}));

// 3. Parse JSON request bodies
app.use(express.json());

// 4. JWT authentication (skips /health internally)
app.use(authMiddleware);

// ── Routes ──────────────────────────────────────────────────────────────────

// Health check (no auth — handled by auth middleware skip)
const healthRouter = require('./routes/health');
app.use(healthRouter);

// Trade routes
const tradesRouter = require('./routes/trades');
app.use(tradesRouter);

// Session routes
const sessionsRouter = require('./routes/sessions');
app.use(sessionsRouter);

// User routes
const usersRouter = require('./routes/users');
app.use(usersRouter);

// ── Error Handling ──────────────────────────────────────────────────────────

// 404 catch-all for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found.`,
    traceId: req.traceId,
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// ── Start Server ────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'API server started');
  });
}

module.exports = app;
