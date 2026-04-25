// tests/integration.test.js — End-to-end flow tests
// Phase 6: Testing

const crypto = require('node:crypto');
const { describe, it, assert, USERS, generateToken, GET, POST } = require('./setup');

describe('Integration: full trade→metrics flow', () => {
  const alexToken = generateToken(USERS.ALEX);
  const tradeId = crypto.randomUUID();

  it('POST closed trade → GET metrics → values present', async () => {
    // 1. POST a closed trade
    const res = await POST('/trades', {
      token: alexToken,
      body: {
        tradeId,
        userId: USERS.ALEX,
        sessionId: crypto.randomUUID(),
        asset: 'INTG_TEST',
        assetClass: 'equity',
        direction: 'long',
        entryPrice: 100, exitPrice: 110, quantity: 1,
        entryAt: '2025-06-01T10:00:00Z',
        exitAt: '2025-06-01T11:00:00Z',
        status: 'closed',
        emotionalState: 'calm',
        planAdherence: 5,
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'win');

    // 2. Wait for worker to process
    await new Promise(r => setTimeout(r, 3000));

    // 3. GET metrics — should include data
    const metrics = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: alexToken,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'daily' },
    });
    assert.equal(metrics.status, 200);
    assert.ok(metrics.body.planAdherenceScore !== null);
    assert.ok(typeof metrics.body.winRateByEmotionalState === 'object');
  });

  it('health endpoint reflects running system', async () => {
    const res = await GET('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.dbConnection, 'connected');
    assert.ok('queueLag' in res.body);
    assert.ok(res.body.timestamp);
  });
});
