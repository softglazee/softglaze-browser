'use strict';
// Microsoft Store purchases in the app (Store build only): the addon bridge, the purchase / claim /
// restore / background-sync flow with a fake addon and a fake licensing server, the renderer's result
// mapping, and that website and base builds are untouched. No real Store call or purchase is made.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const bridge = require('../src/main/storeBridge');
const { createStoreCommerce, priceOf, PENDING_SETTING, SYNC_SETTING, SYNC_EVERY_MS } = require('../src/main/storeCommerce');
const loadOutcomes = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'storePurchase.mjs')).href);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const DAY = 86400000;
const PRO = {
  storeId: '9NPRO0000001', inAppOfferToken: 'pro_monthly', title: 'Pro', productKind: 'Durable',
  price: { formatted: '$4.99', formattedRecurrence: '$4.99', currencyCode: 'USD' },
  skus: [{ storeId: '9NPRO0000001/0010', isSubscription: true, price: { formatted: '$4.99', formattedRecurrence: '$4.99', currencyCode: 'USD' }, subscription: { billingPeriod: 1, billingPeriodUnit: 'month', hasTrialPeriod: false } }]
};
const ENT = { ...PRO, storeId: '9NENT0000001', inAppOfferToken: 'enterprise_monthly', title: 'Enterprise', price: { formatted: '$28.99', currencyCode: 'USD' }, skus: [] };

// A fake addon bridge: scripted answers per command, every call recorded.
function fakeBridge(over = {}) {
  const calls = [];
  const answers = {
    ping: { ok: true, protocol: 1, packaged: true, packageFamilyName: 'SoftGlaze.SoftGlazeBrowser_x' },
    products: { ok: true, products: [PRO, ENT], extendedError: '0x00000000' },
    license: { ok: true, app: { isActive: true }, addOns: [] },
    keys: { ok: true, collectionsKey: 'ckey-123456789012345678901', purchaseKey: 'pkey-123456789012345678901' },
    purchase: { ok: true, status: 'Succeeded', extendedError: '0x00000000' },
    ...over
  };
  return {
    calls,
    answers,
    available: () => over.available !== false,
    isStoreInstall: () => true,
    call: async (cmd, opts) => { calls.push({ cmd, opts }); const a = answers[cmd]; return typeof a === 'function' ? a(opts) : a; }
  };
}

function fakeServer(over = {}) {
  const calls = [];
  return {
    calls,
    session: async (install) => {
      calls.push({ fn: 'session', install });
      if (over.sessionError) throw over.sessionError;
      return over.session || { products: [{ productId: 'pro_monthly', plan: 'pro', tier: 'pro' }, { productId: 'enterprise_monthly', plan: 'enterprise', tier: 'enterprise' }], verification: { mode: 'unverified' } };
    },
    claim: async (body) => {
      calls.push({ fn: 'claim', body });
      if (over.claimError) { const e = over.claimError; if (typeof e === 'function') { const x = e(body); if (x) throw x; } else throw e; }
      return typeof over.claim === 'function' ? over.claim(body) : (over.claim || { ok: true, mode: 'unverified', verified: false, licensed: true, entitlements: [{ productId: 'pro_monthly', status: 'active' }] });
    }
  };
}

function harness({ bridgeOver, serverOver, lease = { tier: 'pro', type: 'paid' }, settings = {}, now } = {}) {
  const b = fakeBridge(bridgeOver);
  const s = fakeServer(serverOver);
  const store = { ...settings };
  let leases = 0;
  const sc = createStoreCommerce({
    bridge: b,
    server: s,
    ensureInstall: async () => ({ installId: 'inst-1', installSecret: 'secret-1' }),
    refreshLease: async () => { leases += 1; return typeof lease === 'function' ? lease() : lease; },
    readSetting: async (k, fb) => (k in store ? store[k] : fb),
    writeSetting: async (k, v) => { store[k] = v; },
    now: now || (() => Date.now())
  });
  return { sc, b, s, store, leases: () => leases };
}

const netErr = () => Object.assign(new Error('getaddrinfo ENOTFOUND'), { network: true });
const codeErr = (code, status = 409) => Object.assign(new Error(code), { code, status });

// ---- bridge --------------------------------------------------------------------------------------
test('bridge: outside the Store package nothing is loaded and every call says not_store_build', async () => {
  bridge._setForTests({ isStoreInstall: false });
  assert.equal(bridge.available(), false);
  assert.deepEqual((await bridge.call('license')).error, 'not_store_build');
  bridge._setForTests(null);
  if (process.platform !== 'win32' || process.windowsStore !== true) assert.equal(bridge.isStoreInstall(), false, 'plain Node / website build');
});

