'use strict';
// Audit T2-7: the licensing stack published Postgres on every interface with the static
// password "softglaze". The database holds licences and sealed payment-provider secrets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMPOSE = fs.readFileSync(path.join(__dirname, '..', 'licensing-server', 'docker-compose.yml'), 'utf8');
const dbService = /\n  db:\n([\s\S]*?)\n  server:/.exec(COMPOSE.replace(/\r\n/g, '\n'));

test('Postgres is only published on loopback', () => {
  assert.ok(dbService, 'the db service must be found');
  const ports = Array.from(dbService[1].matchAll(/-\s*"([^"]+)"/g), (m) => m[1]).filter((p) => /5432/.test(p));
  assert.ok(ports.length > 0, 'expected the 5432 mapping (loopback) to be present');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `port mapping ${p} must bind to 127.0.0.1`);
});

test('no static database password is shipped', () => {
  assert.ok(!/POSTGRES_PASSWORD:\s*softglaze\b/.test(COMPOSE), 'the literal password must be gone');
  assert.ok(!/softglaze:softglaze@/.test(COMPOSE), 'DATABASE_URL must not embed the literal password');
  assert.match(COMPOSE, /POSTGRES_PASSWORD:\s*"\$\{POSTGRES_PASSWORD:\?/, 'the password must be required from the environment');
  assert.match(COMPOSE, /softglaze:\$\{POSTGRES_PASSWORD:\?[^}]*\}@db:5432/, 'the server must use the same required password');
});
