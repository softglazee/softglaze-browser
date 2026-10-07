'use strict';
// Audit L2, L5, L6, L8, L9: payment webhooks. Prisma is replaced by an in-memory fake
// (test/helpers/fakePrisma.js) and provider calls are stubbed, then the real Express
// router is exercised over HTTP.
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakePrisma } = require('./helpers/fakePrisma');

const db = fakePrisma();
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };

const express = require('express');
const { sealJson } = require('../src/crypto/secrets');
const stripeProvider = require('../src/providers/stripe');
const paypalProvider = require('../src/providers/paypal');
const router = require('../src/routes/webhooks');

const DAY = 86400000;
const CM_KEY = 'cmus_api_key';

// Stripe: the signature check itself is Stripe's SDK; here the body is the event.
stripeProvider.verifyEvent = ({ rawBody }) => JSON.parse(Buffer.from(rawBody).toString('utf8'));
paypalProvider.verifyWebhook = async () => true;

let base;
let server;
test.before(async () => {
  const app = express();
  app.use('/v1/webhooks', router);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/v1/webhooks`;
});
test.after(() => server.close());

function reset() {
  for (const k of Object.keys(db.tables)) db.tables[k] = [];
  for (const k of Object.keys(db.hooks)) delete db.hooks[k];
  db.tables.tenant.push({ id: 't1', status: 'active' }, { id: 't2', status: 'active' });
  db.tables.tenantPaymentConfig.push(
    { id: 'c1', tenantId: 't1', provider: 'stripe', enabled: true, secretsSealed: sealJson({ secretKey: 'sk_test', webhookSecret: 'whsec' }) },
    { id: 'c2', tenantId: 't1', provider: 'paypal', enabled: true, secretsSealed: sealJson({ clientId: 'id', clientSecret: 's', webhookId: 'wh', env: 'sandbox' }) },
    { id: 'c3', tenantId: 't1', provider: 'cryptomus', enabled: true, secretsSealed: sealJson({ merchantId: 'm', apiKey: CM_KEY }) },
    // What the old payment-config route sealed for Cryptomus: no apiKey at all.
    { id: 'c4', tenantId: 't2', provider: 'cryptomus', enabled: true, secretsSealed: sealJson({ secretKey: '', webhookSecret: '', merchantId: 'm' }) }
  );
  db.tables.plan.push({ id: 'p1', tenantId: 't1', key: 'pro', tier: 'pro', months: 1, interval: 'month' });
}
function addPayment(provider, providerRef, extra = {}) {
  const row = { id: `pay_${providerRef}`, tenantId: 't1', provider, providerRef, status: 'pending', plan: 'pro', installId: 'inst1', account: null, amount: 500, createdAt: new Date(), ...extra };
  db.tables.payment.push(row);
  return row;
}
const payment = (ref) => db.tables.payment.find((p) => p.providerRef === ref);
const licenses = () => db.tables.license;
const daysLeft = (lic) => Math.round((new Date(lic.currentPeriodEnd).getTime() - Date.now()) / DAY);

async function post(provider, body, tenantId = 't1') {
  const r = await fetch(`${base}/${provider}/${tenantId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const cmSign = (data, key) => {
  const json = JSON.stringify(data).replace(/\//g, '\\/');
  return { ...data, sign: crypto.createHash('md5').update(Buffer.from(json, 'utf8').toString('base64') + key).digest('hex') };
};
const stripeEvent = (id, type, object) => ({ id, type, data: { object } });
const paidSession = (id, extra = {}) => ({ id, mode: 'payment', payment_status: 'paid', metadata: {}, ...extra });
async function quiet(fn) {
  const e = console.error; const w = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
}

// --- L2 ---------------------------------------------------------------------
test('L2: a Cryptomus webhook is rejected when the stored apiKey is empty (forged with md5 + "")', async () => {
  reset();
  addPayment('cryptomus', 'u-forged', { tenantId: 't2' });
  const r = await post('cryptomus', cmSign({ uuid: 'u-forged', status: 'paid' }, ''), 't2');
  assert.equal(r.status, 400);
  assert.equal(licenses().length, 0);
  assert.equal(payment('u-forged').status, 'pending');
});

test('L2: a correctly signed Cryptomus payment provisions once; a later paid_over for the same order does nothing', async () => {
  reset();
  addPayment('cryptomus', 'u1');
  assert.equal((await post('cryptomus', cmSign({ uuid: 'u1', status: 'paid' }, CM_KEY))).status, 200);
  assert.equal(licenses().length, 1);
  assert.equal(daysLeft(licenses()[0]), 30);
  assert.equal(payment('u1').status, 'paid');
  assert.equal((await post('cryptomus', cmSign({ uuid: 'u1', status: 'paid_over' }, CM_KEY))).status, 200);
  assert.equal(daysLeft(licenses()[0]), 30, 'an already-paid payment must not be granted again');
});

test('L2: the Payment lookup is scoped to the provider (a Stripe ref cannot be settled via Cryptomus)', async () => {
  reset();
  addPayment('stripe', 'shared-ref');
  assert.equal((await post('cryptomus', cmSign({ uuid: 'shared-ref', status: 'paid' }, CM_KEY))).status, 200);
  assert.equal(licenses().length, 0);
  assert.equal(payment('shared-ref').status, 'pending');
});

test('L2: no Payment recorded at checkout means no licence', async () => {
  reset();
  await post('stripe', stripeEvent('evt_nopay', 'checkout.session.completed', paidSession('cs_unknown', { metadata: { installId: 'x', planKey: 'pro' } })));
  assert.equal(licenses().length, 0);
});

// --- L5 ---------------------------------------------------------------------
test('L5: a replayed event is a duplicate and grants nothing', async () => {
  reset();
  addPayment('stripe', 'cs_1');
  const ev = stripeEvent('evt_1', 'checkout.session.completed', paidSession('cs_1'));
  assert.deepEqual((await post('stripe', ev)).json, { received: true });
  assert.deepEqual((await post('stripe', ev)).json, { received: true, duplicate: true });
  assert.equal(licenses().length, 1);
  assert.equal(daysLeft(licenses()[0]), 30);
  assert.ok(db.tables.webhookEvent[0].processedAt instanceof Date);
});

test('L5: concurrent deliveries of one event provision once', async () => {
  reset();
  addPayment('stripe', 'cs_c');
  const ev = stripeEvent('evt_c', 'checkout.session.completed', paidSession('cs_c'));
  const rs = await Promise.all([post('stripe', ev), post('stripe', ev), post('stripe', ev)]);
  assert.equal(rs.filter((r) => r.json && r.json.duplicate).length, 2);
  assert.equal(licenses().length, 1);
  assert.equal(daysLeft(licenses()[0]), 30);
});

test('L5: a failure rolls back, releases the event, and the retry is processed', async () => {
  reset();
  addPayment('stripe', 'cs_f');
  let fail = true;
  db.hooks['license.create'] = () => { if (fail) { fail = false; throw new Error('db down'); } };
  const ev = stripeEvent('evt_f', 'checkout.session.completed', paidSession('cs_f'));
  assert.equal((await quiet(() => post('stripe', ev))).status, 500);
  assert.equal(db.tables.webhookEvent.length, 0, 'the event row must be released');
  assert.equal(payment('cs_f').status, 'pending', 'the payment status change must roll back with provisioning');
  assert.equal(licenses().length, 0);
  assert.deepEqual((await post('stripe', ev)).json, { received: true });
  assert.equal(licenses().length, 1);
  assert.equal(payment('cs_f').status, 'paid');
});

test('L5: an unprocessed claim is a duplicate while fresh, and is taken over once stale', async () => {
  reset();
  addPayment('stripe', 'cs_s');
  const ev = stripeEvent('evt_s', 'checkout.session.completed', paidSession('cs_s'));
  db.tables.webhookEvent.push({ id: 'evt_s', tenantId: 't1', provider: 'stripe', type: '', receivedAt: new Date(), processedAt: null });
  assert.equal((await post('stripe', ev)).json.duplicate, true);
  assert.equal(licenses().length, 0);
  db.tables.webhookEvent[0].receivedAt = new Date(Date.now() - 3600000);
  assert.deepEqual((await post('stripe', ev)).json, { received: true });
  assert.equal(licenses().length, 1);
});

// --- L6 ---------------------------------------------------------------------
const completedCapture = { id: 'O1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C1', status: 'COMPLETED' }] } }] };

