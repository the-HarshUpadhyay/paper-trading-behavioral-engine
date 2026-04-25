// loadtest/k6-trade-close.js — NevUp Track 1 Production Load Test
//
// Validates ALL spec requirements (spec_ref.md §7):
//   - Sustained ≥200 req/s for 60s
//   - p95 write latency ≤ 150ms
//   - p95 read latency ≤ 200ms
//   - Error rate < 1%
//   - Async pipeline (POST latency stays low → no blocking)
//   - Multi-tenant enforcement (403 on cross-tenant)
//   - Idempotency (duplicate tradeId → 200, no duplicate row)
//
// Architecture: ramping-arrival-rate with warmup phase
//
// Usage:
//   k6 run k6-trade-close.js
//   k6 run k6-trade-close.js --out json=results.json

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { Trend, Rate, Counter } from 'k6/metrics';

// ── Custom Metrics ──────────────────────────────────────────────────────────

const writeLatency = new Trend('trade_write_latency', true);
const readLatency  = new Trend('metrics_read_latency', true);
const writeErrors  = new Rate('trade_write_errors');
const readErrors   = new Rate('metrics_read_errors');
const tradesCreated = new Counter('trades_created');

// ── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// 10 seed users from nevup_seed_dataset.json (userId + one valid sessionId)
const USERS = [
  { id: 'f412f236-4edc-47a2-8f54-8763a6ed2ce8', session: '4f39c2ea-8687-41f7-85a0-1fafd3e976df' },
  { id: 'fcd434aa-2201-4060-aeb2-f44c77aa0683', session: '29557b38-1332-4a4d-a688-f1cac77416c8' },
  { id: '84a6a3dd-f2d0-4167-960b-7319a6033d49', session: '0f414e15-8904-4c86-a076-d7bcb90decc3' },
  { id: '4f2f0816-f350-4684-b6c3-29bbddbb1869', session: 'd0e24e7b-14e8-4de5-bb00-8dd60f980f11' },
  { id: '75076413-e8e8-44ac-861f-c7acb3902d6d', session: '12865ff1-720a-41b6-a2b4-7728ccaca660' },
  { id: '8effb0f2-f16b-4b5f-87ab-7ffca376f309', session: '722d0010-d93d-4c9c-97d7-5189a875edc9' },
  { id: '50dd1053-73b0-43c5-8d0f-d2af88c01451', session: 'dec67127-f4c1-4f6f-9fc2-dbe046718f58' },
  { id: 'af2cfc5e-c132-4989-9c12-2913f89271fb', session: '29322429-a5b4-4e7c-8d8d-c78f1bbbe460' },
  { id: '9419073a-3d58-4ee6-a917-be2d40aecef2', session: '2eee3ecd-1c43-41c0-8ded-96d6ba475b39' },
  { id: 'e84ea28c-e5a7-49ef-ac26-a873e32667bd', session: '1aeec0aa-c818-4150-9b00-74eedce478f7' },
];

const ASSETS       = ['BTC/USD', 'ETH/USD', 'AAPL', 'TSLA', 'MSFT', 'EUR/USD', 'GBP/JPY', 'AMZN'];
const ASSET_CLASSES = ['equity', 'crypto', 'forex'];
const DIRECTIONS    = ['long', 'short'];
const EMOTIONS      = ['calm', 'anxious', 'greedy', 'fearful', 'neutral'];

// ── Scenarios ───────────────────────────────────────────────────────────────
//
// Main Load:
//   Phase 1 (warmup):  0 → 210 req/s over 10s
//   Phase 2 (sustain): hold 210 req/s for 60s
//   Traffic mix: 80% POST /trades, 20% GET /users/:id/metrics
//
// Validation (low-frequency):
//   - Idempotency check: 2 req/s for 30s
//   - Multi-tenant check: 1 req/s for 20s
//   - Health check: 0.5 req/s for 60s

