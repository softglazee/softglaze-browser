'use strict';
// Keeps Customer rows in step with installs, licences, payments and trials.
//  - recomputeCustomer: one customer, right after something changed (verify, trial, admin action).
//  - reconcileTenant: the whole tenant, from the cron every 15 minutes, so changes made by payment
//    webhooks and activation codes reach the customer records even if a hook was missed.
// A change of statusAuto writes a `status` event ({ from, to }) dated when it really happened
// (churn = the day the paid term ended), which the churn and paying-customer history read.
const { computeCustomerState, effectiveStatus } = require('./state');
const { parseEmail } = require('./emailAddress');
const { ms } = require('../util/time');

const TRACKED = ['statusAuto', 'status', 'tier', 'trialStartedAt', 'trialEndsAt', 'paidSince', 'paidUntil', 'complimentaryUntil',
  'totalPaidCents', 'currency', 'firstSeenAt', 'lastSeenAt', 'appVersion'];

const same = (a, b) => {
  if (a instanceof Date || b instanceof Date || (typeof a === 'string' && /^\d{4}-\d\d-\d\dT/.test(a))) return ms(a) === ms(b);
  return (a == null ? null : a) === (b == null ? null : b);
};

async function addEvent(db, tenantId, customerId, type, data = null, at = new Date()) {
  return db.customerEvent.create({ data: { tenantId, customerId, type, data, at: at instanceof Date ? at : new Date(at) } });
}

// Trials of this customer that later turned into a paid licence or payment get convertedAt.
async function markConversions(db, trials, licences, payments) {
  const paidMoments = [
    ...licences.filter((l) => !l.complimentary).map((l) => ms(l.createdAt)),
    ...payments.filter((p) => p.status === 'paid' || p.status === 'refunded').map((p) => ms(p.paidAt || p.createdAt))
  ].filter(Boolean);
  for (const t of trials) {
    if (t.convertedAt) continue;
    const after = paidMoments.filter((m) => m >= ms(t.startedAt));
    if (after.length) await db.trial.update({ where: { id: t.id }, data: { convertedAt: new Date(Math.min(...after)) } });
  }
}

// Writes the derived fields when they changed. `rel` = { licences, payments, trials, installs }.
async function applyState(db, customer, rel, { now = Date.now(), graceDays = 3 } = {}) {
  const st = computeCustomerState({ ...rel, now, graceDays, createdAt: customer.createdAt });
  const next = {
    statusAuto: st.statusAuto,
    tier: st.tier,
    trialStartedAt: st.trialStartedAt,
    trialEndsAt: st.trialEndsAt,
    paidSince: st.paidSince,
    paidUntil: st.paidUntil,
    complimentaryUntil: st.complimentaryUntil,
    totalPaidCents: st.totalPaidCents,
    currency: st.currency || customer.currency || null,
    firstSeenAt: st.firstSeenAt && ms(st.firstSeenAt) < ms(customer.firstSeenAt) ? st.firstSeenAt : customer.firstSeenAt,
    lastSeenAt: st.lastSeenAt && (!customer.lastSeenAt || ms(st.lastSeenAt) > ms(customer.lastSeenAt)) ? st.lastSeenAt : customer.lastSeenAt,
    appVersion: st.appVersion || customer.appVersion || null
  };
  next.status = effectiveStatus({ ...customer, statusAuto: next.statusAuto });
  const data = {};
  for (const k of TRACKED) if (!same(customer[k], next[k])) data[k] = next[k];
  let updated = customer;
  if (Object.keys(data).length) updated = await db.customer.update({ where: { id: customer.id }, data });
  if (customer.statusAuto !== next.statusAuto) {
    // First-time paid is dated when they started paying (a licence found by the first cron run after
    // this shipped, for example); a return after churn is dated now.
    let at = st.statusChangedAt;
    if (next.statusAuto === 'paid' && !['churned', 'cancelled'].includes(customer.statusAuto) && st.paidSince) {
      at = new Date(Math.min(ms(st.paidSince), ms(now)));
    }
    await addEvent(db, customer.tenantId, customer.id, 'status', { from: customer.statusAuto, to: next.statusAuto }, at);
  }
  await markConversions(db, rel.trials, rel.licences, rel.payments);
  return updated;
}

async function loadRelations(db, tenantId, customerId) {
  const where = { tenantId, customerId };
  const [licences, payments, trials, installs] = await Promise.all([
    db.license.findMany({ where }), db.payment.findMany({ where }), db.trial.findMany({ where }), db.install.findMany({ where })
  ]);
  return { licences, payments, trials, installs };
}

async function recomputeCustomer(db, tenantId, customerId, opts = {}) {
  if (!customerId) return null;
  const c = await db.customer.findUnique({ where: { id: String(customerId) } });
  if (!c || c.tenantId !== tenantId) return null;
  return applyState(db, c, await loadRelations(db, tenantId, c.id), opts);
}

// Creates a customer (status lead) and its first status event.
async function createCustomer(db, tenantId, data) {
  const c = await db.customer.create({ data: { tenantId, ...data } });
  await addEvent(db, tenantId, c.id, 'status', { from: null, to: c.statusAuto || 'lead' }, c.createdAt || new Date());
  await addEvent(db, tenantId, c.id, 'created', { source: c.source });
  return c;
}

// An install registered with an owner email (claimed, not verified): make sure a customer exists for
// it and link the install, unless it is already linked. Never changes an existing customer's data.
async function noteInstallAccount(db, tenantId, installId, account) {
  const parsed = parseEmail(account);
  if (!parsed || !installId) return null;
  const install = await db.install.findUnique({ where: { id: String(installId) } });
  if (!install || install.tenantId !== tenantId || install.customerId) return null;
  let c = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: parsed.emailKey } } });
  let created = false;
  if (!c) {
    try {
      c = await createCustomer(db, tenantId, { email: parsed.email, emailKey: parsed.emailKey, source: 'app' });
      created = true;
    } catch (e) {
      if (!e || e.code !== 'P2002') throw e;
      c = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: parsed.emailKey } } });
    }
  }
  if (!c) return null;
  await db.install.update({ where: { id: install.id }, data: { customerId: c.id } });
  return { customer: c, created };
}

