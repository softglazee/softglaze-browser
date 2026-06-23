'use strict';
// Centralized, validated environment. Fails fast at startup if misconfigured.
// dotenv is optional — in containers/CI the vars come from the real environment.
try { require('dotenv').config(); } catch (_) { /* dotenv not installed: use process.env as-is */ }

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
