'use strict';
// Safepay (providers/safepay.js, POST /v1/checkout provider 'safepay', POST /v1/webhooks/safepay/:tenantId).
// The outbound HTTPS helper is replaced by a recording stub and Prisma by the in-memory fake, then the
// real Express routers run over HTTP.
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test';
process.env.PUBLIC_BASE_URL = 'https://api.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakePrisma } = require('./helpers/fakePrisma');

// Recording stand-in for src/http (safepay.js reads httpsRequest at require time).
const http = {
  calls: [],
  replies: [],
  async httpsRequest(method, url, opts = {}) {
    http.calls.push({ method, url, headers: opts.headers || {}, body: opts.body });
    const next = http.replies.shift();
    if (!next) throw new Error(`unexpected request ${method} ${url}`);
    return typeof next === 'function' ? next(method, url, opts) : next;
  }
};
const httpPath = require.resolve('../src/http');
require.cache[httpPath] = { id: httpPath, filename: httpPath, loaded: true, exports: http };

const db = fakePrisma();
db.setting = { findMany: async () => [], findUnique: async () => null };
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };

const express = require('express');
const { sealJson } = require('../src/crypto/secrets');
const safepay = require('../src/providers/safepay');
const { buildProviderSecrets, PROVIDER_FIELDS } = require('../src/providers/configFields');
const { CHECKOUT_PROVIDERS } = require('../src/providers/checkoutProviders');

const DAY = 86400000;
const WH = 'sfpy_webhook_shared_secret';
const SECRETS = { publicKey: 'pub_test', secretKey: 'sec_test', webhookSecret: WH, env: 'sandbox' };
const ok = (data) => ({ status: 200, json: { data, status: { errors: [], message: 'success' } } });
const hmac = (body, key = WH) => crypto.createHmac('sha256', key).update(body).digest('hex');

let base;
let server;
test.before(async () => {
  const app = express();
  app.use('/v1/webhooks', require('../src/routes/webhooks'));
  app.use(express.json());
  app.use('/v1/checkout', require('../src/routes/checkout'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error.' }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function reset() {
  for (const k of Object.keys(db.tables)) db.tables[k] = [];
  for (const k of Object.keys(db.hooks)) delete db.hooks[k];
  http.calls = []; http.replies = [];
  db.tables.tenant.push({ id: 't1', status: 'active' }, { id: 't2', status: 'active' });
  db.tables.tenantPaymentConfig.push(
    { id: 'c1', tenantId: 't1', provider: 'safepay', enabled: true, secretsSealed: sealJson(SECRETS) },
    // Saved without a webhook secret (cannot happen through payment-config, but must still be safe).
    { id: 'c2', tenantId: 't2', provider: 'safepay', enabled: true, secretsSealed: sealJson({ publicKey: 'p', secretKey: 's' }) }
  );
  db.tables.plan.push(
    { id: 'p1', tenantId: 't1', key: 'pro', name: 'Pro', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, recurring: false, active: true },
    { id: 'p2', tenantId: 't1', key: 'pro_monthly', name: 'Pro', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, recurring: true, active: true },
    { id: 'p3', tenantId: 't1', key: 'ent_yearly', name: 'Enterprise', tier: 'enterprise', amount: 29000, currency: 'USD', interval: 'year', months: 12, recurring: true, active: true }
  );
}
function addPayment(providerRef, extra = {}) {
  const row = { id: `pay_${providerRef}`, tenantId: 't1', provider: 'safepay', providerRef, status: 'pending', plan: 'pro', installId: 'inst1', account: null, amount: 500, currency: 'USD', createdAt: new Date(), ...extra };
  db.tables.payment.push(row);
  return row;
}
const payment = (ref) => db.tables.payment.find((p) => p.providerRef === ref);
const licenses = () => db.tables.license;
const daysLeft = (lic) => Math.round((new Date(lic.currentPeriodEnd).getTime() - Date.now()) / DAY);

async function deliver(event, { tenantId = 't1', key = WH, signature } = {}) {
  const body = JSON.stringify(event);
  const headers = { 'content-type': 'application/json' };
  const sig = signature === undefined ? hmac(body, key) : signature;
  if (sig !== null) headers['x-sfpy-signature'] = sig;
  const r = await fetch(`${base}/v1/webhooks/safepay/${tenantId}`, { method: 'POST', headers, body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
let evtN = 0;
const ev = (type, data, token = `evt_${++evtN}`) => ({ token, version: '2.0.0', type, data, created_at: { seconds: Math.floor(Date.now() / 1000) } });
const paid = (tracker, extra = {}) => ev('payment.succeeded', { tracker, state: 'TRACKER_ENDED', amount: 500, currency: 'USD', ...extra });
const subPaid = (planId, subId, extra = {}) => ev('subscription.payment.succeeded', {
  id: subId, plan_id: planId, customer_email: 'buyer@example.com', status: 'ACTIVE', amount: 500, currency: 'USD',
  current_period_end_date: { seconds: Math.floor((Date.now() + 30 * DAY) / 1000) }, transaction_id: 'txn_1', transaction_status: 'COMPLETE', ...extra
});
async function quiet(fn) {
  const e = console.error; const w = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
}

// --- signature ----------------------------------------------------------------------------------
test('verifyWebhook accepts the HMAC-SHA256 hex of the raw body', () => {
  const raw = Buffer.from('{"type":"payment.succeeded","data":{"tracker":"track_1"}}');
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: raw, signature: hmac(raw) }), true);
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: raw, signature: hmac(raw).toUpperCase() }), true);
});

