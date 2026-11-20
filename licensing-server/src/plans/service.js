'use strict';
// Plans are the single source of prices. GET /v1/plans/public serves the active ones (cached 60 s);
// every price or currency change is written to PlanPriceHistory, and the admin audit log records
// the whole change. Amounts are integers in minor units (cents): 2900 = US$29.00.
const { asJson } = require('../util/json');
const sales = require('./sales');

// The app's own limits per tier (src/main/tierPolicy.js), used when a plan has no limits of its own.
// profiles / aiActionsPerDay null = unlimited. Free (tier free, amount 0) is never sold and never gets a
// signed lease: the licence answer says { lease: null, free: true, limits } instead (src/routes/license.js).
const TIER_LIMITS = Object.freeze({
  free: Object.freeze({ seats: 1, maxParallel: 1, auditExport: false, profiles: 25, devices: 1, aiActionsPerDay: 25, sync: false, phoneControl: false, partnerDeals: true }),
  pro: Object.freeze({ seats: 3, maxParallel: 3, auditExport: false, profiles: null, devices: 3, aiActionsPerDay: null, sync: true, phoneControl: true, partnerDeals: false }),
  enterprise: Object.freeze({ seats: 25, maxParallel: 10, auditExport: true, profiles: null, devices: 10, aiActionsPerDay: null, sync: true, phoneControl: true, partnerDeals: false })
});
const TIERS = Object.keys(TIER_LIMITS);
// What GET /v1/plans/public answered before the Free plan (app 1.0.26 and older read this shape).
const LEGACY_LIMIT_KEYS = ['seats', 'maxParallel', 'auditExport'];
const LIMIT_KEYS = Object.keys(TIER_LIMITS.free);
const FREE_PLAN_KEY = 'free';
const INTERVALS = ['month', 'year', 'once'];
const CACHE_MS = 60000;
const cache = new Map();

function limitsOf(plan) {
  const own = asJson(plan.limits);
  const base = TIER_LIMITS[plan.tier] || TIER_LIMITS.pro;
  return own && typeof own === 'object' ? { ...base, ...own } : { ...base };
}

// A plan the checkout, the website and the admin's payment grant may sell: never Free, never US$0.
const isPurchasable = (plan) => Boolean(plan) && plan.tier !== 'free' && Number(plan.amount) > 0;

// The tenant's Free plan row (key "free", else any active plan of tier free), or null.
async function findFreePlan(db, tenantId) {
  const byKey = await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: FREE_PLAN_KEY } } });
  if (byKey && byKey.tier === 'free') return byKey;
  return db.plan.findFirst({ where: { tenantId, tier: 'free', active: true }, orderBy: { sortOrder: 'asc' } });
}

// The effective Free limits of a tenant: its Free plan row, else the built-in ones.
async function freeLimits(db, tenantId) {
  const row = await findFreePlan(db, tenantId).catch(() => null);
  return row ? limitsOf(row) : { ...TIER_LIMITS.free };
}

// legacy: only the limit keys app 1.0.26 knew (seats, maxParallel, auditExport).
function publicPlan(p, { legacy = false } = {}) {
  const limits = limitsOf(p);
  if (legacy) for (const k of Object.keys(limits)) if (!LEGACY_LIMIT_KEYS.includes(k)) delete limits[k];
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
    limits
  };
}

