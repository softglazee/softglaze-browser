'use strict';
// Microsoft Store yearly add-ons in the app (src/main/storeCommerce.js): pro_yearly and enterprise_yearly
// next to pro_monthly and enterprise_monthly, each with the Store's own price and billing period; a yearly
// plan card buys the yearly add-on and never the monthly one; without a yearly add-on in the Store the
// yearly plan is not sold there. A fake addon bridge and a fake licensing server: no real Store call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStoreCommerce, offerPeriod, offerFor, DEFAULT_PRODUCTS } = require('../src/main/storeCommerce');

const ROOT = path.join(__dirname, '..');
const sku = (storeId, formatted, unit, count = 1) => [{ storeId: `${storeId}/0010`, isSubscription: true, price: { formatted, formattedRecurrence: formatted, currencyCode: 'USD' }, subscription: { billingPeriod: count, billingPeriodUnit: unit, hasTrialPeriod: false } }];
const product = (storeId, token, title, formatted, unit, count) => ({ storeId, inAppOfferToken: token, title, productKind: 'Durable', price: { formatted, currencyCode: 'USD' }, skus: sku(storeId, formatted, unit, count) });
const PRO_M = product('9NPRO0000001', 'pro_monthly', 'Pro', '$4.99', 'month');
const ENT_M = product('9NENT0000001', 'enterprise_monthly', 'Enterprise', '$28.99', 'month');
const PRO_Y = product('9NPROYEAR001', 'pro_yearly', 'Pro (yearly)', '$49.99', 'year');
const ENT_Y = product('9NENTYEAR001', 'enterprise_yearly', 'Enterprise (yearly)', '$289.99', 'month', 12);

// The owner's recommended map: the yearly add-ons stand for the yearly plans.
const SESSION = { products: [
  { productId: 'pro_monthly', plan: 'pro', tier: 'pro' }, { productId: 'enterprise_monthly', plan: 'enterprise', tier: 'enterprise' },
  { productId: 'pro_yearly', plan: 'pro-yearly', tier: 'pro' }, { productId: 'enterprise_yearly', plan: 'enterprise-yearly', tier: 'enterprise' }
], verification: { mode: 'unverified' } };

function harness({ products = [PRO_M, ENT_M, PRO_Y, ENT_Y], session = SESSION, sessionError = null } = {}) {
  const calls = [];
  const bridge = {
    available: () => true,
    isStoreInstall: () => true,
    call: async (cmd, opts) => {
      calls.push({ cmd, opts });
      if (cmd === 'ping') return { ok: true, packaged: true };
      if (cmd === 'products') return { ok: true, products };
      if (cmd === 'license') return { ok: true, addOns: [] };
      if (cmd === 'purchase') return { ok: true, status: 'NotPurchased' };
      return { ok: false, error: 'unknown' };
    }
  };
  const server = {
    session: async () => { if (sessionError) throw sessionError; return session; },
    claim: async () => ({ ok: true, licensed: false, entitlements: [] })
  };
  const store = {};
  const sc = createStoreCommerce({
    bridge, server,
    ensureInstall: async () => ({ installId: 'inst-1', installSecret: 'secret-1' }),
    refreshLease: async () => null,
    readSetting: async (k, fb) => (k in store ? store[k] : fb),
    writeSetting: async (k, v) => { store[k] = v; }
  });
  return { sc, calls, bought: () => calls.filter((c) => c.cmd === 'purchase').map((c) => c.opts.storeId) };
}

test('Product IDs per tier and billing period; the built-in map when the server cannot be reached', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)), { pro: { month: 'pro_monthly', year: 'pro_yearly' }, enterprise: { month: 'enterprise_monthly', year: 'enterprise_yearly' } });
  const st = await harness({ sessionError: Object.assign(new Error('offline'), { network: true }) }).sc.status();
  assert.deepEqual(st.offers.map((o) => [o.productId, o.plan, o.tier, o.period]), [
    ['pro_monthly', 'pro', 'pro', 'month'], ['enterprise_monthly', 'enterprise', 'enterprise', 'month'],
    ['pro_yearly', 'pro-yearly', 'pro', 'year'], ['enterprise_yearly', 'enterprise-yearly', 'enterprise', 'year']
  ]);
  assert.equal(st.plans['pro-yearly'].price.formatted, '$49.99');
});

test('the billing period comes from the Store SKU (1 year or 12 months), else the Product ID', () => {
  assert.equal(offerPeriod('anything', { period: { unit: 'year', count: 1 } }), 'year');
  assert.equal(offerPeriod('anything', { period: { unit: 'month', count: 12 } }), 'year');
  assert.equal(offerPeriod('pro_yearly', { period: { unit: 'month', count: 1 } }), 'month', 'the Store\'s own period wins');
  assert.equal(offerPeriod('pro_yearly', null), 'year');
  assert.equal(offerPeriod('enterprise_annual', null), 'year');
  assert.equal(offerPeriod('pro_monthly', null), 'month');
  assert.equal(offerPeriod('pro', { period: { unit: 'unknown' } }), 'month');
});

