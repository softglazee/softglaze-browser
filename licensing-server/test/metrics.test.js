'use strict';
// Metrics maths and customer status rules, with hand-computed expectations (definitions in
// src/metrics/maths.js and docs/ADMIN-API.md).
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test@127.0.0.1/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/metrics/maths');
const { computeCustomerState, effectiveStatus } = require('../src/customers/state');
const { memoryPrisma } = require('./helpers/memoryPrisma');
const { applyState } = require('../src/customers/sync');

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 15, 12); // 15 Nov 2026
const d = (s) => new Date(`${s}T12:00:00Z`);
const future = new Date(NOW + 20 * DAY);
const past = new Date(NOW - 20 * DAY);

const PLANS = [
  { key: 'pro', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, active: true, sortOrder: 1 },
  { key: 'enterprise', tier: 'enterprise', amount: 2900, currency: 'USD', interval: 'month', months: 1, active: true, sortOrder: 2 },
  { key: 'pro-year', tier: 'pro', amount: 5000, currency: 'USD', interval: 'year', months: 12, active: true, sortOrder: 3 },
  { key: 'pro-eu', tier: 'pro', amount: 450, currency: 'EUR', interval: 'month', months: 1, active: false, sortOrder: 4 }
];

test('MRR: monthly equivalent of active paid licences, per currency; comps, expired and cancelled excluded', () => {
  const lic = (id, extra) => ({ id, status: 'active', currentPeriodEnd: future, complimentary: false, ...extra });
  const L = [
    lic('l1', { plan: 'pro', tier: 'pro', customerId: 'c1' }), // 500
    lic('l7', { plan: 'gone', tier: 'pro', customerId: 'c1' }), // unknown key -> cheapest-term pro plan: 500
    lic('l2', { plan: null, tier: 'enterprise', customerId: 'c2' }), // by tier: 2900
    lic('l3', { plan: 'pro-year', tier: 'pro', customerId: 'c3' }), // 5000 / 12 = 416.67
    lic('l8', { plan: 'pro-eu', tier: 'pro', customerId: 'c8' }), // EUR 450 (plan inactive now: still priced by key)
    lic('l4', { plan: 'enterprise', tier: 'enterprise', customerId: 'c4', complimentary: true }),
    lic('l5', { plan: 'pro', tier: 'pro', customerId: 'c5', currentPeriodEnd: past }),
    lic('l6', { plan: 'pro', tier: 'pro', customerId: 'c6', status: 'canceled' })
  ];
  const r = M.computeMrr(L, PLANS, NOW);
  assert.deepEqual(r.byCurrency, [
    { currency: 'EUR', mrrCents: 450, arrCents: 5400 },
    { currency: 'USD', mrrCents: 4317, arrCents: 51804 } // 500 + 500 + 2900 + 416.67 = 4316.67 -> 4317
  ]);
  assert.equal(r.payingCustomers, 4);
  assert.equal(r.payingLicences, 5);
  assert.equal(r.unpricedLicences, 0);
  const noEnterprise = M.computeMrr([lic('x', { plan: null, tier: 'enterprise', customerId: 'z' })], PLANS.filter((p) => p.tier !== 'enterprise'), NOW);
  assert.equal(noEnterprise.unpricedLicences, 1);
  assert.deepEqual(noEnterprise.byCurrency, []);
  assert.equal(M.termMonths({ interval: 'year', months: 1 }), 12);
  assert.equal(M.termMonths({ interval: 'month', months: 3 }), 3);
});

const ev = (customerId, at, from, to) => ({ customerId, type: 'status', at: d(at), data: { from, to } });
const EVENTS = [
  ev('A', '2026-01-01', null, 'lead'), ev('A', '2026-01-10', 'lead', 'paid'), ev('A', '2026-03-05', 'paid', 'churned'), ev('A', '2026-04-02', 'churned', 'paid'),
  ev('B', '2026-01-02', null, 'lead'), ev('B', '2026-02-01', 'lead', 'paid'),
  ev('C', '2026-01-20', null, 'paid'), ev('C', '2026-02-15', 'paid', 'cancelled'),
  ev('D', '2026-01-05', null, 'trial'), ev('D', '2026-01-12', 'trial', 'trial_expired')
];

