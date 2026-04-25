// src/services/publisher.js — XADD to trade:closed Redis Stream
// Phase 3: Write API

const { getRedis } = require('../plugins/redis');
const config = require('../config');

let groupCreated = false;

/**
 * Ensure the consumer group exists (idempotent).
 * Uses MKSTREAM to create the stream if it doesn't exist.
 */
async function ensureConsumerGroup() {
  if (groupCreated) return;

  const redis = getRedis();
  try {
    await redis.xgroup(
      'CREATE',
      config.stream.name,
      config.stream.group,
      '0',
      'MKSTREAM'
    );
  } catch (err) {
    // BUSYGROUP = group already exists — that's fine
    if (!err.message.includes('BUSYGROUP')) {
      throw err;
    }
  }
  groupCreated = true;
}

/**
 * Publish a closed trade to the Redis Stream.
 * Only called when a trade with status === 'closed' is inserted.
 *
 * @param {object} trade - The trade object (camelCase fields)
 */
async function publishTradeClose(trade) {
  await ensureConsumerGroup();

  const redis = getRedis();
  await redis.xadd(
    config.stream.name,
    '*', // auto-generate message ID
    'tradeId', trade.tradeId,
    'userId', trade.userId,
    'sessionId', trade.sessionId,
    'asset', trade.asset,
    'direction', trade.direction,
    'entryPrice', String(trade.entryPrice),
    'exitPrice', String(trade.exitPrice),
    'quantity', String(trade.quantity),
    'entryAt', trade.entryAt,
    'exitAt', trade.exitAt,
    'status', trade.status,
    'outcome', trade.outcome ?? '',
    'pnl', String(trade.pnl ?? 0),
    'planAdherence', String(trade.planAdherence ?? ''),
    'emotionalState', trade.emotionalState ?? '',
  );
}

module.exports = { publishTradeClose, ensureConsumerGroup };
