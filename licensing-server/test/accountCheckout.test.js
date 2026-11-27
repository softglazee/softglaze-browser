'use strict';
// Buying while signed in (src/accountCheckout.js): POST /v1/account/checkout with a web session opens a Stripe
// checkout for a plan ON THE ACCOUNT; the webhook grants it to the account (no install); the account's
// signed-in computers get it from /v1/license (at most the plan's `devices`), the web app sees it in
// /v1/account/me. A computer only linked by a claimed (unverified) email never gets it. Real app over HTTP,
// in-memory Prisma, a fake Stripe SDK (no network).
const fakeStripe = { prices: {}, created: [] };
let sessionN = 0;
class FakeStripe {
  constructor() {
    this.prices = { list: async ({ lookup_keys: keys }) => ({ data: keys.map((k) => fakeStripe.prices[k]).filter(Boolean) }) };
    this.checkout = {
      sessions: {
        create: async (params) => { fakeStripe.created.push(params); sessionN += 1; const id = `cs_test_acct${String(sessionN).padStart(8, '0')}`; return { id, url: `https://checkout.stripe.test/${id}` }; },
        retrieve: async (id) => ({ id, status: 'open', payment_status: 'unpaid', metadata: {} }),
        list: async ({ payment_intent: pi }) => ({ data: fakeStripe.byPi && fakeStripe.byPi[pi] ? [fakeStripe.byPi[pi]] : [] })
      }
    };
    this.invoicePayments = { list: async () => ({ data: [] }) };
    this.invoices = { retrieve: async (id) => ({ id }) };
    this.charges = { retrieve: async (id) => ({ id }) };
    this.webhooks = { constructEvent: (raw) => JSON.parse(Buffer.from(raw).toString('utf8')) };
  }
}
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: FakeStripe };

