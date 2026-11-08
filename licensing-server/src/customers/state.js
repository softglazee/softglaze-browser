'use strict';
// Pure: a customer's derived fields from their licences, payments, trials and installs.
//
// statusAuto, first match wins:
//   paid           an active paid (not complimentary) licence whose term has not ended, or ended less
//                  than renewalGraceDays ago (the app's own grace)
//   cancelled      had a paid licence; the latest one was revoked or refunded (status canceled)
//   churned        had a paid licence; it ran out (or the subscription ended) without renewal
//   trial          a trial whose end is in the future
//   trial_expired  had a trial, never paid
//   lead           none of the above
// Complimentary licences never make a customer "paid"; they set complimentaryUntil and the tier.
// A payment with no licence does not change the status (it still counts in totalPaidCents).
const { ms } = require('../util/time');

const DAY = 86400000;
const STATUSES = ['lead', 'trial', 'trial_expired', 'paid', 'cancelled', 'churned'];
const TIER_RANK = { pro: 1, enterprise: 2 };

const end = (l) => ms(l.currentPeriodEnd) || 0;
const maxBy = (arr, f) => arr.reduce((best, x) => (best == null || f(x) > f(best) ? x : best), null);
const minDate = (dates) => { const v = dates.filter((d) => d != null).map(ms); return v.length ? new Date(Math.min(...v)) : null; };
const maxDate = (dates) => { const v = dates.filter((d) => d != null).map(ms); return v.length ? new Date(Math.max(...v)) : null; };
const bestTier = (lics) => {
  const t = maxBy(lics, (l) => TIER_RANK[l.tier] || 0);
  return t ? (t.tier || 'pro') : null;
};

function computeCustomerState({ licences = [], payments = [], trials = [], installs = [], now = Date.now(), graceDays = 3, createdAt = null } = {}) {
  const nowMs = ms(now);
  const grace = Math.max(0, graceDays) * DAY;
  const paidLics = licences.filter((l) => !l.complimentary);
  const compLics = licences.filter((l) => l.complimentary);
  const activePaid = paidLics.filter((l) => l.status === 'active' && end(l) > nowMs);
  const inGrace = paidLics.filter((l) => l.status === 'active' && end(l) <= nowMs && end(l) + grace > nowMs);
  const activeComp = compLics.filter((l) => l.status === 'active' && end(l) > nowMs);
  const trial = maxBy(trials, (t) => ms(t.startedAt) || 0);
  const trialActive = Boolean(trial && ms(trial.endsAt) > nowMs);
  const settled = payments.filter((p) => p.status === 'paid');

  const paidUntil = paidLics.length ? maxDate(paidLics.map((l) => l.currentPeriodEnd)) : null;
  let statusAuto;
  let changedAt;
  if (activePaid.length || inGrace.length) {
    statusAuto = 'paid';
    changedAt = nowMs;
  } else if (paidLics.length) {
    const latest = maxBy(paidLics, end);
    if (latest.status === 'canceled') {
      statusAuto = 'cancelled';
      changedAt = ms(latest.revokedAt) || end(latest) || nowMs;
    } else {
      statusAuto = 'churned';
      changedAt = end(latest) || nowMs; // churn belongs to the day the paid term ended
    }
  } else if (trial) {
    statusAuto = trialActive ? 'trial' : 'trial_expired';
    changedAt = trialActive ? ms(trial.startedAt) : ms(trial.endsAt);
  } else {
    statusAuto = 'lead';
    changedAt = ms(createdAt) || nowMs;
  }

  let tier = null;
  if (activePaid.length || inGrace.length) tier = bestTier([...activePaid, ...inGrace]);
  else if (activeComp.length) tier = bestTier(activeComp);
  else if (trialActive) tier = trial.tier || 'enterprise';

  // Revenue in the customer's main currency: that of their first settled payment.
  const firstPaid = maxBy(settled, (p) => -(ms(p.paidAt || p.createdAt) || 0));
  const currency = firstPaid ? (firstPaid.currency || 'USD') : null;
  const totalPaidCents = settled.filter((p) => (p.currency || 'USD') === currency).reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const seen = installs.filter((i) => i.lastSeenAt);
  const lastInstall = maxBy(seen, (i) => ms(i.lastSeenAt));
  return {
    statusAuto,
    statusChangedAt: new Date(Math.min(changedAt || nowMs, nowMs)),
    tier,
    trialStartedAt: trial ? trial.startedAt : null,
    trialEndsAt: trial ? trial.endsAt : null,
    paidSince: minDate([...paidLics.map((l) => l.createdAt), ...settled.map((p) => p.paidAt || p.createdAt)]),
    paidUntil,
    complimentaryUntil: activeComp.length ? maxDate(activeComp.map((l) => l.currentPeriodEnd)) : null,
    totalPaidCents,
    currency,
    firstSeenAt: minDate(installs.map((i) => i.createdAt)),
    lastSeenAt: lastInstall ? lastInstall.lastSeenAt : null,
    appVersion: lastInstall ? (lastInstall.appVersion || null) : (maxBy(installs.filter((i) => i.appVersion), (i) => ms(i.createdAt)) || {}).appVersion || null,
    // Where the customer first came from: the channel of their earliest install that reported one.
    firstChannel: (maxBy(installs.filter((i) => i.channel), (i) => -(ms(i.createdAt) || 0)) || {}).channel || null
  };
}

// The status the admin sees.
function effectiveStatus(customer) {
  return customer.statusOverride && STATUSES.includes(customer.statusOverride) ? customer.statusOverride : customer.statusAuto;
}

module.exports = { computeCustomerState, effectiveStatus, STATUSES, TIER_RANK };
