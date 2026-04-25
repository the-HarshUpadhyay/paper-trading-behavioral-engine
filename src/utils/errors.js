// src/utils/errors.js — Standardized error response factory
// Phase 2: Auth + Core Middleware

/**
 * Application error class with HTTP status code and error code
 */
class AppError extends Error {
  constructor(statusCode, errorCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * Create a standardized error response object
 * @param {string} errorCode - Machine-readable error code
 * @param {string} message - Human-readable description
 * @param {string} traceId - Request trace ID
 * @returns {{ error: string, message: string, traceId: string }}
 */
function errorResponse(errorCode, message, traceId) {
  return { error: errorCode, message, traceId };
}

// ── Factory functions ────────────────────────────────────────────────────────

function unauthorized(message = 'Missing or invalid JWT.', traceId = '') {
  return { statusCode: 401, body: errorResponse('UNAUTHORIZED', message, traceId) };
}

function tokenExpired(traceId = '') {
  return { statusCode: 401, body: errorResponse('TOKEN_EXPIRED', 'Token has expired.', traceId) };
}

function forbidden(message = 'Cross-tenant access denied.', traceId = '') {
  return { statusCode: 403, body: errorResponse('FORBIDDEN', message, traceId) };
}

function notFound(resource, traceId = '') {
  return { statusCode: 404, body: errorResponse(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} with the given ID does not exist.`, traceId) };
}

function badRequest(message = 'Invalid request body or parameters.', traceId = '') {
  return { statusCode: 400, body: errorResponse('BAD_REQUEST', message, traceId) };
}

function internalError(traceId = '') {
  return { statusCode: 500, body: errorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', traceId) };
}

module.exports = {
  AppError,
  errorResponse,
  unauthorized,
  tokenExpired,
  forbidden,
  notFound,
  badRequest,
  internalError,
};
