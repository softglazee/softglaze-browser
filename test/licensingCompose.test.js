'use strict';
// Audit T2-7: the licensing stack must not publish its database on every interface,
// and must not ship a static database password. The database holds licences and sealed
// payment-provider secrets. Deployed on MySQL (the Hostinger host has no Postgres).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMPOSE = fs.readFileSync(path.join(__dirname, '..', 'licensing-server', 'docker-compose.yml'), 'utf8');
const dbService = /\n  db:\n([\s\S]*?)\n  server:/.exec(COMPOSE.replace(/\r\n/g, '\n'));

test('the database is only published on loopback', () => {
  assert.ok(dbService, 'the db service must be found');
  const ports = Array.from(dbService[1].matchAll(/-\s*"([^"]+)"/g), (m) => m[1]).filter((p) => /3306/.test(p));
  assert.ok(ports.length > 0, 'expected the 3306 mapping (loopback) to be present');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `port mapping ${p} must bind to 127.0.0.1`);
});

test('no static database password is shipped', () => {
  assert.ok(!/MYSQL_PASSWORD:\s*softglaze\b/.test(COMPOSE), 'the literal password must be gone');
  assert.ok(!/softglaze:softglaze@/.test(COMPOSE), 'DATABASE_URL must not embed the literal password');
  assert.match(COMPOSE, /MYSQL_PASSWORD:\s*"\$\{DB_PASSWORD:\?/, 'the password must be required from the environment');
  assert.match(COMPOSE, /softglaze:\$\{DB_PASSWORD:\?[^}]*\}@db:3306/, 'the server must use the same required password');
});
