'use strict';
// Audit L2 + L7: payment-config must keep every field a provider needs (Cryptomus
// apiKey, PayPal clientId/clientSecret/webhookId/env), refuse a save that lacks one,
// and seal them with the existing sealJson.
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildProviderSecrets, PROVIDER_FIELDS } = require('../src/providers/configFields');
const cryptomus = require('../src/providers/cryptomus');

test('cryptomus keeps apiKey (the webhook verification key) and merchantId', () => {
  const r = buildProviderSecrets('cryptomus', { merchantId: 'm1', apiKey: 'k1', secretKey: 'junk' });
  assert.deepEqual(r.secrets, { merchantId: 'm1', apiKey: 'k1' });
  assert.match(buildProviderSecrets('cryptomus', { merchantId: 'm1' }).error, /apiKey/);
  assert.match(buildProviderSecrets('cryptomus', { merchantId: 'm1', apiKey: '   ' }).error, /apiKey/);
});

test('paypal keeps clientId, clientSecret, webhookId and env', () => {
  const r = buildProviderSecrets('paypal', { clientId: 'c', clientSecret: 's', webhookId: 'w', env: 'Sandbox' });
  assert.deepEqual(r.secrets, { clientId: 'c', clientSecret: 's', webhookId: 'w', env: 'sandbox' });
  assert.equal(buildProviderSecrets('paypal', { clientId: 'c', clientSecret: 's', webhookId: 'w' }).secrets.env, 'live');
  assert.match(buildProviderSecrets('paypal', { clientId: 'c', clientSecret: 's' }).error, /webhookId/);
  assert.match(buildProviderSecrets('paypal', { clientId: 'c', clientSecret: 's', webhookId: 'w', env: 'prod' }).error, /env/);
});

test('stripe requires secretKey and webhookSecret; unknown providers are refused', () => {
  assert.deepEqual(buildProviderSecrets('stripe', { secretKey: 'sk', webhookSecret: 'wh' }).secrets, { secretKey: 'sk', webhookSecret: 'wh' });
  assert.match(buildProviderSecrets('stripe', { secretKey: 'sk' }).error, /webhookSecret/);
  assert.equal(buildProviderSecrets('square', {}).error, 'Unknown provider.');
  assert.deepEqual(Object.keys(PROVIDER_FIELDS).sort(), ['cryptomus', 'paypal', 'stripe']);
});

test('the payment-config route seals the validated per-provider secrets', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'tenantAdmin.js'), 'utf8');
  assert.match(src, /buildProviderSecrets\(provider, b\)/);
  assert.match(src, /if \(built\.error\) return res\.status\(400\)/);
  assert.match(src, /sealJson\(built\.secrets\)/);
  assert.ok(!/merchantId: b\.merchantId/.test(src), 'the old fixed three-field blob must be gone');
});

test('Cryptomus verifyWebhook rejects a payload signed with an empty key when apiKey is empty or missing', () => {
  const crypto = require('node:crypto');
  const json = JSON.stringify({ uuid: 'u', status: 'paid' });
  const sign = crypto.createHash('md5').update(Buffer.from(json, 'utf8').toString('base64')).digest('hex');
  const payload = { uuid: 'u', status: 'paid', sign };
  assert.equal(cryptomus.verifyWebhook({ secrets: {}, payload }), false);
  assert.equal(cryptomus.verifyWebhook({ secrets: { apiKey: '' }, payload }), false);
  assert.equal(cryptomus.verifyWebhook({ secrets: null, payload }), false);
});
