'use strict';
// Yearly plans (owner's decision, 9 November 2026: a year costs 10 months, Pro US$50, Enterprise US$290).
// The licensing server serves them as plans with interval 'year' and months 12; the app groups plans by
// billing period (src/renderer/lib/planPeriods.mjs), shows a Monthly / Yearly switch on the Billing page
// and in the sign-in gate's plan picker, says "billed yearly" with the price spread over a month, marks
// the current plan by the lease's plan key, and never offers the Microsoft Store for a plan it has no
// add-on for (src/renderer/lib/storePurchase.mjs).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeServerPlan, plansFromServer } = require('../src/main/planCatalog');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const lib = (name) => import(pathToFileURL(path.join(R, 'lib', name)).href);

// What GET /v1/plans/public sends once the owner adds the two yearly plans in the admin.
const SERVER = [
  { key: 'pro', name: 'Pro', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, limits: { seats: 3, maxParallel: 3, auditExport: false } },
  { key: 'enterprise', name: 'Enterprise', tier: 'enterprise', amount: 2900, currency: 'USD', interval: 'month', months: 1, limits: { seats: 25, maxParallel: 10, auditExport: true } },
  { key: 'pro-yearly', name: 'Pro (yearly)', tier: 'pro', amount: 5000, currency: 'USD', interval: 'year', months: 12, limits: { seats: 3, maxParallel: 3, auditExport: false } },
  { key: 'enterprise-yearly', name: 'Enterprise (yearly)', tier: 'enterprise', amount: 29000, currency: 'USD', interval: 'year', months: 12, limits: { seats: 25, maxParallel: 10, auditExport: true } }
];
const TRIAL = { id: 'free-trial', kind: 'trial', amount: '0', name: 'Free Trial', period: '7 days', features: [] };
const appPlans = () => plansFromServer(SERVER, [TRIAL]);

test('a yearly server plan is priced per year, billed by the year, with its tier limits', () => {
  const y = normalizeServerPlan(SERVER[2]);
  assert.equal(y.id, 'pro-yearly');
  assert.equal(y.amount, '50');
  assert.equal(y.period, 'year', 'the card reads "$50 / year", never "/ month"');
  assert.equal(y.interval, 'year');
  assert.equal(y.months, 12);
  assert.equal(y.tier, 'pro');
  assert.deepEqual(y.limits, { seats: 3, maxParallel: 3, auditExport: false });
  const e = normalizeServerPlan(SERVER[3]);
  assert.deepEqual([e.amount, e.period, e.tier, e.limits.seats], ['290', 'year', 'enterprise', 25]);
  assert.equal(normalizeServerPlan(SERVER[0]).interval, 'month');
  const list = appPlans();
  assert.deepEqual(list.map((p) => p.id), ['free-trial', 'pro', 'enterprise', 'pro-yearly', 'enterprise-yearly']);
});

test('plans are grouped by billing period; the switch appears only with both periods for sale', async () => {
  const { billingPeriodOf, hasBothPeriods, plansForPeriod, counterpartPlan } = await lib('planPeriods.mjs');
  const list = appPlans();
  assert.equal(billingPeriodOf(TRIAL), null);
  assert.equal(billingPeriodOf(list[1]), 'month');
  assert.equal(billingPeriodOf(list[3]), 'year');
  assert.equal(billingPeriodOf({ kind: 'paid', period: 'year' }), 'year', 'the built-in catalog has only period');
  assert.equal(hasBothPeriods(list), true);
  assert.deepEqual(plansForPeriod(list, 'month').map((p) => p.id), ['free-trial', 'pro', 'enterprise']);
  assert.deepEqual(plansForPeriod(list, 'year').map((p) => p.id), ['free-trial', 'pro-yearly', 'enterprise-yearly']);
  const monthlyOnly = list.slice(0, 3);
  assert.equal(hasBothPeriods(monthlyOnly), false);
  assert.deepEqual(plansForPeriod(monthlyOnly, 'year').map((p) => p.id), ['free-trial', 'pro', 'enterprise'], 'no yearly plans yet: everything shows, as before');
  assert.equal(counterpartPlan(list[2], list, 'year').id, 'enterprise-yearly', 'flipping the switch keeps the tier');
  assert.equal(counterpartPlan(list[3], list, 'month').id, 'pro');
});

test('a yearly card says what it costs a month and what it saves (2 months free at the owner\'s prices)', async () => {
  const { yearlyDeal } = await lib('planPeriods.mjs');
  const list = appPlans();
  assert.deepEqual(yearlyDeal(list[3], list), { perMonth: '4.17', saving: '10', monthsFree: 2 });
  assert.deepEqual(yearlyDeal(list[4], list), { perMonth: '24.17', saving: '58', monthsFree: 2 });
  assert.equal(yearlyDeal(list[1], list), null, 'monthly cards have no yearly line');
  assert.equal(yearlyDeal(TRIAL, list), null);
  // A price changed in the admin: the line follows it, and "months free" only when it is whole months.
  const odd = { ...list[3], amount: '48' };
  assert.deepEqual(yearlyDeal(odd, list), { perMonth: '4', saving: '12', monthsFree: null });
  const noSaving = { ...list[3], amount: '60' };
  assert.deepEqual(yearlyDeal(noSaving, list), { perMonth: '5', saving: null, monthsFree: null });
  assert.deepEqual(yearlyDeal(list[3], [list[3]]), { perMonth: '4.17', saving: null, monthsFree: null }, 'no monthly plan to compare with');
});

