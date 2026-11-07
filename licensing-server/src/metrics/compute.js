'use strict';
// Loads a tenant's rows and applies src/metrics/maths.js. Fine for tens of thousands of rows; the
// daily snapshots (written by the cron) keep MRR history exact without replaying old licence states.
const M = require('./maths');
const { DAY, ms, monthKey, dayKey, monthRange } = require('../util/time');
const { asJson } = require('../util/json');

async function loadAll(db, tenantId) {
  const [customers, licences, plans, payments, trials, events, snapshots, attempts] = await Promise.all([
    db.customer.findMany({ where: { tenantId } }),
    db.license.findMany({ where: { tenantId } }),
    db.plan.findMany({ where: { tenantId } }),
    db.payment.findMany({ where: { tenantId } }),
    db.trial.findMany({ where: { tenantId } }),
    db.customerEvent.findMany({ where: { tenantId, type: 'status' } }),
    db.metricSnapshot.findMany({ where: { tenantId } }),
    db.trialAttempt.findMany({ where: { tenantId } })
  ]);
  return { customers, licences, plans, payments, trials, events: events.map((e) => ({ ...e, data: asJson(e.data) })), snapshots, attempts };
}

function summaryFrom(d, now) {
  const mrr = M.computeMrr(d.licences, d.plans, now);
  const primary = mrr.byCurrency[0] || { currency: 'USD', mrrCents: 0, arrCents: 0 };
  return {
    customersByStatus: M.countByStatus(d.customers, 'status'),
    customersByComputedStatus: M.countByStatus(d.customers, 'statusAuto'),
    customersTotal: d.customers.filter((c) => !c.deletedAt).length,
    verifiedCustomers: d.customers.filter((c) => !c.deletedAt && c.emailVerifiedAt).length,
    marketingConsent: d.customers.filter((c) => !c.deletedAt && c.marketingConsent && !c.unsubscribedAt).length,
    complimentaryActive: d.customers.filter((c) => !c.deletedAt && c.complimentaryUntil && ms(c.complimentaryUntil) > ms(now)).length,
    payingCustomers: mrr.payingCustomers,
    payingLicences: mrr.payingLicences,
    unpricedLicences: mrr.unpricedLicences,
    mrr: mrr.byCurrency,
    mrrCents: primary.mrrCents,
    arrCents: primary.arrCents,
    currency: primary.currency,
    arpaCents: mrr.payingCustomers ? Math.round(primary.mrrCents / mrr.payingCustomers) : null,
    activeTrials: d.trials.filter((t) => ms(t.endsAt) > ms(now)).length
  };
}