test('bridge: parses the addon JSON, reports a missing addon and a broken reply without throwing', async () => {
  const seen = [];
  bridge._setForTests({ isStoreInstall: true, addon: { call: async (cmd, opts) => { seen.push([cmd, opts]); return '{"ok":true,"protocol":1,"packaged":true}'; } } });
  assert.deepEqual(await bridge.call('ping', { a: 1 }), { ok: true, protocol: 1, packaged: true });
  assert.deepEqual(seen[0], ['ping', { a: 1 }]);
  bridge._setForTests({ isStoreInstall: true, addon: { call: async () => 'not json' } });
  assert.equal((await bridge.call('license')).error, 'bridge_error');
  bridge._setForTests({ isStoreInstall: true, addon: { call: async () => { throw new Error('boom'); } } });
  assert.equal((await bridge.call('license')).error, 'bridge_error');
  bridge._setForTests({ isStoreInstall: true, addon: null });
  assert.equal((await bridge.call('license')).error, 'addon_unavailable');
  bridge._setForTests(null);
  assert.ok(bridge.TIMEOUT_MS.purchase >= 10 * 60000, 'the purchase dialog gets minutes, not seconds');
});

test('bridge: the window handle is the HWND from getNativeWindowHandle, as a decimal string', () => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(0x1234567n, 0);
  assert.equal(bridge.windowHandle({ getNativeWindowHandle: () => buf, isDestroyed: () => false }), String(0x1234567));
  assert.equal(bridge.windowHandle({ getNativeWindowHandle: () => buf, isDestroyed: () => true }), '');
  assert.equal(bridge.windowHandle(null), '');
});

// ---- prices --------------------------------------------------------------------------------------
test('the shown price is the Store subscription SKU price, preferring the SKU without a Store trial', () => {
  assert.equal(priceOf(PRO).formatted, '$4.99');
  assert.deepEqual(priceOf(PRO).period, { count: 1, unit: 'month' });
  const withTrial = { ...PRO, skus: [{ isSubscription: true, price: { formattedRecurrence: '$0.00' }, subscription: { hasTrialPeriod: true } }, { isSubscription: true, price: { formattedRecurrence: '$4.99', currencyCode: 'USD' }, subscription: { hasTrialPeriod: false } }] };
  assert.equal(priceOf(withTrial).formatted, '$4.99');
  assert.equal(priceOf(ENT).formatted, '$28.99', 'no SKU list: the product price');
  assert.equal(priceOf(null), null);
});

// ---- status --------------------------------------------------------------------------------------
test('status: plan -> Store product with its own price; nothing when the addon or the package identity is missing', async () => {
  const { sc } = harness();
  const st = await sc.status();
  assert.equal(st.available, true);
  assert.equal(st.provider, 'Microsoft Store');
  assert.equal(st.plans.pro.price.formatted, '$4.99');
  assert.equal(st.plans.enterprise.price.formatted, '$28.99');
  assert.equal(st.plans.pro.available, true);
  assert.ok(!JSON.stringify(st).includes('Ticket'), 'never hands service tickets to the renderer');

  assert.equal((await harness({ bridgeOver: { available: false } }).sc.status()).available, false);
  assert.equal((await harness({ bridgeOver: { ping: { ok: true, packaged: false } } }).sc.status()).reason, 'no_package_identity');
  const missing = await harness({ bridgeOver: { products: { ok: true, products: [PRO] } } }).sc.status();
  assert.equal(missing.plans.enterprise.available, false, 'an add-on not yet published is not offered');
  const offline = await harness({ serverOver: { sessionError: netErr() } }).sc.status();
  assert.equal(offline.plans.pro.price.formatted, '$4.99', 'offline: the built-in Product ID map');
});

// ---- purchase ------------------------------------------------------------------------------------
test('purchase cancelled in Microsoft\'s dialog: nothing is reported or charged', async () => {
  const { sc, s, b } = harness({ bridgeOver: { purchase: { ok: true, status: 'NotPurchased' } } });
  assert.deepEqual(await sc.purchase('pro', '123'), { status: 'cancelled' });
  assert.equal(s.calls.filter((c) => c.fn === 'claim').length, 0);
  assert.deepEqual(b.calls.find((c) => c.cmd === 'purchase').opts, { storeId: '9NPRO0000001', hwnd: '123' });
});

