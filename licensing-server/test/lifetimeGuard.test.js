'use strict';
// Lifetime guard (src/plans/lifetimeGuard.js): a lifetime licence is never changed by a subscription,
// a fixed-term checkout or a code. Before it, Pro Lifetime + one Enterprise month became Enterprise
// until ~2126, and Enterprise Lifetime + "Downgrade to Pro" or a 1-month Pro code became Pro for life.
// Checkout and redeem refuse with 409 lifetime_active before anything is charged or claimed; a paid
// webhook that arrives anyway leaves the licence alone and flags the payment for a manual refund.
const H = require('./helpers/harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sealJson } = require('../src/crypto/secrets');
const stripeProvider = require('../src/providers/stripe');
const { provisionFromPaymentRef, setSubscriptionPeriod, revokeForRefund, grantMonths } = require('../src/licensing');
const { isLifetimeLicence, LIFETIME_AFTER_MS } = require('../src/plans/lifetimeGuard');
const { termDays } = require('../src/util/time');

const T = 'tenant1';
const DAY = 86400000;
const LIFE_END = () => new Date(Date.now() + termDays(1200) * DAY);
const tenant = { id: T };

// No network: Stripe checkout and signature checks are stubbed.
let refN = 0;
stripeProvider.createCheckout = async () => { refN += 1; return { url: `https://pay.test/${refN}`, ref: `cs_test_${refN}` }; };
stripeProvider.verifyEvent = ({ rawBody }) => JSON.parse(Buffer.from(rawBody).toString('utf8'));

test.before(async () => {
  await H.start();
  await H.seedTenant(T);
  await H.db.plan.create({ data: { tenantId: T, key: 'pro-lifetime', name: 'Pro Lifetime', tier: 'pro', amount: 4900, currency: 'USD', interval: 'once', months: 1200, sortOrder: 20 } });
  await H.db.plan.create({ data: { tenantId: T, key: 'enterprise-lifetime', name: 'Enterprise Lifetime', tier: 'enterprise', amount: 24900, currency: 'USD', interval: 'once', months: 1200, sortOrder: 21 } });
  await H.db.tenantPaymentConfig.create({ data: { tenantId: T, provider: 'stripe', enabled: true, secretsSealed: sealJson({ secretKey: 'sk_test', webhookSecret: 'whsec' }) } });
});
test.after(() => H.stop());

let seed = 0;
// A fresh install holding one licence: kind 'pro-lifetime' | 'enterprise-lifetime' | 'code-lifetime'
// (a redeemed lifetime code: no plan key, end ~2126) | 'pro' (monthly, 10 days left) | null.
async function installWith(kind) {
  seed += 1;
  const inst = await H.newInstall(T, `life-${seed}`);
  let lic = null;
  if (kind) {
    const monthly = kind === 'pro';
    lic = await H.db.license.create({ data: {
      tenantId: T, installId: inst.installId, status: 'active',
      tier: kind.startsWith('enterprise') ? 'enterprise' : 'pro',
      plan: kind === 'code-lifetime' ? null : kind,
      currentPeriodEnd: monthly ? new Date(Date.now() + 10 * DAY) : LIFE_END()
    } });
  }
  return { ...inst, lic };
}
const licOf = (installId) => H.db.license.findMany({ where: { tenantId: T, installId } });
const checkout = (installId, planKey) => H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey, installId, provider: 'stripe' } });
const paymentsFor = (installId) => H.db.payment.findMany({ where: { tenantId: T, installId } });
const redeem = (inst, code) => H.call('POST', '/v1/redeem', { body: { tenantId: T, code, installId: inst.installId, installSecret: inst.installSecret } });
let codeN = 0;
async function code(tier, months) {
  codeN += 1;
  const c = `LIFEGUARD-${codeN}`;
  await H.db.licenseCode.create({ data: { tenantId: T, code: c, tier, months } });
  return c;
}
function same(before, after) {
  assert.equal(after.tier, before.tier);
  assert.equal(after.plan, before.plan);
  assert.equal(after.status, 'active');
  assert.equal(new Date(after.currentPeriodEnd).getTime(), new Date(before.currentPeriodEnd).getTime());
}

test('isLifetimeLicence: lifetime plan or a term past 50 years, active only', () => {
  const now = Date.now();
  const life = { key: 'pro-lifetime', interval: 'once', months: 1200 };
  assert.equal(isLifetimeLicence({ status: 'active', currentPeriodEnd: LIFE_END() }, null, now), true);
  assert.equal(isLifetimeLicence({ status: 'active', currentPeriodEnd: new Date(now + 30 * DAY) }, life, now), true);
  assert.equal(isLifetimeLicence({ status: 'active', currentPeriodEnd: new Date(now + 365 * DAY) }, { interval: 'year', months: 12 }, now), false);
  assert.equal(isLifetimeLicence({ status: 'active', currentPeriodEnd: new Date(now + LIFETIME_AFTER_MS - DAY) }, null, now), false);
  assert.equal(isLifetimeLicence({ status: 'canceled', currentPeriodEnd: LIFE_END() }, life, now), false);
});

