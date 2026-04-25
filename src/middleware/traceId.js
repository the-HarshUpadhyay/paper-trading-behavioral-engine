// src/middleware/traceId.js — Generate UUID per request, attach to req.traceId
// Phase 2: Auth + Core Middleware

const crypto = require('crypto');

/**
 * Attach a unique traceId to every request.
 * This traceId appears in:
 * - Structured logs (via pino-http)
 * - Error response bodies (via errorHandler)
 */
function traceIdMiddleware(req, res, next) {
  req.traceId = crypto.randomUUID();
  next();
}

module.exports = traceIdMiddleware;