// opts: { from: 'YYYY-MM', to: 'YYYY-MM', days: 30 }
async function computeMetrics(db, tenantId, { now = Date.now(), from, to, days = 30 } = {}) {
  const d = await loadAll(db, tenantId);
  const toKey = to || monthKey(now);
  const fromKey = from || monthKey(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 11, 1));
  const months = monthRange(fromKey, toKey);
  const summary = summaryFrom(d, now);

  const dayFrom = ms(now) - (Math.max(1, Math.min(days, 366)) - 1) * DAY;
  const perDay = M.trialsPerDay(d.trials, Date.UTC(new Date(dayFrom).getUTCFullYear(), new Date(dayFrom).getUTCMonth(), new Date(dayFrom).getUTCDate()), ms(now));

  const churn = M.churnByMonth(d.events, months);
  const revenue = M.revenueByMonth(d.payments, months);
  const conversion = M.conversionByCohort(d.trials, months);
  const snapByDay = new Map(d.snapshots.map((s) => [s.day, asJson(s.data)]));
  const monthly = months.map((m, i) => {
    const rev = revenue.filter((r) => r.month === m && r.currency === summary.currency)[0] || { grossCents: 0, refundsCents: 0, netCents: 0, payments: 0 };
    const payingAny = M.payingDuring(d.events, m);
    const lastSnapDay = [...snapByDay.keys()].filter((k) => k.startsWith(m)).sort().pop();
    const snap = lastSnapDay ? snapByDay.get(lastSnapDay) : null;
    return {
      month: m,
      newCustomers: d.customers.filter((c) => monthKey(c.createdAt) === m).length,
      newTrials: conversion[i].trials,
      trialsConverted: conversion[i].converted,
      conversionRate: conversion[i].conversionRate,
      payingStart: churn[i].payingStart,
      newPaying: churn[i].newPaying,
      reactivated: churn[i].reactivated,
      churned: churn[i].churned,
      cancelled: churn[i].cancelled,
      payingEnd: churn[i].payingEnd,
      churnRate: churn[i].churnRate,
      currency: summary.currency,
      revenueGrossCents: rev.grossCents,
      refundsCents: rev.refundsCents,
      revenueNetCents: rev.netCents,
      payments: rev.payments,
      revenuePerPayingCustomerCents: payingAny ? Math.round(rev.netCents / payingAny) : null,
      mrrEndCents: snap && Array.isArray(snap.mrr) ? ((snap.mrr.find((x) => x.currency === summary.currency) || {}).mrrCents ?? 0) : null,
      mrrSnapshotDay: lastSnapDay || null
    };
  });

  const settled = d.payments.filter((p) => p.status === 'paid' || p.status === 'refunded');
  const lifetimeNet = settled.filter((p) => (p.currency || 'USD') === summary.currency)
    .reduce((s, p) => s + (p.status === 'paid' ? Number(p.amount) || 0 : 0), 0);
  const everPaid = new Set(d.licences.filter((l) => !l.complimentary && l.customerId).map((l) => l.customerId)).size;
  const attemptsWindow = d.attempts.filter((a) => ms(a.at) >= ms(now) - 30 * DAY);
  const refused = {};
  for (const a of attemptsWindow) if (a.outcome !== 'granted' && a.outcome !== 'repeat') refused[a.outcome] = (refused[a.outcome] || 0) + 1;

  return {
    asOf: new Date(now).toISOString(),
    ...summary,
    lifetimeNetRevenueCents: lifetimeNet,
    customersEverPaid: everPaid,
    lifetimeRevenuePerPayingCustomerCents: everPaid ? Math.round(lifetimeNet / everPaid) : null,
    trials: { perDay, perWeek: M.trialsPerWeek(perDay) },
    trialRefusalsLast30Days: refused,
    conversion,
    churn,
    revenue,
    monthly,
    topCountries: M.topCountries(d.customers)
  };
}

// Cron: today's snapshot (overwritten by each run, so the last run of the day wins).
async function writeSnapshot(db, tenantId, now = Date.now()) {
  const d = await loadAll(db, tenantId);
  const s = summaryFrom(d, now);
  const data = {
    mrr: s.mrr, payingCustomers: s.payingCustomers, payingLicences: s.payingLicences, unpricedLicences: s.unpricedLicences,
    customersByStatus: s.customersByStatus, customersByComputedStatus: s.customersByComputedStatus, activeTrials: s.activeTrials, at: new Date(now).toISOString()
  };
  const day = dayKey(now);
  await db.metricSnapshot.upsert({ where: { tenantId_day: { tenantId, day } }, update: { data }, create: { tenantId, day, data } });
  return { day, ...data };
}

const MONTHLY_COLUMNS = ['month', 'newCustomers', 'newTrials', 'trialsConverted', 'conversionRate', 'payingStart', 'newPaying', 'reactivated',
  'churned', 'cancelled', 'payingEnd', 'churnRate', 'currency', 'revenueGrossCents', 'refundsCents', 'revenueNetCents', 'payments',
  'revenuePerPayingCustomerCents', 'mrrEndCents', 'mrrSnapshotDay'];

module.exports = { computeMetrics, writeSnapshot, MONTHLY_COLUMNS };
