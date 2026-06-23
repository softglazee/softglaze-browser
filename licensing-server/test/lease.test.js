'use strict';
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'postgresql://test';
process.env.LEASE_DAYS = '7';

const test = require('node:test');
const assert = require('node:assert');
const { verify, createPublicKey } = require('node:crypto');
const { generateTenantKeypair } = require('../src/crypto/keys');
const { seal } = require('../src/crypto/secrets');
const { issueLease } = require('../src/lease');

function fixture() {
  const { publicKeyPem, privateKeyPem } = generateTenantKeypair();
  return { tenant: { id: 'tenant_x', privateKeySealed: seal(privateKeyPem) }, publicKeyPem };
}
function decode(token) {
  const [p, s] = token.split('.');
  return { p, s, payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) };
}
const DAY = 86400000;

test('issueLease signs a token that verifies with the tenant public key', () => {
  const { tenant, publicKeyPem } = fixture();
  const lease = issueLease(tenant, { tier: 'pro', installId: 'i1', currentPeriodEnd: new Date(Date.now() + 30 * DAY) });
  const { p, s, payload } = decode(lease.token);
  assert.ok(verify(null, Buffer.from(p), createPublicKey(publicKeyPem), Buffer.from(s, 'base64url')));
  assert.strictEqual(payload.tenant, 'tenant_x');
  assert.strictEqual(payload.tier, 'pro');
  assert.strictEqual(payload.sub, 'i1');
});

test('lease exp is capped to LEASE_DAYS when the paid term is far out', () => {
  const { tenant } = fixture();
  const lease = issueLease(tenant, { tier: 'pro', currentPeriodEnd: new Date(Date.now() + 365 * DAY) });
  assert.ok(lease.exp <= Math.floor((Date.now() + 7 * DAY) / 1000) + 5);
});

test('lease exp never overshoots a near currentPeriodEnd', () => {
  const { tenant } = fixture();
  const soon = new Date(Date.now() + 2 * DAY);
  const lease = issueLease(tenant, { tier: 'pro', currentPeriodEnd: soon });
  assert.ok(lease.exp <= Math.floor(soon.getTime() / 1000) + 1);
});

test('a tampered lease payload no longer verifies', () => {
  const { tenant, publicKeyPem } = fixture();
  const lease = issueLease(tenant, { tier: 'pro', currentPeriodEnd: new Date(Date.now() + 30 * DAY) });
  const { s, payload } = decode(lease.token);
  payload.tier = 'enterprise';
  const forgedP = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.ok(!verify(null, Buffer.from(forgedP), createPublicKey(publicKeyPem), Buffer.from(s, 'base64url')));
});