test('the current plan is the lease\'s plan key when known, else the tier (as before)', async () => {
  const { isCurrentPlan, initialPeriod } = await lib('planPeriods.mjs');
  const list = appPlans();
  const [, pro, ent, proY] = list;
  const onProMonthly = { isPaid: true, currentTier: 'pro', currentPlanKey: 'pro', plans: list };
  assert.equal(isCurrentPlan(pro, onProMonthly), true);
  assert.equal(isCurrentPlan(proY, onProMonthly), false, 'a monthly Pro customer can choose Pro yearly');
  assert.equal(isCurrentPlan(ent, onProMonthly), false);
  const onProYearly = { ...onProMonthly, currentPlanKey: 'pro-yearly' };
  assert.equal(isCurrentPlan(proY, onProYearly), true);
  assert.equal(isCurrentPlan(pro, onProYearly), false);
  assert.equal(initialPeriod(list, onProYearly), 'year', 'a yearly customer lands on Yearly');
  assert.equal(initialPeriod(list, onProMonthly), 'month');
  const codeLicence = { isPaid: true, currentTier: 'pro', currentPlanKey: null, plans: list };
  assert.equal(isCurrentPlan(pro, codeLicence), true, 'no plan key (purchase code): the tier decides');
  assert.equal(isCurrentPlan(proY, codeLicence), true);
  assert.equal(initialPeriod(list, codeLicence), 'month');
  assert.equal(isCurrentPlan(pro, { ...codeLicence, currentPlanKey: 'old-plan' }), true, 'an unknown key falls back to the tier');
  assert.equal(isCurrentPlan(pro, { ...onProMonthly, isPaid: false }), false);
  assert.equal(isCurrentPlan(TRIAL, onProMonthly), false);
});

// The Store build: add-ons per tier and billing period (pro_monthly, pro_yearly, ...) with the Store's own
// prices. status() as storeCommerce.js returns it once the owner maps the yearly add-ons to the yearly plans.
const OFFER = (productId, plan, tier, period, formatted, available = true) => ({ productId, plan, tier, period, available, title: null, price: formatted ? { formatted } : null });
const STORE_BOTH = {
  available: true,
  plans: {
    pro: { productId: 'pro_monthly', tier: 'pro', period: 'month', available: true, price: { formatted: '$4.99' } },
    enterprise: { productId: 'enterprise_monthly', tier: 'enterprise', period: 'month', available: true, price: { formatted: '$28.99' } },
    'pro-yearly': { productId: 'pro_yearly', tier: 'pro', period: 'year', available: true, price: { formatted: '$49.99' } },
    'enterprise-yearly': { productId: 'enterprise_yearly', tier: 'enterprise', period: 'year', available: true, price: { formatted: '$289.99' } }
  },
  offers: [
    OFFER('pro_monthly', 'pro', 'pro', 'month', '$4.99'), OFFER('enterprise_monthly', 'enterprise', 'enterprise', 'month', '$28.99'),
    OFFER('pro_yearly', 'pro-yearly', 'pro', 'year', '$49.99'), OFFER('enterprise_yearly', 'enterprise-yearly', 'enterprise', 'year', '$289.99')
  ]
};

