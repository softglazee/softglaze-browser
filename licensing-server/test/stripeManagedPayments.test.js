'use strict';
// Stripe checkout on Managed Payments (src/providers/stripe.js): a plan is sold through the Stripe Price
// with its lookup key, on API version basil or later, with managed_payments enabled. The Price must
// match the plan's amount, currency and interval. The website sells one-time Prices (lifetime) with an
// activation code by email; its thanks page asks /v1/checkout/status?session=cs_... . Real app over
// HTTP, in-memory Prisma, a fake Stripe SDK (no network).
const fakeStripe = {
  constructed: [],
  prices: {},          // lookup key -> Price
  created: [],         // checkout.sessions.create params
  sessions: {},        // id -> session (retrieve)
  invoicePaymentCalls: []
};
let sessionN = 0;
class FakeStripe {
  constructor(key, opts) {
    fakeStripe.constructed.push({ key, opts });
    this.prices = {
      list: async ({ lookup_keys: keys }) => ({ data: keys.map((k) => fakeStripe.prices[k]).filter((p) => p && p.active !== false) })
    };
    this.checkout = {
      sessions: {
        create: async (params) => {
          fakeStripe.created.push(params);
          sessionN += 1;
          const id = `cs_test_fake${String(sessionN).padStart(8, '0')}`;
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id) => fakeStripe.sessions[id] || { id, status: 'open', payment_status: 'unpaid', metadata: {} },
        list: async () => ({ data: [] })
      }
    };
    this.invoicePayments = {
      list: async (params) => { fakeStripe.invoicePaymentCalls.push(params); return { data: [{ invoice: 'in_sub_1' }] }; }
    };
    this.invoices = { retrieve: async (id) => ({ id, parent: { subscription_details: { subscription: 'sub_from_invoice' } } }) };
    this.charges = { retrieve: async (id) => ({ id, payment_intent: 'pi_from_charge' }) };
    this.webhooks = { constructEvent: (raw) => JSON.parse(Buffer.from(raw).toString('utf8')) };
  }
}
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: FakeStripe };

process.env.WEB_CHECKOUT_RATE_PER_MIN = '100000';

const H = require('./helpers/harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sealJson } = require('../src/crypto/secrets');
const stripeProvider = require('../src/providers/stripe');

const T = 'tenant1';
const SITE = 'https://browser.softglaze.com';
const price = (id, lookup, amount, recurring) => ({
  id, lookup_key: lookup, unit_amount: amount, currency: 'usd', active: true,
  type: recurring ? 'recurring' : 'one_time', recurring: recurring ? { interval: recurring } : null
});

test.before(async () => {
  await H.start();
  await H.seedTenant(T);
  await H.db.plan.create({ data: { tenantId: T, key: 'pro-yearly', name: 'Pro (yearly)', tier: 'pro', amount: 5000, currency: 'USD', interval: 'year', months: 12, sortOrder: 3 } });
  await H.db.plan.create({ data: { tenantId: T, key: 'pro-lifetime', name: 'Pro Lifetime', tier: 'pro', amount: 4900, currency: 'USD', interval: 'once', months: 1200, sortOrder: 20 } });
  await H.db.plan.create({ data: { tenantId: T, key: 'enterprise-lifetime', name: 'Enterprise Lifetime', tier: 'enterprise', amount: 24900, currency: 'USD', interval: 'once', months: 1200, sortOrder: 21 } });
  await H.db.tenantPaymentConfig.create({ data: { tenantId: T, provider: 'stripe', enabled: true, secretsSealed: sealJson({ secretKey: 'sk_test_abc', webhookSecret: 'whsec_x' }) } });
  Object.assign(fakeStripe.prices, {
    pro_monthly: price('price_pm', 'pro_monthly', 500, 'month'),
    pro_yearly: price('price_py', 'pro_yearly', 5000, 'year'),
    pro_lifetime: price('price_pl', 'pro_lifetime', 4900, null),
    enterprise_monthly: price('price_em', 'enterprise_monthly', 2900, 'month'),
    enterprise_lifetime: price('price_el', 'enterprise_lifetime', 24900, null)
  });
});
test.after(() => H.stop());

const appCheckout = (installId, planKey) => H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey, installId, provider: 'stripe' } });
const webCheckout = (body, headers = {}) => H.call('POST', '/v1/checkout', { body: { tenantId: T, provider: 'stripe', ...body }, headers });
const lastCreate = () => fakeStripe.created[fakeStripe.created.length - 1];
let seed = 0;
const newInstall = async () => { seed += 1; return H.newInstall(T, `mp-${seed}`); };
const waitFor = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 20)); }
};