test('purchase succeeded: the licence, the Store price and the purchase go to the server, then the lease', async () => {
  const exp = Date.now() + 30 * DAY;
  const h = harness({ bridgeOver: { license: { ok: true, addOns: [{ key: '9NPRO0000001/0010', skuStoreId: '9NPRO0000001/0010', inAppOfferToken: 'pro_monthly', isActive: true, expiresAtMs: exp }] } } });
  const r = await h.sc.purchase('pro', '77');
  assert.equal(r.status, 'active');
  assert.equal(r.tier, 'pro');
  assert.equal(r.purchased, 'Succeeded');
  const body = h.s.calls.find((c) => c.fn === 'claim').body;
  assert.equal(body.installId, 'inst-1');
  assert.equal(body.licenseRead, true);
  assert.deepEqual(body.addOns, [{ inAppOfferToken: 'pro_monthly', skuStoreId: '9NPRO0000001/0010', isActive: true, expiresAtMs: exp }]);
  assert.equal(body.prices.pro_monthly.formatted, '$4.99');
  assert.deepEqual(body.purchase, { productId: 'pro_monthly', status: 'Succeeded' });
  assert.equal(body.keys, undefined, 'no keys while the server cannot verify');
  assert.equal(body.move, false);
  assert.equal(h.leases(), 1);
  assert.equal(h.store[PENDING_SETTING], null);
});

test('when the server can verify, the app turns its tickets into Store ID keys and sends them', async () => {
  const session = { products: [{ productId: 'pro_monthly', plan: 'pro', tier: 'pro' }], verification: { mode: 'verified', collectionsTicket: 'ct', purchaseTicket: 'pt', publisherUserId: 'inst-1' } };
  const h = harness({ serverOver: { session, claim: { ok: true, mode: 'verified', verified: true, licensed: true, entitlements: [{ status: 'active' }] } } });
  const r = await h.sc.purchase('pro', '77');
  assert.equal(r.status, 'active');
  assert.equal(r.verified, true);
  assert.deepEqual(h.b.calls.find((c) => c.cmd === 'keys').opts, { collectionsTicket: 'ct', purchaseTicket: 'pt', publisherUserId: 'inst-1' });
  assert.deepEqual(h.s.calls.find((c) => c.fn === 'claim').body.keys, { collections: 'ckey-123456789012345678901', purchase: 'pkey-123456789012345678901' });
});

test('already owned: restores instead of buying again', async () => {
  const h = harness({ bridgeOver: { purchase: { ok: true, status: 'AlreadyPurchased' } } });
  const r = await h.sc.purchase('enterprise', '1');
  assert.equal(r.status, 'active');
  assert.equal(r.purchased, 'AlreadyPurchased');
});

test('Store network / server errors and a missing product are explained, not thrown', async () => {
  assert.deepEqual(await harness({ bridgeOver: { purchase: { ok: true, status: 'NetworkError' } } }).sc.purchase('pro', '1'), { status: 'error', code: 'store_network' });
  assert.equal((await harness({ bridgeOver: { purchase: { ok: true, status: 'ServerError', extendedError: '0x803F6107' } } }).sc.purchase('pro', '1')).code, 'store_server');
  assert.equal((await harness({ bridgeOver: { products: { ok: true, products: [PRO] } } }).sc.purchase('enterprise', '1')).code, 'store_product_missing');
  assert.equal((await harness().sc.purchase('pro', '')).code, 'no_window');
  assert.equal((await harness({ bridgeOver: { purchase: { ok: false, error: 'invalid_window', message: 'gone' } } }).sc.purchase('pro', '1')).code, 'invalid_window');
});

test('offline after paying: the claim is kept and sent by the next background sync', async () => {
  let online = false;
  const h = harness({ serverOver: { claimError: () => (online ? null : netErr()) } });
  const r = await h.sc.purchase('pro', '1');
  assert.equal(r.status, 'pending_offline');
  assert.deepEqual(h.store[PENDING_SETTING].purchase, { productId: 'pro_monthly', status: 'Succeeded' });
  online = true;
  const later = await h.sc.backgroundSync();
  assert.equal(later.status, 'active');
  assert.deepEqual(h.s.calls.filter((c) => c.fn === 'claim').pop().body.purchase, { productId: 'pro_monthly', status: 'Succeeded' }, 'the saved purchase goes with it');
  assert.equal(h.store[PENDING_SETTING], null);
});

