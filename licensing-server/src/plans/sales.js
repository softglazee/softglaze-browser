'use strict';
// Lifetime plans, sale windows and sales caps (Black Friday 2026 and later offers).
//
// Lifetime: a one-time plan (interval 'once') with months = LIFETIME_MONTHS (1200 = 100 years of
//   termDays, so the licence runs to about 2126). It is never offered by GET /v1/plans/public unless the
//   caller asks with include=lifetime (app 1.0.26 and older would show it as "1200 months"), it is left
//   out of MRR (src/metrics/maths.js), and the admin payment grant accepts 1200 months for it.
// Sale window: Plan.saleStartsAt / saleEndsAt (UTC, either may be null). Outside the window a checkout
//   and an admin payment for the plan are refused (the admin can override, audited).
// Cap: Plan.saleCap = how many may be sold. Sold = the plan's Payment rows with status 'paid', from every
//   route (website card, app checkout, invoice recorded in the admin, Microsoft Store). A refund frees
//   its place. A website or app checkout that is still pending holds a place for HOLD_MS, so two buyers
//   cannot both take the last licence while one of them is on the payment page. A payment that settles
//   after the cap was reached is still honoured (the buyer paid); only new checkouts are refused.
// GET /v1/plans/offers (src/routes/plansPublic.js) gives the website the real numbers: cap, sold,
// remaining and the window state, for every active plan that has a cap or a window or is lifetime.

const LIFETIME_MONTHS = 1200;
const HOLD_MS = 30 * 60 * 1000;
const MAX_CAP = 1000000;
const OFFERS_CACHE_MS = 15000;
const offersCache = new Map();

const ms = (v) => (v == null ? null : (v instanceof Date ? v.getTime() : new Date(v).getTime()));
const isLifetime = (plan) => Boolean(plan) && plan.interval === 'once' && Number(plan.months) >= LIFETIME_MONTHS;
const hasSaleRules = (plan) => Boolean(plan) && (plan.saleCap != null || plan.saleStartsAt != null || plan.saleEndsAt != null);

// 'upcoming' | 'open' | 'ended' ('open' when the plan has no window at all).
function windowState(plan, now = Date.now()) {
  const start = ms(plan && plan.saleStartsAt);
  const end = ms(plan && plan.saleEndsAt);
  if (start != null && now < start) return 'upcoming';
  if (end != null && now > end) return 'ended';
  return 'open';
}

// -> { sold, held, refunded } for one plan key.
async function salesCount(db, tenantId, planKey, now = Date.now()) {
  const [sold, held, refunded] = await Promise.all([
    db.payment.count({ where: { tenantId, plan: planKey, status: 'paid' } }),
    db.payment.count({ where: { tenantId, plan: planKey, status: 'pending', createdAt: { gte: new Date(now - HOLD_MS) } } }),
    db.payment.count({ where: { tenantId, plan: planKey, status: 'refunded' } })
  ]);
  return { sold, held, refunded };
}

// Everything the admin and the website need about one plan's sale.
// -> { key, lifetime, cap, sold, held, refunded, remaining, window, state, startsAt, endsAt }
// state: 'open' | 'upcoming' | 'ended' | 'sold_out'. remaining is null when there is no cap.
async function availability(db, tenantId, plan, now = Date.now()) {
  const counts = await salesCount(db, tenantId, plan.key, now);
  const cap = plan.saleCap == null ? null : Number(plan.saleCap);
  const remaining = cap == null ? null : Math.max(0, cap - counts.sold - counts.held);
  const win = windowState(plan, now);
  let state = win;
  if (win === 'open' && cap != null && remaining <= 0) state = 'sold_out';
  return {
    key: plan.key,
    lifetime: isLifetime(plan),
    cap,
    ...counts,
    remaining,
    window: win,
    state,
    startsAt: plan.saleStartsAt ? new Date(ms(plan.saleStartsAt)).toISOString() : null,
    endsAt: plan.saleEndsAt ? new Date(ms(plan.saleEndsAt)).toISOString() : null
  };
}

