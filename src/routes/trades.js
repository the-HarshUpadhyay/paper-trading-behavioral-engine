// src/routes/trades.js — POST /trades + GET /trades/:tradeId
// Phase 3: Write API

const { Router } = require('express');
const { createTrade, getTradeById } = require('../services/tradeService');
const { checkResourceTenancy } = require('../middleware/tenancy');
const errors = require('../utils/errors');

const router = Router();

// ── Validation ──────────────────────────────────────────────────────────────

const VALID_ASSET_CLASSES = ['equity', 'crypto', 'forex'];
const VALID_DIRECTIONS = ['long', 'short'];
const VALID_STATUSES = ['open', 'closed', 'cancelled'];
const VALID_EMOTIONS = ['calm', 'anxious', 'greedy', 'fearful', 'neutral'];

function validateTradeInput(body, traceId) {
  const missing = [];

  if (!body.tradeId) missing.push('tradeId');
  if (!body.userId) missing.push('userId');
  if (!body.sessionId) missing.push('sessionId');
  if (!body.asset) missing.push('asset');
  if (!body.assetClass) missing.push('assetClass');
  if (!body.direction) missing.push('direction');
  if (body.entryPrice == null) missing.push('entryPrice');
  if (body.quantity == null) missing.push('quantity');
  if (!body.entryAt) missing.push('entryAt');
  if (!body.status) missing.push('status');

  if (missing.length > 0) {
    return errors.badRequest(`Missing required fields: ${missing.join(', ')}`, traceId);
  }

  if (!VALID_ASSET_CLASSES.includes(body.assetClass)) {
    return errors.badRequest(`Invalid assetClass: ${body.assetClass}. Must be one of: ${VALID_ASSET_CLASSES.join(', ')}`, traceId);
  }
  if (!VALID_DIRECTIONS.includes(body.direction)) {
    return errors.badRequest(`Invalid direction: ${body.direction}. Must be one of: ${VALID_DIRECTIONS.join(', ')}`, traceId);
  }
  if (!VALID_STATUSES.includes(body.status)) {
    return errors.badRequest(`Invalid status: ${body.status}. Must be one of: ${VALID_STATUSES.join(', ')}`, traceId);
  }
  if (body.emotionalState && !VALID_EMOTIONS.includes(body.emotionalState)) {
    return errors.badRequest(`Invalid emotionalState: ${body.emotionalState}. Must be one of: ${VALID_EMOTIONS.join(', ')}`, traceId);
  }
  if (body.planAdherence != null && (body.planAdherence < 1 || body.planAdherence > 5)) {
    return errors.badRequest('planAdherence must be between 1 and 5.', traceId);
  }
  if (body.entryRationale && body.entryRationale.length > 500) {
    return errors.badRequest('entryRationale must be 500 characters or less.', traceId);
  }

  return null; // valid
}

// ── POST /trades ────────────────────────────────────────────────────────────

router.post('/trades', async (req, res, next) => {
  try {
    const body = req.body;

    // 1. Validate request body
    const validationError = validateTradeInput(body, req.traceId);
    if (validationError) {
      return res.status(validationError.statusCode).json(validationError.body);
    }

    // 2. Tenancy check on write: body.userId must match JWT userId
    if (body.userId !== req.userId) {
      const err = errors.forbidden('Cross-tenant access denied.', req.traceId);
      return res.status(err.statusCode).json(err.body);
    }

    // 3. Create trade (idempotent)
    const { trade } = await createTrade(body);

    // 4. Always return 200 (spec: both new and duplicate return 200)
    return res.status(200).json(trade);
  } catch (err) {
    next(err);
  }
});

// ── GET /trades/:tradeId ────────────────────────────────────────────────────

router.get('/trades/:tradeId', async (req, res, next) => {
  try {
    const { tradeId } = req.params;

    // 1. Fetch trade
    const trade = await getTradeById(tradeId);

    // 2. Not found
    if (!trade) {
      const err = errors.notFound('Trade', req.traceId);
      return res.status(err.statusCode).json(err.body);
    }

    // 3. Tenancy check — MUST return 403, never 404 for cross-tenant
    const tenancyError = checkResourceTenancy(
      { user_id: trade.userId }, // checkResourceTenancy expects snake_case key
      req.userId,
      req.traceId
    );
    if (tenancyError) {
      return res.status(tenancyError.statusCode).json(tenancyError.body);
    }

    // 4. Return trade
    return res.status(200).json(trade);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
