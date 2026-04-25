// src/routes/sessions.js — Session routes
// Phase 5: Read API

const { Router } = require('express');
const { getSessionById, saveDebrief } = require('../services/sessionService');
const { checkResourceTenancy } = require('../middleware/tenancy');
const errors = require('../utils/errors');

const router = Router();

// ── Validation ──────────────────────────────────────────────────────────────

const VALID_MOODS = ['calm', 'anxious', 'greedy', 'fearful', 'neutral'];

function validateDebriefInput(body, traceId) {
  const missing = [];
  if (!body.overallMood) missing.push('overallMood');
  if (body.planAdherenceRating == null) missing.push('planAdherenceRating');

  if (missing.length > 0) {
    return errors.badRequest(`Missing required fields: ${missing.join(', ')}`, traceId);
  }
  if (!VALID_MOODS.includes(body.overallMood)) {
    return errors.badRequest(`Invalid overallMood: ${body.overallMood}. Must be one of: ${VALID_MOODS.join(', ')}`, traceId);
  }
  if (body.planAdherenceRating < 1 || body.planAdherenceRating > 5) {
    return errors.badRequest('planAdherenceRating must be between 1 and 5.', traceId);
  }
  if (body.keyMistake && body.keyMistake.length > 1000) {
    return errors.badRequest('keyMistake must be 1000 characters or less.', traceId);
  }
  if (body.keyLesson && body.keyLesson.length > 1000) {
    return errors.badRequest('keyLesson must be 1000 characters or less.', traceId);
  }

  return null;
}

// ── GET /sessions/:sessionId ────────────────────────────────────────────────

router.get('/sessions/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await getSessionById(sessionId);

    if (!session) {
      const err = errors.notFound('Session', req.traceId);
      return res.status(err.statusCode).json(err.body);
    }

    // Tenancy check — 403 never 404
    const tenancyError = checkResourceTenancy(
      { user_id: session.userId },
      req.userId,
      req.traceId
    );
    if (tenancyError) {
      return res.status(tenancyError.statusCode).json(tenancyError.body);
    }

    return res.status(200).json(session);
  } catch (err) {
    next(err);
  }
});

// ── POST /sessions/:sessionId/debrief ───────────────────────────────────────

router.post('/sessions/:sessionId/debrief', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // Check session exists
    const session = await getSessionById(sessionId);

    if (!session) {
      const err = errors.notFound('Session', req.traceId);
      return res.status(err.statusCode).json(err.body);
    }

    // Tenancy check
    const tenancyError = checkResourceTenancy(
      { user_id: session.userId },
      req.userId,
      req.traceId
    );
    if (tenancyError) {
      return res.status(tenancyError.statusCode).json(tenancyError.body);
    }

    // Validate input
    const validationError = validateDebriefInput(req.body, req.traceId);
    if (validationError) {
      return res.status(validationError.statusCode).json(validationError.body);
    }

    // Save debrief
    const result = await saveDebrief(sessionId, req.body);

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /sessions/:sessionId/coaching ───────────────────────────────────────

router.get('/sessions/:sessionId/coaching', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // Check session exists
    const session = await getSessionById(sessionId);

    if (!session) {
      const err = errors.notFound('Session', req.traceId);
      return res.status(err.statusCode).json(err.body);
    }

    // Tenancy check
    const tenancyError = checkResourceTenancy(
      { user_id: session.userId },
      req.userId,
      req.traceId
    );
    if (tenancyError) {
      return res.status(tenancyError.statusCode).json(tenancyError.body);
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Generate coaching message based on session data
    const closedTrades = session.trades.filter(t => t.status === 'closed');
    const wins = closedTrades.filter(t => t.outcome === 'win').length;
    const losses = closedTrades.filter(t => t.outcome === 'loss').length;

    const coachingMessage = generateCoachingMessage(session, wins, losses);
    const tokens = coachingMessage.split(/(?<=\s)/); // Split on whitespace, keeping spaces

    // Stream tokens one at a time
    for (let i = 0; i < tokens.length; i++) {
      res.write(`event: token\ndata: ${JSON.stringify({ token: tokens[i], index: i })}\n\n`);
      // Small delay to simulate streaming
      await new Promise(r => setTimeout(r, 50));
    }

    // Send done event with full message
    res.write(`event: done\ndata: ${JSON.stringify({ fullMessage: coachingMessage })}\n\n`);
    res.end();
  } catch (err) {
    next(err);
  }
});

/**
 * Generate a coaching message based on session data.
 * Returns a contextual message referencing actual trade stats.
 */
function generateCoachingMessage(session, wins, losses) {
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total * 100).toFixed(0) : 0;
  const pnl = session.totalPnl;

  let msg = `Session Review: You completed ${total} trades`;

  if (pnl >= 0) {
    msg += ` with a total P&L of $${pnl.toFixed(2)}.`;
    msg += ` Your win rate was ${winRate}%, which shows ${winRate >= 60 ? 'strong discipline' : 'room for improvement'}.`;
  } else {
    msg += ` with a net loss of $${Math.abs(pnl).toFixed(2)}.`;
    msg += ` Your win rate was ${winRate}%. Let's review what happened.`;
  }

  if (wins > losses) {
    msg += ` Great job maintaining a positive edge today.`;
    msg += ` Focus on replicating the setups that worked well.`;
  } else if (losses > wins) {
    msg += ` Consider reviewing your entry criteria — were your setups aligned with your plan?`;
    msg += ` Remember, cutting losses early protects your capital for better opportunities.`;
  }

  msg += ` Keep journaling and reflecting after each session — consistency in self-review is what separates good traders from great ones.`;

  return msg;
}

module.exports = router;
