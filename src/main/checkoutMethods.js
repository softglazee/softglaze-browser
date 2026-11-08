'use strict';
// Which payment methods a tenant (sellable) build offers, from the licensing server
// (GET /v1/checkout/methods, 1.0.23+): the website payment providers switched on for this tenant, with
// the server's name for each, and whether Microsoft Store sales are on. So a provider the owner turns on
// later (2Checkout, Paddle, Payoneer, ...) appears without a new app version: the server's checkout
// answers with a URL the app opens, whatever the provider is.
// Cached like the plan catalog (planCatalog.js). When the server cannot be reached the last good answer
// from this run is used, else the providers baked into the build (tenantConfig().checkoutProviders) with
// Store sales off. Pure apart from the injected fetch, so tests use a fake.

const CACHE_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
// Provider ids as the server writes them; the Store and manual methods are never website checkouts.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NOT_CHECKOUT = new Set(['microsoft_store', 'manual', 'wise', 'bank']);
const MAX_PROVIDERS = 20;

function cleanLabel(v, fallback) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return s || fallback;
}

// The server answer -> { providers: [{ id, label, kind: 'automated' }], storeSalesEnabled } or null when
// it is not that shape (then the caller keeps what it had).
function normalizeMethods(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.providers)) return null;
  const providers = [];
  for (const p of raw.providers) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '').trim().toLowerCase();
    if (!ID_RE.test(id) || NOT_CHECKOUT.has(id) || providers.some((x) => x.id === id)) continue;
    // Every website provider is a hosted checkout the app opens; anything else is not offered here.
    if (p.kind !== undefined && p.kind !== 'automated') continue;
    providers.push({ id, label: cleanLabel(p.label, id), kind: 'automated' });
    if (providers.length >= MAX_PROVIDERS) break;
  }
  const store = raw.store && typeof raw.store === 'object' ? raw.store : {};
  return { providers, storeSalesEnabled: store.salesEnabled === true };
}

// The baked list as methods (labels from the app's own provider list), Store sales off.
function fallbackMethods(ids, labelFor = (id) => id) {
  const providers = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw || '').trim().toLowerCase();
    if (!ID_RE.test(id) || NOT_CHECKOUT.has(id) || providers.some((x) => x.id === id)) continue;
    providers.push({ id, label: cleanLabel(labelFor(id), id), kind: 'automated' });
  }
  return { providers, storeSalesEnabled: false };
}

// get({ fallback }) -> { providers, storeSalesEnabled, source: 'server' | 'stale' | 'fallback', fetchedAt }
function createCheckoutCatalog({ fetchMethods, now = () => Date.now(), ttlMs = CACHE_MS, retryMs = RETRY_MS } = {}) {
  let good = null; // { value, at }
  let failedAt = null;
  let inflight = null;

  async function refresh() {
    try {
      const value = normalizeMethods(await fetchMethods());
      if (value) { good = { value, at: now() }; failedAt = null; return; }
      failedAt = now();
    } catch (_) { failedAt = now(); }
  }

  async function get({ fallback = { providers: [], storeSalesEnabled: false } } = {}) {
    const t = now();
    const fresh = good && t - good.at < ttlMs;
    const resting = failedAt !== null && t - failedAt < retryMs;
    if (!fresh && !resting) {
      if (!inflight) inflight = refresh().finally(() => { inflight = null; });
      await inflight;
    }
    if (good) return { ...good.value, source: now() - good.at < ttlMs ? 'server' : 'stale', fetchedAt: good.at };
    const fb = fallback && Array.isArray(fallback.providers) ? fallback : { providers: [], storeSalesEnabled: false };
    return { providers: fb.providers, storeSalesEnabled: false, source: 'fallback', fetchedAt: null };
  }

  function clear() { good = null; failedAt = null; }

  return { get, clear };
}

// Does the Store status (storeCommerce.status()) carry a price for at least one plan? Without prices
// the add-ons are not set up in Partner Center yet, so the Store method stays hidden.
function storeHasPrices(status) {
  if (!status || status.available !== true || !status.plans || typeof status.plans !== 'object') return false;
  return Object.values(status.plans).some((p) => p && p.available && p.price && p.price.formatted);
}

module.exports = { CACHE_MS, RETRY_MS, normalizeMethods, fallbackMethods, createCheckoutCatalog, storeHasPrices };