test('Store build: each card gets the add-on for its tier and billing period, with the Store\'s own price', async () => {
  const { storeOffer, storePrice, storeSellsPlan, storeHasBothPeriods, methodsForPlan, sellablePlans } = await lib('storePurchase.mjs');
  const { plansForPeriod } = await lib('planPeriods.mjs');
  const list = appPlans();
  const [, pro, ent, proY, entY] = list;
  assert.equal(storePrice(STORE_BOTH, pro), '$4.99');
  assert.equal(storePrice(STORE_BOTH, proY), '$49.99');
  assert.equal(storePrice(STORE_BOTH, entY), '$289.99');
  assert.equal(storeOffer(STORE_BOTH, ent).productId, 'enterprise_monthly');
  assert.equal(storePrice(STORE_BOTH, 'pro'), '$4.99', 'a plan id still reads the add-on mapped to that key');
  assert.equal(storeHasBothPeriods(STORE_BOTH), true);
  const storeOnly = sellablePlans(list, { storeOnly: true, storeInfo: STORE_BOTH });
  assert.deepEqual(plansForPeriod(storeOnly, 'year').map((p) => p.id), ['free-trial', 'pro-yearly', 'enterprise-yearly'], 'the Yearly switch shows the yearly add-ons');

  // The owner mapped the yearly add-ons to the monthly keys (pro_yearly -> 'pro'): the monthly card keeps
  // the monthly add-on, the yearly card finds the yearly one by tier and period.
  const byTier = {
    available: true,
    plans: { pro: STORE_BOTH.plans.pro, enterprise: STORE_BOTH.plans.enterprise },
    offers: [OFFER('pro_monthly', 'pro', 'pro', 'month', '$4.99'), OFFER('pro_yearly', 'pro', 'pro', 'year', '$49.99'), OFFER('enterprise_monthly', 'enterprise', 'enterprise', 'month', '$28.99'), OFFER('enterprise_yearly', 'enterprise', 'enterprise', 'year', '$289.99')]
  };
  assert.equal(storeOffer(byTier, pro).productId, 'pro_monthly');
  assert.equal(storeOffer(byTier, proY).productId, 'pro_yearly');
  assert.equal(storePrice(byTier, entY), '$289.99');

  // No yearly add-on in the Store (not made yet, or not published): yearly is not sold there, monthly is.
  const monthlyOnly = { available: true, plans: { pro: STORE_BOTH.plans.pro, enterprise: STORE_BOTH.plans.enterprise }, offers: STORE_BOTH.offers.slice(0, 2) };
  assert.equal(storeOffer(monthlyOnly, proY), null, 'a yearly card never gets the monthly add-on');
  assert.equal(storePrice(monthlyOnly, proY), null);
  assert.equal(storeSellsPlan(monthlyOnly, proY), false);
  assert.equal(storeSellsPlan(monthlyOnly, pro), true);
  assert.equal(storeHasBothPeriods(monthlyOnly), false);
  assert.deepEqual(sellablePlans(list, { storeOnly: true, storeInfo: monthlyOnly }).map((p) => p.id), ['free-trial', 'pro', 'enterprise'], 'Store-only build: falls back to monthly');
  const unpublished = { ...STORE_BOTH, offers: STORE_BOTH.offers.map((o) => (o.period === 'year' ? { ...o, available: false, price: null } : o)) };
  assert.equal(storeSellsPlan(unpublished, entY), false, 'mapped but not found in the Store: not sold');

  // Mixed methods: the Store is offered only for the plans it sells.
  const store = { id: 'microsoft_store', kind: 'store', label: 'Microsoft Store' };
  const card = { id: 'stripe', kind: 'automated', label: 'Stripe (cards)' };
  assert.deepEqual(methodsForPlan([store, card], monthlyOnly, proY).map((m) => m.id), ['stripe']);
  assert.deepEqual(methodsForPlan([store, card], STORE_BOTH, proY).map((m) => m.id), ['microsoft_store', 'stripe']);
  assert.equal(sellablePlans(list, { storeOnly: false, storeInfo: monthlyOnly }).length, 5);
  // Sales off (status not available) or no Store build: nothing is filtered, as before.
  assert.equal(storeSellsPlan(null, proY), true);
  assert.equal(storeSellsPlan({ available: false, reason: 'sales_off' }, proY), true);
  assert.equal(storePrice({ available: false, reason: 'sales_off' }, pro), null);
});

test('the gate picks a monthly plan first, whatever order the server lists them in', async () => {
  const { defaultPlanId, paidPlans } = await lib('signupFlow.mjs');
  const list = paidPlans({ plans: appPlans() });
  assert.equal(defaultPlanId(list), 'pro');
  assert.equal(defaultPlanId([list[2], list[3], list[0], list[1]]), 'pro');
  assert.equal(defaultPlanId([list[2], list[3]]), 'pro-yearly', 'only yearly plans: the first one');
  assert.equal(defaultPlanId([{ ...list[0] }, { ...list[1], highlight: true }, list[2], list[3]]), 'enterprise');
});

test('Billing page and gate wire it up: switch with aria-pressed, deal line, plan key, Store filter', () => {
  const billing = read('pages', 'BillingPage.jsx');
  const gate = read('components', 'Gate.jsx');
  for (const src of [billing, gate]) {
    assert.match(src, /aria-pressed=\{activePeriod === p\}/);
    assert.match(src, /hasBothPeriods\(/);
    assert.match(src, /yearlyDeal\(/);
    assert.match(src, /period\.billedYearly/);
    assert.match(src, /sellablePlans\(/);
    assert.match(src, /methodsForPlan\(/);
  }
  assert.match(billing, /currentPlanKey: backend\?\.lease\?\.plan/);
  assert.doesNotMatch(billing, /isPaid && plan\.tier === currentTier/, 'the tier alone no longer decides "Current plan"');
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
  assert.match(main, /currentPeriodEnd: ent\.currentPeriodEnd, plan: ent\.plan \|\| null \}/, 'backendInfo passes the lease plan key');
});

test('the new strings exist in English and Spanish with the same keys', () => {
  const en = JSON.parse(read('i18n', 'locales', 'en', 'billing.json')).period;
  const es = JSON.parse(read('i18n', 'locales', 'es', 'billing.json')).period;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const k of ['label', 'monthly', 'yearly', 'billedYearly', 'monthsFree_one', 'monthsFree_other', 'monthsFreeShort_one', 'monthsFreeShort_other', 'save']) {
    assert.ok(en[k] && es[k], k);
  }
  assert.match(en.billedYearly, /\{\{perMonth\}\}/);
  assert.match(es.billedYearly, /\{\{perMonth\}\}/);
});