test('churn per month: paid -> churned / cancelled dated in the month, over paying at the start', () => {
  const rows = M.churnByMonth(EVENTS, ['2026-01', '2026-02', '2026-03', '2026-04']);
  const pick = (r) => [r.payingStart, r.newPaying, r.reactivated, r.churned, r.cancelled, r.payingEnd, r.churnRate];
  assert.deepEqual(rows.map(pick), [
    [0, 2, 0, 0, 0, 2, null], // Jan: A and C start paying
    [2, 1, 0, 0, 1, 2, 0.5], // Feb: B starts, C cancels
    [2, 0, 0, 1, 0, 1, 0.5], // Mar: A churns
    [1, 0, 1, 0, 0, 2, 0] // Apr: A comes back
  ]);
  for (const r of rows) assert.equal(r.payingEnd, r.payingStart + r.newPaying + r.reactivated - r.churned - r.cancelled, `identity ${r.month}`);
  assert.equal(M.payingDuring(EVENTS, '2026-03'), 2, 'A paid part of March, B all of it');
});

test('revenue per month: gross by paid date, refunds by refund date, net, per currency', () => {
  const P = [
    { amount: 500, currency: 'USD', status: 'paid', paidAt: d('2026-01-15') },
    { amount: 2900, currency: 'USD', status: 'refunded', paidAt: d('2026-02-02'), refundedAt: d('2026-03-03') },
    { amount: 500, currency: 'USD', status: 'paid', paidAt: null, createdAt: d('2026-03-20') },
    { amount: 1000, currency: 'EUR', status: 'paid', paidAt: d('2026-03-01') },
    { amount: 999, currency: 'USD', status: 'pending', createdAt: d('2026-03-01') },
    { amount: 999, currency: 'USD', status: 'failed', createdAt: d('2026-03-01') }
  ];
  const rows = M.revenueByMonth(P, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(rows.map((r) => [r.month, r.currency, r.grossCents, r.refundsCents, r.netCents, r.payments]), [
    ['2026-01', 'USD', 500, 0, 500, 1],
    ['2026-02', 'USD', 2900, 0, 2900, 1],
    ['2026-03', 'EUR', 1000, 0, 1000, 1],
    ['2026-03', 'USD', 500, 2900, -2400, 1]
  ]);
});

test('trial -> paid conversion by start-month cohort', () => {
  const T = [
    { startedAt: d('2026-01-03'), convertedAt: d('2026-01-20') },
    { startedAt: d('2026-01-09'), convertedAt: null },
    { startedAt: d('2026-02-01'), convertedAt: d('2026-04-01') }
  ];
  assert.deepEqual(M.conversionByCohort(T, ['2026-01', '2026-02', '2026-03']), [
    { cohort: '2026-01', trials: 2, converted: 1, conversionRate: 0.5 },
    { cohort: '2026-02', trials: 1, converted: 1, conversionRate: 1 },
    { cohort: '2026-03', trials: 0, converted: 0, conversionRate: null }
  ]);
});

test('new trials per day and per ISO week; top countries', () => {
  const T = [{ startedAt: d('2026-11-09') }, { startedAt: d('2026-11-09') }, { startedAt: d('2026-11-10') }, { startedAt: d('2026-11-16') }];
  const perDay = M.trialsPerDay(T, Date.UTC(2026, 10, 8), Date.UTC(2026, 10, 16, 23));
  assert.equal(perDay.length, 9);
  assert.deepEqual(perDay.filter((x) => x.trials), [{ date: '2026-11-09', trials: 2 }, { date: '2026-11-10', trials: 1 }, { date: '2026-11-16', trials: 1 }]);
  assert.deepEqual(M.trialsPerWeek(perDay), [{ weekStart: '2026-11-02', trials: 0 }, { weekStart: '2026-11-09', trials: 3 }, { weekStart: '2026-11-16', trials: 1 }]);
  const C = [{ country: 'PK', statusAuto: 'paid' }, { country: 'PK', statusAuto: 'lead' }, { country: 'US', statusAuto: 'paid' }, { country: null, statusAuto: 'lead' }, { country: 'US', statusAuto: 'lead', deletedAt: new Date() }];
  assert.deepEqual(M.topCountries(C), [
    { country: 'PK', customers: 2, paying: 1 }, { country: 'US', customers: 1, paying: 1 }, { country: 'unknown', customers: 1, paying: 0 }
  ]);
});

test('customer status rules, including the renewal grace and complimentary licences', () => {
  const s = (rel, graceDays = 3) => computeCustomerState({ ...rel, now: NOW, graceDays });
  assert.equal(s({}).statusAuto, 'lead');
  const trial = { startedAt: new Date(NOW - 2 * DAY), endsAt: new Date(NOW + 5 * DAY), tier: 'enterprise' };
  assert.deepEqual([s({ trials: [trial] }).statusAuto, s({ trials: [trial] }).tier], ['trial', 'enterprise']);
  assert.equal(s({ trials: [{ ...trial, endsAt: new Date(NOW - DAY) }] }).statusAuto, 'trial_expired');

  const paid = { status: 'active', tier: 'pro', complimentary: false, createdAt: new Date(NOW - 40 * DAY), currentPeriodEnd: new Date(NOW + 10 * DAY) };
  const st = s({ licences: [paid], trials: [trial] });
  assert.equal(st.statusAuto, 'paid');
  assert.equal(st.tier, 'pro');
  assert.equal(st.paidUntil.getTime(), paid.currentPeriodEnd.getTime());
  assert.equal(st.paidSince.getTime(), paid.createdAt.getTime());

  const lapsed2 = { ...paid, currentPeriodEnd: new Date(NOW - 2 * DAY) };
  assert.equal(s({ licences: [lapsed2] }).statusAuto, 'paid', 'inside the 3 grace days');
  const lapsed4 = { ...paid, currentPeriodEnd: new Date(NOW - 4 * DAY) };
  const churned = s({ licences: [lapsed4] });
  assert.equal(churned.statusAuto, 'churned');
  assert.equal(churned.statusChangedAt.getTime(), lapsed4.currentPeriodEnd.getTime(), 'churn is dated at paid-until');
  assert.equal(s({ licences: [{ ...paid, status: 'canceled', currentPeriodEnd: new Date(NOW - DAY), revokedAt: new Date(NOW - DAY) }] }).statusAuto, 'cancelled');

  const comp = { ...paid, tier: 'enterprise', complimentary: true };
  const cs = s({ licences: [comp] });
  assert.equal(cs.statusAuto, 'lead', 'a free licence is not a paying customer');
  assert.equal(cs.tier, 'enterprise');
  assert.ok(cs.complimentaryUntil);

  const pays = [
    { amount: 500, currency: 'USD', status: 'paid', paidAt: new Date(NOW - 30 * DAY) },
    { amount: 2900, currency: 'USD', status: 'paid', paidAt: new Date(NOW - 5 * DAY) },
    { amount: 2900, currency: 'USD', status: 'refunded', paidAt: new Date(NOW - 4 * DAY) },
    { amount: 9999, currency: 'PKR', status: 'paid', paidAt: new Date(NOW - 3 * DAY) }
  ];
  const t = s({ payments: pays });
  assert.deepEqual([t.totalPaidCents, t.currency], [3400, 'USD']);
  assert.equal(effectiveStatus({ statusAuto: 'lead', statusOverride: 'paid' }), 'paid');
  assert.equal(effectiveStatus({ statusAuto: 'lead', statusOverride: null }), 'lead');
});

test('status events: first paid is dated when paying began, churn at paid-until; trials get convertedAt', async () => {
  const db = memoryPrisma();
  const c = await db.customer.create({ data: { tenantId: 't', email: 'x@example.com', emailKey: 'x@example.com', createdAt: new Date(NOW - 60 * DAY) } });
  const trial = await db.trial.create({ data: { tenantId: 't', customerId: c.id, machineHash: 'm', emailKeyHash: 'e', startedAt: new Date(NOW - 50 * DAY), endsAt: new Date(NOW - 43 * DAY) } });
  const lic = await db.license.create({ data: { tenantId: 't', customerId: c.id, tier: 'pro', status: 'active', currentPeriodEnd: new Date(NOW + 5 * DAY), createdAt: new Date(NOW - 40 * DAY) } });
  const rel = async () => ({ licences: await db.license.findMany({ where: { customerId: c.id } }), payments: [], trials: await db.trial.findMany({ where: { customerId: c.id } }), installs: [] });

  let cur = await applyState(db, await db.customer.findUnique({ where: { id: c.id } }), await rel(), { now: NOW });
  assert.equal(cur.statusAuto, 'paid');
  let events = db.tables.customerEvent;
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { from: 'lead', to: 'paid' });
  assert.equal(events[0].at.getTime(), NOW - 40 * DAY, 'dated when the licence began, not when the cron noticed');
  assert.equal(db.tables.trial[0].convertedAt.getTime(), NOW - 40 * DAY);

  const later = NOW + 10 * DAY; // 5 days after the end: past the 3-day grace
  cur = await applyState(db, await db.customer.findUnique({ where: { id: c.id } }), await rel(), { now: later });
  assert.equal(cur.statusAuto, 'churned');
  events = db.tables.customerEvent;
  assert.deepEqual(events[1].data, { from: 'paid', to: 'churned' });
  assert.equal(events[1].at.getTime(), lic.currentPeriodEnd.getTime());
  // Nothing changes on a second pass.
  await applyState(db, await db.customer.findUnique({ where: { id: c.id } }), await rel(), { now: later });
  assert.equal(db.tables.customerEvent.length, 2);
  assert.ok(trial.id);
});
