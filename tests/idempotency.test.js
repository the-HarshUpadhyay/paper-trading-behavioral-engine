// tests/idempotency.test.js — Idempotent write API: sequential + concurrent proof
// Proves: POST /trades with same tradeId always returns 200 with identical record,
//         never creates duplicates, never returns 409 or 500.

const crypto = require('node:crypto');
const { describe, it, assert, USERS, generateToken, POST } = require('./setup');

// ── Helpers ─────────────────────────────────────────────────────────────────

const ALEX = USERS.ALEX;
const alexToken = generateToken(ALEX);

function makeTrade(overrides = {}) {
  return {
    tradeId: crypto.randomUUID(),
    userId: ALEX,
    sessionId: crypto.randomUUID(),
    asset: 'AAPL',
    assetClass: 'equity',
    direction: 'long',
    entryPrice: 150.00,
    exitPrice: 155.00,
    quantity: 10,
    entryAt: '2025-02-01T10:00:00Z',
    exitAt: '2025-02-01T12:00:00Z',
    status: 'closed',
    planAdherence: 4,
    emotionalState: 'calm',
    entryRationale: 'Breakout above resistance',
    ...overrides,
  };
}

/**
 * Strips volatile fields (createdAt, updatedAt) for deep comparison.
 * These may differ by microseconds between INSERT and SELECT paths.
 */
function stableFields(body) {
  const { createdAt, updatedAt, ...rest } = body;
  return rest;
}

/**
 * Fire N requests in parallel — truly concurrent, no serialization.
 */
