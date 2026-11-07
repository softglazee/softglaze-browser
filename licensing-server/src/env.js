'use strict';
// Centralized, validated environment. Fails fast at startup if misconfigured.
// dotenv is optional — in containers/CI the vars come from the real environment.
const path = require('path');
const fs = require('fs');

let dotenv = null;
try { dotenv = require('dotenv'); } catch (_) { /* dotenv not installed: use process.env as-is */ }

// The first config/.env up the tree: some hosts (LiteSpeed/Hostinger Node apps) keep it outside the
// deploy folder. CONFIG_ENV_FILE points at one explicitly (tests, unusual layouts).
function findConfigEnv() {
  if (process.env.CONFIG_ENV_FILE) return fs.existsSync(process.env.CONFIG_ENV_FILE) ? process.env.CONFIG_ENV_FILE : null;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'config', '.env');
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
const configEnvPath = findConfigEnv();

if (dotenv) {
  // 1) the standard local .env (next to the process cwd). 2) config/.env. dotenv never overrides
  // set vars, so the process env or local .env wins at startup.
  dotenv.config({ quiet: true });
  if (configEnvPath) dotenv.config({ path: configEnvPath, quiet: true });
}

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

// Values the owner may change on the server without a restart (SMTP_*, TRUST_PROXY_HOPS): read from
// config/.env whenever the file changes (mtime), falling back to the process environment. The file
// wins, because the process copy is whatever the file held when the app started.
let liveCache = { mtimeMs: -1, values: {} };
function liveFileValues() {
  if (!configEnvPath || !dotenv) return {};
  try {
    const st = fs.statSync(configEnvPath);
    if (st.mtimeMs !== liveCache.mtimeMs) {
      liveCache = { mtimeMs: st.mtimeMs, values: dotenv.parse(fs.readFileSync(configEnvPath)) };
    }
    return liveCache.values;
  } catch (_) {
    return {};
  }
}
function liveEnv(name) {
  const fromFile = liveFileValues()[name];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

module.exports = {
  port,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  leaseDays: Math.max(1, Number(process.env.LEASE_DAYS || 7)),
  masterKey,
  databaseUrl: required('DATABASE_URL'),
  configEnvPath,
  liveEnv
};
