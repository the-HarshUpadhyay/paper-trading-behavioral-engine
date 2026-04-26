/**
 * loadtest/idempotency.js — k6 load test proving idempotent POST /trades
 *
 * Strategy:
 *   - Pre-generate a FIXED tradeId before the test
 *   - All VUs fire POST /trades with the SAME tradeId concurrently
 *   - Every response must be HTTP 200 with identical body
 *   - Zero 409s, zero 500s, zero failures
 *
 * Usage:
 *   node loadtest/generate_tokens.js > /dev/null
 *   K6_WEB_DASHBOARD=true k6 run loadtest/idempotency.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Custom Metrics ──────────────────────────────────────────────────────────

const idempotencyLatency = new Trend('idempotency_latency', true);
const successCount       = new Counter('idempotency_success');
const conflictCount      = new Counter('idempotency_409_conflict');
const serverErrorCount   = new Counter('idempotency_500_error');
const bodyMismatchCount  = new Counter('idempotency_body_mismatch');
const idempotencyRate    = new Rate('idempotency_pass_rate');

// ── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./users.json'));
});

// Use the first user for all idempotency requests
const USER   = users[0];
const TOKEN  = USER.token;
const USER_ID = USER.userId;
const SESSION_ID = USER.sessionId;

// ── Fixed Trade Payload ─────────────────────────────────────────────────────
// ALL VUs send the SAME tradeId — this is the idempotency test.

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Generate ONE tradeId per test run — shared across all VUs
const FIXED_TRADE_ID = __ENV.TRADE_ID || uuidv4();

const FIXED_PAYLOAD = JSON.stringify({
  tradeId:        FIXED_TRADE_ID,
  userId:         USER_ID,
  sessionId:      SESSION_ID,
  asset:          'AAPL',
  assetClass:     'equity',
  direction:      'long',
  entryPrice:     150.00,
  exitPrice:      155.00,
  quantity:       10,
  entryAt:        '2025-02-01T10:00:00Z',
  exitAt:         '2025-02-01T12:00:00Z',
  status:         'closed',
  planAdherence:  4,
  emotionalState: 'calm',
  entryRationale: 'k6 idempotency test',
  revengeFlag:    false,
});

// ── Scenarios ───────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Phase 1: Warmup — low concurrency to establish the record
    idempotency_warmup: {
      executor: 'constant-arrival-rate',
      exec: 'idempotentWrite',
      rate: 10,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      startTime: '0s',
    },

    // Phase 2: Steady load — high concurrency duplicate bombardment
    idempotency_steady: {
      executor: 'constant-arrival-rate',
      exec: 'idempotentWrite',
      rate: 100,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 100,
      maxVUs: 200,
      startTime: '10s',
    },

    // Phase 3: Burst — spike of duplicates
    idempotency_burst: {
      executor: 'constant-arrival-rate',
      exec: 'idempotentWrite',
      rate: 200,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 150,
      maxVUs: 300,
      startTime: '40s',
    },
  },

  thresholds: {
    // Every response must be 200
    'http_req_failed':          ['rate==0'],
    // Zero 409 Conflict responses
    'idempotency_409_conflict': ['count==0'],
    // Zero 500 errors
    'idempotency_500_error':    ['count==0'],
    // Zero body mismatches
    'idempotency_body_mismatch': ['count==0'],
    // 100% pass rate
    'idempotency_pass_rate':    ['rate==1'],
    // p95 latency under 150ms
    'idempotency_latency':      ['p(95)<150'],
    // No dropped iterations
    'dropped_iterations':       ['count==0'],
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

// ── Reference Body ──────────────────────────────────────────────────────────
// Captured from the first successful response. All subsequent responses must match.

let referenceBody = null;

// ── Test Function ───────────────────────────────────────────────────────────

export function idempotentWrite() {
  const params = {
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  const res = http.post(`${BASE_URL}/trades`, FIXED_PAYLOAD, params);

  idempotencyLatency.add(res.timings.duration);

  // Check 1: Status must be 200
  const is200 = res.status === 200;

  // Check 2: Must NOT be 409
  if (res.status === 409) {
    conflictCount.add(1);
  }

  // Check 3: Must NOT be 500+
  if (res.status >= 500) {
    serverErrorCount.add(1);
  }

  // Check 4: Body must contain expected tradeId
  let bodyOk = false;
  try {
    const body = res.json();
    bodyOk = body && (body.tradeId === FIXED_TRADE_ID || body.trade_id === FIXED_TRADE_ID);

    // Check 5: Body must be identical across all requests
    // Compare core fields (exclude timestamps which may differ by microseconds)
    if (bodyOk) {
      const coreFields = {
        tradeId: body.tradeId || body.trade_id,
        userId: body.userId || body.user_id,
        asset: body.asset,
        assetClass: body.assetClass || body.asset_class,
        direction: body.direction,
        entryPrice: body.entryPrice || body.entry_price,
        exitPrice: body.exitPrice || body.exit_price,
        quantity: body.quantity,
        status: body.status,
        outcome: body.outcome,
        pnl: body.pnl,
      };

      if (referenceBody === null) {
        referenceBody = coreFields;
      } else {
        // Compare with reference
        const match = JSON.stringify(coreFields) === JSON.stringify(referenceBody);
        if (!match) {
          bodyMismatchCount.add(1);
          bodyOk = false;
        }
      }
    }
  } catch {
    bodyOk = false;
  }

  const passed = is200 && bodyOk;
  idempotencyRate.add(passed);

  if (passed) {
    successCount.add(1);
  }

  check(res, {
    'status is 200':     (r) => r.status === 200,
    'not 409 Conflict':  (r) => r.status !== 409,
    'not 500 Error':     (r) => r.status < 500,
    'has correct tradeId': () => bodyOk,
  });

  // Think-time for VU overlap (proves concurrency)
  sleep(0.3);
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const totalReqs  = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const passed     = data.metrics.idempotency_success ? data.metrics.idempotency_success.values.count : 0;
  const conflicts  = data.metrics.idempotency_409_conflict ? data.metrics.idempotency_409_conflict.values.count : 0;
  const errors     = data.metrics.idempotency_500_error ? data.metrics.idempotency_500_error.values.count : 0;
  const mismatches = data.metrics.idempotency_body_mismatch ? data.metrics.idempotency_body_mismatch.values.count : 0;
  const passRate   = data.metrics.idempotency_pass_rate ? data.metrics.idempotency_pass_rate.values.rate : 0;
  const p95        = data.metrics.idempotency_latency ? data.metrics.idempotency_latency.values['p(95)'] : 'N/A';
  const dropped    = data.metrics.dropped_iterations ? data.metrics.dropped_iterations.values.count : 0;

  const summary = `
╔══════════════════════════════════════════════════════════════════╗
║             IDEMPOTENCY LOAD TEST RESULTS                      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Fixed tradeId: ${FIXED_TRADE_ID}            ║
║                                                                  ║
║  Total Requests:     ${String(totalReqs).padStart(8)}                               ║
║  Successful (200):   ${String(passed).padStart(8)}                               ║
║  409 Conflicts:      ${String(conflicts).padStart(8)}  ${conflicts === 0 ? '✅' : '❌'}                          ║
║  500 Errors:         ${String(errors).padStart(8)}  ${errors === 0 ? '✅' : '❌'}                          ║
║  Body Mismatches:    ${String(mismatches).padStart(8)}  ${mismatches === 0 ? '✅' : '❌'}                          ║
║  Dropped Iterations: ${String(dropped).padStart(8)}  ${dropped === 0 ? '✅' : '❌'}                          ║
║  Pass Rate:          ${(passRate * 100).toFixed(1)}%  ${passRate === 1 ? '✅' : '❌'}                          ║
║  p95 Latency:        ${typeof p95 === 'number' ? p95.toFixed(2) + 'ms' : p95}                                     ║
║                                                                  ║
║  VERDICT: ${passRate === 1 && conflicts === 0 && errors === 0 && mismatches === 0 ? 'IDEMPOTENCY PROVEN ✅' : 'IDEMPOTENCY BROKEN ❌'}                               ║
╚══════════════════════════════════════════════════════════════════╝
`;

  return {
    stdout: summary,
    'loadtest/reports/idempotency_results.json': JSON.stringify({
      tradeId: FIXED_TRADE_ID,
      totalRequests: totalReqs,
      successful: passed,
      conflicts409: conflicts,
      errors500: errors,
      bodyMismatches: mismatches,
      passRate,
      p95: typeof p95 === 'number' ? parseFloat(p95.toFixed(2)) : null,
      droppedIterations: dropped,
      verdict: passRate === 1 && conflicts === 0 && errors === 0 && mismatches === 0
        ? 'IDEMPOTENCY_PROVEN'
        : 'IDEMPOTENCY_BROKEN',
    }, null, 2),
  };
}
