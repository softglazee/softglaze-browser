'use strict';
// Black Friday 2026 (src/plans/sales.js): lifetime plans (interval once, months 1200), sale windows and caps.
// The admin creates the plans with no code change; checkout and the admin's manual payment refuse a plan
// outside its window or once its cap is taken; GET /v1/plans/offers gives the website the real numbers;
// GET /v1/plans/public hides lifetime plans from older apps; MRR leaves lifetime licences out.
const H = require('./helpers/harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan } = require('../src/plans/service');
const { availability, windowState, LIFETIME_MONTHS, HOLD_MS, invalidateOffers } = require('../src/plans/sales');
const { computeMrr } = require('../src/metrics/maths');
const { termDays } = require('../src/util/time');

const T = 'tenant1';
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();

test.before(async () => {
  await H.start();
  await H.seedTenant(T);
});
test.after(() => H.stop());

test('validatePlan: 1200 months only as a one-time lifetime plan; cap and window are checked', () => {
  assert.equal(validatePlan({ key: 'pro-lifetime', name: 'Pro Lifetime', amount: 4900, interval: 'once', months: LIFETIME_MONTHS }).errors, null);
  assert.ok(validatePlan({ key: 'x', name: 'X', amount: 100, interval: 'month', months: 1200 }).errors.months);
  assert.ok(validatePlan({ key: 'x', name: 'X', amount: 100, interval: 'once', months: 121 }).errors.months);
  assert.ok(validatePlan({ key: 'x', name: 'X', amount: 100, interval: 'once', months: 1200, recurring: true }).errors.recurring);
  assert.ok(validatePlan({ saleCap: 0 }, { partial: true }).errors.saleCap);
  assert.ok(validatePlan({ saleCap: 2.5 }, { partial: true }).errors.saleCap);
  assert.equal(validatePlan({ saleCap: null }, { partial: true }).errors, null);
  assert.ok(validatePlan({ saleStartsAt: 'not a date' }, { partial: true }).errors.saleStartsAt);
  assert.ok(validatePlan({ saleStartsAt: '2026-12-02T00:00:00Z', saleEndsAt: '2026-11-24T00:00:00Z' }, { partial: true }).errors.saleEndsAt);
  const ok = validatePlan({ saleCap: 500, saleStartsAt: '2026-11-24T00:00:00Z', saleEndsAt: '2026-12-01T23:59:59Z' }, { partial: true });
  assert.equal(ok.errors, null);
  assert.equal(ok.data.saleCap, 500);
  assert.equal(ok.data.saleEndsAt.toISOString(), '2026-12-01T23:59:59.000Z');
});

test('windowState: upcoming, open, ended; no window = open', () => {
  const p = { saleStartsAt: new Date('2026-11-24T00:00:00Z'), saleEndsAt: new Date('2026-12-01T23:59:59Z') };
  assert.equal(windowState(p, Date.parse('2026-11-23T23:59:59Z')), 'upcoming');
  assert.equal(windowState(p, Date.parse('2026-11-24T00:00:00Z')), 'open');
  assert.equal(windowState(p, Date.parse('2026-12-01T23:59:59Z')), 'open');
  assert.equal(windowState(p, Date.parse('2026-12-02T00:00:00Z')), 'ended');
  assert.equal(windowState({}, Date.now()), 'open');
});

test('the admin creates both lifetime plans with no code change, and sees their sales', async () => {
  const now = Date.now();
  const pro = await H.admin('POST', '/plans', { body: {
    key: 'pro-lifetime', name: 'Pro Lifetime', tier: 'pro', amount: 4900, currency: 'USD', interval: 'once', months: 1200,
    recurring: false, active: true, sortOrder: 20, saleCap: 500, saleStartsAt: iso(now - DAY), saleEndsAt: iso(now + 7 * DAY),
    note: 'Black Friday 2026'
  } });
  assert.equal(pro.status, 201, pro.text);
  assert.equal(pro.json.plan.saleCap, 500);
  const ent = await H.admin('POST', '/plans', { body: {
    key: 'enterprise-lifetime', name: 'Enterprise Lifetime', tier: 'enterprise', amount: 24900, interval: 'once', months: 1200,
    active: true, sortOrder: 21, saleCap: 100, saleStartsAt: iso(now - DAY), saleEndsAt: iso(now + 7 * DAY)
  } });
  assert.equal(ent.status, 201, ent.text);
  const list = await H.admin('GET', '/plans');
  const row = list.json.items.find((p) => p.key === 'pro-lifetime');
  assert.equal(row.lifetime, true);
  assert.deepEqual({ cap: row.sales.cap, sold: row.sales.sold, remaining: row.sales.remaining, state: row.sales.state }, { cap: 500, sold: 0, remaining: 500, state: 'open' });
  assert.equal(list.json.items.find((p) => p.key === 'pro').sales, null, 'a plain plan has no sales block');
  const one = await H.admin('GET', '/plans/enterprise-lifetime');
  assert.equal(one.json.plan.sales.cap, 100);
});

test('GET /v1/plans/public hides lifetime plans unless include=lifetime', async () => {
  const plain = await H.call('GET', `/v1/plans/public?tenantId=${T}`);
  assert.equal(plain.status, 200);
  assert.ok(!plain.json.some((p) => p.key.endsWith('-lifetime')), 'older apps never see a "1200 months" card');
  // The public list is cached 60 s per tenant; the lifetime plans were created after any earlier read.
  const withLifetime = await H.call('GET', `/v1/plans/public?tenantId=${T}&include=lifetime`);
  const lp = withLifetime.json.find((p) => p.key === 'pro-lifetime');
  assert.ok(lp, 'include=lifetime lists it');
  assert.equal(lp.lifetime, true);
  assert.equal(lp.amount, 4900);
});

test('GET /v1/plans/offers: cap, sold, remaining and state, CORS open', async () => {
  invalidateOffers(T);
  const r = await H.call('GET', `/v1/plans/offers?tenantId=${T}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const pro = r.json.offers.find((o) => o.key === 'pro-lifetime');
  assert.deepEqual(
    { amountDecimal: pro.amountDecimal, lifetime: pro.lifetime, cap: pro.cap, sold: pro.sold, remaining: pro.remaining, state: pro.state },
    { amountDecimal: '49.00', lifetime: true, cap: 500, sold: 0, remaining: 500, state: 'open' }
  );
  assert.ok(!r.json.offers.some((o) => o.key === 'pro'), 'plain monthly plans are not offers');
  assert.equal((await H.call('GET', '/v1/plans/offers')).status, 400);
  assert.equal((await H.call('GET', '/v1/plans/offers?tenantId=nope')).status, 404);
});

test('paid payments take places, pending checkouts hold one for 30 minutes, refunds free theirs', async () => {
  const plan = await H.db.plan.findUnique({ where: { tenantId_key: { tenantId: T, key: 'enterprise-lifetime' } } });
  const now = Date.now();
  await H.db.payment.create({ data: { tenantId: T, provider: 'safepay', providerRef: 'trk-paid', amount: 24900, status: 'paid', plan: plan.key, paidAt: new Date(now) } });
  await H.db.payment.create({ data: { tenantId: T, provider: 'safepay', providerRef: 'trk-hold', amount: 24900, status: 'pending', plan: plan.key, createdAt: new Date(now - 60000) } });
  await H.db.payment.create({ data: { tenantId: T, provider: 'safepay', providerRef: 'trk-old', amount: 24900, status: 'pending', plan: plan.key, createdAt: new Date(now - HOLD_MS - 60000) } });
  await H.db.payment.create({ data: { tenantId: T, provider: 'manual', providerRef: 'INV-R', amount: 24900, status: 'refunded', plan: plan.key } });
  const a = await availability(H.db, T, plan, now);
  assert.deepEqual({ sold: a.sold, held: a.held, refunded: a.refunded, remaining: a.remaining }, { sold: 1, held: 1, refunded: 1, remaining: 98 });
});

test('checkout refuses a sold-out, not yet open or ended offer with 409 before anything is created', async () => {
  const now = Date.now();
  await H.admin('POST', '/plans', { body: { key: 'tiny-lifetime', name: 'Tiny', tier: 'pro', amount: 4900, interval: 'once', months: 1200, saleCap: 1 } });
  await H.db.payment.create({ data: { tenantId: T, provider: 'manual', providerRef: 'INV-T1', amount: 4900, status: 'paid', plan: 'tiny-lifetime' } });
  const before = await H.db.payment.count({ where: { tenantId: T } });
  const sold = await H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'tiny-lifetime', provider: 'safepay', account: 'buyer@example.com' } });
  assert.equal(sold.status, 409);
  assert.equal(sold.json.error, 'sold_out');
  assert.equal(sold.json.remaining, 0);

  await H.admin('PATCH', '/plans/tiny-lifetime', { body: { saleCap: null, saleStartsAt: iso(now + DAY) } });
  const early = await H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'tiny-lifetime', provider: 'safepay', account: 'buyer@example.com' } });
  assert.equal(early.status, 409);
  assert.equal(early.json.error, 'sale_not_open');

  await H.admin('PATCH', '/plans/tiny-lifetime', { body: { saleStartsAt: iso(now - 2 * DAY), saleEndsAt: iso(now - DAY) } });
  const late = await H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'tiny-lifetime', provider: 'safepay', account: 'buyer@example.com' } });
  assert.equal(late.status, 409);
  assert.equal(late.json.error, 'sale_ended');
  assert.equal(await H.db.payment.count({ where: { tenantId: T } }), before, 'no pending payment was created');

  // Inside the window with places left, the sale check passes (this test tenant has no Safepay keys).
  const open = await H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'pro-lifetime', provider: 'safepay', account: 'buyer@example.com' } });
  assert.equal(open.status, 400);
  assert.match(open.json.error, /not enabled/);
});

test('admin manual payment: refused when sold out unless allowOutsideOffer; a 1200-month grant runs to about 2126', async () => {
  const customer = await H.db.customer.create({ data: { tenantId: T, email: 'agency@example.com', emailKey: 'agency@example.com', source: 'invoice' } });
  await H.admin('PATCH', '/plans/tiny-lifetime', { body: { saleStartsAt: null, saleEndsAt: null, saleCap: 1 } });
  const refused = await H.admin('POST', '/payments', { body: { customerId: customer.id, amount: 4900, currency: 'USD', method: 'invoice', reference: 'SG-BF-0001', plan: 'tiny-lifetime' } });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, 'sold_out');
  assert.equal(refused.json.availability.remaining, 0);

  const forced = await H.admin('POST', '/payments', { body: { customerId: customer.id, amount: 4900, currency: 'USD', method: 'invoice', reference: 'SG-BF-0001', plan: 'tiny-lifetime', allowOutsideOffer: true } });
  assert.equal(forced.status, 201, forced.text);
  const auditRow = (await H.db.adminAudit.findMany({ where: { tenantId: T, action: 'payment.record' } })).pop();
  assert.ok(JSON.stringify(auditRow.detail).includes('allowOutsideOffer'));

  const t0 = Date.now();
  const granted = await H.admin('POST', '/payments', { body: { customerId: customer.id, amount: 24900, currency: 'USD', method: 'bank_transfer', reference: 'SG-BF-0002', plan: 'enterprise-lifetime', grant: true } });
  assert.equal(granted.status, 201, granted.text);
  assert.equal(granted.json.license.tier, 'enterprise');
  const end = new Date(granted.json.license.currentPeriodEnd).getTime();
  assert.ok(Math.abs(end - (t0 + termDays(1200) * DAY)) < 60000);
  assert.equal(new Date(end).getUTCFullYear() >= 2126, true);
  const explicit = await H.admin('POST', '/payments', { body: { customerId: customer.id, amount: 4900, currency: 'USD', method: 'payoneer', reference: 'SG-BF-0003', plan: 'pro-lifetime', grant: { months: 1200 } } });
  assert.equal(explicit.status, 201, explicit.text);
  const bad = await H.admin('POST', '/payments', { body: { customerId: customer.id, amount: 4900, currency: 'USD', method: 'payoneer', reference: 'SG-BF-0004', grant: { months: 600 } } });
  assert.equal(bad.status, 400);
});

test('MRR leaves lifetime licences out (by plan, or by a term past 50 years) and counts them', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const plans = [
    { key: 'pro', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, active: true },
    { key: 'pro-lifetime', tier: 'pro', amount: 4900, currency: 'USD', interval: 'once', months: 1200, active: true }
  ];
  const far = new Date(now.getTime() + termDays(1200) * DAY);
  const soon = new Date(now.getTime() + 20 * DAY);
  const r = computeMrr([
    { id: 'a', customerId: 'c1', status: 'active', plan: 'pro', currentPeriodEnd: soon },
    { id: 'b', customerId: 'c2', status: 'active', plan: 'pro-lifetime', currentPeriodEnd: far },
    { id: 'c', customerId: 'c3', status: 'active', plan: null, tier: 'pro', currentPeriodEnd: far } // a redeemed lifetime code
  ], plans, now);
  assert.equal(r.byCurrency[0].mrrCents, 500);
  assert.equal(r.payingLicences, 3);
  assert.equal(r.payingCustomers, 3);
  assert.equal(r.lifetimeLicences, 2);
});
