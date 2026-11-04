'use strict';
// Phase: multi-provider payments. payments.js is pure (node:https + node:crypto,
// no Electron), so node:test drives it directly. Covers request-shaping (Stripe
// form-encoding), provider metadata, and receipt references.
const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
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

// Decision A4: the offline purchase-code scheme is gone. It signed codes with a
// secret shipped in the binary, so anyone with a copy could mint licences valid on
// every build and sell them. Codes are server-issued and server-checked now. These
// assertions exist so the scheme cannot quietly come back.
test('no offline purchase-code signing or verification ships in the client', () => {
  assert.equal(typeof payments.generatePurchaseCode, 'undefined');
  assert.equal(typeof payments.verifyPurchaseCode, 'undefined');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'payments.js'), 'utf8');
  // The literal that used to be the shared signing secret, and the code shape it
  // signed. A comment may mention them; a live declaration may not.
  assert.ok(!/^\s*const LICENSE_SECRET\s*=/m.test(src), 'LICENSE_SECRET is declared again');
  assert.ok(!/^\s*function purchaseSig/m.test(src), 'purchaseSig is defined again');
  assert.ok(!/\/\^SGP-/.test(src), 'a SGP- redemption pattern is back');
});

test('receipt references are random and not redeemable-looking', () => {
  const a = payments.newReceiptRef();
  const b = payments.newReceiptRef();
  assert.match(a, /^SGR-[0-9A-F]{8}-[0-9A-F]{8}$/);
  assert.notEqual(a, b);                       // not derived from anything guessable
  assert.ok(!a.startsWith('SGP-'));            // can never be mistaken for a code
  const handlers = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');
  // Grants, completed checkouts and approved manual payments must file their
  // invoice under a receipt, never mint something a buyer could pass on.
  assert.ok(!/generatePurchaseCode/.test(handlers), 'a call site mints purchase codes again');
  assert.equal((handlers.match(/payments\.newReceiptRef\(\)/g) || []).length, 3);
});