test('status: every add-on with its period and the Store\'s own price; one add-on per plan key as before', async () => {
  const st = await harness().sc.status();
  assert.equal(st.available, true);
  const by = Object.fromEntries(st.offers.map((o) => [o.productId, o]));
  assert.deepEqual([by.pro_yearly.period, by.pro_yearly.price.formatted, by.pro_yearly.available], ['year', '$49.99', true]);
  assert.deepEqual([by.enterprise_yearly.period, by.enterprise_yearly.price.formatted], ['year', '$289.99']);
  assert.equal(by.pro_monthly.period, 'month');
  assert.equal(st.plans.pro.productId, 'pro_monthly');
  assert.equal(st.plans['enterprise-yearly'].productId, 'enterprise_yearly');

  // Yearly add-ons mapped to the monthly keys: the monthly one keeps the key, the yearly one is in offers.
  const tierMap = { products: [
    { productId: 'pro_monthly', plan: 'pro', tier: 'pro' }, { productId: 'pro_yearly', plan: 'pro', tier: 'pro' },
    { productId: 'enterprise_yearly', plan: 'enterprise', tier: 'enterprise' }, { productId: 'enterprise_monthly', plan: 'enterprise', tier: 'enterprise' }
  ], verification: { mode: 'unverified' } };
  const st2 = await harness({ session: tierMap }).sc.status();
  assert.equal(st2.plans.pro.productId, 'pro_monthly');
  assert.equal(st2.plans.enterprise.productId, 'enterprise_monthly', 'even when the yearly one is listed first');
  assert.equal(offerFor(st2, { plan: 'pro-yearly', tier: 'pro', period: 'year' }).productId, 'pro_yearly');
  assert.equal(offerFor(st2, { plan: 'pro', tier: 'pro', period: 'month' }).productId, 'pro_monthly');
});

test('purchase: a yearly card buys the yearly add-on; a monthly card the monthly one; no yearly add-on means not sold', async () => {
  const h = harness();
  assert.equal((await h.sc.purchase('pro-yearly', '1', { tier: 'pro', period: 'year' })).status, 'cancelled');
  assert.equal((await h.sc.purchase('enterprise-yearly', '1', { tier: 'enterprise', period: 'year' })).status, 'cancelled');
  assert.equal((await h.sc.purchase('pro', '1', { tier: 'pro', period: 'month' })).status, 'cancelled');
  assert.equal((await h.sc.purchase('enterprise', '1')).status, 'cancelled', 'without a period: the add-on mapped to the key, as before');
  assert.deepEqual(h.bought(), ['9NPROYEAR001', '9NENTYEAR001', '9NPRO0000001', '9NENT0000001']);

  // The yearly add-ons are not in the Store (not made yet): the yearly plan is not bought, monthly still is.
  const m = harness({ products: [PRO_M, ENT_M] });
  assert.deepEqual(await m.sc.purchase('pro-yearly', '1', { tier: 'pro', period: 'year' }), { status: 'unavailable', code: 'store_product_missing' });
  assert.equal((await m.sc.purchase('pro', '1', { tier: 'pro', period: 'month' })).status, 'cancelled');
  assert.deepEqual(m.bought(), ['9NPRO0000001'], 'never the monthly add-on for a yearly card');

  // Mapped by tier (pro_yearly -> 'pro'): the yearly card still finds the yearly add-on.
  const t = harness({ session: { products: [{ productId: 'pro_monthly', plan: 'pro', tier: 'pro' }, { productId: 'pro_yearly', plan: 'pro', tier: 'pro' }], verification: { mode: 'unverified' } } });
  await t.sc.purchase('pro-yearly', '1', { tier: 'pro', period: 'year' });
  await t.sc.purchase('pro', '1', { tier: 'pro', period: 'month' });
  assert.deepEqual(t.bought(), ['9NPROYEAR001', '9NPRO0000001']);
});

test('main passes the plan card\'s tier and billing period to the Store purchase', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
  assert.match(main, /getStoreCommerce\(\)\.purchase\(plan\.id, storeWindowHandle\(event\), \{ tier: plan\.tier, period \}\)/);
  // Store sales off: purchase still refuses before any Store call, and status hides the Store (unchanged).
  assert.match(main, /if \(!\(await storeSalesOpen\(\)\)\) return \{ status: 'unavailable', code: 'store_sales_off' \};/);
  assert.match(main, /return \{ available: false, reason: 'sales_off', salesEnabled: false \};/);
});
