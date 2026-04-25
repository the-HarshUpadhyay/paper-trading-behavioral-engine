// src/middleware/errorHandler.js — Global error handler with traceId
// Phase 2: Auth + Core Middleware

const pino = require('pino');
const logger = pino({ level: 'error' });

/**
 * Global Express error handler.
 * Catches any unhandled errors thrown in route handlers or middleware.
 * Always returns the spec-mandated { error, message, traceId } shape.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const traceId = req.traceId || 'unknown';
  const statusCode = err.statusCode || 500;
  const errorCode = err.errorCode || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred.';

  // Log the error with full context
  logger.error({
    traceId,
    userId: req.userId || 'anonymous',
    statusCode,
    errorCode,
    method: req.method,
    url: req.originalUrl,
    stack: statusCode === 500 ? err.stack : undefined,
  }, message);

  res.status(statusCode).json({
    error: errorCode,
    message,
    traceId,
  });
}

module.exports = errorHandler;
