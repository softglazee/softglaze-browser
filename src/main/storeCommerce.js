'use strict';
// Microsoft Store purchases for the Store build (Pro and Enterprise as subscription add-ons).
//
//   buy:     Microsoft's purchase dialog (addon "purchase", owner window = the app window)
//   claim:   read the add-on licences on this PC (addon "license"), make Store ID keys from our
//            server's service tickets when it can verify (addon "keys"), and report all of it to the
//            licensing server (POST /v1/store/claim). The server checks it with the Microsoft Store,
//            records the entitlement and the payment, and the normal signed lease follows from
//            /v1/license, so tierPolicy and the offline grace work exactly as for any paid licence.
//   restore: the same claim, started by the customer (or with move: true to take the subscription
//            over from another computer).
//   sync:    on start and every 6 hours, re-report when there is something to report, so renewals,
//            cancellations and refunds reach the server even before it can verify by itself.
//
// Every dependency is injected (the addon bridge, the server calls, settings, the lease refresh), so
// tests drive it with fakes and no real purchase is ever made. Results are plain objects with a
// `status` the renderer turns into a message (src/renderer/lib/storePurchase.mjs).

// Used when the licensing server cannot be reached; the server's settings.store.productPlans wins.
const DEFAULT_PRODUCTS = Object.freeze({ pro: 'pro_monthly', enterprise: 'enterprise_monthly' });
const SESSION_TTL_MS = 10 * 60000; // service tickets live about an hour
const PRODUCTS_TTL_MS = 60 * 60000;
const SYNC_EVERY_MS = 6 * 3600000;
const PENDING_SETTING = 'storePendingClaim';
const SYNC_SETTING = 'storeLastSync';
const GRANTING = new Set(['active', 'grace']);

function fallbackSession() {
  return {
    products: Object.entries(DEFAULT_PRODUCTS).map(([plan, productId]) => ({ productId, plan, tier: plan })),
    verification: { mode: 'offline' },
    offline: true
  };
}

// The price to show and record: the subscription SKU's per-period price (a SKU with a free trial comes
// first when there is one, so prefer the SKU without it), else the product price.
function priceOf(product) {
  if (!product) return null;
  const skus = Array.isArray(product.skus) ? product.skus : [];
  const sku = skus.find((s) => s && s.isSubscription && !(s.subscription && s.subscription.hasTrialPeriod))
    || skus.find((s) => s && s.isSubscription) || null;
  const p = (sku && sku.price) || product.price || {};
  const formatted = String(p.formattedRecurrence || p.formatted || '').trim();
  if (!formatted) return null;
  const sub = sku && sku.subscription ? sku.subscription : null;
  return {
    formatted,
    formattedRecurrence: String(p.formattedRecurrence || ''),
    currencyCode: String(p.currencyCode || ''),
    period: sub ? { count: Number(sub.billingPeriod) || 1, unit: String(sub.billingPeriodUnit || 'month') } : null,
    storeTrial: Boolean(sub && sub.hasTrialPeriod)
  };
}

const isNetworkError = (e) => Boolean(e && (e.network === true || /timed out/i.test(String(e.message || ''))));

