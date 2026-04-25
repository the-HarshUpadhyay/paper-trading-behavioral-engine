// tests/auth.test.js — Authentication and authorization tests
// Phase 6: Testing

const { describe, it, assert, USERS, generateToken, expiredToken, GET } = require('./setup');

describe('Authentication', () => {

  it('GET /health without auth → 200', async () => {
    const res = await GET('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.timestamp);
  });

  it('GET /trades/:id without auth → 401', async () => {
    const res = await GET('/trades/nonexistent');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'UNAUTHORIZED');
    assert.ok(res.body.traceId);
  });

  it('GET /trades/:id with expired JWT → 401', async () => {
    const token = expiredToken(USERS.ALEX);
    const res = await GET('/trades/nonexistent', { token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'TOKEN_EXPIRED');
    assert.ok(res.body.traceId);
  });

  it('GET /trades/:id with malformed JWT → 401', async () => {
    const res = await GET('/trades/nonexistent', { token: 'not.a.jwt' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'UNAUTHORIZED');
  });

  it('GET /trades/:id with garbage token → 401', async () => {
    const res = await GET('/trades/nonexistent', { token: 'aaa.bbb.ccc' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'UNAUTHORIZED');
  });

  it('valid JWT passes auth (404 for non-existent trade)', async () => {
    const token = generateToken(USERS.ALEX);
    const res = await GET('/trades/00000000-0000-0000-0000-000000000000', { token });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'TRADE_NOT_FOUND');
  });

  it('cross-tenant access → 403 (never 404)', async () => {
    const tokenA = generateToken(USERS.ALEX);
    const tokenB = generateToken(USERS.JORDAN);

    // Get a real trade from Alex's data
    const res1 = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: tokenA,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'daily' }
    });
    assert.equal(res1.status, 200);

    // Jordan tries to access Alex's metrics
    const res2 = await GET(`/users/${USERS.ALEX}/metrics`, {
      token: tokenB,
      query: { from: '2024-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', granularity: 'daily' }
    });
    assert.equal(res2.status, 403);
    assert.equal(res2.body.error, 'FORBIDDEN');
  });

  it('all error responses have { error, message, traceId } shape', async () => {
    const res = await GET('/trades/test');
    assert.equal(res.status, 401);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(typeof res.body.message, 'string');
    assert.equal(typeof res.body.traceId, 'string');
    // traceId should be UUID format
    assert.match(res.body.traceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
