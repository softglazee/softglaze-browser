'use strict';
// Env set BEFORE requiring modules that read it at load time (secrets reads MASTER_KEY).
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'postgresql://test';

const test = require('node:test');
const assert = require('node:assert');
const { verify, createPublicKey } = require('node:crypto');
const secrets = require('../src/crypto/secrets');
const keys = require('../src/crypto/keys');

test('secrets seal/open round-trips', () => {
  const sealed = secrets.seal('hello-secret');
  assert.notStrictEqual(sealed, 'hello-secret');
  assert.strictEqual(secrets.open(sealed), 'hello-secret');
});

test('secrets sealJson/openJson round-trips an object', () => {
  const obj = { secretKey: 'sk_test_123', webhookSecret: 'whsec_abc' };
  assert.deepStrictEqual(secrets.openJson(secrets.sealJson(obj)), obj);
});

test('open() rejects a tampered ciphertext (GCM auth tag)', () => {
  const parts = secrets.seal('x').split(':'); // v1:iv:tag:ct
  const ct = Buffer.from(parts[3], 'base64'); ct[0] ^= 0xff;
  parts[3] = ct.toString('base64');
  assert.throws(() => secrets.open(parts.join(':')));
});

test('keys: an Ed25519 signature verifies with the public key', () => {
  const { publicKeyPem, privateKeyPem } = keys.generateTenantKeypair();
  const data = Buffer.from('payload-bytes');
  const sig = keys.signEd25519(privateKeyPem, data);
  assert.ok(verify(null, data, createPublicKey(publicKeyPem), sig));
});

test('keys: a different keypair does NOT verify the signature', () => {
  const a = keys.generateTenantKeypair();
  const b = keys.generateTenantKeypair();
  const data = Buffer.from('payload-bytes');
  const sig = keys.signEd25519(a.privateKeyPem, data);
  assert.ok(!verify(null, data, createPublicKey(b.publicKeyPem), sig));
});

test('keys: newApiKey + sha256Hex shapes', () => {
  assert.match(keys.newApiKey(), /^sgls_[A-Za-z0-9_-]+$/);
  assert.strictEqual(keys.sha256Hex('a'), keys.sha256Hex('a'));
  assert.notStrictEqual(keys.sha256Hex('a'), keys.sha256Hex('b'));
});