test('in use on another computer -> move; move limit; not yet listed by Microsoft -> pending', async () => {
  const inUse = harness({ serverOver: { claimError: (body) => (body.move ? null : codeErr('store_in_use')) } });
  assert.equal((await inUse.sc.restore()).status, 'in_use');
  assert.equal((await inUse.sc.restore({ move: true })).status, 'active');
  assert.equal(inUse.s.calls.filter((c) => c.fn === 'claim').pop().body.move, true);
  assert.equal((await harness({ serverOver: { claimError: codeErr('store_move_limit', 429) } }).sc.restore({ move: true })).status, 'move_limit');
  const notYet = harness({ serverOver: { claimError: codeErr('store_not_owned', 404) } });
  assert.equal((await notYet.sc.purchase('pro', '1')).status, 'pending');
  assert.ok(notYet.store[PENDING_SETTING], 'kept for the next sync');
});

test('pending review, nothing to restore, and a lease not fetched yet', async () => {
  assert.equal((await harness({ serverOver: { claim: { ok: true, mode: 'pending_review', licensed: false, entitlements: [{ status: 'pending' }] } } }).sc.purchase('pro', '1')).status, 'pending_review');
  assert.equal((await harness({ serverOver: { claim: { ok: true, mode: 'unverified', licensed: false, entitlements: [] } } }).sc.restore()).status, 'none');
  assert.equal((await harness({ lease: null }).sc.restore()).status, 'pending');
  assert.equal((await harness({ lease: { tier: 'enterprise', type: 'trial' } }).sc.restore()).status, 'pending', 'a trial lease is not the purchase');
});

test('background sync: quiet without Store add-ons, at most every 6 hours, reports a past subscription', async () => {
  let t = 1_000_000;
  const quiet = harness({ now: () => t });
  assert.equal((await quiet.sc.backgroundSync()).status, 'none');
  assert.equal(quiet.s.calls.length, 0, 'no add-on and no history: the server is not called');
  assert.equal(await quiet.sc.backgroundSync(), null, 'within 6 hours: nothing');
  t += SYNC_EVERY_MS + 1;
  assert.equal((await quiet.sc.backgroundSync()).status, 'none');

  const had = harness({ settings: { [SYNC_SETTING]: { at: 0, hadEntitlement: true } }, serverOver: { claim: { ok: true, licensed: false, entitlements: [{ status: 'expired' }] } } });
  const r = await had.sc.backgroundSync();
  assert.equal(r.status, 'none');
  assert.equal(had.s.calls.filter((c) => c.fn === 'claim').length, 1, 'an ended subscription is still reported, so the server ends it');
  assert.equal(had.store[SYNC_SETTING].hadEntitlement, false);

  const mine = harness({ bridgeOver: { license: { ok: true, addOns: [{ inAppOfferToken: 'pro_monthly', isActive: true, expiresAtMs: Date.now() + DAY }] } } });
  assert.equal((await mine.sc.backgroundSync()).status, 'active', 'a reinstall finds its Store subscription by itself');
  assert.equal(await harness({ bridgeOver: { available: false } }).sc.backgroundSync(), null);
});

