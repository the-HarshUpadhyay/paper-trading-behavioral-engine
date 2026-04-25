// tests/trades.test.js — Idempotency, validation, tenancy, P&L tests
// Phase 6: Testing

const crypto = require('node:crypto');
const { describe, it, assert, USERS, generateToken, GET, POST } = require('./setup');

describe('POST /trades', () => {
  const alexToken = generateToken(USERS.ALEX);
  const tradeId = crypto.randomUUID();

  const validTrade = {
    tradeId,
    userId: USERS.ALEX,
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
  };

  it('creates a new trade → 200 with computed outcome + pnl', async () => {
    const res = await POST('/trades', { token: alexToken, body: validTrade });
    assert.equal(res.status, 200);
    assert.equal(res.body.tradeId, tradeId);
    assert.equal(res.body.outcome, 'win');
    assert.equal(res.body.pnl, 50); // (155-150)*10
    assert.equal(res.body.revengeFlag, false);
    assert.ok(res.body.createdAt);
    assert.ok(res.body.updatedAt);
  });

  it('duplicate tradeId → 200 with identical body (idempotent)', async () => {
    const res = await POST('/trades', { token: alexToken, body: validTrade });
    assert.equal(res.status, 200);
    assert.equal(res.body.tradeId, tradeId);
    assert.equal(res.body.pnl, 50);
    assert.equal(res.body.outcome, 'win');
  });

  it('short trade P&L computed correctly', async () => {
    const shortTrade = {
      ...validTrade,
      tradeId: crypto.randomUUID(),
      direction: 'short',
      entryPrice: 200,
      exitPrice: 190,
      quantity: 5,
    };
    const res = await POST('/trades', { token: alexToken, body: shortTrade });
    assert.equal(res.status, 200);
    assert.equal(res.body.pnl, 50); // (200-190)*5 for short
    assert.equal(res.body.outcome, 'win');
  });

  it('losing trade computed correctly', async () => {
    const losingTrade = {
      ...validTrade,
      tradeId: crypto.randomUUID(),
      entryPrice: 150,
      exitPrice: 145,
      quantity: 10,
    };
    const res = await POST('/trades', { token: alexToken, body: losingTrade });
    assert.equal(res.status, 200);
    assert.equal(res.body.pnl, -50);
    assert.equal(res.body.outcome, 'loss');
  });

  it('missing required fields → 400', async () => {
    const res = await POST('/trades', { token: alexToken, body: { tradeId: 'x' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
    assert.ok(res.body.message.includes('Missing required fields'));
  });

  it('invalid assetClass → 400', async () => {
    const res = await POST('/trades', {
      token: alexToken,
      body: { ...validTrade, tradeId: crypto.randomUUID(), assetClass: 'bonds' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes('assetClass'));
  });

  it('invalid emotionalState → 400', async () => {
    const res = await POST('/trades', {
      token: alexToken,
      body: { ...validTrade, tradeId: crypto.randomUUID(), emotionalState: 'happy' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes('emotionalState'));
  });

  it('planAdherence out of range → 400', async () => {
    const res = await POST('/trades', {
      token: alexToken,
      body: { ...validTrade, tradeId: crypto.randomUUID(), planAdherence: 6 },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes('planAdherence'));
  });

  it('wrong userId in JWT → 403', async () => {
    const jordanToken = generateToken(USERS.JORDAN);
    const res = await POST('/trades', { token: jordanToken, body: validTrade });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  });
});

describe('GET /trades/:tradeId', () => {
  const alexToken = generateToken(USERS.ALEX);
  const jordanToken = generateToken(USERS.JORDAN);
  let knownTradeId;

  it('get existing trade → 200', async () => {
    // Create a trade first
    knownTradeId = crypto.randomUUID();
    await POST('/trades', {
      token: alexToken,
      body: {
        tradeId: knownTradeId,
        userId: USERS.ALEX,
        sessionId: crypto.randomUUID(),
        asset: 'MSFT', assetClass: 'equity', direction: 'long',
        entryPrice: 400, exitPrice: 410, quantity: 2,
        entryAt: '2025-03-01T10:00:00Z', exitAt: '2025-03-01T11:00:00Z',
        status: 'closed',
      },
    });

    const res = await GET(`/trades/${knownTradeId}`, { token: alexToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.tradeId, knownTradeId);
    assert.equal(res.body.asset, 'MSFT');
  });

  it('non-existent trade → 404', async () => {
    const res = await GET('/trades/00000000-0000-0000-0000-000000000000', { token: alexToken });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'TRADE_NOT_FOUND');
  });

  it('another user\'s trade → 403 (never 404)', async () => {
    const res = await GET(`/trades/${knownTradeId}`, { token: jordanToken });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  });
});
