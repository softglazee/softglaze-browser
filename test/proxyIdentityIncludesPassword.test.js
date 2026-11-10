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
  // 1.0.26: the owner is part of the key, so two members can each keep their own row
  // (test/permissionsFollowup.test.js).
  assert.match(SCHEMA, /@@unique\(\[type, host, port, username, passwordHash, ownerMemberId\]\)/);
  const id = fnBody('proxyIdentityWhere');
  for (const col of ['type: parsed.type', 'host: parsed.host', 'port: parsed.port']) assert.ok(id.includes(col), col);
  assert.match(id, /username: parsed\.username == null \|\| parsed\.username === '' \? null : String\(parsed\.username\)/);
  assert.match(id, /password: parsed\.password == null \|\| parsed\.password === '' \? null : String\(parsed\.password\)/);
});

test('findOrCreateProxy reuses only an exact match and never rewrites a password', () => {
  const body = fnBody('findOrCreateProxy');
  assert.match(body, /const existing = await findVisibleProxy\(db, parsed, add\);/);
  const find = fnBody('findVisibleProxy');
  assert.match(find, /const identity = proxyIdentityWhere\(parsed\);/);
  assert.ok(!/db\.proxy\.update\(/.test(body + find), 'no password overwrite on a matched row');
  // Inside the migration $transaction an outer-client query would block: the caller reads the
  // member context first and passes it in, and the lookup itself only uses the given client.
  assert.ok(!/scopedProxyWhere|getPrisma\(\)/.test(find), 'no outer-client query in the lookup');
  assert.match(fnBody('migrateProfiles'), /findOrCreateProxy\(tx, norm\.proxyRaw, `\$\{norm\.title\} Proxy`, norm\.proxyType, proxyAdd\)/);
  assert.match(body, /return db\.proxy\.create\(\{/);
});

test('manual add and batch add treat a different password as a different proxy', () => {
  assert.match(fnBody('createProxy'), /const existing = await findVisibleProxy\(db, parsed, add\);/);
  assert.match(fnBody('batchAddProxies'), /const existing = await findVisibleProxy\(db, parsed, add\);/);
});

test('the proxy client rewrites password equality to the keyed hash (sealed rows still match)', () => {
  const SECRETS = fs.readFileSync(path.join(ROOT, 'src', 'main', 'proxySecrets.js'), 'utf8');
  assert.match(SECRETS, /out\.passwordHash = out\.password === null \? null : hashWithKey\(key, out\.password\);/);
});
