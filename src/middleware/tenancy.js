// src/middleware/tenancy.js — Tenancy enforcement helpers
// Phase 2: Auth + Core Middleware

const errors = require('../utils/errors');

/**
 * Create a middleware that enforces tenancy on a path parameter.
 * Use for endpoints like GET /users/:userId/metrics where the userId
 * is directly in the URL path.
 *
 * @param {string} paramName - The route parameter to check (e.g. 'userId')
 * @returns {Function} Express middleware
 */
function enforcePathTenancy(paramName) {
  return (req, res, next) => {
    const targetUserId = req.params[paramName];
    if (targetUserId !== req.userId) {
      const err = errors.forbidden('Cross-tenant access denied.', req.traceId);
      return res.status(err.statusCode).json(err.body);
    }
    next();
  };
}

/**
 * Check tenancy on a fetched resource. Use in route handlers after
 * fetching a resource from the database.
 * 
 * Returns null if tenancy passes, or an error response object if it fails.
 * 
 * @param {object} resource - The DB row with a user_id field
 * @param {string} requestUserId - req.userId from JWT
 * @param {string} traceId - req.traceId
 * @returns {null | { statusCode: number, body: object }}
 */
function checkResourceTenancy(resource, requestUserId, traceId) {
  if (resource.user_id !== requestUserId) {
    return errors.forbidden('Cross-tenant access denied.', traceId);
  }
  return null;
}

module.exports = { enforcePathTenancy, checkResourceTenancy };
