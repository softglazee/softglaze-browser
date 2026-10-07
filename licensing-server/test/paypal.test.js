'use strict';
// Audit L6: PayPal capture must be idempotent (PayPal-Request-Id) and must not swallow
// errors. The HTTPS helper is replaced before the provider loads it.
const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
let nextCapture = null;
const httpPath = require.resolve('../src/http');
require.cache[httpPath] = {
  id: httpPath, filename: httpPath, loaded: true,
  exports: {
    httpsRequest: async (method, url, opts) => {
      calls.push({ method, url, opts });
      if (url.endsWith('/v1/oauth2/token')) return { status: 200, json: { access_token: 'tok' } };
      return nextCapture;
    }
  }
};
const paypal = require('../src/providers/paypal');
const secrets = { clientId: 'id', clientSecret: 's', env: 'sandbox', webhookId: 'wh' };

test('captureOrder sends a PayPal-Request-Id derived from the order id', async () => {
  calls.length = 0;
  nextCapture = { status: 201, json: { id: 'O1', status: 'COMPLETED' } };
  await paypal.captureOrder({ secrets, orderId: 'O1' });
  await paypal.captureOrder({ secrets, orderId: 'O1' });
  const caps = calls.filter((c) => c.url.includes('/capture'));
  assert.equal(caps.length, 2);
  assert.equal(caps[0].opts.headers['PayPal-Request-Id'], 'sg-capture-O1');
  assert.equal(caps[1].opts.headers['PayPal-Request-Id'], caps[0].opts.headers['PayPal-Request-Id'], 'a retry reuses the same id');
});

test('captureOrder throws on a failed capture instead of returning it', async () => {
  nextCapture = { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] } };
  await assert.rejects(paypal.captureOrder({ secrets, orderId: 'O2' }), /INSTRUMENT_DECLINED/);
  nextCapture = { status: 500, json: null };
  await assert.rejects(paypal.captureOrder({ secrets, orderId: 'O2' }), /HTTP 500/);
});

test('an already-captured order is reported, not thrown, and is not treated as a completed capture', async () => {
  nextCapture = { status: 422, json: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } };
  const r = await paypal.captureOrder({ secrets, orderId: 'O3' });
  assert.equal(r.alreadyCaptured, true);
  assert.equal(paypal.isCaptureCompleted(r), false);
});

test('isCaptureCompleted requires a COMPLETED order with only COMPLETED captures', () => {
  const cap = (s) => ({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: s }] } }] });
  assert.equal(paypal.isCaptureCompleted(cap('COMPLETED')), true);
  assert.equal(paypal.isCaptureCompleted(cap('PENDING')), false);
  assert.equal(paypal.isCaptureCompleted({ status: 'COMPLETED', purchase_units: [] }), false);
  assert.equal(paypal.isCaptureCompleted(null), false);
});
