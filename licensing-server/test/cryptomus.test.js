'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const cryptomus = require('../src/providers/cryptomus');

// Build a validly-signed Cryptomus webhook payload the way the gateway does
// (md5 of base64(PHP-slash-escaped JSON) + apiKey), to exercise verifyWebhook.
const sign = (bodyStr, apiKey) => crypto.createHash('md5').update(Buffer.from(bodyStr, 'utf8').toString('base64') + apiKey).digest('hex');
function signed(data, apiKey) {
  const jsonPhp = JSON.stringify(data).replace(/\//g, '\\/');
  return { ...data, sign: sign(jsonPhp, apiKey) };
}

test('verifyWebhook accepts a correctly-signed payload (incl. slashes in a URL)', () => {
  const apiKey = 'cmus_test_key';
  const payload = signed({ uuid: 'u1', order_id: 'o1', status: 'paid', url: 'https://pay.cryptomus.com/x' }, apiKey);
  assert.ok(cryptomus.verifyWebhook({ secrets: { apiKey }, payload }));
});

test('verifyWebhook rejects a wrong key', () => {
  const payload = signed({ uuid: 'u1', status: 'paid' }, 'right-key');
  assert.ok(!cryptomus.verifyWebhook({ secrets: { apiKey: 'wrong-key' }, payload }));
});

test('verifyWebhook rejects a missing signature', () => {
  assert.ok(!cryptomus.verifyWebhook({ secrets: { apiKey: 'k' }, payload: { uuid: 'u1', status: 'paid' } }));
});

test('isPaid recognizes paid / paid_over only', () => {
  assert.ok(cryptomus.isPaid({ status: 'paid' }));
  assert.ok(cryptomus.isPaid({ payment_status: 'paid_over' }));
  assert.ok(!cryptomus.isPaid({ status: 'pending' }));
  assert.ok(!cryptomus.isPaid({}));
});