function fireParallel(n, fn) {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. INTEGRATION TEST — Sequential idempotency
// ═════════════════════════════════════════════════════════════════════════════

describe('Idempotency: sequential duplicate detection', () => {
  const trade = makeTrade();

  it('first POST → 200, creates the record', async () => {
    const res = await POST('/trades', { token: alexToken, body: trade });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.tradeId, trade.tradeId);
    assert.equal(res.body.userId, ALEX);
    assert.equal(res.body.asset, 'AAPL');
    assert.equal(res.body.pnl, 50); // (155-150)*10
    assert.equal(res.body.outcome, 'win');
  });

  it('second POST with SAME tradeId → 200 (not 409, not 500)', async () => {
    const res = await POST('/trades', { token: alexToken, body: trade });
    assert.equal(res.status, 200, `Duplicate must return 200, got ${res.status}`);
    assert.notEqual(res.status, 409, 'Must NOT return 409 Conflict');
    assert.notEqual(res.status, 500, 'Must NOT return 500');
  });

  it('second POST returns IDENTICAL record to first', async () => {
    const first = await POST('/trades', { token: alexToken, body: trade });
    const second = await POST('/trades', { token: alexToken, body: trade });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    // Core fields must be byte-identical
    assert.deepStrictEqual(
      stableFields(first.body),
      stableFields(second.body),
      'Duplicate response body must be identical to original'
    );
  });

  it('third, fourth, fifth POST — all 200, all identical', async () => {
    const responses = [];
    for (let i = 0; i < 5; i++) {
      const res = await POST('/trades', { token: alexToken, body: trade });
      assert.equal(res.status, 200, `Attempt ${i + 1} must return 200`);
      responses.push(stableFields(res.body));
    }

    // All 5 responses must be identical
    for (let i = 1; i < responses.length; i++) {
      assert.deepStrictEqual(
        responses[i],
        responses[0],
        `Response ${i + 1} differs from response 1`
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CONCURRENCY TEST — Race condition exposure
// ═════════════════════════════════════════════════════════════════════════════

describe('Idempotency: concurrent duplicate detection (race condition test)', () => {

  it('50 parallel POSTs with SAME tradeId → all return 200', async () => {
    const trade = makeTrade();
    const N = 50;

    const results = await fireParallel(N, () =>
      POST('/trades', { token: alexToken, body: trade })
    );

    // Every single response must be 200
    for (let i = 0; i < N; i++) {
      assert.equal(
        results[i].status, 200,
        `Request ${i + 1}/${N} returned ${results[i].status}: ${JSON.stringify(results[i].body)}`
      );
    }
  });

  it('50 parallel POSTs → all response bodies are identical', async () => {
    const trade = makeTrade();
    const N = 50;

    const results = await fireParallel(N, () =>
      POST('/trades', { token: alexToken, body: trade })
    );

    // Verify all returned 200 first
    results.forEach((r, i) => assert.equal(r.status, 200, `Request ${i} ≠ 200`));

    // All response bodies must be identical (modulo timestamps)
    const baseline = stableFields(results[0].body);
    for (let i = 1; i < N; i++) {
      assert.deepStrictEqual(
        stableFields(results[i].body),
        baseline,
        `Concurrent response ${i + 1} differs from response 1 — possible duplicate creation`
      );
    }
  });

  it('100 parallel POSTs with SAME tradeId → zero non-200 responses', async () => {
    const trade = makeTrade();
    const N = 100;

    const results = await fireParallel(N, () =>
      POST('/trades', { token: alexToken, body: trade })
    );

    const non200 = results.filter(r => r.status !== 200);
    assert.equal(
      non200.length, 0,
      `Expected 0 non-200 responses, got ${non200.length}: ${JSON.stringify(non200.map(r => ({ status: r.status, body: r.body })))}`
    );
  });

  it('100 parallel POSTs → no 409 Conflict responses', async () => {
    const trade = makeTrade();
    const N = 100;

    const results = await fireParallel(N, () =>
      POST('/trades', { token: alexToken, body: trade })
    );

    const conflicts = results.filter(r => r.status === 409);
    assert.equal(
      conflicts.length, 0,
      `Idempotent endpoint must never return 409. Got ${conflicts.length} conflict responses.`
    );
  });

  it('100 parallel POSTs → no 500 Internal Server Error responses', async () => {
    const trade = makeTrade();
    const N = 100;

    const results = await fireParallel(N, () =>
      POST('/trades', { token: alexToken, body: trade })
    );

    const errors = results.filter(r => r.status >= 500);
    assert.equal(
      errors.length, 0,
      `Got ${errors.length} server errors: ${JSON.stringify(errors.map(r => r.body))}`
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. DATABASE VERIFICATION — Only one record exists
// ═════════════════════════════════════════════════════════════════════════════

describe('Idempotency: DB-level uniqueness (via API)', () => {

  it('after 50 concurrent POSTs, GET returns one record', async () => {
    const tradeId = crypto.randomUUID();
    const trade = makeTrade({ tradeId });
    const N = 50;

    // Fire N concurrent writes
    const results = await fireParallel(N, () =>
      POST('/trades', { token: alexToken, body: trade })
    );

    // All must be 200
    results.forEach((r, i) => assert.equal(r.status, 200, `Write ${i} failed`));

    // GET the trade — must exist and be unique
    const { request: _unused, GET: getReq } = require('./setup');
    const getRes = await getReq(`/trades/${tradeId}`, { token: alexToken });
    assert.equal(getRes.status, 200, 'Trade must be retrievable');
    assert.equal(getRes.body.tradeId, tradeId);
    assert.equal(getRes.body.asset, trade.asset);
  });

  it('duplicate POST does not alter original record fields', async () => {
    const tradeId = crypto.randomUUID();
    const original = makeTrade({
      tradeId,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 5,
      emotionalState: 'calm',
    });

    // Create original
    const first = await POST('/trades', { token: alexToken, body: original });
    assert.equal(first.status, 200);

    // Send duplicate with DIFFERENT payload fields (but same tradeId)
    const tampered = makeTrade({
      tradeId,                     // same tradeId
      entryPrice: 999,             // different price
      exitPrice: 9999,             // different price
      quantity: 99999,             // different quantity
      emotionalState: 'greedy',    // different emotion
      entryRationale: 'TAMPERED',  // different rationale
      asset: 'BTC/USDT',          // different asset
      assetClass: 'crypto',       // different class
    });

    const second = await POST('/trades', { token: alexToken, body: tampered });
    assert.equal(second.status, 200);

    // The returned record must match the ORIGINAL, not the tampered payload
    assert.equal(second.body.entryPrice, 100, 'entryPrice must be from original insert');
    assert.equal(second.body.exitPrice, 110, 'exitPrice must be from original insert');
    assert.equal(second.body.quantity, 5, 'quantity must be from original insert');
    assert.equal(second.body.asset, 'AAPL', 'asset must be from original insert');
    assert.equal(second.body.assetClass, 'equity', 'assetClass must be from original insert');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. STRESS ESCALATION — Increasing concurrency levels
// ═════════════════════════════════════════════════════════════════════════════

describe('Idempotency: stress escalation', () => {

  for (const N of [10, 25, 50, 100]) {
    it(`${N} concurrent POSTs with same tradeId → all pass`, async () => {
      const trade = makeTrade();

      const results = await fireParallel(N, () =>
        POST('/trades', { token: alexToken, body: trade })
      );

      const statuses = results.map(r => r.status);
      const all200 = statuses.every(s => s === 200);

      assert.ok(
        all200,
        `At concurrency=${N}: expected all 200, got ${JSON.stringify([...new Set(statuses)])}`
      );

      // All bodies identical
      const bodies = results.map(r => stableFields(r.body));
      for (let i = 1; i < bodies.length; i++) {
        assert.deepStrictEqual(bodies[i], bodies[0], `Body mismatch at concurrency=${N}, index=${i}`);
      }
    });
  }
});