test('checkout: Pro Lifetime + Enterprise monthly is refused with 409 lifetime_active, nothing created', async () => {
  const inst = await installWith('pro-lifetime');
  const r = await checkout(inst.installId, 'enterprise');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'lifetime_active');
  assert.equal(r.json.tier, 'pro');
  assert.equal((await paymentsFor(inst.installId)).length, 0, 'no pending payment');
  same(inst.lic, (await licOf(inst.installId))[0]);
});

test('checkout: Enterprise Lifetime + "Downgrade to Pro" (monthly) is refused', async () => {
  const inst = await installWith('enterprise-lifetime');
  const r = await checkout(inst.installId, 'pro');
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'lifetime_active');
  assert.equal((await paymentsFor(inst.installId)).length, 0);
});

test('checkout: same or lower lifetime is refused; a redeemed lifetime code (no plan key) counts as lifetime', async () => {
  const pro = await installWith('pro-lifetime');
  assert.equal((await checkout(pro.installId, 'pro-lifetime')).json.error, 'lifetime_active');
  const ent = await installWith('enterprise-lifetime');
  assert.equal((await checkout(ent.installId, 'pro-lifetime')).json.error, 'lifetime_active');
  const coded = await installWith('code-lifetime');
  const r = await checkout(coded.installId, 'pro');
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'lifetime_active');
});

test('checkout: Pro Lifetime -> Enterprise Lifetime upgrade is allowed', async () => {
  const inst = await installWith('pro-lifetime');
  const r = await checkout(inst.installId, 'enterprise-lifetime');
  assert.equal(r.status, 200, r.text);
  assert.equal((await paymentsFor(inst.installId)).length, 1);
});

test('checkout: non-lifetime licences and new installs are unchanged', async () => {
  const monthly = await installWith('pro');
  const up = await checkout(monthly.installId, 'enterprise');
  assert.equal(up.status, 200, up.text);
  const toLife = await checkout(monthly.installId, 'pro-lifetime');
  assert.equal(toLife.status, 200, toLife.text);
  const fresh = await installWith(null);
  assert.equal((await checkout(fresh.installId, 'pro')).status, 200);
});

test('webhook after the fact: Enterprise month paid on Pro Lifetime -> licence unchanged, payment paid + flagged, refund takes nothing', async () => {
  const inst = await installWith('pro-lifetime');
  await H.db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_late_1', amount: 2900, status: 'pending', plan: 'enterprise', installId: inst.installId } });
  const r = await provisionFromPaymentRef(tenant, 'stripe', 'cs_late_1', {}, H.db);
  assert.deepEqual(r, { provisioned: false, lifetimeGuard: true });
  const lics = await licOf(inst.installId);
  assert.equal(lics.length, 1);
  same(inst.lic, lics[0]);
  const pay = (await paymentsFor(inst.installId))[0];
  assert.equal(pay.status, 'paid', 'the money was taken: the payment is recorded');
  assert.match(pay.note, /\[lifetime-guard\] NEEDS MANUAL REFUND/);

  const listed = await H.admin('GET', '/payments?flag=lifetime_guard');
  assert.equal(listed.status, 200, listed.text);
  assert.ok(listed.json.items.some((p) => p.id === pay.id), 'the admin finds it with ?flag=lifetime_guard');

  const refund = await revokeForRefund(tenant, { provider: 'stripe', sessionRef: 'cs_late_1' }, H.db);
  assert.equal(refund.changed, true);
  same(inst.lic, (await licOf(inst.installId))[0]);
});

test('webhook after the fact: Pro month paid on Enterprise Lifetime (downgrade) leaves Enterprise Lifetime', async () => {
  const inst = await installWith('enterprise-lifetime');
  await H.db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_late_2', amount: 500, status: 'pending', plan: 'pro', installId: inst.installId } });
  await provisionFromPaymentRef(tenant, 'stripe', 'cs_late_2', {}, H.db);
  same(inst.lic, (await licOf(inst.installId))[0]);
  assert.match((await paymentsFor(inst.installId))[0].note, /lifetime-guard/);
});