const H = require('./helpers/harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sealJson } = require('../src/crypto/secrets');
const { createSession } = require('../src/auth/sessions');

const T = 'tenant1';
const price = (id, lookup, amount, recurring) => ({ id, lookup_key: lookup, unit_amount: amount, currency: 'usd', active: true, type: recurring ? 'recurring' : 'one_time', recurring: recurring ? { interval: recurring } : null });
const db = H.db;
let n = 0;

test.before(async () => {
  await H.start();
  await H.seedTenant(T);
  await db.plan.create({ data: { tenantId: T, key: 'pro-lifetime', name: 'Pro Lifetime', tier: 'pro', amount: 4900, currency: 'USD', interval: 'once', months: 1200, sortOrder: 20 } });
  await db.tenantPaymentConfig.create({ data: { tenantId: T, provider: 'stripe', enabled: true, secretsSealed: sealJson({ secretKey: 'sk_test_abc', webhookSecret: 'whsec_x' }) } });
  Object.assign(fakeStripe.prices, {
    pro_monthly: price('price_pm', 'pro_monthly', 500, 'month'),
    enterprise_monthly: price('price_em', 'enterprise_monthly', 2900, 'month'),
    pro_lifetime: price('price_pl', 'pro_lifetime', 4900, null)
  });
});
test.after(() => H.stop());

async function newCustomer(email) {
  n += 1;
  const customer = await db.customer.create({ data: { tenantId: T, email, emailKey: email.toLowerCase(), emailVerifiedAt: new Date() } });
  const web = await createSession(db, { tenantId: T, customer, provider: 'email', kind: 'web' });
  return { customer, token: web.token };
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const buy = (token, planKey) => H.call('POST', '/v1/account/checkout', { body: { planKey }, headers: bearer(token) });
const hook = (obj, type = 'checkout.session.completed') => {
  n += 1;
  return H.call('POST', `/v1/webhooks/stripe/${T}`, { body: JSON.stringify({ id: `evt_acct_${n}`, type, data: { object: obj } }), headers: { 'content-type': 'application/json', 'stripe-signature': 'x' } });
};
const lastCreate = () => fakeStripe.created[fakeStripe.created.length - 1];
// A computer: registered, linked to the customer, optionally with a live desktop sign-in.
async function computer(customer, seed, { signedIn = true } = {}) {
  const inst = await H.newInstall(T, seed);
  await db.install.update({ where: { id: inst.installId }, data: { customerId: customer.id, lastSeenAt: new Date() } });
  if (signedIn) await createSession(db, { tenantId: T, customer, provider: 'email', kind: 'desktop', installId: inst.installId });
  return inst;
}
const licenceCheck = (inst) => H.call('POST', '/v1/license', { body: { tenantId: T, ...inst } });

test('monthly plan: a subscription on the account, returning to the web app; nothing on a computer', async () => {
  const { customer, token } = await newCustomer('acct.buyer@example.com');
  const r = await buy(token, 'pro');
  assert.equal(r.status, 200, r.text);
  const p = lastCreate();
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.managed_payments, { enabled: true });
  assert.deepEqual(p.line_items, [{ price: 'price_pm', quantity: 1 }]);
  assert.equal(p.customer_email, 'acct.buyer@example.com');
  assert.equal(p.client_reference_id, undefined);
  assert.equal(p.metadata.customerId, customer.id);
  assert.equal(p.metadata.method, 'account');
  assert.equal(p.metadata.installId, '');
  assert.match(p.success_url, /^https:\/\/app\.softglaze\.com\/upgrade\/done\?session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(p.cancel_url, 'https://app.softglaze.com/upgrade?plan=pro&cancelled=1');
  const pay = await db.payment.findFirst({ where: { providerRef: r.json.ref } });
  assert.equal(pay.method, 'account');
  assert.equal(pay.customerId, customer.id);
  assert.equal(pay.installId, null);
});

test('paid: the account gets the plan, its signed-in computer is paid, /me shows it', async () => {
  const { customer, token } = await newCustomer('acct.paid@example.com');
  const pc = await computer(customer, 'acct-paid-1');
  assert.equal((await licenceCheck(pc)).json.free, true, 'Free before paying');
  const r = await buy(token, 'pro');
  const ev = await hook({ id: r.json.ref, mode: 'subscription', subscription: 'sub_acct_1', payment_status: 'paid', metadata: lastCreate().metadata, customer_details: { email: 'acct.paid@example.com' } });
  assert.equal(ev.status, 200, ev.text);
  const lic = await db.license.findFirst({ where: { providerRef: 'sub_acct_1' } });
  assert.equal(lic.customerId, customer.id);
  assert.equal(lic.installId, null);
  assert.equal(lic.source, 'account');
  assert.equal(lic.tier, 'pro');
  const l = await licenceCheck(pc);
  assert.equal(l.status, 200, l.text);
  assert.equal(l.json.type, 'paid');
  assert.equal(l.json.tier, 'pro');
  const me = await H.call('GET', '/v1/account/me', { headers: bearer(token) });
  assert.equal(me.json.account.tier, 'pro');
  assert.equal(me.json.account.plan, 'pro');
  assert.equal((await buy(token, 'enterprise')).json.error, 'already_subscribed', 'one subscription per account; change it at link.com');
});

test('a computer linked only by a claimed email, or signed out, never gets the account plan', async () => {
  const { customer, token } = await newCustomer('acct.claim@example.com');
  const r = await buy(token, 'pro');
  await hook({ id: r.json.ref, mode: 'subscription', subscription: 'sub_acct_claim', payment_status: 'paid', metadata: lastCreate().metadata });
  const claimed = await computer(customer, 'acct-claim-1', { signedIn: false });
  assert.equal((await licenceCheck(claimed)).json.free, true);
  const signedOut = await computer(customer, 'acct-claim-2');
  await db.authSession.updateMany({ where: { installId: signedOut.installId }, data: { revokedAt: new Date() } });
  assert.equal((await licenceCheck(signedOut)).json.free, true);
  const expired = await computer(customer, 'acct-claim-3');
  await db.authSession.updateMany({ where: { installId: expired.installId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await licenceCheck(expired)).json.free, true);
});

test('Pro covers 3 signed-in computers: the 3 seen most recently', async () => {
  const { customer, token } = await newCustomer('acct.devices@example.com');
  const r = await buy(token, 'pro');
  await hook({ id: r.json.ref, mode: 'subscription', subscription: 'sub_acct_dev', payment_status: 'paid', metadata: lastCreate().metadata });
  const pcs = [];
  for (let i = 0; i < 4; i += 1) pcs.push(await computer(customer, `acct-dev-${i}`));
  // The first one was seen longest ago; the others check in after it.
  await db.install.update({ where: { id: pcs[0].installId }, data: { lastSeenAt: new Date(Date.now() - 86400000) } });
  for (const pc of pcs.slice(1)) assert.equal((await licenceCheck(pc)).json.type, 'paid');
  // A licence check touches lastSeenAt, so ask for pcs[0] with the other three just seen: it is the 4th.
  const oldest = await db.install.findUnique({ where: { id: pcs[0].installId } });
  const { accountLicencesFor } = require('../src/licensing');
  assert.equal((await accountLicencesFor(db, T, oldest, Date.now(), async () => ({ devices: 3 }))).length, 0);
  assert.equal((await accountLicencesFor(db, T, await db.install.findUnique({ where: { id: pcs[3].installId } }), Date.now(), async () => ({ devices: 3 }))).length, 1);
});

test('lifetime on the account: one payment; buying it again is refused', async () => {
  const { customer, token } = await newCustomer('acct.life@example.com');
  const r = await buy(token, 'pro-lifetime');
  assert.equal(r.status, 200, r.text);
  assert.equal(lastCreate().mode, 'payment');
  assert.equal(lastCreate().payment_intent_data.metadata.customerId, customer.id);
  await hook({ id: r.json.ref, mode: 'payment', payment_status: 'paid', metadata: lastCreate().metadata });
  const lic = await db.license.findFirst({ where: { customerId: customer.id, source: 'account' } });
  assert.equal(lic.plan, 'pro-lifetime');
  assert.ok(new Date(lic.currentPeriodEnd).getTime() > Date.now() + 50 * 365 * 86400000);
  const again = await buy(token, 'pro-lifetime');
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'lifetime_active');
  const me = await H.call('GET', '/v1/account/me', { headers: bearer(token) });
  assert.equal(me.json.account.lifetime, true);
});

test('a refunded account subscription ends the plan but never locks the computer', async () => {
  const { customer, token } = await newCustomer('acct.refund@example.com');
  const pc = await computer(customer, 'acct-refund-1');
  const r = await buy(token, 'pro');
  await hook({ id: r.json.ref, mode: 'subscription', subscription: 'sub_acct_ref', payment_status: 'paid', metadata: lastCreate().metadata });
  assert.equal((await licenceCheck(pc)).json.type, 'paid');
  fakeStripe.byPi = { pi_acct_ref: { id: r.json.ref, subscription: 'sub_acct_ref' } };
  const ev = await hook({ id: 'ch_acct_ref', payment_intent: 'pi_acct_ref', refunded: true, amount: 500, amount_refunded: 500 }, 'charge.refunded');
  assert.equal(ev.status, 200, ev.text);
  assert.equal((await db.license.findFirst({ where: { providerRef: 'sub_acct_ref' } })).status, 'canceled');
  const l = await licenceCheck(pc);
  assert.equal(l.json.free, true);
  assert.equal(l.json.lockReason, undefined);
});

test('no session, a phone session, an unknown plan: refused before anything is recorded', async () => {
  const before = await db.payment.count({});
  assert.equal((await H.call('POST', '/v1/account/checkout', { body: { planKey: 'pro' } })).status, 401);
  const { customer, token } = await newCustomer('acct.phone@example.com');
  const phone = await createSession(db, { tenantId: T, customer, provider: 'email', kind: 'mobile' });
  const p = await buy(phone.token, 'pro');
  assert.equal(p.status, 403);
  assert.equal(p.json.error, 'web_only');
  assert.equal((await buy(token, 'nope')).json.error, 'unknown_plan');
  assert.equal((await buy(token, 'free')).status === 400 || (await buy(token, 'free')).status === 409, true);
  assert.equal(await db.payment.count({}), before);
});
