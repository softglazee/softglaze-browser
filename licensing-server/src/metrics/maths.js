'use strict';
// Business metrics as pure functions over plain rows. Definitions (also in docs/ADMIN-API.md):
//
// MRR   Sum, over active paid licences (status active, not complimentary, term end in the future), of
//       the licence plan's monthly-equivalent amount: amount / termMonths, termMonths = the plan's
//       months (12 or more when interval is "year"). A licence without a plan key is priced by the
//       cheapest-term active plan of its tier; one with no matching plan is reported as unpriced.
//       Totals are per currency, rounded to the cent once at the end. ARR = MRR x 12.
// Paying customers   Distinct customers with at least one such licence.
// Churn (month M)    Paid customers whose paid term ended in M without renewal: status events
//       paid -> churned | cancelled dated in M (churn is dated at the paid-until day, and only
//       recorded once the renewal grace has passed). Rate = churned / paying at the start of M.
// Conversion (cohort M)   Trials started in M that later became paid (Trial.convertedAt set).
// Revenue (month M)  Gross = settled payments (paid or later refunded) by paidAt in M; refunds =
//       refunded payments by refundedAt in M; net = gross - refunds. Per currency.
// Revenue per paying customer (month M) = net(M) / customers who were paying at any time in M.
// ARPA (now) = MRR / paying customers.
const { DAY, ms, monthKey, monthStart, nextMonthStart, dayKey, weekKey, monthRange } = require('../util/time');

function termMonths(plan) {
  const m = Math.max(1, Number(plan.months) || 1);
  return plan.interval === 'year' ? Math.max(12, m) : m;
}

function monthlyAmount(plan) {
  return (Number(plan.amount) || 0) / termMonths(plan);
}

function planForLicence(lic, plans) {
  if (lic.plan) {
    const byKey = plans.find((p) => p.key === lic.plan);
    if (byKey) return byKey;
  }
  const sameTier = plans.filter((p) => p.active && p.tier === (lic.tier || 'pro') && p.amount > 0);
  sameTier.sort((a, b) => termMonths(a) - termMonths(b) || (a.sortOrder || 0) - (b.sortOrder || 0) || a.amount - b.amount);
  return sameTier[0] || null;
}

function isPayingLicence(l, nowMs) {
  return !l.complimentary && l.status === 'active' && ms(l.currentPeriodEnd) > nowMs;
}

// -> { byCurrency: [{ currency, mrrCents, arrCents }], payingCustomers, payingLicences, unpricedLicences }
function computeMrr(licences, plans, now) {
  const nowMs = ms(now);
  const sums = new Map();
  const customers = new Set();
  let paying = 0;
  let unpriced = 0;
  for (const l of licences) {
    if (!isPayingLicence(l, nowMs)) continue;
    paying += 1;
    customers.add(l.customerId || `install:${l.installId || l.id}`);
    const plan = planForLicence(l, plans);
    if (!plan) { unpriced += 1; continue; }
    const cur = plan.currency || 'USD';
    sums.set(cur, (sums.get(cur) || 0) + monthlyAmount(plan));
  }
  const byCurrency = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => {
    const mrrCents = Math.round(v);
    return { currency, mrrCents, arrCents: mrrCents * 12 };
  });
  return { byCurrency, payingCustomers: customers.size, payingLicences: paying, unpricedLicences: unpriced };
}

// Status at time t for every customer, replaying status events in date order.
function statusesAt(events, t) {
  const last = new Map();
  const sorted = events.filter((e) => e.type === 'status').slice().sort((a, b) => ms(a.at) - ms(b.at));
  for (const e of sorted) {
    if (ms(e.at) >= t) break;
    last.set(e.customerId, e.data && e.data.to);
  }
  return last;
}

const countPaid = (map) => { let n = 0; for (const v of map.values()) if (v === 'paid') n += 1; return n; };

// Monthly paying-customer movement. events: [{ customerId, type: 'status', at, data: { from, to } }]
// -> [{ month, payingStart, newPaying, reactivated, churned, cancelled, payingEnd, churnRate }]
function churnByMonth(events, months) {
  const status = events.filter((e) => e.type === 'status' && e.data);
  return months.map((m) => {
    const start = monthStart(m);
    const end = nextMonthStart(m);
    const inMonth = status.filter((e) => ms(e.at) >= start && ms(e.at) < end);
    const payingStart = countPaid(statusesAt(status, start));
    const payingEnd = countPaid(statusesAt(status, end));
    const toPaid = inMonth.filter((e) => e.data.to === 'paid' && e.data.from !== 'paid');
    const reactivated = toPaid.filter((e) => e.data.from === 'churned' || e.data.from === 'cancelled').length;
    const churned = inMonth.filter((e) => e.data.from === 'paid' && e.data.to === 'churned').length;
    const cancelled = inMonth.filter((e) => e.data.from === 'paid' && e.data.to === 'cancelled').length;
    const lost = churned + cancelled;
    return {
      month: m,
      payingStart,
      newPaying: toPaid.length - reactivated,
      reactivated,
      churned,
      cancelled,
      payingEnd,
      churnRate: payingStart ? round4(lost / payingStart) : null
    };
  });
}

