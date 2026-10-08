'use strict';
// Centralized, validated environment. Fails fast at startup if misconfigured.
// dotenv is optional — in containers/CI the vars come from the real environment.
try {
  const dotenv = require('dotenv');
  const path = require('path');
  const fs = require('fs');
  // 1) the standard local .env (next to the process cwd).
  dotenv.config();
  // 2) a shared config/.env higher up the tree. Some hosts (LiteSpeed/Hostinger
  //    Node apps) keep the env file outside the per-deploy folder and do not inject
  //    every var into the worker, so the local .env ends up empty. Walk up from here
  //    and load the first `config/.env` found. dotenv never overrides already-set
  //    vars, so a real process env or the local .env always wins.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'config', '.env');
    if (fs.existsSync(candidate)) { dotenv.config({ path: candidate }); break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
} catch (_) { /* dotenv not installed: use process.env as-is */ }

// Prisma's MySQL connector resolves "localhost" to IPv6 ::1, where MySQL usually
// is not listening; force IPv4 so the client connects the same way the server does.
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/@localhost([:/])/, '@127.0.0.1$1');
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const masterKey = Buffer.from(required('MASTER_KEY'), 'base64');
if (masterKey.length !== 32) {
  throw new Error('MASTER_KEY must decode to 32 bytes. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
}

const port = Number(process.env.PORT || 8787);

module.exports = {
  port,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  leaseDays: Math.max(1, Number(process.env.LEASE_DAYS || 7)),
  masterKey,
  databaseUrl: required('DATABASE_URL')
};
