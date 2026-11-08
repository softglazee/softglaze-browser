'use strict';
// 1.0.23: tenant builds take their payment methods from the licensing server (GET /v1/checkout/methods)
// instead of the list baked into the build, so a provider switched on later needs no app update; the
// baked list is the fallback offline. The Microsoft Store method shows only when the server has Store
// sales on AND the Store returns the add-ons' prices. Pure module tests plus the real functions from
// ipcHandlers.js through the licence harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');

const { publicKey } = generateKeyPairSync('ed25519');
process.env.SG_TENANT_ID = 'tenant_test';
process.env.SG_API_BASE_URL = 'http://127.0.0.1:9';
process.env.SG_TENANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const { buildMain } = require('./helpers/licenseHarness');
const cm = require('../src/main/checkoutMethods');
const { PENDING_SETTING, SYNC_SETTING } = require('../src/main/storeCommerce');

const plain = (v) => JSON.parse(JSON.stringify(v));
const offlineError = () => Object.assign(new Error('getaddrinfo ENOTFOUND api.softglaze.com'), { code: 'ENOTFOUND', network: true });
const OWNER = { id: 1, name: 'Ada Owner', email: 'ada@example.com', role: 'OWNER', status: 'active', createdAt: new Date() };

const SERVER = {
  providers: [
    { id: 'stripe', label: 'Card (Stripe)', kind: 'automated' },
    { id: '2checkout', label: 'Card or PayPal (2Checkout)', kind: 'automated' }
  ],
  store: { salesEnabled: false }
};
const withStore = (salesEnabled) => ({ ...SERVER, store: { salesEnabled } });
const STORE_PRICED = { available: true, provider: 'Microsoft Store', plans: { pro: { productId: 'pro_monthly', tier: 'pro', available: true, price: { formatted: '$4.99' } }, enterprise: { productId: 'enterprise_monthly', tier: 'enterprise', available: true, price: { formatted: '$29.99' } } } };
const STORE_NO_PRICES = { available: true, provider: 'Microsoft Store', plans: { pro: { productId: 'pro_monthly', tier: 'pro', available: false, price: null }, enterprise: { productId: 'enterprise_monthly', tier: 'enterprise', available: false, price: null } } };

function main(opts = {}) {
  return buildMain({ tenant: true, members: [{ ...OWNER }], activeMemberId: 1, ...opts });
}

// ---- pure ------------------------------------------------------------------------------------------

test('normalizeMethods: unknown provider ids pass through generically; Store, manual and bad ids never do', () => {
  const n = cm.normalizeMethods({
    providers: [
      { id: 'Paddle', label: '  Paddle  <b>' },
      { id: 'paddle', label: 'dupe' },
      { id: 'microsoft_store', label: 'Microsoft Store' },
      { id: 'manual', label: 'Bank' },
      { id: 'bad id!', label: 'x' },
      { id: 'payoneer', label: '', kind: 'automated' },
      { id: 'wiseish', label: 'Wise', kind: 'manual' },
      null
    ],
    store: { salesEnabled: 'true' }
  });
  assert.deepEqual(n, { providers: [{ id: 'paddle', label: 'Paddle b', kind: 'automated' }, { id: 'payoneer', label: 'payoneer', kind: 'automated' }], storeSalesEnabled: false });
  assert.equal(cm.normalizeMethods({ providers: [], store: { salesEnabled: true } }).storeSalesEnabled, true);
  assert.equal(cm.normalizeMethods([{ id: 'stripe' }]), null, 'an array is not the shape');
  assert.equal(cm.normalizeMethods(null), null);
  assert.deepEqual(cm.fallbackMethods(['Stripe', 'bogus id', 'stripe', 'microsoft_store'], (id) => (id === 'stripe' ? 'Stripe (cards)' : id)),
    { providers: [{ id: 'stripe', label: 'Stripe (cards)', kind: 'automated' }], storeSalesEnabled: false });
});

test('the catalog caches the server answer, keeps the last good one when offline, else the baked list', async () => {
  let t = 1000;
  let calls = 0;
  let answer = SERVER;
  const cat = cm.createCheckoutCatalog({ fetchMethods: async () => { calls += 1; if (answer instanceof Error) throw answer; return answer; }, now: () => t });
  const fb = cm.fallbackMethods(['cryptomus'], () => 'Cryptomus (crypto)');
  const a = await cat.get({ fallback: fb });
  assert.equal(a.source, 'server');
  assert.deepEqual(a.providers.map((p) => p.id), ['stripe', '2checkout']);
  await cat.get({ fallback: fb });
  assert.equal(calls, 1, 'cached');
  t += cm.CACHE_MS + 1;
  answer = offlineError();
  const stale = await cat.get({ fallback: fb });
  assert.equal(stale.source, 'stale');
  assert.deepEqual(stale.providers.map((p) => p.id), ['stripe', '2checkout'], 'the last good answer');
  await cat.get({ fallback: fb });
  assert.equal(calls, 2, 'rests after a failure instead of retrying every call');
  const cold = cm.createCheckoutCatalog({ fetchMethods: async () => { throw offlineError(); } });
  const c = await cold.get({ fallback: fb });
  assert.deepEqual(plain(c), { providers: [{ id: 'cryptomus', label: 'Cryptomus (crypto)', kind: 'automated' }], storeSalesEnabled: false, source: 'fallback', fetchedAt: null });
  assert.equal(cm.storeHasPrices(STORE_PRICED), true);
  assert.equal(cm.storeHasPrices(STORE_NO_PRICES), false);
  assert.equal(cm.storeHasPrices({ available: false }), false);
});

