#!/usr/bin/env node
// scripts/generate-token.js — CLI tool to mint JWTs for testing
// Usage: node scripts/generate-token.js <userId> [name]
// Phase 2: Auth + Core Middleware

const path = require('path');

// Load config (for JWT secret)
require('dotenv').config({ path: path.join(__dirname, '..', '.env.example') });
const jwt = require('../src/utils/jwt');

const userId = process.argv[2];
const name = process.argv[3] || 'Test User';

if (!userId) {
  console.error('Usage: node scripts/generate-token.js <userId> [name]');
  console.error('');
  console.error('Seed data userIds:');
  console.error('  f412f236-4edc-47a2-8f54-8763a6ed2ce8  Alex Mercer (revenge_trading)');
  console.error('  fcd434aa-2201-4060-aeb2-f44c77aa0683  Jordan Lee (overtrading)');
  console.error('  84a6a3dd-f2d0-4167-960b-7319a6033d49  Sam Rivera (fomo_entries)');
  console.error('  4f2f0816-f350-4684-b6c3-29bbddbb1869  Casey Kim (plan_non_adherence)');
  console.error('  75076413-e8e8-44ac-861f-c7acb3902d6d  Morgan Bell (premature_exit)');
  console.error('  8effb0f2-f16b-4b5f-87ab-7ffca376f309  Taylor Grant (loss_running)');
  console.error('  50dd1053-73b0-43c5-8d0f-d2af88c01451  Riley Stone (session_tilt)');
  console.error('  af2cfc5e-c132-4989-9c12-2913f89271fb  Drew Patel (time_of_day_bias)');
  console.error('  9419073a-3d58-4ee6-a917-be2d40aecef2  Quinn Torres (position_sizing)');
  console.error('  e84ea28c-e5a7-49ef-ac26-a873e32667bd  Avery Chen (clean)');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const token = jwt.sign({
  sub: userId,
  iat: now,
  exp: now + 86400, // 24 hours
  role: 'trader',
  name,
});

console.log(token);
