'use strict';
// Plans and prices in tenant (sellable) builds come from the licensing server, GET /v1/plans/public
// (spec A4), so a price changed in the admin shows in the app without a new release. The list is
// cached for an hour. When it cannot be fetched, the last good list from this run is used, else the
// built-in catalog (ipcHandlers' DEFAULT_BILLING_PLANS). No other price is ever shown. Pure apart
// from the injected fetch, so tests use a fake.

const CACHE_MS = 60 * 60 * 1000;
// After a failed fetch (offline), wait this long before trying again so pages don't stall on it.
const RETRY_MS = 60 * 1000;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// The server's Plan.amount is in minor units (cents). amountCents wins when sent; a decimal string
// ("29.00") is read as a major-unit price. Returns a display string ("29", "19.99") or null.
function majorAmount(p) {
  let n;
  if (p.amountCents != null && p.amountCents !== '') n = Number(p.amountCents) / 100;
  else if (typeof p.amount === 'string' && p.amount.includes('.')) n = Number.parseFloat(p.amount);
  else if (p.amount != null && p.amount !== '') n = Number(p.amount) / 100;
  else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  return String(Math.round(n * 100) / 100);
}

function periodLabel(interval, months) {
  const i = String(interval || '').toLowerCase();
  if (/^(year|annual)/.test(i) || months === 12) return 'year';
  if (/^week/.test(i)) return 'week';
  if (months > 1) return `${months} months`;
  return 'month';
}

function normalizeLimits(l) {
  if (!l || typeof l !== 'object') return null;
  const int = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null);
  return { seats: int(l.seats), maxParallel: int(l.maxParallel), auditExport: Boolean(l.auditExport) };
}

const isTrialPlan = (p, key) => String(p.kind || '').toLowerCase() === 'trial'
  || String(p.tier || '').toLowerCase() === 'trial'
  || /^(free-)?trial$/i.test(key);

// One server plan -> the app's plan shape (the same fields BillingPage and the Gate read), or null.
function normalizeServerPlan(p) {
  if (!p || typeof p !== 'object' || p.active === false) return null;
  const key = String(p.key || '').trim();
  if (!KEY_RE.test(key)) return null;
  const name = String(p.name || '').trim().slice(0, 60);
  if (!name) return null;
  const trial = isTrialPlan(p, key);
  const amount = trial ? '0' : majorAmount(p);
  if (amount == null) return null;
  const months = Math.max(1, Number.parseInt(p.months, 10) || 1);
  const features = Array.isArray(p.features)
    ? p.features.map((f) => String(f == null ? '' : f).trim().slice(0, 200)).filter(Boolean).slice(0, 30)
    : [];
  const limits = normalizeLimits(p.limits);
  return {
    // The key is sent back to the server at checkout, so it keeps its exact spelling.
    id: key,
    tier: trial || String(p.tier || '').toLowerCase() === 'enterprise' ? 'enterprise' : 'pro',
    kind: trial ? 'trial' : 'paid',
    trialDays: Math.max(1, Number.parseInt(p.trialDays, 10) || 7),
    name,
    amount,
    currency: String(p.currency || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'USD',
    months,
    // How the server bills it ('month', 'year'): the Billing page groups plans by it (planPeriods.mjs).
    interval: trial ? null : (periodLabel(p.interval, months) === 'year' ? 'year' : String(p.interval || 'month').toLowerCase().slice(0, 16)),
    period: trial ? `${Math.max(1, Number.parseInt(p.trialDays, 10) || 7)} days` : periodLabel(p.interval, months),
    tagline: String(p.tagline || p.description || '').slice(0, 200),
    highlight: Boolean(p.highlight),
    active: true,
    features,
    ...(limits ? { limits } : {}),
    source: 'server'
  };
}

// The server list (an array, or { plans: [...] }) -> app plans with the trial card first, or null
// when it holds no usable paid plan. The trial card is the built-in one when the server lists none.
function plansFromServer(raw, fallbackPlans) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.plans) ? raw.plans : null);
  if (!list) return null;
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const n = normalizeServerPlan(p);
    if (!n || seen.has(n.id.toLowerCase())) continue;
    seen.add(n.id.toLowerCase());
    out.push(n);
  }
  const paid = out.filter((p) => p.kind === 'paid');
  if (!paid.length) return null;
  const trial = out.find((p) => p.kind === 'trial')
    || (Array.isArray(fallbackPlans) ? fallbackPlans.find((p) => p && p.kind === 'trial') : null)
    || null;
  return trial ? [trial, ...paid] : paid;
}

// get({ fallback }) -> { plans, source: 'server' | 'stale' | 'fallback', fetchedAt }.
function createPlanCatalog({ fetchPlans, now = () => Date.now(), ttlMs = CACHE_MS, retryMs = RETRY_MS } = {}) {
  let good = null; // { plans, at }
  let failedAt = null;
  let inflight = null;

  async function refresh(fallback) {
    try {
      const plans = plansFromServer(await fetchPlans(), fallback);
      if (plans) { good = { plans, at: now() }; failedAt = null; return; }
      failedAt = now();
    } catch (_) { failedAt = now(); }
  }

  async function get({ fallback = [] } = {}) {
    const t = now();
    const fresh = good && t - good.at < ttlMs;
    const resting = failedAt !== null && t - failedAt < retryMs;
    if (!fresh && !resting) {
      if (!inflight) inflight = refresh(fallback).finally(() => { inflight = null; });
      await inflight;
    }
    if (good) return { plans: good.plans, source: now() - good.at < ttlMs ? 'server' : 'stale', fetchedAt: good.at };
    return { plans: Array.isArray(fallback) ? fallback : [], source: 'fallback', fetchedAt: null };
  }

  function clear() { good = null; failedAt = null; }

  return { get, clear };
}

module.exports = { CACHE_MS, RETRY_MS, majorAmount, normalizeServerPlan, plansFromServer, createPlanCatalog };
