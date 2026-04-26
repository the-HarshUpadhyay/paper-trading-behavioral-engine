/**
 * loadtest/async-pipeline.js — k6 load test proving async pipeline decoupling
 *
 * Strategy:
 *   - Sustain 200 closed-trade writes/sec for 60s
 *   - Monitor write latency: must remain flat and < 50ms p95
 *   - If metrics were computed synchronously, latency would spike
 *   - Simultaneously monitor /health queueLag to prove events are queued
 *
 * The KEY metric: write_latency MUST be independent of worker processing speed.
 * If the worker is slow or backlogged, write_latency must stay the same.
 *
 * Usage:
 *   node loadtest/generate_tokens.js > /dev/null
 *   K6_WEB_DASHBOARD=true k6 run loadtest/async-pipeline.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Gauge } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Custom Metrics ──────────────────────────────────────────────────────────

const writeLatency     = new Trend('async_write_latency', true);
const healthLatency    = new Trend('async_health_latency', true);
const queueLagGauge    = new Gauge('async_queue_lag');
const writeSuccess     = new Counter('async_write_success');
const writeErrors      = new Counter('async_write_errors');

// ── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./users.json'));
});

const ASSET_CLASSES = ['equity', 'crypto', 'forex'];
const DIRECTIONS    = ['long', 'short'];
const EMOTIONS      = ['calm', 'anxious', 'greedy', 'fearful', 'neutral'];
const ASSETS = {
  equity: ['AAPL', 'MSFT', 'TSLA', 'GOOG', 'NVDA'],
  crypto: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
  forex:  ['EUR/USD', 'GBP/USD', 'USD/JPY'],
};

function randomElement(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)); }

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Main write load — ALL closed trades (every one produces a stream event)
    async_write_load: {
      executor: 'constant-arrival-rate',
      exec: 'writeClosedTrade',
      rate: 200,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 150,
      maxVUs: 400,
    },

    // Health monitor — check queueLag periodically
    health_monitor: {
      executor: 'constant-arrival-rate',
      exec: 'checkHealth',
      rate: 2,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },

  thresholds: {
    // CRITICAL: Write latency must be low — proves async decoupling
    // If metrics were computed synchronously, p95 would be >> 50ms
    'async_write_latency': [
      'p(50)<20',      // p50 < 20ms
      'p(95)<50',      // p95 < 50ms — THE key threshold
      'p(99)<100',     // p99 < 100ms
    ],

    // Zero write failures
    'http_req_failed': ['rate<0.01'],

    // No dropped iterations
    'dropped_iterations': ['count==0'],
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

// ── Write Scenario ──────────────────────────────────────────────────────────

export function writeClosedTrade() {
  const user = randomElement(users);
  const assetClass = randomElement(ASSET_CLASSES);
  const asset = randomElement(ASSETS[assetClass]);
  const direction = randomElement(DIRECTIONS);
  const entryPrice = randomFloat(10, 5000);

  // ALL trades are CLOSED — every single one triggers a Redis Stream XADD
  // This creates MAXIMUM queue pressure on the worker
  const payload = {
    tradeId:        uuidv4(),
    userId:         user.userId,
    sessionId:      user.sessionId,
    asset:          asset,
    assetClass:     assetClass,
    direction:      direction,
    entryPrice:     entryPrice,
    exitPrice:      randomFloat(entryPrice * 0.8, entryPrice * 1.2),
    quantity:       randomInt(1, 100),
    entryAt:        '2025-02-01T10:00:00Z',
    exitAt:         '2025-02-01T12:00:00Z',
    status:         'closed',                        // ← EVERY trade is closed
    planAdherence:  randomInt(1, 5),
    emotionalState: randomElement(EMOTIONS),
    entryRationale: `Async pipeline test - ${asset}`,
    revengeFlag:    false,
  };

  const params = {
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${user.token}`,
    },
    tags: { scenario: 'write' },
  };

  const res = http.post(`${BASE_URL}/trades`, JSON.stringify(payload), params);

  writeLatency.add(res.timings.duration);

  const ok = check(res, {
    'write: status is 200':      (r) => r.status === 200,
    'write: latency < 100ms':    (r) => r.timings.duration < 100,
    'write: has tradeId':        (r) => {
      try { return r.json().tradeId != null; } catch { return false; }
    },
  });

  if (ok) {
    writeSuccess.add(1);
  } else {
    writeErrors.add(1);
  }

  sleep(0.5); // Think-time for VU overlap
}

// ── Health Monitor Scenario ─────────────────────────────────────────────────

export function checkHealth() {
  const res = http.get(`${BASE_URL}/health`);

  healthLatency.add(res.timings.duration);

  try {
    const body = res.json();
    if (typeof body.queueLag === 'number') {
      queueLagGauge.add(body.queueLag);
    }
  } catch {
    // ignore parse errors
  }

  check(res, {
    'health: status is 200': (r) => r.status === 200,
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const totalReqs = data.metrics.async_write_success ? data.metrics.async_write_success.values.count : 0;
  const errors    = data.metrics.async_write_errors ? data.metrics.async_write_errors.values.count : 0;
  const dropped   = data.metrics.dropped_iterations ? data.metrics.dropped_iterations.values.count : 0;

  const p50 = data.metrics.async_write_latency ? data.metrics.async_write_latency.values['p(50)'] : 'N/A';
  const p95 = data.metrics.async_write_latency ? data.metrics.async_write_latency.values['p(95)'] : 'N/A';
  const p99 = data.metrics.async_write_latency ? data.metrics.async_write_latency.values['p(99)'] : 'N/A';

  const queueLag = data.metrics.async_queue_lag ? data.metrics.async_queue_lag.values.value : 'N/A';

  const p95Val  = typeof p95 === 'number' ? p95 : 999;
  const isAsync = p95Val < 50;

  const summary = `
╔══════════════════════════════════════════════════════════════════╗
║         ASYNC PIPELINE DECOUPLING — LOAD TEST RESULTS          ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Write Requests:     ${String(totalReqs).padStart(8)}  (all CLOSED → all produce events) ║
║  Write Errors:       ${String(errors).padStart(8)}                                  ║
║  Dropped Iterations: ${String(dropped).padStart(8)}                                  ║
║                                                                  ║
║  ✏️  WRITE LATENCY (POST /trades)                                ║
║  ─────────────────────────────────────────────────────────       ║
║  p50:  ${typeof p50 === 'number' ? p50.toFixed(2) + 'ms' : p50}                                                  ║
║  p95:  ${typeof p95 === 'number' ? p95.toFixed(2) + 'ms' : p95}   <── KEY METRIC                           ║
║  p99:  ${typeof p99 === 'number' ? p99.toFixed(2) + 'ms' : p99}                                                  ║
║                                                                  ║
║  📊 QUEUE STATE                                                  ║
║  ─────────────────────────────────────────────────────────       ║
║  Final queueLag:     ${typeof queueLag === 'number' ? String(queueLag).padStart(8) : queueLag}                               ║
║  (Non-zero queueLag PROVES events go through the queue)         ║
║                                                                  ║
║  VERDICT: ${isAsync ? 'ASYNC PIPELINE PROVEN ✅' : 'POSSIBLE SYNC COUPLING ❌'}                             ║
║  ${isAsync
    ? 'Write p95 < 50ms → metrics NOT in write path'
    : 'Write p95 ≥ 50ms → metrics may be synchronous'}                ║
╚══════════════════════════════════════════════════════════════════╝
`;

  return {
    stdout: summary,
    'loadtest/reports/async_pipeline_results.json': JSON.stringify({
      totalRequests: totalReqs,
      errors,
      droppedIterations: dropped,
      writeLatency: {
        p50: typeof p50 === 'number' ? parseFloat(p50.toFixed(2)) : null,
        p95: typeof p95 === 'number' ? parseFloat(p95.toFixed(2)) : null,
        p99: typeof p99 === 'number' ? parseFloat(p99.toFixed(2)) : null,
      },
      queueLag: typeof queueLag === 'number' ? queueLag : null,
      verdict: isAsync ? 'ASYNC_PIPELINE_PROVEN' : 'POSSIBLE_SYNC_COUPLING',
    }, null, 2),
  };
}
