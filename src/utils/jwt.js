// src/utils/jwt.js — sign() and verify() using crypto.createHmac (HS256)
// Phase 2: Auth + Core Middleware

const crypto = require('crypto');
const config = require('../config');

/**
 * Base64url encode a string (no padding, URL-safe chars)
 */
function base64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64url decode to string
 */
function base64urlDecode(str) {
  // Restore padding
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4;
  if (padding === 2) padded += '==';
  else if (padding === 3) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Sign a JWT payload with HS256
 * @param {object} payload - Claims to include (sub, iat, exp, role, name)
 * @returns {string} Signed JWT token
 */
function sign(payload) {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url(payload);
  const sigData = `${header}.${body}`;
  const sig = crypto
    .createHmac('sha256', config.jwt.secret)
    .update(sigData)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${sigData}.${sig}`;
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT string
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
function verify(token) {
  // Split token into parts
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is missing or not a string' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token: expected 3 parts' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const sigData = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac('sha256', config.jwt.secret)
    .update(sigData)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signatureB64 !== expectedSig) {
    return { valid: false, error: 'Invalid signature' };
  }

  // Decode header
  let header;
  try {
    header = JSON.parse(base64urlDecode(headerB64));
  } catch {
    return { valid: false, error: 'Malformed header: invalid JSON' };
  }

  if (header.alg !== 'HS256') {
    return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    return { valid: false, error: 'Malformed payload: invalid JSON' };
  }

  // Validate required claims
  if (!payload.sub) {
    return { valid: false, error: 'Missing required claim: sub' };
  }
  if (!payload.iat) {
    return { valid: false, error: 'Missing required claim: iat' };
  }
  if (!payload.exp) {
    return { valid: false, error: 'Missing required claim: exp' };
  }
  if (!payload.role) {
    return { valid: false, error: 'Missing required claim: role' };
  }

  // Check expiry — 0 seconds clock skew, UTC strictly
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    return { valid: false, error: 'Token expired' };
  }

  return { valid: true, payload };
}

module.exports = { sign, verify, base64url, base64urlDecode };