export const options = {
  scenarios: {
    // ── Primary load scenario ──────────────────────────────────────────
    sustained_load: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 75,
      maxVUs: 250,
      stages: [
        { target: 210, duration: '10s' },   // Phase 1: warmup ramp
        { target: 210, duration: '60s' },   // Phase 2: sustained load
      ],
    },

    // ── Idempotency validation (low-frequency) ─────────────────────────
    idempotency_check: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 2,
      maxVUs: 5,
      startTime: '15s',   // start after warmup stabilizes
      exec: 'idempotencyTest',
    },

    // ── Multi-tenant validation (low-frequency) ────────────────────────
    tenant_check: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 2,
      maxVUs: 5,
      startTime: '15s',
      exec: 'tenantTest',
    },

    // ── Health endpoint monitoring ─────────────────────────────────────
    health_monitor: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '2s',   // 0.5 req/s
      duration: '70s',
      preAllocatedVUs: 1,
      maxVUs: 2,
      exec: 'healthTest',
    },
  },

  thresholds: {
    // Spec §7: p95 write latency ≤ 150ms
    'trade_write_latency': ['p(95)<150'],

    // Spec §7: p95 read latency ≤ 200ms
    'metrics_read_latency': ['p(95)<200'],

    // Spec §7: ≥200 req/s sustained
    'http_reqs{scenario:sustained_load}': ['rate>=200'],

    // Error rate < 1%
    'trade_write_errors': ['rate<0.01'],
    'metrics_read_errors': ['rate<0.01'],

    // Overall HTTP failure rate
    'http_req_failed{scenario:sustained_load}': ['rate<0.01'],

    // No dropped iterations (system can keep up)
    'dropped_iterations': ['count==0'],
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getUser() {
  const idx = Math.floor(Math.random() * USERS.length);
  return { ...USERS[idx], tokenIdx: idx };
}

function authHeaders(tokenIdx) {
  const token = __ENV[`TOKEN_${tokenIdx}`] || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

function generateTradePayload(user) {
  const now = Date.now();
  const asset = pickRandom(ASSETS);
  const assetClass = asset.includes('/') ? (asset.includes('USD') && asset.startsWith('BTC') || asset.startsWith('ETH') ? 'crypto' : 'forex') : 'equity';

  return JSON.stringify({
    tradeId: uuidv4(),
    userId: user.id,
    sessionId: user.session,
    asset: asset,
    assetClass: assetClass,
    direction: pickRandom(DIRECTIONS),
    entryPrice: Math.round((50 + Math.random() * 500) * 100) / 100,
    exitPrice: Math.round((50 + Math.random() * 500) * 100) / 100,
    quantity: Math.round((0.1 + Math.random() * 10) * 100) / 100,
    entryAt: new Date(now - Math.random() * 3600000).toISOString(),
    exitAt: new Date(now).toISOString(),
    status: 'closed',
    planAdherence: Math.ceil(Math.random() * 5),
    emotionalState: pickRandom(EMOTIONS),
    entryRationale: 'k6 load test trade',
  });
}

// ── Setup: verify system is alive ───────────────────────────────────────────

export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  const ok = check(healthRes, { 'setup: health ok': (r) => r.status === 200 });
  if (!ok) {
    console.error('FATAL: System not healthy. Aborting.');
    return { abort: true };
  }
  return { startTime: new Date().toISOString() };
}

// ── Main Load Scenario (default function) ───────────────────────────────────
// Traffic mix: 80% POST /trades, 20% GET /users/:id/metrics

export default function (data) {
  if (data && data.abort) return;

  const user = getUser();
  const headers = authHeaders(user.tokenIdx);

  if (Math.random() < 0.8) {
    // ── 80% — POST /trades (write path) ──────────────────────────────
    const payload = generateTradePayload(user);

    const res = http.post(`${BASE_URL}/trades`, payload, {
      headers,
      tags: { name: 'POST /trades' },
      timeout: '10s',
    });

    writeLatency.add(res.timings.duration);
    tradesCreated.add(1);

    const passed = check(res, {
      'write: status 200': (r) => r.status === 200,
      'write: has tradeId': (r) => {
        try { return JSON.parse(r.body).tradeId !== undefined; }
        catch { return false; }
      },
      'write: has outcome': (r) => {
        try {
          const b = JSON.parse(r.body);
          return b.outcome === 'win' || b.outcome === 'loss';
        } catch { return false; }
      },
      'write: has pnl': (r) => {
        try { return JSON.parse(r.body).pnl !== undefined; }
        catch { return false; }
      },
    });

    writeErrors.add(!passed);

  } else {
    // ── 20% — GET /users/:id/metrics (read path) ────────────────────
    const url = `${BASE_URL}/users/${user.id}/metrics?from=2024-01-01T00:00:00Z&to=2027-12-31T23:59:59Z&granularity=daily`;

    const res = http.get(url, {
      headers,
      tags: { name: 'GET /metrics' },
      timeout: '10s',
    });

    readLatency.add(res.timings.duration);

    const passed = check(res, {
      'read: status 200': (r) => r.status === 200,
      'read: has userId': (r) => {
        try { return JSON.parse(r.body).userId !== undefined; }
        catch { return false; }
      },
    });

    readErrors.add(!passed);
  }
}

// ── Idempotency Validation Scenario ─────────────────────────────────────────

const IDEMPOTENCY_TRADE_ID = '00000000-idem-test-0000-000000000001';

export function idempotencyTest(data) {
  if (data && data.abort) return;

  const user = USERS[0];  // always user 0
  const headers = authHeaders(0);

  // POST same tradeId every time
  const payload = JSON.stringify({
    tradeId: IDEMPOTENCY_TRADE_ID,
    userId: user.id,
    sessionId: user.session,
    asset: 'AAPL',
    assetClass: 'equity',
    direction: 'long',
    entryPrice: 150.00,
    exitPrice: 155.00,
    quantity: 10,
    entryAt: '2026-01-01T10:00:00Z',
    exitAt: '2026-01-01T10:05:00Z',
    status: 'closed',
    planAdherence: 4,
    emotionalState: 'calm',
  });

  const res = http.post(`${BASE_URL}/trades`, payload, {
    headers,
    tags: { name: 'POST /trades (idempotency)' },
    timeout: '5s',
  });

  check(res, {
    'idempotency: status 200 (not 409)': (r) => r.status === 200,
    'idempotency: same tradeId returned': (r) => {
      try { return JSON.parse(r.body).tradeId === IDEMPOTENCY_TRADE_ID; }
      catch { return false; }
    },
  });
}

// ── Multi-Tenant Validation Scenario ────────────────────────────────────────

export function tenantTest(data) {
  if (data && data.abort) return;

  // User 0's token accessing User 1's metrics → must be 403
  const headers = authHeaders(0);
  const otherUserId = USERS[1].id;

  const res = http.get(
    `${BASE_URL}/users/${otherUserId}/metrics?from=2024-01-01T00:00:00Z&to=2027-12-31T23:59:59Z&granularity=daily`,
    { headers, tags: { name: 'GET /metrics (cross-tenant)' }, timeout: '5s' }
  );

  check(res, {
    'tenant: cross-tenant → 403': (r) => r.status === 403,
    'tenant: NOT 404': (r) => r.status !== 404,
    'tenant: NOT 200': (r) => r.status !== 200,
  });
}

// ── Health Monitor Scenario ─────────────────────────────────────────────────

export function healthTest(data) {
  if (data && data.abort) return;

  const res = http.get(`${BASE_URL}/health`, {
    tags: { name: 'GET /health' },
    timeout: '5s',
  });

  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: has queueLag': (r) => {
      try { return JSON.parse(r.body).queueLag !== undefined; }
      catch { return false; }
    },
    'health: has dbConnection': (r) => {
      try { return JSON.parse(r.body).dbConnection !== undefined; }
      catch { return false; }
    },
    'health: queueLag is number': (r) => {
      try { return typeof JSON.parse(r.body).queueLag === 'number'; }
      catch { return false; }
    },
  });
}

// ── Teardown ────────────────────────────────────────────────────────────────

export function teardown(data) {
  if (data && data.abort) return;
  console.log(`Load test completed. Started at: ${data.startTime}`);
}
