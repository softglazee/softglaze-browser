'use strict';
// Credential-redaction policy (src/main/rbacPolicy.js). Pure — no Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactForRole } = require('../src/main/rbacPolicy.js');

const MASK = '•'.repeat(8); // '••••••••' — the module's REDACTED constant

test('OPERATOR cannot read proxy credentials but keeps connectivity', () => {
  const rec = { host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' };
  const out = redactForRole('OPERATOR', 'proxyCredentials', rec);
  assert.equal(out.username, MASK);
  assert.equal(out.password, MASK);
  assert.equal(out.hasUsername, true);
  assert.equal(out.hasPassword, true);
  assert.equal(out._redacted, true);
  assert.equal(out.host, '1.2.3.4'); // host:port stays usable
  // the raw record must never be mutated
  assert.equal(rec.username, 'user');
  assert.equal(rec.password, 'pass');
});

test('OPERATOR cannot read token strings', () => {
  const out = redactForRole('OPERATOR', 'tokenString', { token: 'sk_live_1', apiKey: 'ak', secretKey: 'sk' });
  assert.equal(out.token, MASK);
  assert.equal(out.apiKey, MASK);
  assert.equal(out.secretKey, MASK);
});

test('OPERATOR sees cookie count but not cookie values', () => {
  const out = redactForRole('OPERATOR', 'cookieDump', { cookies: [{ a: 1 }, { b: 2 }, { c: 3 }] });
  assert.equal(out.cookies, undefined);
  assert.equal(out.cookieCount, 3);
});

test('OWNER reads raw values (object returned unchanged)', () => {
  const rec = { username: 'user', password: 'pass' };
  const out = redactForRole('OWNER', 'proxyCredentials', rec);
  assert.equal(out.username, 'user');
  assert.equal(out.password, 'pass');
  assert.equal(out, rec);
});

test('an unknown role is treated as the most-restricted', () => {
  const out = redactForRole('NOBODY', 'tokenString', { token: 't' });
  assert.equal(out.token, MASK);
});
