// tests/setup.js — Test helpers: JWT generation, HTTP client, constants
// Phase 6: Testing

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Load env for JWT secret
require('dotenv').config();
const jwt = require('../src/utils/jwt');

// ── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

// Seed user IDs from generate-token.js
const USERS = {
  ALEX: 'f412f236-4edc-47a2-8f54-8763a6ed2ce8',    // Alex Mercer — revenge trader
  JORDAN: 'fcd434aa-2201-4060-aeb2-f44c77aa0683',   // Jordan Lee — overtrader
  SOFIA: '6bb8d7ed-e96d-4f2c-b025-2f1e0e2e5e14',    // Sofia Chen
};

// ── JWT Helpers ─────────────────────────────────────────────────────────────

function generateToken(userId, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: userId,
    iat: options.iat || now,
    exp: options.exp || now + 86400, // 24h
    role: options.role || 'trader',
  });
}

function expiredToken(userId) {
  return generateToken(userId, { iat: 1000, exp: 1001 });
}

// ── HTTP Client ─────────────────────────────────────────────────────────────

/**
 * Make an HTTP request. Returns { status, headers, body }.
 * Uses raw http module for reliability in node:test runner.
 */
function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);

    // Add query params
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }

    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {},
    };

    // Auth header
    if (options.token) {
      reqOptions.headers['Authorization'] = `Bearer ${options.token}`;
    }

    // Body
    let bodyStr = null;
    if (options.body) {
      bodyStr = JSON.stringify(options.body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Convenience methods
const GET = (path, opts) => request('GET', path, opts);
const POST = (path, opts) => request('POST', path, opts);

module.exports = {
  assert, describe, it, before, after,
  BASE_URL, USERS,
  generateToken, expiredToken,
  request, GET, POST,
};