test('webhook after the fact: a Stripe subscription on a lifetime install is not applied and is flagged', async () => {
  const inst = await installWith('enterprise-lifetime');
  await H.db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_sub_1', amount: 500, status: 'pending', plan: 'pro', installId: inst.installId } });
  const event = { id: 'evt_life_sub', type: 'checkout.session.completed', data: { object: { id: 'cs_sub_1', mode: 'subscription', subscription: 'sub_life_1', payment_status: 'paid', metadata: {} } } };
  const r = await H.call('POST', `/v1/webhooks/stripe/${T}`, { body: JSON.stringify(event), headers: { 'content-type': 'application/json', 'stripe-signature': 'x' } });
  assert.equal(r.status, 200, r.text);
  const lics = await licOf(inst.installId);
  assert.equal(lics.length, 1);
  same(inst.lic, lics[0]);
  assert.notEqual(lics[0].providerRef, 'sub_life_1');
  const pay = (await paymentsFor(inst.installId))[0];
  assert.equal(pay.status, 'paid');
  assert.match(pay.note, /NEEDS MANUAL REFUND: subscription sub_life_1/);
  // setSubscriptionPeriod directly (a Safepay first charge takes the same path).
  const out = await setSubscriptionPeriod(tenant, { subscriptionId: 'sub_life_2', installId: inst.installId, tier: 'pro', plan: 'pro', periodEnd: new Date(Date.now() + 30 * DAY) }, H.db);
  assert.equal(out.lifetimeGuard, true);
  same(inst.lic, (await licOf(inst.installId))[0]);
});

test('webhook: Pro Lifetime -> Enterprise Lifetime upgrades in place, end not stacked to 2226', async () => {
  const inst = await installWith('pro-lifetime');
  await H.db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_up_1', amount: 24900, status: 'pending', plan: 'enterprise-lifetime', installId: inst.installId } });
  const r = await provisionFromPaymentRef(tenant, 'stripe', 'cs_up_1', {}, H.db);
  assert.equal(r.provisioned, true);
  const lics = await licOf(inst.installId);
  assert.equal(lics.length, 1);
  assert.equal(lics[0].tier, 'enterprise');
  assert.equal(lics[0].plan, 'enterprise-lifetime');
  assert.ok(new Date(lics[0].currentPeriodEnd).getTime() < LIFE_END().getTime() + DAY, 'not 200 years');
  // And back down is refused.
  const down = await grantMonths(tenant, { installId: inst.installId, tier: 'pro', plan: 'pro-lifetime', months: 1200, lifetime: true }, H.db);
  assert.equal(down.lifetimeGuard, true);
});

test('webhook: non-lifetime licences keep the old behaviour (stack the term, take the new tier)', async () => {
  const inst = await installWith('pro');
  await H.db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_norm_1', amount: 2900, status: 'pending', plan: 'enterprise', installId: inst.installId } });
  const r = await provisionFromPaymentRef(tenant, 'stripe', 'cs_norm_1', {}, H.db);
  assert.equal(r.provisioned, true);
  const lic = (await licOf(inst.installId))[0];
  assert.equal(lic.tier, 'enterprise');
  const days = Math.round((new Date(lic.currentPeriodEnd).getTime() - Date.now()) / DAY);
  assert.ok(days >= 39 && days <= 41, `10 days left + one month, got ${days}`);
  assert.ok(!(await paymentsFor(inst.installId))[0].note);
});

test('redeem: a 1-month code on a lifetime licence is refused with 409 and the code stays unused', async () => {
  const ent = await installWith('enterprise-lifetime');
  const proCode = await code('pro', 1);
  const r = await redeem(ent, proCode);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'lifetime_active');
  same(ent.lic, (await licOf(ent.installId))[0]);
  const rec = await H.db.licenseCode.findUnique({ where: { tenantId_code: { tenantId: T, code: proCode } } });
  assert.equal(rec.redeemedAt, null, 'still usable on another install');

  const pro = await installWith('pro-lifetime');
  const entMonth = await code('enterprise', 1);
  assert.equal((await redeem(pro, entMonth)).json.error, 'lifetime_active');
  same(pro.lic, (await licOf(pro.installId))[0]);
  assert.equal((await redeem(pro, await code('pro', 1200))).json.error, 'lifetime_active', 'same-tier lifetime code too');

  const other = await installWith('pro');
  assert.equal((await redeem(other, proCode)).status, 200, 'the refused code works elsewhere');
});

test('redeem: a lifetime Enterprise code upgrades Pro Lifetime in place', async () => {
  const pro = await installWith('pro-lifetime');
  const r = await redeem(pro, await code('enterprise', 1200));
  assert.equal(r.status, 200, r.text);
  const lics = await licOf(pro.installId);
  assert.equal(lics.length, 1);
  assert.equal(lics[0].tier, 'enterprise');
  assert.ok(new Date(lics[0].currentPeriodEnd).getTime() < LIFE_END().getTime() + DAY);
});

test('redeem: non-lifetime licences are unchanged (code tier, term stacked)', async () => {
  const inst = await installWith('pro');
  const r = await redeem(inst, await code('enterprise', 1));
  assert.equal(r.status, 200, r.text);
  const lic = (await licOf(inst.installId))[0];
  assert.equal(lic.tier, 'enterprise');
  const days = Math.round((new Date(lic.currentPeriodEnd).getTime() - Date.now()) / DAY);
  assert.ok(days >= 39 && days <= 41, `got ${days}`);
  const fresh = await installWith(null);
  assert.equal((await redeem(fresh, await code('pro', 1200))).status, 200, 'a lifetime code on a new install still works');
});