test('verifyWebhook rejects a wrong key, a changed body, a missing or malformed header', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: raw, signature: hmac(raw, 'other') }), false);
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: Buffer.from('{"a":2}'), signature: hmac(raw) }), false);
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: raw, signature: undefined }), false);
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: raw, signature: 'abc' }), false);
  assert.equal(safepay.verifyWebhook({ secrets: SECRETS, rawBody: raw, signature: hmac(raw).slice(0, 62) + 'zz' }), false);
});

test('verifyWebhook rejects everything when the webhook secret is unset (an empty HMAC key is forgeable)', () => {
  const raw = Buffer.from('{"a":1}');
  for (const secrets of [null, {}, { webhookSecret: '' }, { ...SECRETS, webhookSecret: undefined }]) {
    assert.equal(safepay.verifyWebhook({ secrets, rawBody: raw, signature: hmac(raw, '') }), false);
  }
});

// --- config -------------------------------------------------------------------------------------
test('payment-config: safepay needs publicKey, secretKey, webhookSecret; env defaults to sandbox', () => {
  assert.deepEqual(PROVIDER_FIELDS.safepay, { required: ['publicKey', 'secretKey', 'webhookSecret'], optional: ['env'] });
  const r = buildProviderSecrets('safepay', { publicKey: ' pk ', secretKey: 'sk', webhookSecret: 'wh', junk: 'x' });
  assert.deepEqual(r.secrets, { publicKey: 'pk', secretKey: 'sk', webhookSecret: 'wh', env: 'sandbox' });
  assert.equal(buildProviderSecrets('safepay', { publicKey: 'pk', secretKey: 'sk', webhookSecret: 'wh', env: 'LIVE' }).secrets.env, 'live');
  assert.match(buildProviderSecrets('safepay', { publicKey: 'pk', secretKey: 'sk', webhookSecret: 'wh', env: 'production' }).error, /env/);
  assert.match(buildProviderSecrets('safepay', { publicKey: 'pk', secretKey: 'sk' }).error, /webhookSecret/);
  assert.match(buildProviderSecrets('safepay', { publicKey: 'pk', secretKey: '  ', webhookSecret: 'wh' }).error, /secretKey/);
  assert.match(buildProviderSecrets('safepay', { secretKey: 'sk', webhookSecret: 'wh' }).error, /publicKey/);
});

test('the app lists Safepay as "Safepay (cards)"', () => {
  assert.equal(CHECKOUT_PROVIDERS.safepay.label, 'Safepay (cards)');
});

