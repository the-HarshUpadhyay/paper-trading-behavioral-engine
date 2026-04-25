// loadtest/k6-trade-close.js — k6 load test: 200 VUs, 60s, POST /trades
// Phase 7: Load Testing

import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { Trend, Rate, Counter } from 'k6/metrics';
import { crypto } from 'k6/experimental/webcrypto';

// ── Custom Metrics ──────────────────────────────────────────────────────────

const tradeLatency = new Trend('trade_create_duration', true);
const tradeErrors = new Rate('trade_error_rate');
const tradeCount = new Counter('trades_created');

// ── Config ──────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    trade_close: {
      executor: 'constant-vus',
      vus: 200,
      duration: '60s',
    },
  },
  thresholds: {
    'trade_create_duration': ['p(95)<150'],  // p95 < 150ms
    'trade_error_rate': ['rate<0.01'],        // error rate < 1%
  },
};

// ── Pre-generated JWTs ──────────────────────────────────────────────────────
// Generated using: node scripts/generate-token.js <userId>
// These are valid 24h tokens for seed users

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Seed user IDs
const USER_IDS = [
  'f412f236-4edc-47a2-8f54-8763a6ed2ce8',
  'fcd434aa-2201-4060-aeb2-f44c77aa0683',
  '6bb8d7ed-e96d-4f2c-b025-2f1e0e2e5e14',
  'ba940b0a-7a6d-4fc0-80e0-d1cdedf55f70',
  '2d7fc61e-f0d8-4e9e-8faa-3a64c6e35b72',
];

const ASSETS = ['AAPL', 'TSLA', 'MSFT', 'GOOG', 'AMZN', 'BTC', 'ETH', 'EUR/USD'];
const EMOTIONS = ['calm', 'anxious', 'greedy', 'fearful', 'neutral'];

// ── JWT signing (inline HS256) ──────────────────────────────────────────────

const JWT_SECRET = __ENV.JWT_SECRET || '97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02';

function base64urlEncode(str) {
  return __ENV._b64 || encoding.b64encode(str, 'rawurl');
}

// Pre-generate tokens using k6 http to call our own token endpoint
// Or just hardcode a few long-lived tokens
let TOKENS = {};

export function setup() {
  // Generate tokens by calling our generate-token logic inline
  // Since k6 can't call Node, we'll use a simpler approach:
  // just make a health check to warm up, and use pre-computed tokens
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health ok': (r) => r.status === 200 });

  return { startTime: new Date().toISOString() };
}

// ── VU Logic ────────────────────────────────────────────────────────────────

export default function () {
  // Pick random user
  const userIdx = Math.floor(Math.random() * USER_IDS.length);
  const userId = USER_IDS[userIdx];

  // Generate unique trade
  const trade = {
    tradeId: uuidv4(),
    userId: userId,
    sessionId: uuidv4(),
    asset: ASSETS[Math.floor(Math.random() * ASSETS.length)],
    assetClass: 'equity',
    direction: Math.random() > 0.5 ? 'long' : 'short',
    entryPrice: Math.round((100 + Math.random() * 200) * 100) / 100,
    exitPrice: Math.round((100 + Math.random() * 200) * 100) / 100,
    quantity: Math.ceil(Math.random() * 50),
    entryAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    exitAt: new Date().toISOString(),
    status: 'closed',
    planAdherence: Math.ceil(Math.random() * 5),
    emotionalState: EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)],
  };

  // Use pre-generated token from env or generate-token script
  const token = __ENV[`TOKEN_${userIdx}`] || __ENV.TOKEN || '';

  const res = http.post(`${BASE_URL}/trades`, JSON.stringify(trade), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    tags: { name: 'POST /trades' },
  });

  // Record metrics
  tradeLatency.add(res.timings.duration);
  tradeErrors.add(res.status !== 200);
  tradeCount.add(1);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has tradeId': (r) => {
      try {
        return JSON.parse(r.body).tradeId === trade.tradeId;
      } catch { return false; }
    },
    'has outcome': (r) => {
      try {
        const b = JSON.parse(r.body);
        return b.outcome === 'win' || b.outcome === 'loss';
      } catch { return false; }
    },
  });
}

export function teardown(data) {
  console.log(`Load test completed. Started at: ${data.startTime}`);
}
