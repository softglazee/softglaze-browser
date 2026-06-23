'use strict';
// Offline lease verification (the licensing trust boundary). Mirrors the server's
// lease format: "<payloadB64url>.<sigB64url>", Ed25519-signed over the payloadB64
// bytes. Env is set BEFORE requiring the client so tenantConfig picks up the test
// key + tenantId (the module memoizes on first load).
const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync, sign } = require('node:crypto');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

process.env.SG_TENANT_ID = 'tenant_test';
process.env.SG_API_BASE_URL = 'http://localhost:8787';
process.env.SG_TENANT_PUBLIC_KEY = PUB_PEM;

const { verifyLease } = require('../src/main/licenseClient');

const b64url = (b) => Buffer.from(b).toString('base64url');
function makeLease(priv, payload) {
  const p = b64url(JSON.stringify(payload));
  const s = sign(null, Buffer.from(p), priv);
  return `${p}.${b64url(s)}`;
}
const future = () => Math.floor(Date.now() / 1000) + 3600;
const basePayload = (over = {}) => ({ v: 1, tenant: 'tenant_test', sub: 'inst_1', account: null, tier: 'pro', plan: 'pro', iat: Math.floor(Date.now() / 1000), exp: future(), nonce: 'abc', ...over });

test('verifyLease accepts a valid, in-tenant, unexpired lease', () => {
  const r = verifyLease(makeLease(privateKey, basePayload()));
  assert.ok(r, 'should verify');
  assert.strictEqual(r.tier, 'pro');
  assert.strictEqual(r.tenant, 'tenant_test');
});

test('verifyLease rejects a tampered payload', () => {
  const token = makeLease(privateKey, basePayload({ tier: 'pro' }));
  // Flip the tier in the payload without re-signing.
  const [p, s] = token.split('.');
  const obj = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  obj.tier = 'enterprise';
  const forged = `${b64url(JSON.stringify(obj))}.${s}`;
  assert.strictEqual(verifyLease(forged), null);
});

test('verifyLease rejects a tampered signature', () => {
  const token = makeLease(privateKey, basePayload());
  const [p] = token.split('.');
  const badSig = b64url(Buffer.alloc(64, 7));
  assert.strictEqual(verifyLease(`${p}.${badSig}`), null);
});

test('verifyLease rejects an expired lease', () => {
  const r = verifyLease(makeLease(privateKey, basePayload({ exp: Math.floor(Date.now() / 1000) - 10 })));
  assert.strictEqual(r, null);
});

test('verifyLease rejects a lease for a different tenant', () => {
  const r = verifyLease(makeLease(privateKey, basePayload({ tenant: 'someone_else' })));
  assert.strictEqual(r, null);
});

test('verifyLease rejects a lease signed by a different key', () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  const r = verifyLease(makeLease(other, basePayload()));
  assert.strictEqual(r, null);
});

test('verifyLease rejects malformed input', () => {
  assert.strictEqual(verifyLease(''), null);
  assert.strictEqual(verifyLease('no-dot-here'), null);
  assert.strictEqual(verifyLease('a.'), null);
  assert.strictEqual(verifyLease(null), null);
});
