'use strict';
// Plan limits: the one place that says what Pro and Enterprise unlock. Pure (no Electron, DB or
// globals). ipcHandlers.js passes the effective licence view from getLicense() (the local licence,
// a verified backend lease, or the certified Super Admin's exemption) and enforces the result.
//
//                team members   profiles at once in a parallel run   audit-log export
//   Pro               3                         3                          no
//   Enterprise       25                        10                          yes
//   Trial             3          by tier (the trial runs as Enterprise, so 10 and yes)
//
// The owner counts as one member. Limits follow the licence's type and tier, not its state: a lapsed
// licence keeps its limits through the grace days, and after that the existing licence ban locks the
// workspace (profile launches are refused in main) exactly as before. A missing or unknown licence
// type gets Pro limits, which keeps the old 3-seat default.

const TIER_LIMITS = Object.freeze({
  pro: Object.freeze({ seats: 3, maxParallel: 3, auditExport: false }),
  enterprise: Object.freeze({ seats: 25, maxParallel: 10, auditExport: true })
});

// The free trial keeps 3 seats whatever its tier.
const TRIAL_SEATS = 3;

// Hard ceiling for one parallel run; parallelRunner.js clamps to the same number.
const MAX_PARALLEL = 10;

// Default concurrency when a run does not ask for one (unchanged from before tiers).
const DEFAULT_PARALLEL = 3;

function normalizeTier(tier) {
  return String(tier || '').toLowerCase() === 'enterprise' ? 'enterprise' : 'pro';
}

// license: { type, tier, isExempt } (a getLicense() view or a License row). Returns
// { tier, seats, maxParallel, auditExport, exempt }.
function limitsForLicense(license) {
  const lic = (license && typeof license === 'object') ? license : {};
  // Only main sets isExempt (certified Super Admin on a base build), so a type string cannot claim it.
  if (lic.isExempt === true) return { tier: 'enterprise', ...TIER_LIMITS.enterprise, exempt: true };
  const type = String(lic.type || '').toLowerCase();
  if (type === 'trial') {
    const tier = normalizeTier(lic.tier);
    return { tier, ...TIER_LIMITS[tier], seats: TRIAL_SEATS, exempt: false };
  }
  if (type === 'paid') {
    const tier = normalizeTier(lic.tier);
    return { tier, ...TIER_LIMITS[tier], exempt: false };
  }
  return { tier: 'pro', ...TIER_LIMITS.pro, exempt: false };
}

// Concurrency for one parallel run: the requested number (3 when missing), at least 1, at most the
// plan's maxParallel and never above MAX_PARALLEL.
function clampConcurrency(requested, limits) {
  const max = Math.max(1, Math.min(MAX_PARALLEL, Number(limits && limits.maxParallel) || 1));
  const want = Number.parseInt(requested, 10) || DEFAULT_PARALLEL;
  return Math.max(1, Math.min(max, want));
}

module.exports = {
  TIER_LIMITS,
  TRIAL_SEATS,
  MAX_PARALLEL,
  DEFAULT_PARALLEL,
  normalizeTier,
  limitsForLicense,
  clampConcurrency
};
