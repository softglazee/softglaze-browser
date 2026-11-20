// Free forever plan (1.0.27): the small pure helpers the upgrade prompt, the counters, the day 8 screen and the
// Billing page share. Framework-free so node:test covers it.

// "US$5" for the cheapest monthly Pro plan in a billing.getPlans() list; null when the list has none.
export function proMonthlyPrice(plans) {
  const list = Array.isArray(plans) ? plans : [];
  const monthly = list.filter((p) => p && p.kind !== 'trial' && p.active !== false && String(p.tier || 'pro') === 'pro'
    && !/year/i.test(String(p.interval || p.period || '')) && Number(p.months || 1) === 1);
  if (!monthly.length) return null;
  const cheapest = monthly.slice().sort((a, b) => Number(a.amount) - Number(b.amount))[0];
  const amount = String(cheapest.amount);
  const cur = String(cheapest.currency || 'USD').toUpperCase();
  return cur === 'USD' ? `US$${amount}` : `${amount} ${cur}`;
}

// "24 of 25" style counters; null when the plan has no cap (Pro, Enterprise, the trial).
export function counterOf(part) {
  if (!part || part.limit == null) return null;
  const used = Math.max(0, Number(part.used) || 0);
  const limit = Math.max(0, Number(part.limit) || 0);
  return { used, limit, full: used >= limit, near: limit > 0 && used >= Math.max(1, limit - 2) };
}

const KINDS = new Set(['profiles', 'running', 'openable', 'seats', 'ai', 'sync', 'phone']);

// A plan:limit-hit push -> what the prompt shows; unknown kinds fall back to a generic Pro prompt.
export function promptFor(info) {
  const kind = info && KINDS.has(info.kind) ? info.kind : 'generic';
  return {
    kind,
    limit: info && info.limit != null ? Number(info.limit) : null,
    used: info && info.used != null ? Number(info.used) : null,
    chooseProfiles: kind === 'openable' && Boolean(info && info.needsChoice)
  };
}

// The comparison table on the Billing page: one row per feature, the values as i18n keys (plan.billing.values.*)
// or numbers. freeLimits: tierPolicy limits of Free from main (server values when it sent them).
export function comparisonRows(freeLimits) {
  const f = freeLimits || {};
  const n = (v, fallback) => (v == null ? fallback : v);
  return [
    { key: 'profiles', free: n(f.profiles, 25), pro: 'unlimited', enterprise: 'unlimited' },
    { key: 'running', free: n(f.runningCap ?? f.maxParallel, 1), pro: 3, enterprise: 10 },
    { key: 'seats', free: n(f.seats, 1), pro: 3, enterprise: 25 },
    { key: 'pcs', free: n(f.devices, 1), pro: 3, enterprise: 10 },
    { key: 'fingerprints', free: 'yes', pro: 'yes', enterprise: 'yes' },
    { key: 'ai', free: { count: n(f.aiActionsPerDay, 25) }, pro: 'unlimited', enterprise: 'unlimitedAudit' },
    { key: 'phone', free: 'viewApprove', pro: 'openStop', enterprise: 'teamApprovals' },
    { key: 'sync', free: f.sync ? 'yes' : 'no', pro: 'yes', enterprise: 'yes' },
    { key: 'support', free: 'helpCentre', pro: 'email', enterprise: 'priorityEmail' }
  ];
}

// The words SoftGlaze never uses in user-facing text (Store and website rules).
export const BLOCKED_WORDS = /\b(antidetect|undetectable|bypass|evade|spoof|stealth|ban|fake|anonymous)\b/i;
