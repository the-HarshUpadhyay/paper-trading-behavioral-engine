// tests/helpers/auth.js — JWT generation, tampering, and tenant isolation helpers
// Multi-Tenancy Security Suite

const crypto = require('node:crypto');

// Load the project's real JWT module for valid token generation
require('dotenv').config();
const jwt = require('../../src/utils/jwt');

// ── Tenant Identities ──────────────────────────────────────────────────────

/**
 * Two fully isolated tenant identities.
 * ALEX and JORDAN are seed users from the dataset — they own real data.
 * ATTACKER is a fabricated userId with no data to test orphan-token attacks.
 */
const TENANT = {
  ALEX: {
    userId: 'f412f236-4edc-47a2-8f54-8763a6ed2ce8',
    name: 'Alex Mercer',
  },
  JORDAN: {
    userId: 'fcd434aa-2201-4060-aeb2-f44c77aa0683',
    name: 'Jordan Lee',
  },
  SOFIA: {
    userId: '6bb8d7ed-e96d-4f2c-b025-2f1e0e2e5e14',
    name: 'Sofia Chen',
  },
  // Fabricated attacker — valid UUID but no data in DB
  ATTACKER: {
    userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Malicious Actor',
  },
};

// ── Token Generation ────────────────────────────────────────────────────────

/**
 * Generate a validly signed JWT for a given userId.
 * Uses the real HS256 secret from the project config.
 */
function validToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: userId,
    iat: now,
    exp: now + 86400,
    role: 'trader',
  });
}

/**
 * Generate an expired but correctly signed JWT.
 */
function expiredToken(userId) {
  return jwt.sign({
    sub: userId,
    iat: 1000,
    exp: 1001,
    role: 'trader',
  });
}

/**
 * Generate a tampered JWT — modify the payload (userId) WITHOUT resigning.
 * Takes a valid token for victimUserId, replaces the sub claim with
 * attackerUserId, but keeps the ORIGINAL signature. This simulates a
 * payload-editing attack.
 */
function tamperedToken(victimUserId, attackerUserId) {
  // Generate a valid token for the victim
  const original = validToken(victimUserId);
  const [header, , signature] = original.split('.');

  // Build a new payload with the attacker's userId
  const now = Math.floor(Date.now() / 1000);
  const forgedPayload = Buffer.from(JSON.stringify({
    sub: attackerUserId,
    iat: now,
    exp: now + 86400,
    role: 'trader',
  })).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Re-assemble with the ORIGINAL signature (mismatch → invalid)
  return `${header}.${forgedPayload}.${signature}`;
}

/**
 * Generate a JWT signed with a WRONG secret.
 * Payload is valid, but the signature uses a different key.
 */
function wrongSecretToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    iat: now,
    exp: now + 86400,
    role: 'trader',
  })).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const wrongSecret = 'wrong-secret-key-that-does-not-match';
  const sig = crypto
    .createHmac('sha256', wrongSecret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${header}.${payload}.${sig}`;
}

/**
 * Generate a JWT with alg:none — a classic JWT bypass attack.
 * Sets algorithm to 'none' and omits the signature entirely.
 */
function algNoneToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    iat: now,
    exp: now + 86400,
    role: 'trader',
  })).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${header}.${payload}.`;
}

// ── Trade Payload Factory ───────────────────────────────────────────────────

/**
 * Generate a realistic closed trade payload for a given userId.
 * Returns a fresh tradeId each call to avoid idempotency collisions.
 */
function makeTrade(userId, overrides = {}) {
  return {
    tradeId: crypto.randomUUID(),
    userId,
    sessionId: crypto.randomUUID(),
    asset: 'AAPL',
    assetClass: 'equity',
    direction: 'long',
    entryPrice: 150.00,
    exitPrice: 155.00,
    quantity: 10,
    entryAt: '2025-02-15T10:00:00Z',
    exitAt: '2025-02-15T12:00:00Z',
    status: 'closed',
    planAdherence: 4,
    emotionalState: 'calm',
    entryRationale: 'Multi-tenancy test trade',
    ...overrides,
  };
}

module.exports = {
  TENANT,
  validToken,
  expiredToken,
  tamperedToken,
  wrongSecretToken,
  algNoneToken,
  makeTrade,
};
