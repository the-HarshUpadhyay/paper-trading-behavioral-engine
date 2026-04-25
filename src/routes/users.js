// src/routes/users.js — User metrics and profile routes
// Phase 5: Read API

const { Router } = require('express');
const { enforcePathTenancy } = require('../middleware/tenancy');
const { getUserMetrics, getUserProfile } = require('../services/metricsService');
const errors = require('../utils/errors');

const router = Router();

// ── GET /users/:userId/metrics ──────────────────────────────────────────────

router.get('/users/:userId/metrics',
  enforcePathTenancy('userId'),
  async (req, res, next) => {
    try {
      const { userId } = req.params;
      const { from, to, granularity } = req.query;

      // Validate required query params
      if (!from || !to || !granularity) {
        const missing = [];
        if (!from) missing.push('from');
        if (!to) missing.push('to');
        if (!granularity) missing.push('granularity');
        const err = errors.badRequest(`Missing required query parameters: ${missing.join(', ')}`, req.traceId);
        return res.status(err.statusCode).json(err.body);
      }

      // Validate granularity enum
      const validGranularities = ['hourly', 'daily', 'rolling30d'];
      if (!validGranularities.includes(granularity)) {
        const err = errors.badRequest(
          `Invalid granularity: ${granularity}. Must be one of: ${validGranularities.join(', ')}`,
          req.traceId
        );
        return res.status(err.statusCode).json(err.body);
      }

      // Validate date formats
      if (isNaN(Date.parse(from))) {
        const err = errors.badRequest('Invalid "from" date format. Must be ISO-8601.', req.traceId);
        return res.status(err.statusCode).json(err.body);
      }
      if (isNaN(Date.parse(to))) {
        const err = errors.badRequest('Invalid "to" date format. Must be ISO-8601.', req.traceId);
        return res.status(err.statusCode).json(err.body);
      }

      const metrics = await getUserMetrics(userId, from, to, granularity);
      return res.status(200).json(metrics);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /users/:userId/profile ──────────────────────────────────────────────

router.get('/users/:userId/profile',
  enforcePathTenancy('userId'),
  async (req, res, next) => {
    try {
      const { userId } = req.params;
      const profile = await getUserProfile(userId);
      return res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
