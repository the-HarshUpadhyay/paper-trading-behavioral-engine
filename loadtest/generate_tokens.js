// loadtest/generate_tokens.js — Pre-generate JWT tokens for k6 load testing
// Usage: node loadtest/generate_tokens.js
//
// Outputs environment variable assignments for both PowerShell and Bash.
// Copy the relevant block, paste into terminal, then run k6.

const path = require('path');
const jwt = require(path.join(__dirname, '..', 'src', 'utils', 'jwt'));

// All 10 seed users from nevup_seed_dataset.json
const SEED_USERS = [
  'f412f236-4edc-47a2-8f54-8763a6ed2ce8',
  'fcd434aa-2201-4060-aeb2-f44c77aa0683',
  '84a6a3dd-f2d0-4167-960b-7319a6033d49',
  '4f2f0816-f350-4684-b6c3-29bbddbb1869',
  '75076413-e8e8-44ac-861f-c7acb3902d6d',
  '8effb0f2-f16b-4b5f-87ab-7ffca376f309',
  '50dd1053-73b0-43c5-8d0f-d2af88c01451',
  'af2cfc5e-c132-4989-9c12-2913f89271fb',
  '9419073a-3d58-4ee6-a917-be2d40aecef2',
  'e84ea28c-e5a7-49ef-ac26-a873e32667bd',
];

const now = Math.floor(Date.now() / 1000);
const exp = now + 86400; // 24 hours

console.log('# NevUp k6 Load Test — JWT Tokens');
console.log('# Generated:', new Date().toISOString());
console.log('# Valid for 24 hours');
console.log('');

console.log('# --- PowerShell ---');
SEED_USERS.forEach((userId, i) => {
  const token = jwt.sign({ sub: userId, role: 'trader', iat: now, exp, name: `LoadTest-${i}` });
  console.log(`$env:TOKEN_${i}="${token}"`);
});

console.log('');
console.log('# --- Bash ---');
SEED_USERS.forEach((userId, i) => {
  const token = jwt.sign({ sub: userId, role: 'trader', iat: now, exp, name: `LoadTest-${i}` });
  console.log(`export TOKEN_${i}="${token}"`);
});
