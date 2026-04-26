#!/usr/bin/env node
// loadtest/generate_tokens.js — Generate JWTs for all 10 seed users
// Outputs shell variables: export TOKEN_0=..., export TOKEN_1=..., etc.
// Also outputs a JSON array of {userId, token} pairs for k6

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.example') });

const jwt = require('../src/utils/jwt');

const USERS = [
  { userId: 'f412f236-4edc-47a2-8f54-8763a6ed2ce8', name: 'Alex Mercer',   sessionId: '4f39c2ea-8687-41f7-85a0-1fafd3e976df' },
  { userId: 'fcd434aa-2201-4060-aeb2-f44c77aa0683', name: 'Jordan Lee',    sessionId: '29557b38-1332-4a4d-a688-f1cac77416c8' },
  { userId: '84a6a3dd-f2d0-4167-960b-7319a6033d49', name: 'Sam Rivera',    sessionId: '0f414e15-8904-4c86-a076-d7bcb90decc3' },
  { userId: '4f2f0816-f350-4684-b6c3-29bbddbb1869', name: 'Casey Kim',     sessionId: 'd0e24e7b-14e8-4de5-bb00-8dd60f980f11' },
  { userId: '75076413-e8e8-44ac-861f-c7acb3902d6d', name: 'Morgan Bell',   sessionId: '12865ff1-720a-41b6-a2b4-7728ccaca660' },
  { userId: '8effb0f2-f16b-4b5f-87ab-7ffca376f309', name: 'Taylor Grant',  sessionId: '722d0010-d93d-4c9c-97d7-5189a875edc9' },
  { userId: '50dd1053-73b0-43c5-8d0f-d2af88c01451', name: 'Riley Stone',   sessionId: 'dec67127-f4c1-4f6f-9fc2-dbe046718f58' },
  { userId: 'af2cfc5e-c132-4989-9c12-2913f89271fb', name: 'Drew Patel',    sessionId: '29322429-a5b4-4e7c-8d8d-c78f1bbbe460' },
  { userId: '9419073a-3d58-4ee6-a917-be2d40aecef2', name: 'Quinn Torres',  sessionId: '2eee3ecd-1c43-41c0-8ded-96d6ba475b39' },
  { userId: 'e84ea28c-e5a7-49ef-ac26-a873e32667bd', name: 'Avery Chen',    sessionId: '1aeec0aa-c818-4150-9b00-74eedce478f7' },
];

const tokensData = USERS.map((user, i) => {
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({
    sub: user.userId,
    iat: now,
    exp: now + 86400, // 24 hours
    role: 'trader',
    name: user.name,
  });

  return { ...user, token };
});

// Output shell exports
tokensData.forEach((t, i) => {
  console.log(`export TOKEN_${i}="${t.token}"`);
});

// Also write a JSON file for k6 to consume
const fs = require('fs');
const outPath = path.join(__dirname, 'users.json');
fs.writeFileSync(outPath, JSON.stringify(tokensData, null, 2));
console.error(`[generate_tokens] Wrote ${tokensData.length} user tokens to ${outPath}`);
