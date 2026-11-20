'use strict';
// What POST /v1/license adds to its answers for the Free plan (free forever + 7-day reverse trial):
//   limitsForLicence  the effective limits of a paid licence (its plan row, else its tier)
//   lockReasonFor     'revoked' | 'refunded' | null: the only cases where an install gets NO Free plan
//   parseUsage        the optional { aiActionsToday, profiles, running } the app reports (junk ignored)
//   checkFreeUsage    flags a Free install over its daily AI actions and records one customer event per
//                     install per UTC day (type free_limit_exceeded): the "checked by the server daily" part
const { TIER_LIMITS, limitsOf } = require('./service');
const { addEvent } = require('../customers/sync');

const DAY = 86400000;
const USAGE_KEYS = ['aiActionsToday', 'profiles', 'running'];
const USAGE_MAX = 10000000;

async function limitsForLicence(db, tenantId, lic) {
  const tier = lic.tier || 'pro';
  if (lic.plan) {
    const plan = await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: String(lic.plan) } } }).catch(() => null);
    if (plan && plan.tier === tier) return limitsOf(plan);
  }
  return { ...(TIER_LIMITS[tier] || TIER_LIMITS.pro) };
}

// lic: the install's most relevant licence (pickLeaseLicence: none is active, so the most recently updated).
//   revoked   an admin revoked it (POST /v1/admin/licenses/:id/revoke sets revokedAt), or the Microsoft
//             Store revoked it;
//   refunded  a refund ended it (revokeForRefund leaves status canceled without revokedAt; a Store refund
//             says so in revokedReason).
// A licence that simply ran out, a subscription cancelled at the end of its term, or a Store licence that
// moved to another PC is not a lock: that install is on Free.
function lockReasonFor(lic) {
  if (!lic || lic.status !== 'canceled') return null;
  if (lic.source === 'microsoft_store') {
    const why = String(lic.revokedReason || '').toLowerCase();
    if (why.includes('refunded')) return 'refunded';
    if (why.includes('revoked')) return 'revoked';
    return null;
  }
  return lic.revokedAt ? 'revoked' : 'refunded';
}

function parseUsage(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const out = {};
  for (const k of USAGE_KEYS) {
    const v = u[k];
    if (Number.isInteger(v) && v >= 0 && v <= USAGE_MAX) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// -> usageFlags (array, possibly empty). Never throws: a failed event write must not break the licence answer.
async function checkFreeUsage(db, tenantId, install, usage, limits, now = Date.now()) {
  const flags = [];
  const cap = limits && limits.aiActionsPerDay;
  if (!usage || usage.aiActionsToday === undefined || cap === null || cap === undefined) return flags;
  if (usage.aiActionsToday <= cap) return flags;
  flags.push('ai_over_limit');
  if (!install.customerId) return flags;
  try {
    const dayStart = new Date(Math.floor(now / DAY) * DAY);
    const today = await db.customerEvent.findMany({
      where: { tenantId, customerId: install.customerId, type: 'free_limit_exceeded', at: { gte: dayStart } }
    });
    const data = (e) => (typeof e.data === 'string' ? (() => { try { return JSON.parse(e.data); } catch (_) { return null; } })() : e.data);
    if (!today.some((e) => (data(e) || {}).installId === install.id)) {
      await addEvent(db, tenantId, install.customerId, 'free_limit_exceeded', {
        installId: install.id, limit: 'aiActionsPerDay', allowed: cap, reported: usage.aiActionsToday, day: dayStart.toISOString().slice(0, 10)
      }, new Date(now));
    }
  } catch (_) { /* the flag is still answered */ }
  return flags;
}

module.exports = { limitsForLicence, lockReasonFor, parseUsage, checkFreeUsage, USAGE_KEYS };