// --- checkout -----------------------------------------------------------------------------------
test('one-time checkout: tracker + auth token, hosted /embedded/ URL, Payment ref = tracker', async () => {
  reset();
  http.replies.push(ok({ tracker: { token: 'track_abc' } }), { status: 200, json: { data: 'tbt_xyz' } });
  const r = await fetch(`${base}/v1/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 't1', planKey: 'pro', provider: 'safepay', installId: 'inst9' }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ref, 'track_abc');
  const [session, token] = http.calls;
  assert.equal(session.url, 'https://sandbox.api.getsafepay.com/order/payments/v3/');
  assert.equal(session.headers['X-SFPY-MERCHANT-SECRET'], 'sec_test');
  assert.equal(session.body.merchant_api_key, 'pub_test');
  assert.equal(session.body.intent, 'CYBERSOURCE');
  assert.equal(session.body.mode, 'payment');
  assert.equal(session.body.amount, 500);
  assert.equal(session.body.currency, 'USD');
  assert.match(session.body.metadata.order_id, /^sg-t1-\d+$/);
  assert.equal(token.url, 'https://sandbox.api.getsafepay.com/client/passport/v1/token');
  const u = new URL(j.url);
  assert.equal(u.origin + u.pathname, 'https://sandbox.api.getsafepay.com/embedded/');
  assert.equal(u.searchParams.get('environment'), 'sandbox');
  assert.equal(u.searchParams.get('tracker'), 'track_abc');
  assert.equal(u.searchParams.get('tbt'), 'tbt_xyz');
  assert.equal(u.searchParams.get('source'), 'hosted');
  assert.equal(u.searchParams.get('redirect_url'), 'https://api.test/v1/checkout/return/success');
  assert.equal(u.searchParams.get('cancel_url'), 'https://api.test/v1/checkout/return/cancel');
  const p = payment('track_abc');
  assert.equal(p.status, 'pending');
  assert.equal(p.amount, 500);
  assert.equal(p.installId, 'inst9');
});

test('recurring checkout: a Safepay plan from our Plan row, /checkout/auth/login URL, Payment ref = plan token', async () => {
  reset();
  http.replies.push(ok({ token: 'plan_123' }), { status: 200, json: { data: 'tbt_1' } });
  const r = await fetch(`${base}/v1/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 't1', planKey: 'ent_yearly', provider: 'safepay' }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ref, 'plan_123');
  const [plan] = http.calls;
  assert.equal(plan.url, 'https://sandbox.api.getsafepay.com/client/plans/v1/');
  assert.deepEqual({ ...plan.body.payload, product: undefined }, {
    amount: '29000', currency: 'USD', interval: 'YEAR', interval_count: 1, billing_cycles: 0, type: 'RECURRING', product: undefined, active: true
  });
  const u = new URL(j.url);
  assert.equal(u.origin + u.pathname, 'https://sandbox.api.getsafepay.com/checkout/auth/login');
  assert.equal(u.searchParams.get('plan_id'), 'plan_123');
  assert.equal(u.searchParams.get('auth_token'), 'tbt_1');
  assert.equal(u.searchParams.get('env'), 'sandbox');
  assert.equal(u.searchParams.get('reference'), 'plan_123');
  assert.equal(payment('plan_123').amount, 29000);
});

test('live env uses the live API and checkout hosts', async () => {
  reset();
  http.replies.push(ok({ token: 'plan_live' }), { status: 200, json: { data: 'tbt_live' } });
  const out = await safepay.createCheckout({ secrets: { ...SECRETS, env: 'live' }, plan: db.tables.plan[1], orderId: 'o1', returnUrl: 'https://r', cancelUrl: 'https://c' });
  assert.equal(http.calls[0].url, 'https://api.getsafepay.com/client/plans/v1/');
  assert.ok(out.url.startsWith('https://getsafepay.com/checkout/auth/login?'));
  assert.equal(new URL(out.url).searchParams.get('env'), 'production');
  assert.equal(safepay.paymentCheckoutUrl('live', { tracker: 't', tbt: 'b' }).split('?')[0], 'https://getsafepay.com/embedded/');
});

