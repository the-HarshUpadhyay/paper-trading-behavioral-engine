// src/workers/index.js — Worker process entry point, consumer group setup
// Phase 4: Async Pipeline

const config = require('../config');
const { getRedis, closeRedis } = require('../plugins/redis');
const { getPool, closePool } = require('../plugins/database');

// Metric handlers
const computePlanAdherence = require('./planAdherence');
const computeRevengeFlag = require('./revengeFlag');
const computeSessionTilt = require('./sessionTilt');
const computeWinRateByEmotion = require('./winRateByEmotion');
const computeOvertrading = require('./overtradingDetector');

let running = true;

/**
 * Parse a Redis Stream message (flat key-value array) into a trade object.
 * XREADGROUP returns: [messageId, [key1, val1, key2, val2, ...]]
 */
function parseStreamMessage(fields) {
  const trade = {};
  for (let i = 0; i < fields.length; i += 2) {
    trade[fields[i]] = fields[i + 1];
  }
  // Convert numeric strings back to numbers
  trade.entryPrice = parseFloat(trade.entryPrice) || 0;
  trade.exitPrice = parseFloat(trade.exitPrice) || 0;
  trade.quantity = parseFloat(trade.quantity) || 0;
  trade.pnl = parseFloat(trade.pnl) || 0;
  trade.planAdherence = trade.planAdherence ? parseInt(trade.planAdherence, 10) : null;
  return trade;
}

/**
 * Process a single trade through all 5 metric handlers.
 * Sequential execution — simpler error handling.
 */
async function processMessage(trade) {
  console.log(`[worker] Processing trade ${trade.tradeId} for user ${trade.userId}`);

  await computePlanAdherence(trade);
  console.log(`[worker]   ✓ planAdherence`);

  await computeRevengeFlag(trade);
  console.log(`[worker]   ✓ revengeFlag`);

  await computeSessionTilt(trade);
  console.log(`[worker]   ✓ sessionTilt`);

  await computeWinRateByEmotion(trade);
  console.log(`[worker]   ✓ winRateByEmotion`);

  await computeOvertrading(trade);
  console.log(`[worker]   ✓ overtradingDetector`);
}

/**
 * Ensure consumer group exists. Uses MKSTREAM.
 */
async function ensureGroup(redis) {
  try {
    await redis.xgroup(
      'CREATE',
      config.stream.name,
      config.stream.group,
      '0',
      'MKSTREAM'
    );
    console.log(`[worker] Created consumer group "${config.stream.group}" on "${config.stream.name}"`);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      throw err;
    }
    console.log(`[worker] Consumer group "${config.stream.group}" already exists`);
  }
}

/**
 * Main consumer loop: XREADGROUP → process → XACK
 */
async function run() {
  const redis = getRedis();
  const consumer = config.stream.consumer;

  console.log(`[worker] Worker started (PID: ${process.pid})`);
  console.log(`[worker] Stream: ${config.stream.name}, Group: ${config.stream.group}, Consumer: ${consumer}`);

  await ensureGroup(redis);

  // First, process any pending messages (crash recovery)
  await processPending(redis, consumer);

  // Main loop: read new messages
  while (running) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', config.stream.group, consumer,
        'COUNT', 10,
        'BLOCK', 5000, // Block for 5s waiting for new messages
        'STREAMS', config.stream.name,
        '>' // Only new messages
      );

      if (!results) continue; // Timeout — no new messages

      const [, messages] = results[0]; // [[streamName, [[id, fields], ...]]]

      for (const [messageId, fields] of messages) {
        const trade = parseStreamMessage(fields);

        try {
          await processMessage(trade);
          // ACK after successful processing
          await redis.xack(config.stream.name, config.stream.group, messageId);
          console.log(`[worker] ✓ ACK ${messageId}`);
        } catch (err) {
          // Don't XACK on error — message stays in PEL for retry
          console.error(`[worker] ✗ Error processing ${messageId}: ${err.message}`);
        }
      }
    } catch (err) {
      if (running) {
        console.error('[worker] Consumer loop error:', err.message);
        // Brief pause before retrying
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
}

/**
 * Process any pending messages from the PEL (Pending Entries List).
 * This handles messages that were read but not ACKed (crash recovery).
 */
async function processPending(redis, consumer) {
  try {
    const results = await redis.xreadgroup(
      'GROUP', config.stream.group, consumer,
      'COUNT', 100,
      'STREAMS', config.stream.name,
      '0' // Pending messages
    );

    if (!results) return;

    const [, messages] = results[0];
    if (messages.length === 0) return;

    console.log(`[worker] Processing ${messages.length} pending messages...`);

    for (const [messageId, fields] of messages) {
      if (!fields || fields.length === 0) continue; // Already ACKed

      const trade = parseStreamMessage(fields);
      try {
        await processMessage(trade);
        await redis.xack(config.stream.name, config.stream.group, messageId);
        console.log(`[worker] ✓ Recovered ${messageId}`);
      } catch (err) {
        console.error(`[worker] ✗ Failed to recover ${messageId}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[worker] PEL processing error:', err.message);
  }
}

// ── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`[worker] ${signal} received, shutting down...`);
  running = false;

  // Give current processing time to finish
  await new Promise(r => setTimeout(r, 1000));

  await closeRedis();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the worker
run().catch(err => {
  console.error('[worker] Fatal error:', err.message);
  process.exit(1);
});
