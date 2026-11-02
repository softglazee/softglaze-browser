'use strict';
// Audit 2 Nov 2026 #2: pasted proxies were matched on type+host+port+username only, and a
// different password OVERWROTE the matched row. Vendors that carry the sticky session in
// the password (IPRoyal, PacketStream, Froxy, MarsProxies...) collapsed N pasted sessions
// into one row, so N profiles shared one exit IP, and another member's proxy could be
// re-passworded. Manual add and batch add refused a second session as a "duplicate".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

test('the identity matches the DB unique key, password included', () => {
  assert.match(SCHEMA, /@@unique\(\[type, host, port, username, passwordHash\]\)/);
  const id = fnBody('proxyIdentityWhere');
  for (const col of ['type: parsed.type', 'host: parsed.host', 'port: parsed.port']) assert.ok(id.includes(col), col);
  assert.match(id, /username: parsed\.username == null \|\| parsed\.username === '' \? null : String\(parsed\.username\)/);
  assert.match(id, /password: parsed\.password == null \|\| parsed\.password === '' \? null : String\(parsed\.password\)/);
});

test('findOrCreateProxy reuses only an exact match and never rewrites a password', () => {
  const body = fnBody('findOrCreateProxy');
  assert.match(body, /db\.proxy\.findFirst\(\{ where: proxyIdentityWhere\(parsed\) \}\)/);
  assert.ok(!/db\.proxy\.update\(/.test(body), 'no password overwrite on a matched row');
  assert.ok(!/scopedProxyWhere/.test(body), 'no outer-client query (it runs inside $transaction during migration)');
  assert.match(body, /return db\.proxy\.create\(\{/);
});

test('manual add and batch add treat a different password as a different proxy', () => {
  assert.match(fnBody('createProxy'), /where: proxyIdentityWhere\(parsed\),/);
  assert.match(fnBody('batchAddProxies'), /where: proxyIdentityWhere\(parsed\)/);
});

test('the proxy client rewrites password equality to the keyed hash (sealed rows still match)', () => {
  const SECRETS = fs.readFileSync(path.join(ROOT, 'src', 'main', 'proxySecrets.js'), 'utf8');
  assert.match(SECRETS, /out\.passwordHash = out\.password === null \? null : hashWithKey\(key, out\.password\);/);
});