// ---- ipcHandlers -----------------------------------------------------------------------------------

test('tenant: the payment methods are what the server switched on, labels from the server', async () => {
  const m = main({ checkoutProviders: ['cryptomus'], api: { checkoutMethods: async () => SERVER } });
  const r = plain(await m.fns.listPaymentMethods());
  assert.deepEqual(r.methods, [
    { id: 'stripe', label: 'Card (Stripe)', kind: 'automated' },
    { id: '2checkout', label: 'Card or PayPal (2Checkout)', kind: 'automated' }
  ], 'the server list replaces the baked one');
});

test('tenant offline: the providers baked into the build, with the app labels', async () => {
  const m = main({ checkoutProviders: ['stripe', 'paypal'], api: { checkoutMethods: async () => { throw offlineError(); } } });
  assert.deepEqual(plain(await m.fns.listPaymentMethods()).methods, [
    { id: 'stripe', label: 'Stripe (cards)', kind: 'automated' },
    { id: 'paypal', label: 'PayPal', kind: 'automated' }
  ]);
  const none = main({ api: { checkoutMethods: async () => { throw offlineError(); } } });
  assert.deepEqual(plain(await none.fns.listPaymentMethods()).methods, [], 'nothing baked: nothing offered');
});

test('tenant checkout: a provider the server lists (even one the app has never heard of) gets the server URL', async () => {
  const m = main({ api: { checkoutMethods: async () => SERVER, checkout: async ({ provider, planKey }) => ({ url: `https://pay.example/${provider}/${planKey}`, ref: 'r1', provider }) } });
  const r = plain(await m.fns.startCheckout({ provider: '2checkout', planId: 'pro' }));
  assert.equal(r.url, 'https://pay.example/2checkout/pro');
  assert.equal(r.provider, '2checkout');
  assert.deepEqual(plain(m.calls.find((c) => c.method === 'checkout').args[0]), { planKey: 'pro', installId: 'inst_1', provider: '2checkout' });
  await assert.rejects(m.fns.startCheckout({ provider: 'paypal', planId: 'pro' }), /not available for this app/, 'a provider the server did not list is refused');
  const first = plain(await m.fns.startCheckout({ planId: 'pro' }));
  assert.equal(first.provider, 'stripe', 'no provider: the first one the server lists');
});

test('Microsoft Store method: hidden while Store sales are off (the default) or the Store has no prices', async () => {
  const store = (status) => ({ isStoreInstall: true, available: true, status: async () => status });
  const off = main({ store: store(STORE_PRICED), api: { checkoutMethods: async () => withStore(false) } });
  assert.ok(!plain(await off.fns.listPaymentMethods()).methods.some((x) => x.kind === 'store'), 'sales off');
  const noPrices = main({ store: store(STORE_NO_PRICES), api: { checkoutMethods: async () => withStore(true) } });
  assert.ok(!plain(await noPrices.fns.listPaymentMethods()).methods.some((x) => x.kind === 'store'), 'no prices from the Store');
  const offline = main({ store: store(STORE_PRICED), api: { checkoutMethods: async () => { throw offlineError(); } } });
  assert.ok(!plain(await offline.fns.listPaymentMethods()).methods.some((x) => x.kind === 'store'), 'server not reachable: hidden');
  const on = main({ store: store(STORE_PRICED), api: { checkoutMethods: async () => withStore(true) } });
  const methods = plain(await on.fns.listPaymentMethods()).methods;
  assert.deepEqual(methods[0], { id: 'microsoft_store', label: 'Microsoft Store', kind: 'store' }, 'sales on and priced: first');
  assert.equal(methods.length, 3);
  const website = main({ store: { isStoreInstall: false, available: false }, api: { checkoutMethods: async () => withStore(true) } });
  assert.ok(!plain(await website.fns.listPaymentMethods()).methods.some((x) => x.kind === 'store'), 'never outside the Store package');
});

test('Store status and purchase follow the switch; an existing Store subscription can still be restored', async () => {
  const store = { isStoreInstall: true, available: true, status: async () => STORE_PRICED };
  const off = main({ store, api: { checkoutMethods: async () => withStore(false) } });
  assert.deepEqual(plain(await off.fns.storeStatus()), { available: false, reason: 'sales_off', salesEnabled: false }, 'no Store card or prices');
  assert.deepEqual(plain(await off.fns.storePurchase({ planId: 'pro' })), { status: 'unavailable', code: 'store_sales_off' });
  assert.ok(!off.calls.some((c) => c.method === 'storeCommerce.purchase'), 'Microsoft is never asked');
  // A customer who already bought in the Store keeps the card (restore, manage) with sales off.
  for (const settings of [{ [SYNC_SETTING]: { at: Date.now(), hadEntitlement: true } }, { [PENDING_SETTING]: { at: Date.now(), purchase: { productId: 'pro_monthly' } } }]) {
    const had = main({ store, settings, api: { checkoutMethods: async () => withStore(false) } });
    const st = plain(await had.fns.storeStatus());
    assert.equal(st.available, true);
    assert.equal(st.salesEnabled, false);
  }
  const on = main({ store, api: { checkoutMethods: async () => withStore(true) } });
  const st = plain(await on.fns.storeStatus());
  assert.equal(st.available, true);
  assert.equal(st.salesEnabled, true);
  const bought = plain(await on.fns.storePurchase({ planId: 'pro' }));
  assert.equal(bought.status, 'active');
  assert.ok(on.calls.some((c) => c.method === 'storeCommerce.purchase'));
});
