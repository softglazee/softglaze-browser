'use strict';
// Plans are the single source of prices. GET /v1/plans/public serves the active ones (cached 60 s);
// every price or currency change is written to PlanPriceHistory, and the admin audit log records
// the whole change. Amounts are integers in minor units (cents): 2900 = US$29.00.
const { asJson } = require('../util/json');

// The app's own limits per tier (src/main/tierPolicy.js), used when a plan has no limits of its own.
const TIER_LIMITS = Object.freeze({
  pro: Object.freeze({ seats: 3, maxParallel: 3, auditExport: false }),
  enterprise: Object.freeze({ seats: 25, maxParallel: 10, auditExport: true })
});
const INTERVALS = ['month', 'year', 'once'];
const CACHE_MS = 60000;
const cache = new Map();

function limitsOf(plan) {
  const own = asJson(plan.limits);
  const base = TIER_LIMITS[plan.tier] || TIER_LIMITS.pro;
  return own && typeof own === 'object' ? { ...base, ...own } : { ...base };
}

function publicPlan(p) {
  return {
    key: p.key,
    name: p.name,
    tier: p.tier,
    amount: p.amount,
    amountDecimal: (p.amount / 100).toFixed(2),
    currency: p.currency,
    interval: p.interval,
    months: p.months,
    highlight: Boolean(p.highlight),
    features: asJson(p.features) || [],
    limits: limitsOf(p)
  };
}

const byDisplayOrder = (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.amount - b.amount || a.key.localeCompare(b.key);

async function getPublicPlans(db, tenantId, now = Date.now()) {
  const hit = cache.get(tenantId);
  if (hit && now - hit.at < CACHE_MS) return hit.plans;
  const rows = await db.plan.findMany({ where: { tenantId, active: true } });
  const plans = rows.sort(byDisplayOrder).map(publicPlan);
  cache.set(tenantId, { at: now, plans });
  return plans;
}

function invalidatePublicPlans(tenantId) { cache.delete(tenantId); }

// -> { data, errors }. partial: only validate what is present (PATCH).
function validatePlan(b, { partial = false } = {}) {
  const errors = {};
  const data = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has('key')) {
    if (typeof b.key !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(b.key)) errors.key = 'expected 1-40 lowercase letters, digits, - or _';
    else data.key = b.key;
  }
  if (!partial || has('name')) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80) errors.name = 'required, at most 80 characters';
    else data.name = b.name.trim();
  }
  if (!partial || has('amount')) {
    if (!Number.isInteger(b.amount) || b.amount < 0 || b.amount > 100000000) errors.amount = 'integer minor units (cents), 0 to 100000000';
    else data.amount = b.amount;
  }
  if (has('tier') || !partial) {
    const t = b.tier === undefined ? 'pro' : b.tier;
    if (!['pro', 'enterprise'].includes(t)) errors.tier = 'pro or enterprise'; else data.tier = t;
  }
  if (has('currency') || !partial) {
    const c = b.currency === undefined ? 'USD' : String(b.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) errors.currency = 'ISO 4217 code, e.g. USD'; else data.currency = c;
  }
  if (has('interval') || !partial) {
    const i = b.interval === undefined ? 'month' : b.interval;
    if (!INTERVALS.includes(i)) errors.interval = INTERVALS.join(' | '); else data.interval = i;
  }
  if (has('months') || !partial) {
    const m = b.months === undefined ? 1 : b.months;
    if (!Number.isInteger(m) || m < 1 || m > 120) errors.months = 'integer 1-120'; else data.months = m;
  }
  for (const k of ['recurring', 'active', 'highlight']) {
    if (has(k)) { if (typeof b[k] !== 'boolean') errors[k] = 'boolean'; else data[k] = b[k]; }
    else if (!partial) data[k] = k === 'active';
  }
  if (has('sortOrder')) { if (!Number.isInteger(b.sortOrder) || Math.abs(b.sortOrder) > 10000) errors.sortOrder = 'integer'; else data.sortOrder = b.sortOrder; }
  if (has('description')) {
    if (b.description !== null && (typeof b.description !== 'string' || b.description.length > 2000)) errors.description = 'string, at most 2000 characters';
    else data.description = b.description;
  }
  if (has('features')) {
    if (b.features !== null && !(Array.isArray(b.features) && b.features.length <= 30 && b.features.every((f) => typeof f === 'string' && f.trim() && f.length <= 160))) {
      errors.features = 'array of up to 30 strings (160 characters each)';
    } else data.features = b.features ? b.features.map((f) => f.trim()) : null;
  }
  if (has('limits')) {
    const l = b.limits;
    const ok = l === null || (l && typeof l === 'object' && !Array.isArray(l)
      && Object.keys(l).every((k) => ['seats', 'maxParallel', 'auditExport'].includes(k))
      && (l.seats === undefined || (Number.isInteger(l.seats) && l.seats >= 1 && l.seats <= 10000))
      && (l.maxParallel === undefined || (Number.isInteger(l.maxParallel) && l.maxParallel >= 1 && l.maxParallel <= 100))
      && (l.auditExport === undefined || typeof l.auditExport === 'boolean'));
    if (!ok) errors.limits = '{ seats: 1-10000, maxParallel: 1-100, auditExport: boolean } or null'; else data.limits = l;
  }
  return { data, errors: Object.keys(errors).length ? errors : null };
}

async function recordPrice(db, tenantId, planKey, before, after, actor, note) {
  if (before && before.amount === after.amount && before.currency === after.currency) return;
  await db.planPriceHistory.create({
    data: {
      tenantId, planKey, oldAmount: before ? before.amount : null, newAmount: after.amount,
      oldCurrency: before ? before.currency : null, newCurrency: after.currency, changedBy: actor || null, note: note || null
    }
  });
}

// Create or update by key (used by POST /v1/tenant/plans, the owner's scripts, and the admin API).
async function upsertPlan(db, tenantId, data, { actor, note } = {}) {
  const before = await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: data.key } } });
  const { key, ...rest } = data;
  const plan = before
    ? await db.plan.update({ where: { id: before.id }, data: rest })
    : await db.plan.create({ data: { tenantId, key, ...rest } });
  await recordPrice(db, tenantId, key, before, plan, actor, note);
  invalidatePublicPlans(tenantId);
  return { plan, before };
}

module.exports = { TIER_LIMITS, publicPlan, limitsOf, getPublicPlans, invalidatePublicPlans, validatePlan, upsertPlan, recordPrice };
