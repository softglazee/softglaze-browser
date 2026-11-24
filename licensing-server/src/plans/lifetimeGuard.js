'use strict';
// Lifetime guard (Black Friday 2026): a lifetime licence is never changed by a subscription or a
// fixed-term purchase or code. Without this, grantMonths stacked a month on top of the ~2126 end date
// and overwrote the tier, so Pro Lifetime + one Enterprise month became Enterprise until ~2126, and
// Enterprise Lifetime + "Downgrade to Pro" (or a 1-month Pro code) became Pro for life.
//
// A licence is lifetime when it is active and either its plan is a lifetime plan (interval once,
// months 1200: src/plans/sales.js) or its term runs more than 50 years from now (a redeemed lifetime
// code or an admin grant has no lifetime plan key): the same test MRR uses (src/metrics/maths.js).
// The only change allowed is a lifetime purchase of a HIGHER tier (Pro Lifetime -> Enterprise Lifetime).
const { isLifetime, LIFETIME_MONTHS } = require('./sales');

const DAY = 86400000;
const LIFETIME_AFTER_MS = 600 * 30 * DAY; // 50 years: no monthly or yearly term ever reaches it
const TIER_RANK = { pro: 1, enterprise: 2 };
const LIFETIME_ACTIVE = 'lifetime_active';
const FLAG = '[lifetime-guard]'; // Payment.note marker: GET /v1/admin/payments?flag=lifetime_guard

const ms = (v) => (v ? new Date(v).getTime() : 0);

function isLifetimeLicence(lic, plan, now = Date.now()) {
  if (!lic || lic.status !== 'active') return false;
  const end = ms(lic.currentPeriodEnd);
  if (end <= now) return false;
  return end - now > LIFETIME_AFTER_MS || isLifetime(plan);
}

// The install's active lifetime licence (highest tier first), or null.
async function findLifetimeLicence(db, tenantId, installId, now = Date.now()) {
  if (!installId) return null;
  const rows = await db.license.findMany({ where: { tenantId, installId: String(installId), status: 'active' } });
  const hits = [];
  for (const lic of rows || []) {
    let plan = null;
    if (lic.plan && ms(lic.currentPeriodEnd) - now <= LIFETIME_AFTER_MS) {
      plan = await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: lic.plan } } });
    }
    if (isLifetimeLicence(lic, plan, now)) hits.push(lic);
  }
  hits.sort((a, b) => (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0));
  return hits[0] || null;
}

// May a purchase/code of { tier, lifetime } change this lifetime licence? Only a higher-tier lifetime.
function allowedOnLifetime(lic, { tier, lifetime }) {
  return Boolean(lifetime) && (TIER_RANK[tier] || 0) > (TIER_RANK[lic.tier] || 0);
}

const isLifetimeCode = (code) => Boolean(code) && Number(code.months) >= LIFETIME_MONTHS;

// 409 body for checkout ('checkout': nothing was charged) and redeem ('code': the code was not used).
function blockedBody(lic, kind = 'checkout') {
  const tier = lic.tier === 'enterprise' ? 'Enterprise' : 'Pro';
  const tail = kind === 'code' ? 'This code was not used and still works on another install.' : 'Nothing was charged.';
  return {
    error: LIFETIME_ACTIVE,
    message: `This install already has ${tier} Lifetime, which a subscription, a fixed-term plan or a lower code cannot change. ${tail}`,
    tier: lic.tier,
    lifetime: true
  };
}

module.exports = {
  LIFETIME_AFTER_MS, LIFETIME_ACTIVE, FLAG, TIER_RANK,
  isLifetimeLicence, findLifetimeLicence, allowedOnLifetime, isLifetimeCode, blockedBody
};