function createStoreCommerce(deps) {
  const { bridge, server, ensureInstall, refreshLease, readSetting, writeSetting } = deps;
  const now = deps.now || Date.now;
  let sessionCache = null;
  let productsCache = null;

  async function getSession(install, { fresh = false } = {}) {
    if (!fresh && sessionCache && now() - sessionCache.at < SESSION_TTL_MS) return sessionCache.value;
    const value = await server.session(install);
    if (!value || !Array.isArray(value.products)) throw new Error('The licensing server sent an unexpected Store session.');
    sessionCache = { at: now(), value };
    return value;
  }

  async function storeProducts({ fresh = false } = {}) {
    if (!fresh && productsCache && productsCache.ok && now() - productsCache.at < PRODUCTS_TTL_MS) return productsCache;
    const r = await bridge.call('products', {});
    if (!r || r.ok !== true) return { ok: false, error: (r && r.error) || 'store_error', list: productsCache ? productsCache.list : [] };
    productsCache = { ok: true, at: now(), list: Array.isArray(r.products) ? r.products : [] };
    return productsCache;
  }

  async function savePending(purchase) {
    await writeSetting(PENDING_SETTING, { at: now(), purchase: purchase || null }).catch(() => {});
  }

  async function installOrNull() {
    try { return (await ensureInstall()) || null; } catch (_) { return null; }
  }

  // What the Billing page and the sign-in gate show: is buying possible, and each plan's Store price.
  async function status() {
    if (!bridge.available()) return { available: false, reason: bridge.isStoreInstall() ? 'addon_unavailable' : 'not_store_build' };
    const ping = await bridge.call('ping', {});
    if (!ping.ok || !ping.packaged) return { available: false, reason: 'no_package_identity' };
    const install = await installOrNull();
    let s = fallbackSession();
    if (install) { try { s = await getSession(install); } catch (_) { s = fallbackSession(); } }
    const prod = await storeProducts();
    const plans = {};
    for (const m of s.products) {
      const p = prod.list.find((x) => x && x.inAppOfferToken === m.productId) || null;
      plans[m.plan] = { productId: m.productId, tier: m.tier, available: Boolean(p && p.storeId), title: p ? p.title || null : null, price: priceOf(p) };
    }
    return {
      available: true,
      provider: 'Microsoft Store',
      plans,
      verification: (s.verification && s.verification.mode) || 'unknown',
      productsError: prod.ok ? null : prod.error
    };
  }

  async function claim({ move = false, purchase = null } = {}) {
    if (!bridge.available()) return { status: 'unavailable', code: 'not_store_build' };
    const install = await installOrNull();
    if (!install) { await savePending(purchase); return { status: 'pending_offline' }; }

    const lic = await bridge.call('license', {});
    let s = null;
    try {
      s = await getSession(install, { fresh: true });
    } catch (e) {
      if (isNetworkError(e) || (e && e.status >= 500)) { await savePending(purchase); return { status: 'pending_offline' }; }
      s = fallbackSession();
    }

    let keys = null;
    const v = s.verification || {};
    if (v.mode === 'verified' && v.collectionsTicket && v.purchaseTicket) {
      const k = await bridge.call('keys', { collectionsTicket: v.collectionsTicket, purchaseTicket: v.purchaseTicket, publisherUserId: String(v.publisherUserId || install.installId) });
      if (k.ok && k.collectionsKey && k.purchaseKey) keys = { collections: k.collectionsKey, purchase: k.purchaseKey };
    }

    const prod = await storeProducts();
    const prices = {};
    for (const m of s.products) {
      const price = priceOf(prod.list.find((x) => x && x.inAppOfferToken === m.productId));
      if (price) prices[m.productId] = { formatted: price.formatted, formattedRecurrence: price.formattedRecurrence, currencyCode: price.currencyCode };
    }

    const body = {
      installId: install.installId,
      installSecret: install.installSecret,
      licenseRead: lic.ok === true,
      addOns: lic.ok === true && Array.isArray(lic.addOns)
        ? lic.addOns.map((a) => ({ inAppOfferToken: a.inAppOfferToken, skuStoreId: a.skuStoreId, isActive: a.isActive, expiresAtMs: a.expiresAtMs }))
        : [],
      prices,
      ...(keys ? { keys } : {}),
      ...(purchase ? { purchase } : {}),
      move: move === true
    };

    let res;
    try {
      res = await server.claim(body);
    } catch (e) {
      if (isNetworkError(e) || (e && e.status >= 500)) { await savePending(purchase); return { status: 'pending_offline' }; }
      const code = e && e.code;
      if (code === 'store_in_use') return { status: 'in_use' };
      if (code === 'store_move_limit') return { status: 'move_limit' };
      if (code === 'store_not_owned') { if (purchase) await savePending(purchase); return { status: 'pending', code }; }
      return { status: 'error', code: code || 'server_error', message: e && e.message ? String(e.message) : '' };
    }

    const ents = Array.isArray(res && res.entitlements) ? res.entitlements : [];
    await writeSetting(PENDING_SETTING, null).catch(() => {});
    await writeSetting(SYNC_SETTING, { at: now(), hadEntitlement: ents.some((e) => GRANTING.has(e.status)) }).catch(() => {});

    const ent = res && res.licensed ? await refreshLease() : null;
    if (res && res.licensed && ent && ent.type !== 'trial') return { status: 'active', tier: ent.tier, verified: Boolean(res.verified), mode: res.mode };
    if (ents.some((e) => e.status === 'pending')) return { status: 'pending_review' };
    if (res && res.licensed) return { status: 'pending' }; // licensed on the server, lease not fetched yet
    if (purchase) { await savePending(purchase); return { status: 'pending' }; }
    return { status: 'none', mode: res ? res.mode : null };
  }

  async function purchase(planKey, hwnd) {
    const st = await status();
    if (!st.available) return { status: 'unavailable', code: st.reason };
    const plan = st.plans[String(planKey || '').toLowerCase()];
    if (!plan || !plan.available) return { status: 'unavailable', code: 'store_product_missing' };
    if (!hwnd) return { status: 'error', code: 'no_window' };
    // The addon needs the add-on's Store ID; it is in the product list read by status().
    const prod = await storeProducts();
    const product = prod.list.find((x) => x && x.inAppOfferToken === plan.productId);
    if (!product || !product.storeId) return { status: 'unavailable', code: 'store_product_missing' };
    const r = await bridge.call('purchase', { storeId: product.storeId, hwnd: String(hwnd) });
    if (!r.ok) return { status: 'error', code: r.error || 'store_error', message: r.message || '' };
    switch (r.status) {
      case 'NotPurchased': return { status: 'cancelled' };
      case 'NetworkError': return { status: 'error', code: 'store_network' };
      case 'ServerError': return { status: 'error', code: 'store_server', message: r.extendedError || '' };
      case 'Succeeded':
      case 'AlreadyPurchased': {
        productsCache = null;
        const c = await claim({ purchase: { productId: plan.productId, status: r.status } });
        return { ...c, purchased: r.status };
      }
      default: return { status: 'error', code: 'store_unknown' };
    }
  }

  // Start-up and every 6 hours. Talks to the server only when there is something to report: a claim
  // that could not be sent, a Store add-on on this PC, or a Store subscription we had before (so its
  // end, cancellation or refund reaches the server).
  async function backgroundSync({ force = false } = {}) {
    if (!bridge.available()) return null;
    const pending = await readSetting(PENDING_SETTING, null).catch(() => null);
    const last = await readSetting(SYNC_SETTING, null).catch(() => null);
    if (!force && !pending && last && now() - Number(last.at || 0) < SYNC_EVERY_MS) return null;
    if (!pending && !(last && last.hadEntitlement)) {
      const lic = await bridge.call('license', {});
      const known = new Set(((sessionCache && sessionCache.value.products) || fallbackSession().products).map((p) => p.productId));
      const mine = lic.ok === true && Array.isArray(lic.addOns) && lic.addOns.some((a) => known.has(a.inAppOfferToken));
      if (!mine) {
        if (lic.ok === true) await writeSetting(SYNC_SETTING, { at: now(), hadEntitlement: false }).catch(() => {});
        return { status: 'none' };
      }
    }
    return claim({ purchase: pending && pending.purchase ? pending.purchase : null });
  }

  return { status, purchase, claim, restore: (opts = {}) => claim({ move: opts.move === true }), backgroundSync };
}

// The two licensing-server calls, through licenseClient (same base URL, tenant and machine hash).
function createServerClient(licenseClient, tenantConfig) {
  const base = () => ({ tenantId: tenantConfig().tenantId, machineHash: licenseClient.machineHash(), appVersion: licenseClient.appVersion() });
  return {
    session: ({ installId, installSecret }) => licenseClient.postJson('/v1/store/session', { ...base(), installId, installSecret }),
    claim: (body) => licenseClient.postJson('/v1/store/claim', { ...base(), ...body })
  };
}

module.exports = { createStoreCommerce, createServerClient, priceOf, DEFAULT_PRODUCTS, PENDING_SETTING, SYNC_SETTING, SYNC_EVERY_MS };