test('the client is pinned to a basil API version (Managed Payments needs 2025-03-31.basil or later)', () => {
  assert.match(stripeProvider.API_VERSION, /^\d{4}-\d{2}-\d{2}\.basil$/);
  assert.ok(stripeProvider.API_VERSION >= '2025-03-31.basil');
});

test('app: a monthly plan opens a Managed Payments subscription on the catalog Price', async () => {
  const inst = await newInstall();
  const r = await appCheckout(inst.installId, 'pro');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.url, /^https:\/\/checkout\.stripe\.test\//);
  const p = lastCreate();
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.managed_payments, { enabled: true });
  assert.deepEqual(p.line_items, [{ price: 'price_pm', quantity: 1 }]);
  assert.equal(p.line_items[0].price_data, undefined, 'never inline price_data');
  assert.equal(p.automatic_tax, undefined, 'Managed Payments handles tax: no automatic_tax');
  assert.equal(p.payment_method_types, undefined);
  assert.equal(p.metadata.planKey, 'pro');
  assert.equal(p.metadata.installId, inst.installId);
  assert.deepEqual(p.subscription_data.metadata, p.metadata);
  assert.equal(p.client_reference_id, inst.installId);
  assert.equal(fakeStripe.constructed.at(-1).opts.apiVersion, stripeProvider.API_VERSION);
  const pay = await H.db.payment.findFirst({ where: { providerRef: r.json.ref } });
  assert.equal(pay.status, 'pending');
  assert.equal(pay.amount, 500);
});

test('app: a lifetime plan is a one-time Managed Payments payment', async () => {
  const inst = await newInstall();
  const r = await appCheckout(inst.installId, 'pro-lifetime');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = lastCreate();
  assert.equal(p.mode, 'payment');
  assert.deepEqual(p.managed_payments, { enabled: true });
  assert.deepEqual(p.line_items, [{ price: 'price_pl', quantity: 1 }]);
  assert.equal(p.subscription_data, undefined);
  assert.equal(p.payment_intent_data.metadata.planKey, 'pro-lifetime');
});

test('a missing Price or one that does not match the plan is refused before anything is recorded', async () => {
  const inst = await newInstall();
  const before = (await H.db.payment.findMany({})).length;
  const created = fakeStripe.created.length;

  const missing = await appCheckout(inst.installId, 'enterprise-yearly-missing');
  assert.equal(missing.status, 404); // no such plan at all

  delete fakeStripe.prices.pro_yearly;
  const none = await appCheckout(inst.installId, 'pro-yearly');
  assert.equal(none.status, 409);
  assert.equal(none.json.error, 'stripe_price_missing');
  assert.doesNotMatch(none.json.message, /lookup|price_/, 'the buyer gets plain words, not set-up details');

  fakeStripe.prices.pro_yearly = price('price_py', 'pro_yearly', 4500, 'year');
  const cheaper = await appCheckout(inst.installId, 'pro-yearly');
  assert.equal(cheaper.status, 409);
  assert.equal(cheaper.json.error, 'stripe_price_mismatch');

  fakeStripe.prices.pro_yearly = price('price_py', 'pro_yearly', 5000, 'month');
  const interval = await appCheckout(inst.installId, 'pro-yearly');
  assert.equal(interval.json.error, 'stripe_price_mismatch');

  fakeStripe.prices.pro_yearly = price('price_py', 'pro_yearly', 5000, 'year');
  assert.equal(fakeStripe.created.length, created, 'no Checkout Session was opened');
  assert.equal((await H.db.payment.findMany({})).length, before, 'no Payment was recorded');
  assert.equal((await appCheckout(inst.installId, 'pro-yearly')).status, 200);
});