test('L6: a failed PayPal capture is not swallowed: 500, no licence, event released for retry', async () => {
  reset();
  addPayment('paypal', 'O1');
  paypalProvider.captureOrder = async () => { throw new Error('PayPal: capture failed (HTTP 422, INSTRUMENT_DECLINED).'); };
  const r = await quiet(() => post('paypal', { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O1' } }));
  assert.equal(r.status, 500);
  assert.equal(licenses().length, 0);
  assert.equal(payment('O1').status, 'pending');
  assert.equal(db.tables.webhookEvent.length, 0);
});

test('L6: a completed capture provisions once; PAYMENT.CAPTURE.COMPLETED for the same order does not grant again', async () => {
  reset();
  addPayment('paypal', 'O1');
  paypalProvider.captureOrder = async () => completedCapture;
  await post('paypal', { id: 'WH-2', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O1' } });
  assert.equal(licenses().length, 1);
  await post('paypal', { id: 'WH-3', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { status: 'COMPLETED', supplementary_data: { related_ids: { order_id: 'O1' } } } });
  assert.equal(licenses().length, 1);
  assert.equal(daysLeft(licenses()[0]), 30);
});

test('L6: a PENDING capture waits; PAYMENT.CAPTURE.COMPLETED provisions it', async () => {
  reset();
  addPayment('paypal', 'O2');
  paypalProvider.captureOrder = async () => ({ id: 'O2', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: 'PENDING' }] } }] });
  await post('paypal', { id: 'WH-4', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O2' } });
  assert.equal(licenses().length, 0);
  await post('paypal', { id: 'WH-5', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { status: 'PENDING', supplementary_data: { related_ids: { order_id: 'O2' } } } });
  assert.equal(licenses().length, 0, 'a capture event whose resource is not COMPLETED must not provision');
  await post('paypal', { id: 'WH-6', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { status: 'COMPLETED', supplementary_data: { related_ids: { order_id: 'O2' } } } });
  assert.equal(licenses().length, 1);
});

// --- L8 ---------------------------------------------------------------------
test('L8: checkout.session.completed with payment_status unpaid waits for async_payment_succeeded', async () => {
  reset();
  addPayment('stripe', 'cs_a');
  await post('stripe', stripeEvent('evt_a1', 'checkout.session.completed', paidSession('cs_a', { payment_status: 'unpaid' })));
  assert.equal(licenses().length, 0);
  assert.equal(payment('cs_a').status, 'pending');
  await post('stripe', stripeEvent('evt_a2', 'checkout.session.async_payment_succeeded', paidSession('cs_a')));
  assert.equal(licenses().length, 1);
});

test('L8: async_payment_failed marks the payment failed and grants nothing', async () => {
  reset();
  addPayment('stripe', 'cs_x');
  await post('stripe', stripeEvent('evt_x', 'checkout.session.async_payment_failed', { id: 'cs_x', payment_status: 'unpaid' }));
  assert.equal(payment('cs_x').status, 'failed');
  await post('stripe', stripeEvent('evt_x2', 'checkout.session.async_payment_succeeded', paidSession('cs_x')));
  assert.equal(licenses().length, 0, 'a failed payment is never provisioned');
});

test('L8: a full refund takes the term back once; a partial refund leaves the licence', async () => {
  reset();
  addPayment('stripe', 'cs_r');
  await post('stripe', stripeEvent('evt_r0', 'checkout.session.completed', paidSession('cs_r')));
  const calls = [];
  stripeProvider.resolveChargeRefs = async (a) => { calls.push(a); return { sessionRef: 'cs_r', subscriptionId: null }; };

  await post('stripe', stripeEvent('evt_r1', 'charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount: 500, amount_refunded: 100, refunded: false }));
  assert.equal(calls.length, 0, 'a partial refund is not acted on');
  assert.equal(licenses()[0].status, 'active');

  await post('stripe', stripeEvent('evt_r2', 'charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount: 500, amount_refunded: 500, refunded: true }));
  assert.equal(calls[0].paymentIntent, 'pi_1');
  assert.equal(calls[0].secretKey, 'sk_test');
  assert.equal(payment('cs_r').status, 'refunded');
  assert.equal(licenses()[0].status, 'canceled');
  assert.ok(new Date(licenses()[0].currentPeriodEnd).getTime() <= Date.now());

  // The dispute that can follow a refund does not act twice.
  const end = licenses()[0].currentPeriodEnd;
  await post('stripe', stripeEvent('evt_r3', 'charge.dispute.created', { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1' }));
  assert.equal(licenses()[0].currentPeriodEnd, end);
});

test('L8: refunding one of two stacked purchases removes only its term', async () => {
  reset();
  addPayment('stripe', 'cs_1');
  addPayment('stripe', 'cs_2');
  await post('stripe', stripeEvent('e1', 'checkout.session.completed', paidSession('cs_1')));
  await post('stripe', stripeEvent('e2', 'checkout.session.completed', paidSession('cs_2')));
  assert.equal(daysLeft(licenses()[0]), 60);
  stripeProvider.resolveChargeRefs = async () => ({ sessionRef: 'cs_1', subscriptionId: null });
  await post('stripe', stripeEvent('e3', 'charge.refunded', { id: 'ch', payment_intent: 'pi', amount: 500, amount_refunded: 500, refunded: true }));
  assert.equal(daysLeft(licenses()[0]), 30);
  assert.equal(licenses()[0].status, 'active');
});

test('L8: a dispute on a subscription charge ends that subscription licence now', async () => {
  reset();
  addPayment('stripe', 'cs_sub');
  await post('stripe', stripeEvent('s1', 'checkout.session.completed', paidSession('cs_sub', { mode: 'subscription', subscription: 'sub_1' })));
  assert.equal(licenses()[0].providerRef, 'sub_1');
  const seen = [];
  stripeProvider.resolveChargeRefs = async (a) => { seen.push(a); return { sessionRef: null, subscriptionId: 'sub_1' }; };
  await post('stripe', stripeEvent('s2', 'charge.dispute.created', { id: 'dp', charge: 'ch_s', payment_intent: null }));
  assert.equal(seen[0].charge, 'ch_s');
  assert.equal(licenses()[0].status, 'canceled');
});

test('L8: a subscription checkout that is not paid does not provision', async () => {
  reset();
  addPayment('stripe', 'cs_sub2');
  await post('stripe', stripeEvent('s3', 'checkout.session.completed', paidSession('cs_sub2', { mode: 'subscription', subscription: 'sub_2', payment_status: 'unpaid' })));
  assert.equal(licenses().length, 0);
});

// --- L9 ---------------------------------------------------------------------
test('L9: invoice.paid reads the subscription from invoice.parent.subscription_details', async () => {
  reset();
  addPayment('stripe', 'cs_9');
  await post('stripe', stripeEvent('i0', 'checkout.session.completed', paidSession('cs_9', { mode: 'subscription', subscription: 'sub_9' })));
  const end = Math.floor(Date.now() / 1000) + 45 * 86400;
  await post('stripe', stripeEvent('i1', 'invoice.paid', {
    id: 'in_1', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_9' } },
    lines: { data: [{ period: { end } }] }
  }));
  assert.equal(licenses().length, 1);
  assert.equal(new Date(licenses()[0].currentPeriodEnd).getTime(), end * 1000);
});

test('L9: invoiceSubscriptionId supports both invoice shapes', () => {
  assert.equal(stripeProvider.invoiceSubscriptionId({ subscription: 'sub_a' }), 'sub_a');
  assert.equal(stripeProvider.invoiceSubscriptionId({ subscription: { id: 'sub_b' } }), 'sub_b');
  assert.equal(stripeProvider.invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_c' } } }), 'sub_c');
  assert.equal(stripeProvider.invoiceSubscriptionId({ subscription: null, parent: null }), null);
});