test('a Safepay API error fails the checkout and records no Payment', async () => {
  reset();
  http.replies.push({ status: 400, json: { data: null, status: { errors: ['invalid merchant_api_key'], message: 'error' } } });
  await assert.rejects(safepay.createCheckout({ secrets: SECRETS, plan: db.tables.plan[0], orderId: 'o' }), /invalid merchant_api_key/);
  http.replies.push({ status: 400, json: { data: null, status: { errors: ['bad'], message: 'error' } } });
  const r = await quiet(() => fetch(`${base}/v1/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 't1', planKey: 'pro', provider: 'safepay' }) }));
  assert.equal(r.status, 500);
  assert.equal(db.tables.payment.length, 0);
});

test('createCheckout refuses an unconfigured tenant', async () => {
  await assert.rejects(safepay.createCheckout({ secrets: { webhookSecret: 'x' }, plan: { amount: 500 } }), /not configured/);
});

// --- webhooks -----------------------------------------------------------------------------------
test('webhook: a bad, missing or unkeyed signature is 400 and grants nothing', async () => {
  reset();
  addPayment('track_1');
  assert.equal((await deliver(paid('track_1'), { key: 'wrong' })).status, 400);
  assert.equal((await deliver(paid('track_1'), { signature: null })).status, 400);
  addPayment('track_2', { tenantId: 't2' });
  assert.equal((await deliver(paid('track_2'), { tenantId: 't2', key: '' })).status, 400);
  assert.equal(licenses().length, 0);
  assert.equal(payment('track_1').status, 'pending');
  assert.equal((await deliver(paid('track_1'), { tenantId: 'nope' })).status, 404);
});

test('webhook: payment.succeeded provisions the one-time checkout once; a duplicate delivery is a no-op', async () => {
  reset();
  addPayment('track_1');
  const e = paid('track_1');
  assert.deepEqual((await deliver(e)).json, { received: true });
  assert.equal(payment('track_1').status, 'paid');
  assert.equal(licenses().length, 1);
  assert.equal(licenses()[0].installId, 'inst1');
  assert.equal(daysLeft(licenses()[0]), 30);
  assert.deepEqual((await deliver(e)).json, { received: true, duplicate: true });
  assert.equal((await deliver(paid('track_1'))).status, 200, 'a second event id for the same tracker');
  assert.equal(daysLeft(licenses()[0]), 30, 'granted once');
});

test('webhook: an amount or currency that differs from the checkout grants nothing', async () => {
  reset();
  addPayment('track_a');
  addPayment('track_c');
  await quiet(async () => {
    assert.equal((await deliver(paid('track_a', { amount: 100 }))).status, 200);
    assert.equal((await deliver(paid('track_c', { currency: 'PKR' }))).status, 200);
  });
  assert.equal(licenses().length, 0);
  assert.equal(payment('track_a').status, 'pending');
  assert.equal(payment('track_c').status, 'pending');
});

test('webhook: payment.failed and an unknown tracker grant nothing', async () => {
  reset();
  addPayment('track_f');
  assert.equal((await deliver(ev('payment.failed', { tracker: 'track_f', amount: 500, currency: 'USD' }))).status, 200);
  assert.equal((await deliver(paid('track_other'))).status, 200);
  assert.equal(licenses().length, 0);
  assert.equal(payment('track_f').status, 'pending');
});

test('webhook: the Payment lookup is scoped to Safepay', async () => {
  reset();
  addPayment('shared', { provider: 'stripe' });
  await deliver(paid('shared'));
  assert.equal(licenses().length, 0);
  assert.equal(payment('shared').status, 'pending');
});

test('webhook: subscription.created alone grants nothing', async () => {
  reset();
  addPayment('plan_s', { plan: 'pro_monthly' });
  await deliver(ev('subscription.created', { id: 'sub_1', plan_id: 'plan_s', status: 'INCOMPLETE', amount: 500, currency: 'USD' }));
  assert.equal(licenses().length, 0);
  assert.equal(payment('plan_s').status, 'pending');
});

test('webhook: the first subscription.payment.succeeded activates a licence keyed to the subscription id', async () => {
  reset();
  addPayment('plan_s', { plan: 'pro_monthly' });
  assert.deepEqual((await deliver(subPaid('plan_s', 'sub_1'))).json, { received: true });
  assert.equal(payment('plan_s').status, 'paid');
  assert.equal(licenses().length, 1);
  const lic = licenses()[0];
  assert.equal(lic.providerRef, 'sub_1');
  assert.equal(lic.installId, 'inst1');
  assert.equal(lic.plan, 'pro_monthly');
  assert.equal(lic.status, 'active');
  assert.equal(daysLeft(lic), 30);
});

test('webhook: data.reference finds the checkout too', async () => {
  reset();
  addPayment('plan_r', { plan: 'pro_monthly' });
  await deliver(subPaid('plan_other', 'sub_r', { reference: 'plan_r' }));
  assert.equal(payment('plan_r').status, 'paid');
  assert.equal(licenses()[0].providerRef, 'sub_r');
});

test('webhook: a renewal extends the period; a duplicate renewal does not', async () => {
  reset();
  addPayment('plan_s', { plan: 'pro_monthly' });
  await deliver(subPaid('plan_s', 'sub_1'));
  const renewal = subPaid('plan_s', 'sub_1', { current_period_end_date: { seconds: Math.floor((Date.now() + 60 * DAY) / 1000) }, transaction_id: 'txn_2' });
  assert.deepEqual((await deliver(renewal)).json, { received: true });
  assert.equal(licenses().length, 1);
  assert.equal(daysLeft(licenses()[0]), 60);
  assert.deepEqual((await deliver(renewal)).json, { received: true, duplicate: true });
  assert.equal(daysLeft(licenses()[0]), 60);
});

test('webhook: a renewal with a past period end extends by one interval (never shortens)', async () => {
  reset();
  addPayment('plan_y', { plan: 'ent_yearly', amount: 29000 });
  await deliver(subPaid('plan_y', 'sub_y', { amount: 29000, current_period_end_date: { seconds: 1 } }));
  assert.equal(daysLeft(licenses()[0]), 365);
  assert.equal(licenses()[0].tier, 'enterprise');
  await deliver(subPaid('plan_y', 'sub_y', { amount: 29000, current_period_end_date: { seconds: 1 } }));
  assert.equal(daysLeft(licenses()[0]), 365, 'kept, not shortened');
});

test('webhook: subscription payments with a mismatched amount, failed or incomplete status grant nothing', async () => {
  reset();
  addPayment('plan_s', { plan: 'pro_monthly' });
  await quiet(() => deliver(subPaid('plan_s', 'sub_1', { amount: 1 })));
  await deliver(subPaid('plan_s', 'sub_1', { transaction_status: 'FAILED' }));
  await deliver(ev('subscription.payment.failed', { id: 'sub_1', plan_id: 'plan_s', amount: 500, currency: 'USD' }));
  assert.equal(licenses().length, 0);
  assert.equal(payment('plan_s').status, 'pending');
});

test('webhook: a renewal for a subscription never provisioned here creates nothing', async () => {
  reset();
  addPayment('plan_s', { plan: 'pro_monthly', status: 'failed' });
  await deliver(subPaid('plan_s', 'sub_x'));
  assert.equal(licenses().length, 0);
});

test('webhook: subscription.cancelled ends the licence', async () => {
  reset();
  addPayment('plan_s', { plan: 'pro_monthly' });
  await deliver(subPaid('plan_s', 'sub_1'));
  await deliver(ev('subscription.cancelled', { id: 'sub_1', plan_id: 'plan_s', status: 'CANCELED' }));
  assert.equal(licenses()[0].status, 'expired');
  // Safepay's webhook reference spells it "canceled"; both are handled. Unknown subs are ignored.
  assert.equal((await deliver(ev('subscription.canceled', { id: 'sub_unknown' }))).status, 200);
});

test('webhook: a failure rolls back and the retry is processed', async () => {
  reset();
  addPayment('track_r');
  let fail = true;
  db.hooks['license.create'] = () => { if (fail) { fail = false; throw new Error('db down'); } };
  const e = paid('track_r');
  assert.equal((await quiet(() => deliver(e))).status, 500);
  assert.equal(payment('track_r').status, 'pending');
  assert.deepEqual((await deliver(e)).json, { received: true });
  assert.equal(licenses().length, 1);
});
