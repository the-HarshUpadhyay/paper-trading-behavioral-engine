// tests/metrics.test.js — Behavioral metrics and profile tests
// Phase 6: Testing

const { describe, it, assert, USERS, generateToken, GET } = require('./setup');

describe('GET /users/:userId/metrics', () => {
  const alexToken = generateToken(USERS.ALEX);
  const jordanToken = generateToken(USERS.JORDAN);

  it('returns metrics for valid user → 200', async () => {
    const res = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: alexToken,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'daily' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, USERS.ALEX);
    assert.equal(res.body.granularity, 'daily');
    assert.ok('planAdherenceScore' in res.body);
    assert.ok('sessionTiltIndex' in res.body);
    assert.ok('winRateByEmotionalState' in res.body);
    assert.ok('revengeTrades' in res.body);
    assert.ok('overtradingEvents' in res.body);
    assert.ok(Array.isArray(res.body.timeseries));
  });

  it('timeseries has correct shape', async () => {
    const res = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: alexToken,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'daily' },
    });
    if (res.body.timeseries.length > 0) {
      const b = res.body.timeseries[0];
      assert.ok('bucket' in b);
      assert.ok('tradeCount' in b);
      assert.ok('winRate' in b);
      assert.ok('pnl' in b);
      assert.ok('avgPlanAdherence' in b);
    }
  });

  it('missing query params → 400', async () => {
    const res = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: alexToken, query: { from: '2024-01-01T00:00:00Z' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  it('invalid granularity → 400', async () => {
    const res = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: alexToken,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'weekly' },
    });
    assert.equal(res.status, 400);
  });

  it('cross-tenant → 403', async () => {
    const res = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: jordanToken,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'daily' },
    });
    assert.equal(res.status, 403);
  });
});

describe('GET /users/:userId/profile', () => {
  const alexToken = generateToken(USERS.ALEX);
  const jordanToken = generateToken(USERS.JORDAN);

  it('returns profile → 200', async () => {
    const res = await GET(`/users/${USERS.ALEX}/profile`, { token: alexToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, USERS.ALEX);
    assert.ok(res.body.generatedAt);
    assert.ok(Array.isArray(res.body.dominantPathologies));
    assert.ok(Array.isArray(res.body.strengths));
  });

  it('pathologies have evidence', async () => {
    const res = await GET(`/users/${USERS.ALEX}/profile`, { token: alexToken });
    for (const p of res.body.dominantPathologies) {
      assert.ok('pathology' in p);
      assert.ok(typeof p.confidence === 'number');
      assert.ok(Array.isArray(p.evidenceSessions));
      assert.ok(Array.isArray(p.evidenceTrades));
    }
  });

  it('cross-tenant → 403', async () => {
    const res = await GET(`/users/${USERS.ALEX}/profile`, { token: jordanToken });
    assert.equal(res.status, 403);
  });
});