// ---- renderer --------------------------------------------------------------------------------------
test('renderer: each result maps to a message in en and es; Store prices only from the Store', async () => {
  const o = await loadOutcomes();
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'billing.json'));
  const es = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'es', 'billing.json'));
  const get = (obj, k) => k.split('.').reduce((c, p) => (c == null ? c : c[p]), obj);
  const statuses = ['active', 'cancelled', 'pending', 'pending_offline', 'pending_review', 'none', 'in_use', 'move_limit', 'unavailable', 'error'];
  for (const st of statuses) {
    const out = o.storeOutcome({ status: st, code: st === 'unavailable' ? 'store_product_missing' : undefined });
    assert.equal(typeof get(en, out.key), 'string', `en ${out.key}`);
    assert.equal(typeof get(es, out.key), 'string', `es ${out.key}`);
  }
  assert.equal(o.storeOutcome({ status: 'active', tier: 'enterprise' }).params.plan, 'Enterprise');
  assert.equal(o.storeOutcome({ status: 'active' }).done, true);
  assert.equal(o.storeOutcome({ status: 'pending' }).poll, true);
  assert.equal(o.storeOutcome({ status: 'in_use' }).canMove, true);
  assert.equal(o.storeOutcome({ status: 'error', code: 'store_network' }).key, 'store.result.network');
  assert.equal(o.storeOutcome(null).tone, 'error');

  const flat = (obj, p = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(flat(es.store).sort(), flat(en.store).sort(), 'es has every Store key');
  for (const k of flat(en.store)) {
    const vars = (s) => (String(s).match(/\{\{\w+\}\}/g) || []).sort().join();
    assert.equal(vars(get(es.store, k)), vars(get(en.store, k)), `placeholders of store.${k}`);
  }

  const info = { available: true, plans: { pro: { available: true, price: { formatted: 'PKR 1,399.00' } }, enterprise: { available: false, price: { formatted: '$1' } } } };
  assert.equal(o.storePrice(info, 'pro'), 'PKR 1,399.00');
  assert.equal(o.storePrice(info, 'enterprise'), null, 'not offered: no price');
  assert.equal(o.storePrice(null, 'pro'), null);
  assert.equal(o.storeDowngradeBlocked({ storeOnly: true, isPaid: true, currentTier: 'enterprise', planTier: 'pro' }), true);
  assert.equal(o.storeDowngradeBlocked({ storeOnly: false, isPaid: true, currentTier: 'enterprise', planTier: 'pro' }), false);
  assert.match(o.MANAGE_SUBSCRIPTIONS_URL, /^https:\/\/account\.microsoft\.com\//);

  // Every store.* key the pages use exists, and no Store price is written into them.
  for (const file of [['src', 'renderer', 'pages', 'BillingPage.jsx'], ['src', 'renderer', 'components', 'Gate.jsx']]) {
    const src = read(...file);
    for (const m of src.matchAll(/\bt[b]?\('(store\.[\w.]+)'/g)) assert.equal(typeof get(en, m[1]), 'string', `${file.at(-1)} uses ${m[1]}`);
    assert.ok(!/\$\s?(4\.99|5\.49|28\.99|29\.99)/.test(src), `${file.at(-1)}: no hard-coded Store price`);
    assert.match(src, /storePrice\(storeInfo/, `${file.at(-1)} shows the Store's own price`);
  }
});

// ---- builds ----------------------------------------------------------------------------------------
test('only the Store package ships the addon; website and base builds are unchanged', () => {
  const pkg = require('../package.json');
  assert.ok(!JSON.stringify(pkg.build).includes('store-native'), 'the website/base config never packs it');
  assert.ok(!JSON.stringify(pkg.build.files).includes('native'), 'the addon source is not in app.asar');
  const cfgPath = require.resolve('../electron-builder.store.js');
  const load = (v) => { delete require.cache[cfgPath]; const old = process.env.SG_STORE_COMMERCE; process.env.SG_STORE_COMMERCE = v; try { return require(cfgPath); } finally { if (old === undefined) delete process.env.SG_STORE_COMMERCE; else process.env.SG_STORE_COMMERCE = old; delete require.cache[cfgPath]; } };
  assert.deepEqual(load('0').extraResources, [], '--no-store-commerce');
  const addonBuilt = fs.existsSync(path.join(ROOT, 'dist_store_native', 'softglaze_store.node'));
  if (addonBuilt) assert.deepEqual(load('1').extraResources, [{ from: 'dist_store_native/softglaze_store.node', to: 'store-native/softglaze_store.node' }]);
  else assert.throws(() => load('1'), /build-store-native/, 'a Store build without the addon stops with a clear message');
  const bs = read('scripts', 'build-store.js');
  assert.match(bs, /run\('node scripts\/build-store-native\.js'\)/);
  assert.match(bs, /--no-store-commerce/);
  const main = read('src', 'main', 'ipcHandlers.js');
  // Listed only when the server has Store sales on and the Store returns the add-ons' prices (1.0.23).
  assert.match(main, /if \(offered\.storeSalesEnabled && storeBridge\.available\(\)\) \{/);
  assert.match(main, /if \(checkoutMethods\.storeHasPrices\(st\)\) methods\.unshift\(\{ id: STORE_METHOD_ID, label: 'Microsoft Store', kind: 'store' \}\)/);
  assert.match(read('src', 'main', 'storeBridge.js'), /process\.windowsStore === true/);
  const gyp = read('native', 'store-addon', 'binding.gyp');
  assert.match(gyp, /"target_name": "softglaze_store"/);
  assert.match(read('native', 'store-addon', 'store_addon.cpp'), /IInitializeWithWindow/);
});
