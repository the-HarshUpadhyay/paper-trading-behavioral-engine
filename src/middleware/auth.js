// src/middleware/auth.js — JWT HS256 verification + req.userId extraction
// Phase 2: Auth + Core Middleware

const jwt = require('../utils/jwt');
const errors = require('../utils/errors');

/**
 * JWT authentication middleware.
 * Extracts and verifies the Bearer token, sets req.userId from jwt.sub.
 * 
 * Skips authentication for paths listed in the skip array (e.g. /health).
 */
function authMiddleware(req, res, next) {
  // Skip auth for health endpoint (spec: security: [])
  if (req.path === '/health') {
    req.userId = 'anonymous';
    return next();
  }

  const authHeader = req.headers.authorization;

  // No Authorization header → 401
  if (!authHeader) {
    const err = errors.unauthorized('Missing Authorization header.', req.traceId);
    return res.status(err.statusCode).json(err.body);
  }

  // Must be Bearer scheme
  if (!authHeader.startsWith('Bearer ')) {
    const err = errors.unauthorized('Authorization header must use Bearer scheme.', req.traceId);
    return res.status(err.statusCode).json(err.body);
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  if (!token) {
    const err = errors.unauthorized('Token is empty.', req.traceId);
    return res.status(err.statusCode).json(err.body);
  }

  // Verify token
  const result = jwt.verify(token);

  if (!result.valid) {
    // Distinguish expired tokens from other failures
    if (result.error === 'Token expired') {
      const err = errors.tokenExpired(req.traceId);
      return res.status(err.statusCode).json(err.body);
    }
    const err = errors.unauthorized(result.error, req.traceId);
    return res.status(err.statusCode).json(err.body);
  }

  // Set userId from jwt.sub for downstream use
  req.userId = result.payload.sub;
  req.jwtPayload = result.payload;

  next();
}

module.exports = authMiddleware;
