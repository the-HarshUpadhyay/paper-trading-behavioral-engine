// tests/sessions.test.js — Session summary, debrief, tenancy tests
// Phase 6: Testing

const { describe, it, assert, USERS, generateToken, GET, POST } = require('./setup');

describe('GET /sessions/:sessionId', () => {
  const alexToken = generateToken(USERS.ALEX);

  it('non-existent session → 404', async () => {
    const res = await GET('/sessions/00000000-0000-0000-0000-000000000000', { token: alexToken });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'SESSION_NOT_FOUND');
  });
});

describe('POST /sessions/:sessionId/debrief', () => {
  const alexToken = generateToken(USERS.ALEX);

  it('non-existent session with valid body → 404', async () => {
    const res = await POST('/sessions/00000000-0000-0000-0000-000000000000/debrief', {
      token: alexToken,
      body: {
        overallMood: 'calm',
        planAdherenceRating: 4,
        keyMistake: 'Held too long',
        keyLesson: 'Exit earlier',
        willReviewTomorrow: true,
      },
    });
    assert.equal(res.status, 404);
  });

  it('invalid overallMood on non-existent session → 404', async () => {
    const res = await POST('/sessions/00000000-0000-0000-0000-000000000000/debrief', {
      token: alexToken,
      body: { overallMood: 'happy', planAdherenceRating: 3 },
    });
    // Session lookup happens before validation in our impl
    assert.equal(res.status, 404);
  });
});

describe('GET /sessions/:sessionId/coaching', () => {
  const alexToken = generateToken(USERS.ALEX);

  it('non-existent session → 404', async () => {
    const res = await GET('/sessions/00000000-0000-0000-0000-000000000000/coaching', {
      token: alexToken,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'SESSION_NOT_FOUND');
  });
});
