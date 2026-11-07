'use strict';
// Plans and prices from the licensing server (src/main/planCatalog.js): cents to display prices,
// validation, a one-hour cache, the last good list or the built-in catalog when offline.

const test = require('node:test');
const assert = require('node:assert/strict');
const { majorAmount, normalizeServerPlan, plansFromServer, createPlanCatalog, CACHE_MS, RETRY_MS } = require('../src/main/planCatalog');

const TRIAL = { id: 'free-trial', kind: 'trial', amount: '0', name: 'Free Trial', features: [] };
const FALLBACK = [TRIAL, { id: 'pro', kind: 'paid', amount: '5', name: 'Pro' }, { id: 'enterprise', kind: 'paid', amount: '29', name: 'Enterprise' }];
const SERVER = [
  { key: 'pro', name: 'Pro', tier: 'pro', amount: 500, currency: 'usd', interval: 'month', months: 1, features: [' A ', '', 'B'], limits: { seats: 3, maxParallel: 3, auditExport: false } },
  { key: 'enterprise', name: 'Enterprise', tier: 'enterprise', amount: 2900, currency: 'USD', interval: 'month', months: 1, highlight: true, features: ['C'] }
];

test('amounts are minor units (cents) like the server Plan model', () => {
  assert.equal(majorAmount({ amount: 500 }), '5');
  assert.equal(majorAmount({ amount: 2900 }), '29');
  assert.equal(majorAmount({ amount: 1999 }), '19.99');
  assert.equal(majorAmount({ amountCents: 1500, amount: 15 }), '15', 'amountCents wins');
  assert.equal(majorAmount({ amount: '29.00' }), '29', 'a decimal string is a major-unit price');
  assert.equal(majorAmount({ amount: -1 }), null);
  assert.equal(majorAmount({ amount: 'abc' }), null);
  assert.equal(majorAmount({}), null);
});

test('a server plan becomes the app plan shape; bad rows are dropped', () => {
  const pro = normalizeServerPlan(SERVER[0]);
  assert.equal(pro.id, 'pro');
  assert.equal(pro.kind, 'paid');
  assert.equal(pro.amount, '5');
  assert.equal(pro.currency, 'USD');
  assert.equal(pro.period, 'month');
  assert.deepEqual(pro.features, ['A', 'B']);
  assert.deepEqual(pro.limits, { seats: 3, maxParallel: 3, auditExport: false });
  assert.equal(normalizeServerPlan({ ...SERVER[0], key: 'Pro-Yearly', interval: 'year', months: 12 }).id, 'Pro-Yearly', 'the key keeps its spelling for checkout');
  assert.equal(normalizeServerPlan({ ...SERVER[0], interval: 'year' }).period, 'year');
  assert.equal(normalizeServerPlan({ ...SERVER[0], months: 3 }).period, '3 months');
  assert.equal(normalizeServerPlan({ ...SERVER[0], active: false }), null);
  assert.equal(normalizeServerPlan({ ...SERVER[0], key: 'bad key!' }), null);
  assert.equal(normalizeServerPlan({ ...SERVER[0], name: ' ' }), null);
  assert.equal(normalizeServerPlan({ ...SERVER[0], amount: null }), null);
  const trial = normalizeServerPlan({ key: 'free-trial', name: 'Free Trial', amount: 999, tier: 'trial' });
  assert.equal(trial.kind, 'trial');
  assert.equal(trial.amount, '0', 'a trial is never priced');
  assert.equal(trial.tier, 'enterprise');
});

test('the list puts the trial first (built-in card when the server lists none) and needs a paid plan', () => {
  assert.deepEqual(plansFromServer(SERVER, FALLBACK).map((p) => p.id), ['free-trial', 'pro', 'enterprise']);
  assert.equal(plansFromServer(SERVER, FALLBACK)[0], TRIAL);
  assert.deepEqual(plansFromServer({ plans: SERVER }, FALLBACK).map((p) => p.id), ['free-trial', 'pro', 'enterprise'], '{ plans } is accepted');
  const withTrial = plansFromServer([...SERVER, { key: 'trial', name: 'Try it', amount: 0, kind: 'trial' }], FALLBACK);
  assert.deepEqual(withTrial.map((p) => p.id), ['trial', 'pro', 'enterprise']);
  assert.deepEqual(plansFromServer([SERVER[0], SERVER[0]], FALLBACK).map((p) => p.id), ['free-trial', 'pro'], 'duplicates dropped');
  assert.equal(plansFromServer([], FALLBACK), null);
  assert.equal(plansFromServer([{ key: 'trial', name: 'T', kind: 'trial' }], FALLBACK), null, 'no paid plan is unusable');
  assert.equal(plansFromServer({ error: 'x' }, FALLBACK), null);
});

test('the catalog caches for an hour, then refreshes', async () => {
  let t = 1_000_000;
  let n = 0;
  const cat = createPlanCatalog({ fetchPlans: async () => { n += 1; return SERVER; }, now: () => t });
  const a = await cat.get({ fallback: FALLBACK });
  assert.equal(a.source, 'server');
  assert.deepEqual(a.plans.map((p) => p.amount), ['0', '5', '29']);
  t += CACHE_MS - 1;
  await cat.get({ fallback: FALLBACK });
  assert.equal(n, 1, 'cached within the hour');
  t += 2;
  await cat.get({ fallback: FALLBACK });
  assert.equal(n, 2, 'refetched after an hour');
});

test('offline: the last good list, else the built-in catalog; retries wait a minute', async () => {
  let t = 0;
  let online = false;
  let n = 0;
  const cat = createPlanCatalog({ fetchPlans: async () => { n += 1; if (!online) throw Object.assign(new Error('offline'), { network: true }); return SERVER; }, now: () => t });
  const off = await cat.get({ fallback: FALLBACK });
  assert.equal(off.source, 'fallback');
  assert.equal(off.plans, FALLBACK);
  await cat.get({ fallback: FALLBACK });
  assert.equal(n, 1, 'no retry inside a minute, so pages do not stall offline');
  t += RETRY_MS;
  online = true;
  assert.equal((await cat.get({ fallback: FALLBACK })).source, 'server');
  online = false;
  t += CACHE_MS + 1;
  const stale = await cat.get({ fallback: FALLBACK });
  assert.equal(stale.source, 'stale', 'the last server prices beat the built-in ones');
  assert.deepEqual(stale.plans.map((p) => p.amount), ['0', '5', '29']);
});

test('concurrent reads share one fetch', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const cat = createPlanCatalog({ fetchPlans: async () => { n += 1; await gate; return SERVER; } });
  const both = Promise.all([cat.get({ fallback: FALLBACK }), cat.get({ fallback: FALLBACK })]);
  release();
  const [x, y] = await both;
  assert.equal(n, 1);
  assert.equal(x.plans, y.plans);
});