const REFUSALS = {
  upcoming: { error: 'sale_not_open', message: 'This offer has not started yet.' },
  ended: { error: 'sale_ended', message: 'This offer has ended.' },
  sold_out: { error: 'sold_out', message: 'This offer is sold out.' }
};

// null when the plan may be sold now, else { error, message, availability } (answer with HTTP 409).
async function saleBlock(db, tenantId, plan, now = Date.now()) {
  if (!hasSaleRules(plan)) return null;
  const a = await availability(db, tenantId, plan, now);
  const r = REFUSALS[a.state];
  return r ? { ...r, availability: a } : null;
}

// The public part of one offer (no refund counts; held places count as taken).
function publicOffer(plan, a) {
  return {
    key: plan.key,
    name: plan.name,
    tier: plan.tier,
    amount: plan.amount,
    amountDecimal: (plan.amount / 100).toFixed(2),
    currency: plan.currency,
    lifetime: a.lifetime,
    cap: a.cap,
    sold: a.cap == null ? null : a.sold + a.held,
    remaining: a.remaining,
    state: a.state,
    startsAt: a.startsAt,
    endsAt: a.endsAt
  };
}

// GET /v1/plans/offers: active plans with a cap or a window, or lifetime. Cached OFFERS_CACHE_MS.
async function publicOffers(db, tenantId, now = Date.now()) {
  const hit = offersCache.get(tenantId);
  if (hit && now - hit.at < OFFERS_CACHE_MS) return hit.offers;
  const rows = await db.plan.findMany({ where: { tenantId, active: true } });
  const picked = rows.filter((p) => hasSaleRules(p) || isLifetime(p))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.amount - b.amount || a.key.localeCompare(b.key));
  const offers = [];
  for (const p of picked) offers.push(publicOffer(p, await availability(db, tenantId, p, now)));
  offersCache.set(tenantId, { at: now, offers });
  return offers;
}

function invalidateOffers(tenantId) { if (tenantId) offersCache.delete(tenantId); else offersCache.clear(); }

// GET /v1/plans/public: lifetime plans only for callers that ask for them (include=lifetime).
function filterPublicPlans(plans, include) {
  const want = String(include || '').split(',').map((s) => s.trim().toLowerCase());
  if (want.includes('lifetime')) return plans.map((p) => (isLifetime(p) ? { ...p, lifetime: true } : p));
  return plans.filter((p) => !isLifetime(p));
}

// validatePlan helper for saleCap / saleStartsAt / saleEndsAt. Writes into data and errors.
function validateSaleFields(b, data, errors) {
  const has = (k) => b[k] !== undefined;
  if (has('saleCap')) {
    if (b.saleCap !== null && (!Number.isInteger(b.saleCap) || b.saleCap < 1 || b.saleCap > MAX_CAP)) errors.saleCap = `integer 1-${MAX_CAP}, or null for no cap`;
    else data.saleCap = b.saleCap;
  }
  for (const k of ['saleStartsAt', 'saleEndsAt']) {
    if (!has(k)) continue;
    if (b[k] === null) { data[k] = null; continue; }
    const d = typeof b[k] === 'string' ? new Date(b[k]) : null;
    if (!d || Number.isNaN(d.getTime())) errors[k] = 'ISO 8601 date-time (UTC), e.g. 2026-11-24T00:00:00Z, or null';
    else data[k] = d;
  }
  if (data.saleStartsAt && data.saleEndsAt && data.saleEndsAt.getTime() <= data.saleStartsAt.getTime()) {
    errors.saleEndsAt = 'must be after saleStartsAt';
  }
  const months = has('months') ? b.months : undefined;
  if (months === LIFETIME_MONTHS && has('interval') && b.interval !== 'once') errors.months = `${LIFETIME_MONTHS} months (lifetime) needs interval "once"`;
  if (months === LIFETIME_MONTHS && b.recurring === true) errors.recurring = 'a lifetime plan is a one-time payment, not recurring';
}

module.exports = {
  LIFETIME_MONTHS, HOLD_MS, isLifetime, hasSaleRules, windowState, salesCount, availability, saleBlock,
  publicOffer, publicOffers, invalidateOffers, filterPublicPlans, validateSaleFields
};