// Customers paying at any moment of month m.
function payingDuring(events, m) {
  const start = monthStart(m);
  const end = nextMonthStart(m);
  const status = events.filter((e) => e.type === 'status' && e.data);
  const ids = new Set();
  for (const [id, st] of statusesAt(status, start)) if (st === 'paid') ids.add(id);
  for (const e of status) if (e.data.to === 'paid' && ms(e.at) >= start && ms(e.at) < end) ids.add(e.customerId);
  return ids.size;
}

// payments: [{ amount, currency, status, paidAt, refundedAt, createdAt }]
// -> [{ month, currency, grossCents, refundsCents, netCents, payments }]
function revenueByMonth(payments, months) {
  const set = new Set(months);
  const rows = new Map();
  const row = (m, cur) => {
    const k = `${m}|${cur}`;
    if (!rows.has(k)) rows.set(k, { month: m, currency: cur, grossCents: 0, refundsCents: 0, netCents: 0, payments: 0 });
    return rows.get(k);
  };
  for (const p of payments) {
    if (p.status !== 'paid' && p.status !== 'refunded') continue;
    const cur = p.currency || 'USD';
    const paidMonth = monthKey(p.paidAt || p.createdAt);
    if (set.has(paidMonth)) {
      const r = row(paidMonth, cur);
      r.grossCents += Number(p.amount) || 0;
      r.payments += 1;
    }
    if (p.status === 'refunded') {
      const refMonth = monthKey(p.refundedAt || p.paidAt || p.createdAt);
      if (set.has(refMonth)) row(refMonth, cur).refundsCents += Number(p.amount) || 0;
    }
  }
  for (const r of rows.values()) r.netCents = r.grossCents - r.refundsCents;
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}

// trials: [{ startedAt, convertedAt }] -> [{ cohort, trials, converted, conversionRate }]
function conversionByCohort(trials, months) {
  return months.map((m) => {
    const start = monthStart(m);
    const end = nextMonthStart(m);
    const cohort = trials.filter((t) => ms(t.startedAt) >= start && ms(t.startedAt) < end);
    const converted = cohort.filter((t) => t.convertedAt).length;
    return { cohort: m, trials: cohort.length, converted, conversionRate: cohort.length ? round4(converted / cohort.length) : null };
  });
}

// New trials per UTC day (fromMs..toMs inclusive of days) and per ISO week (Monday).
function trialsPerDay(trials, fromMs, toMs) {
  const counts = new Map();
  for (const t of trials) {
    const s = ms(t.startedAt);
    if (s < fromMs || s > toMs) continue;
    const k = dayKey(s);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [];
  for (let d = Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), new Date(fromMs).getUTCDate()); d <= toMs; d += DAY) {
    out.push({ date: dayKey(d), trials: counts.get(dayKey(d)) || 0 });
  }
  return out;
}

function trialsPerWeek(perDay) {
  const weeks = new Map();
  for (const d of perDay) {
    const k = weekKey(Date.parse(`${d.date}T00:00:00Z`));
    weeks.set(k, (weeks.get(k) || 0) + d.trials);
  }
  return [...weeks.entries()].map(([weekStart, trials]) => ({ weekStart, trials }));
}

// customers: [{ country, statusAuto, deletedAt }] -> top N by customers
function topCountries(customers, n = 10) {
  const m = new Map();
  for (const c of customers) {
    if (c.deletedAt) continue;
    const k = c.country || 'unknown';
    if (!m.has(k)) m.set(k, { country: k, customers: 0, paying: 0 });
    const r = m.get(k);
    r.customers += 1;
    if (c.statusAuto === 'paid') r.paying += 1;
  }
  return [...m.values()].sort((a, b) => b.customers - a.customers || b.paying - a.paying || a.country.localeCompare(b.country)).slice(0, n);
}

function countByStatus(customers, field = 'status') {
  const out = { lead: 0, trial: 0, trial_expired: 0, paid: 0, cancelled: 0, churned: 0 };
  for (const c of customers) {
    if (c.deletedAt) continue;
    const s = c[field];
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

// Installs by where the app was installed from. Apps before 1.0.23 never report it: `unknown`.
function countInstallsByChannel(installs) {
  const out = { store: 0, website: 0, base: 0, unknown: 0 };
  for (const i of installs) {
    const c = i.channel;
    if (c === 'store' || c === 'website' || c === 'base') out[c] += 1;
    else out.unknown += 1;
  }
  return out;
}

function round4(x) { return Math.round(x * 10000) / 10000; }

module.exports = {
  termMonths, monthlyAmount, planForLicence, computeMrr, statusesAt, churnByMonth, payingDuring,
  revenueByMonth, conversionByCohort, trialsPerDay, trialsPerWeek, topCountries, countByStatus, countInstallsByChannel, monthRange
};