const byDisplayOrder = (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.amount - b.amount || a.key.localeCompare(b.key);

// includeFree false (the default, and what app 1.0.26 gets): exactly the answer from before the Free plan,
// so an old app never shows a US$0 plan as a card to buy. includeFree true (app 1.0.27+, the website): the
// Free plan(s) first, then the others, with every limit key.
async function getPublicPlans(db, tenantId, now = Date.now(), { includeFree = false } = {}) {
  const ck = `${tenantId}|${includeFree ? 'free' : 'paid'}`;
  const hit = cache.get(ck);
  if (hit && now - hit.at < CACHE_MS) return hit.plans;
  const rows = await db.plan.findMany({ where: { tenantId, active: true } });
  const free = rows.filter((p) => p.tier === 'free').sort(byDisplayOrder);
  const paid = rows.filter((p) => p.tier !== 'free').sort(byDisplayOrder);
  const plans = includeFree
    ? [...free, ...paid].map((p) => publicPlan(p))
    : paid.map((p) => publicPlan(p, { legacy: true }));
  cache.set(ck, { at: now, plans });
  return plans;
}

function invalidatePublicPlans(tenantId) {
  cache.delete(`${tenantId}|free`);
  cache.delete(`${tenantId}|paid`);
}

const intIn = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const nullableCount = (v) => v === null || intIn(0, 1000000)(v);
const LIMIT_RULES = {
  seats: intIn(1, 10000),
  maxParallel: intIn(1, 100),
  auditExport: (v) => typeof v === 'boolean',
  profiles: nullableCount,
  devices: intIn(1, 1000),
  aiActionsPerDay: nullableCount,
  sync: (v) => typeof v === 'boolean',
  phoneControl: (v) => typeof v === 'boolean',
  partnerDeals: (v) => typeof v === 'boolean'
};
const validLimits = (l) => Object.entries(l).every(([k, v]) => Object.prototype.hasOwnProperty.call(LIMIT_RULES, k) && LIMIT_RULES[k](v));

// -> { data, errors }. partial: only validate what is present (PATCH). current: the stored plan (PATCH), so the
// free / amount rule is checked against the plan as it will be.
function validatePlan(b, { partial = false, current = null } = {}) {
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
    if (!TIERS.includes(t)) errors.tier = 'free, pro or enterprise'; else data.tier = t;
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
    // 1-120, or LIFETIME_MONTHS (1200) for a lifetime plan (interval once): src/plans/sales.js.
    if (!Number.isInteger(m) || ((m < 1 || m > 120) && m !== sales.LIFETIME_MONTHS)) errors.months = `integer 1-120, or ${sales.LIFETIME_MONTHS} for lifetime (interval once)`; else data.months = m;
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
    const ok = l === null || (l && typeof l === 'object' && !Array.isArray(l) && validLimits(l));
    if (!ok) {
      errors.limits = '{ seats: 1-10000, maxParallel: 1-100, auditExport: boolean, profiles: integer >= 0 or null, devices: 1-1000, '
        + 'aiActionsPerDay: integer >= 0 or null, sync: boolean, phoneControl: boolean, partnerDeals: boolean } or null';
    } else data.limits = l;
  }
  // A Free plan costs nothing and is not a subscription. (A US$0 plan of a paid tier can be saved, but
  // the checkout refuses to sell it: isPurchasable.)
  const tier = data.tier !== undefined ? data.tier : current && current.tier;
  const amount = data.amount !== undefined ? data.amount : current && current.amount;
  const recurring = data.recurring !== undefined ? data.recurring : current && current.recurring;
  if (!errors.tier && !errors.amount && tier === 'free' && amount != null && amount !== 0) errors.amount = 'a free plan has amount 0';
  if (tier === 'free' && recurring === true) errors.recurring = 'a free plan is not a subscription';
  sales.validateSaleFields(b, data, errors);
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
  sales.invalidateOffers(tenantId);
  return { plan, before };
}

// The Free plan row every tenant has (migration 20261120120000 seeds it for the existing tenants; the
// provisioning script calls this for new ones). Never changes a Free plan that already exists.
const FREE_PLAN_FEATURES = Object.freeze([
  '25 browser profiles, 1 running at a time',
  'All fingerprint settings and your own proxies',
  'Phone and web app to view profiles and approve AI requests',
  '25 AI actions per day',
  'Free proxies page',
  'Help centre support'
]);
async function ensureFreePlan(db, tenantId) {
  const exists = await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: FREE_PLAN_KEY } } });
  if (exists) return { plan: exists, created: false };
  try {
    const plan = await db.plan.create({
      data: {
        tenantId, key: FREE_PLAN_KEY, name: 'Free', tier: 'free', amount: 0, currency: 'USD', interval: 'month', months: 1,
        recurring: false, active: true, highlight: false, sortOrder: -100, features: [...FREE_PLAN_FEATURES], limits: { ...TIER_LIMITS.free }
      }
    });
    invalidatePublicPlans(tenantId);
    return { plan, created: true };
  } catch (e) {
    if (!e || e.code !== 'P2002') throw e;
    return { plan: await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: FREE_PLAN_KEY } } }), created: false };
  }
}

module.exports = {
  TIER_LIMITS, TIERS, LIMIT_KEYS, LEGACY_LIMIT_KEYS, FREE_PLAN_KEY, FREE_PLAN_FEATURES,
  publicPlan, limitsOf, isPurchasable, findFreePlan, freeLimits, getPublicPlans, invalidatePublicPlans,
  validatePlan, upsertPlan, recordPrice, ensureFreePlan
};
