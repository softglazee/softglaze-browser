'use strict';
// One scheduler pass (scripts/run-cron.js, every 15 minutes from a Hostinger cron job). Per active
// tenant: re-check Microsoft Store subscriptions (renewals, cancellations, refunds; at most every 6 hours
// each), reconcile customers with licences / payments / trials, queue due automations, send the
// outbox (daily cap), apply retention, write today's metric snapshot. A row in JobLock stops two
// runs overlapping; a run that died is taken over after its lock expires (20 minutes).
const os = require('node:os');
const crypto = require('node:crypto');
const { getSettings } = require('./settings');
const { reconcileTenant } = require('./customers/sync');
const { scheduleAutomations } = require('./email/automations');
const { processOutbox } = require('./email/outbox');
const { applyRetention } = require('./privacy/retention');
const { writeSnapshot } = require('./metrics/compute');
const { recheckTenant } = require('./store/entitlements');

const LOCK = 'cron';
const LOCK_MS = 20 * 60000;

async function acquire(db, holder, now) {
  const until = new Date(now + LOCK_MS);
  try {
    await db.jobLock.create({ data: { name: LOCK, lockedUntil: until, holder, lastStartedAt: new Date(now) } });
    return true;
  } catch (e) {
    if (!e || e.code !== 'P2002') throw e;
  }
  const r = await db.jobLock.updateMany({
    where: { name: LOCK, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now) } }] },
    data: { lockedUntil: until, holder, lastStartedAt: new Date(now) }
  });
  return r.count === 1;
}

async function release(db, holder, result) {
  await db.jobLock.updateMany({ where: { name: LOCK, holder }, data: { lockedUntil: null, lastFinishedAt: new Date(), lastResult: result } });
}

async function step(errors, name, fn) {
  try { return await fn(); } catch (e) { errors.push(`${name}: ${e && e.message ? e.message : e}`.slice(0, 300)); return null; }
}

async function runCron(db, { now = Date.now() } = {}) {
  const holder = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`.slice(0, 80);
  if (!(await acquire(db, holder, now))) return { skipped: 'another run holds the lock' };
  const result = { startedAt: new Date(now).toISOString(), tenants: {} };
  try {
    const tenants = await db.tenant.findMany({ where: { status: 'active' } });
    for (const tenant of tenants) {
      const errors = [];
      const settings = await getSettings(db, tenant.id);
      const graceDays = settings.billing.renewalGraceDays;
      const t = {};
      // Microsoft Store first, so the reconcile below already sees renewed or ended Store licences.
      t.store = await step(errors, 'store', () => recheckTenant(db, tenant, { now, settings }));
      t.reconcile = await step(errors, 'reconcile', () => reconcileTenant(db, tenant, { now, graceDays }));
      t.automations = await step(errors, 'automations', () => scheduleAutomations(db, tenant, { now, settings }));
      t.outbox = await step(errors, 'outbox', () => processOutbox(db, tenant, { now, settings }));
      t.retention = await step(errors, 'retention', () => applyRetention(db, tenant, { now, settings }));
      const snap = await step(errors, 'snapshot', () => writeSnapshot(db, tenant.id, now));
      t.snapshot = snap ? { day: snap.day, payingCustomers: snap.payingCustomers } : null;
      if (errors.length) t.errors = errors;
      result.tenants[tenant.id] = t;
    }
  } finally {
    result.finishedAt = new Date().toISOString();
    await release(db, holder, result).catch(() => {});
  }
  return result;
}

module.exports = { runCron, LOCK };
