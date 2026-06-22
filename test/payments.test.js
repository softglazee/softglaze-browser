'use strict';
// Phase: multi-provider payments. payments.js is pure (node:https + node:crypto,
// no Electron), so node:test drives it directly. Covers request-shaping (Stripe
// form-encoding), provider metadata, and the self-verifying purchase codes.
const test = require('node:test');
const assert = require('node:assert/strict');

const payments = require('../src/main/payments');

test('stripeForm encodes nested objects and arrays with bracket syntax', () => {
  const body = payments.stripeForm({
    mode: 'payment',
    line_items: [{ price_data: { currency: 'usd', unit_amount: 500 }, quantity: 1 }]
  });
  const parts = body.split('&');
  assert.ok(parts.includes('mode=payment'));
  // Nested keys use bracket syntax; encodeURIComponent escapes the brackets.
  assert.ok(parts.includes('line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd'));
  assert.ok(parts.includes('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500'));
  assert.ok(parts.includes('line_items%5B0%5D%5Bquantity%5D=1'));
});

test('stripeForm url-encodes values', () => {
  const body = payments.stripeForm({ name: 'a b&c' });
  assert.equal(body, 'name=a%20b%26c');
});

test('PROVIDER_DEFS exposes the five providers with secret flags', () => {
  const ids = payments.PROVIDER_DEFS.map((p) => p.id);
  assert.deepEqual(ids, ['cryptomus', 'stripe', 'paypal', 'wise', 'manual']);

  const secretOf = (pid, key) => payments.getProviderDef(pid).fields.find((f) => f.key === key).secret;
  assert.equal(secretOf('cryptomus', 'apiKey'), true);
  assert.equal(secretOf('cryptomus', 'merchantId'), false);
  assert.equal(secretOf('stripe', 'secretKey'), true);
  assert.equal(secretOf('paypal', 'clientSecret'), true);
  assert.equal(secretOf('paypal', 'clientId'), false);
});

test('automated providers carry adapters; manual providers do not', () => {
  for (const id of ['cryptomus', 'stripe', 'paypal']) {
    const p = payments.getProvider(id);
    assert.equal(p.kind, 'automated');
    assert.equal(typeof p.createInvoice, 'function');
    assert.equal(typeof p.getStatus, 'function');
    assert.equal(typeof p.validate, 'function');
  }
  for (const id of ['wise', 'manual']) {
    const p = payments.getProvider(id);
    assert.equal(p.kind, 'manual');
    assert.equal(p.createInvoice, undefined);
  }
});

test('paypalBase selects sandbox vs live by env', () => {
  assert.equal(payments.paypalBase({ env: 'sandbox' }), 'https://api-m.sandbox.paypal.com');
  assert.equal(payments.paypalBase({ env: 'live' }), 'https://api-m.paypal.com');
  assert.equal(payments.paypalBase({}), 'https://api-m.paypal.com'); // defaults to live
});

test('purchase codes round-trip and reject tampering', () => {
  const code = payments.generatePurchaseCode(3);
  const v = payments.verifyPurchaseCode(code);
  assert.equal(v.valid, true);
  assert.equal(v.months, 3);
  // Flip a payload character → signature must fail.
  const broken = code.replace(/^SGP-03/, 'SGP-12');
  assert.equal(payments.verifyPurchaseCode(broken).valid, false);
  assert.equal(payments.verifyPurchaseCode('not-a-code').valid, false);
});