test('settings checkout.stripeLookupKeys points a plan at another Price', async () => {
  fakeStripe.prices.pro_monthly_v2 = price('price_pm2', 'pro_monthly_v2', 500, 'month');
  const { updateSettings, validatePatch } = require('../src/settings');
  assert.equal(validatePatch({ checkout: { stripeLookupKeys: { pro: 'bad key!' } } }).errors['checkout.stripeLookupKeys'], 'invalid_value');
  assert.equal((await updateSettings(H.db, T, { checkout: { stripeLookupKeys: { pro: 'pro_monthly_v2' } } }, 'test')).ok, true);
  const inst = await newInstall();
  const r = await appCheckout(inst.installId, 'pro');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(lastCreate().line_items, [{ price: 'price_pm2', quantity: 1 }]);
});

test('website: a lifetime plan by Stripe returns to the site with the session id and pre-fills the email', async () => {
  const r = await webCheckout({ planKey: 'enterprise-lifetime', account: 'Web.Buyer@Example.com' }, { origin: SITE });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  const p = lastCreate();
  assert.equal(p.mode, 'payment');
  assert.deepEqual(p.managed_payments, { enabled: true });
  assert.equal(p.success_url, `${SITE}/buy/thanks?provider=stripe&session_id={CHECKOUT_SESSION_ID}`);
  assert.equal(p.cancel_url, `${SITE}/buy?cancelled=1`);
  assert.equal(p.customer_email, 'web.buyer@example.com');
  assert.equal(p.client_reference_id, undefined);
  assert.equal(p.metadata.method, 'web');
  const pay = await H.db.payment.findFirst({ where: { providerRef: r.json.ref } });
  assert.equal(pay.method, 'web');
  assert.equal(pay.installId, null);
  assert.equal(pay.account, 'web.buyer@example.com');
});