// The install's licences, payments and trials belong to whoever verified the install's email.
// Returns the ids of customers they were moved away from (to recompute).
async function linkInstallRecords(db, tenantId, installId, customerId) {
  const previous = new Set();
  for (const model of ['license', 'payment', 'trial']) {
    const rows = await db[model].findMany({ where: { tenantId, installId } });
    for (const r of rows) {
      if (r.customerId === customerId) continue;
      if (r.customerId) previous.add(r.customerId);
      await db[model].update({ where: { id: r.id }, data: { customerId } });
    }
  }
  return [...previous];
}

// A licence the admin granted to a customer before they had an install attaches to the first
// install that proves the email (verify/check), if that install has no licence of its own.
async function claimUnboundLicences(db, tenantId, customerId, installId) {
  const own = await db.license.findFirst({ where: { tenantId, installId } });
  if (own) return null;
  const lic = await db.license.findFirst({ where: { tenantId, customerId, installId: null, status: 'active' }, orderBy: { currentPeriodEnd: 'desc' } });
  if (!lic) return null;
  return db.license.update({ where: { id: lic.id }, data: { installId } });
}

// After a licence or payment changed for an install (activation code, webhook): link the install's
// records to its customer and recompute that customer. No-op for an install without a customer.
async function syncInstall(db, tenantId, installId, opts = {}) {
  if (!installId) return null;
  const install = await db.install.findUnique({ where: { id: String(installId) } });
  if (!install || install.tenantId !== tenantId || !install.customerId) return null;
  const moved = await linkInstallRecords(db, tenantId, install.id, install.customerId);
  for (const other of moved) await recomputeCustomer(db, tenantId, other, opts);
  return recomputeCustomer(db, tenantId, install.customerId, opts);
}

// Licences changed by a webhook in the last few minutes: sync their installs (best effort; the cron
// reconcile catches anything missed).
async function syncRecentLicences(db, tenantId, sinceMs = 10 * 60000) {
  const rows = await db.license.findMany({ where: { tenantId, updatedAt: { gte: new Date(Date.now() - sinceMs) } } });
  for (const id of new Set(rows.map((r) => r.installId).filter(Boolean))) await syncInstall(db, tenantId, id);
}

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
function cleanVersion(v) { return typeof v === 'string' && VERSION_RE.test(v.trim()) ? v.trim() : null; }

// Seen now (licence refresh, register, trial): install + customer lastSeenAt and app version.
async function touchInstall(db, install, appVersion, now = Date.now()) {
  const v = cleanVersion(appVersion);
  const at = new Date(now);
  await db.install.update({ where: { id: install.id }, data: { lastSeenAt: at, ...(v ? { appVersion: v } : {}) } });
  if (install.customerId) {
    await db.customer.updateMany({ where: { id: install.customerId }, data: { lastSeenAt: at, ...(v ? { appVersion: v } : {}) } });
  }
}

// Whole-tenant pass (cron). Returns counts.
async function reconcileTenant(db, tenant, { now = Date.now(), graceDays = 3 } = {}) {
  const tenantId = tenant.id;
  const out = { linkedInstalls: 0, createdCustomers: 0, linkedLicences: 0, linkedPayments: 0, updated: 0 };

  const unlinked = await db.install.findMany({ where: { tenantId, customerId: null, NOT: { account: null } } });
  for (const i of unlinked) {
    const r = await noteInstallAccount(db, tenantId, i.id, i.account);
    if (r) {
      out.linkedInstalls += 1;
      if (r.created) out.createdCustomers += 1;
    }
  }

  const installs = await db.install.findMany({ where: { tenantId, NOT: { customerId: null } } });
  const byInstall = new Map(installs.map((i) => [i.id, i.customerId]));
  for (const model of ['license', 'payment']) {
    const rows = await db[model].findMany({ where: { tenantId, customerId: null, NOT: { installId: null } } });
    for (const r of rows) {
      const cid = byInstall.get(r.installId);
      if (!cid) continue;
      await db[model].update({ where: { id: r.id }, data: { customerId: cid } });
      out[model === 'license' ? 'linkedLicences' : 'linkedPayments'] += 1;
    }
  }

  const [customers, licences, payments, trials] = await Promise.all([
    db.customer.findMany({ where: { tenantId, deletedAt: null } }),
    db.license.findMany({ where: { tenantId, NOT: { customerId: null } } }),
    db.payment.findMany({ where: { tenantId, NOT: { customerId: null } } }),
    db.trial.findMany({ where: { tenantId, NOT: { customerId: null } } })
  ]);
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.customerId)) m.set(r.customerId, []); m.get(r.customerId).push(r); }
    return m;
  };
  const L = group(licences); const P = group(payments); const T = group(trials); const I = group(installs);
  for (const c of customers) {
    const rel = { licences: L.get(c.id) || [], payments: P.get(c.id) || [], trials: T.get(c.id) || [], installs: I.get(c.id) || [] };
    const u = await applyState(db, c, rel, { now, graceDays });
    if (u !== c) out.updated += 1;
  }
  return out;
}

module.exports = {
  addEvent, applyState, recomputeCustomer, createCustomer, noteInstallAccount, claimUnboundLicences, linkInstallRecords,
  syncInstall, syncRecentLicences, touchInstall, cleanVersion, reconcileTenant
};