test('website: a subscription Price is app only; nothing is recorded', async () => {
  const before = (await H.db.payment.findMany({})).length;
  const r = await webCheckout({ planKey: 'enterprise', account: 'buyer@example.com' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'install_required');
  assert.equal((await H.db.payment.findMany({})).length, before);
});

test('website: /status?session= says pending, then paid once Stripe says so; one code is emailed', async () => {
  const email = 'lifetime.buyer@example.com';
  const r = await webCheckout({ planKey: 'pro-lifetime', account: email });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sid = r.json.ref;
  const status = () => H.call('GET', `/v1/checkout/status?tenantId=${T}&session=${encodeURIComponent(sid)}`, { headers: { origin: SITE } });

  const s1 = await status();
  assert.deepEqual(s1.json, { status: 'pending' });
  assert.equal(s1.headers.get('cache-control'), 'no-store');

  fakeStripe.sessions[sid] = { id: sid, status: 'complete', payment_status: 'paid', metadata: lastCreate().metadata };
  const s2 = await status();
  assert.deepEqual(s2.json, { status: 'paid' });
  assert.doesNotMatch(s2.text, /SG-|@/, 'never the code or the email');
  const pay = await H.db.payment.findFirst({ where: { providerRef: sid } });
  assert.equal(pay.status, 'paid');
  assert.match(pay.note || '', /SG-[0-9A-F]{12}/);
  const codes = await H.db.licenseCode.findMany({ where: { tenantId: T, tier: 'pro', months: 1200 } });
  assert.equal(codes.length, 1);

  // The webhook arriving afterwards changes nothing (the Payment is no longer pending).
  const ev = { id: 'evt_after', type: 'checkout.session.completed', data: { object: { id: sid, mode: 'payment', payment_status: 'paid', metadata: lastCreate().metadata } } };
  const w = await H.call('POST', `/v1/webhooks/stripe/${T}`, { body: JSON.stringify(ev), headers: { 'content-type': 'application/json', 'stripe-signature': 'x' } });
  assert.equal(w.status, 200);
  assert.equal((await H.db.licenseCode.findMany({ where: { tenantId: T, tier: 'pro', months: 1200 } })).length, 1);
  assert.deepEqual((await status()).json, { status: 'paid' });
  const mails = await waitFor(() => H.mail.sent.filter((m) => m.to === email).length && H.mail.sent.filter((m) => m.to === email));
  assert.equal(mails.length, 1, 'one activation email');
});

test('website: /status answers unknown for junk, a foreign session or an app purchase', async () => {
  for (const s of ['x', 'cs_live_', 'cs_test_<script>', 'track_abc']) {
    const r = await H.call('GET', `/v1/checkout/status?tenantId=${T}&session=${encodeURIComponent(s)}`);
    assert.deepEqual(r.json, { status: 'unknown' }, s);
  }
  const unknown = await H.call('GET', `/v1/checkout/status?tenantId=${T}&session=cs_test_nosuchsession0001`);
  assert.deepEqual(unknown.json, { status: 'unknown' });
  const inst = await newInstall();
  const app = await appCheckout(inst.installId, 'pro-lifetime');
  const r = await H.call('GET', `/v1/checkout/status?tenantId=${T}&session=${app.json.ref}`);
  assert.deepEqual(r.json, { status: 'unknown' }, 'an app purchase is not a website purchase');
});

test('/methods: Stripe keys switch the website to Stripe; a test key is a test setup, a live key is not', async () => {
  const r = await H.call('GET', `/v1/checkout/methods?tenantId=${T}`);
  assert.deepEqual(r.json.web, { card: true, test: true, provider: 'stripe' });
  assert.ok(!JSON.stringify(r.json).includes('sk_test_abc'));
  const cfg = await H.db.tenantPaymentConfig.findFirst({ where: { tenantId: T, provider: 'stripe' } });
  for (const [key, test] of [['sk_live_abc', false], ['rk_live_abc', false], ['rk_test_abc', true]]) {
    await H.db.tenantPaymentConfig.update({ where: { id: cfg.id }, data: { secretsSealed: sealJson({ secretKey: key, webhookSecret: 'whsec_x' }) } });
    assert.deepEqual((await H.call('GET', `/v1/checkout/methods?tenantId=${T}`)).json.web, { card: true, test, provider: 'stripe' }, key);
  }
  await H.db.tenantPaymentConfig.update({ where: { id: cfg.id }, data: { secretsSealed: cfg.secretsSealed } });
});

test('refund on basil: a charge with no Checkout Session is traced to its subscription through invoice payments', async () => {
  const refs = await stripeProvider.resolveChargeRefs({ secretKey: 'sk_test_abc', paymentIntent: 'pi_renewal_1', invoice: null, charge: null });
  assert.deepEqual(refs, { sessionRef: null, subscriptionId: 'sub_from_invoice' });
  assert.deepEqual(fakeStripe.invoicePaymentCalls.at(-1), { payment: { type: 'payment_intent', payment_intent: 'pi_renewal_1' }, status: 'paid', limit: 1 });
  const disputed = await stripeProvider.resolveChargeRefs({ secretKey: 'sk_test_abc', paymentIntent: null, invoice: null, charge: 'ch_1' });
  assert.equal(disputed.subscriptionId, 'sub_from_invoice');
  assert.equal(fakeStripe.invoicePaymentCalls.at(-1).payment.payment_intent, 'pi_from_charge');
});
