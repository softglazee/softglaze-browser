'use strict';
// Safepay one-time payments without a webhook. Safepay's sandbox did not deliver any webhook for a
// completed payment, so the success return page (and the cron) ask Safepay's API about the tracker.
// Only that API answer grants anything: the tracker in the return URL merely says which pending
// Payment to check. Provisioning is the same as the payment.succeeded webhook (provisionFromPaymentRef,
// pending -> paid once), under a synthetic event id so concurrent checks call Safepay's API once.
const prisma = require('./db');
const { openJson } = require('./crypto/secrets');
const safepay = require('./providers/safepay');
const { provisionFromPaymentRef } = require('./licensing');
const { handleOnce } = require('./webhookOnce');

const verifyEventId = (tracker) => `safepay-verify:${tracker}`;

// -> { status } where status is one of:
//   'invalid'     not a tracker token
//   'unknown'     no pending Safepay Payment with this tracker (or for this tenant)
//   'unconfigured' the tenant has no Safepay keys
//   'not_paid'    Safepay does not report it TRACKER_ENDED (yet)
//   'mismatch'    ended, but the amount/currency is not the checkout's
//   'provisioned' granted now; 'duplicate' another check is handling / handled it
async function verifySafepayTracker(tracker, { tenantId = null, db = prisma } = {}) {
  if (!safepay.isTrackerToken(tracker)) return { status: 'invalid' };
  const where = { provider: 'safepay', providerRef: tracker, status: 'pending' };
  if (tenantId) where.tenantId = tenantId;
  const payment = await db.payment.findFirst({ where, orderBy: { createdAt: 'desc' } });
  if (!payment) return { status: 'unknown' };
  const cfg = await db.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: payment.tenantId, provider: 'safepay' } } });
  if (!cfg) return { status: 'unconfigured' };
  const secrets = openJson(cfg.secretsSealed);
  const t = await safepay.fetchTracker(secrets, tracker);
  if (!t || t.state !== 'TRACKER_ENDED') return { status: 'not_paid', state: t ? t.state : null };
  if (!safepay.trackerPays(t, payment)) {
    console.warn(`[safepay:verify] ${tracker}: ended with ${JSON.stringify({ quote: t.quote, base: t.base })}, checkout was ${payment.amount} ${payment.currency}; not provisioned.`);
    return { status: 'mismatch' };
  }
  const tenant = { id: payment.tenantId };
  let provisioned = false;
  const handled = await handleOnce(tenant.id, 'safepay', verifyEventId(tracker), 'payment.verified', async () => async (tx) => {
    const r = await provisionFromPaymentRef(tenant, 'safepay', tracker, {}, tx);
    provisioned = Boolean(r && r.provisioned);
  }, db);
  if (!handled) return { status: 'duplicate' };
  return { status: provisioned ? 'provisioned' : 'duplicate' };
}

// Cron: one-time Safepay payments still pending between 2 minutes and 48 hours after checkout
// (recurring checkouts have a plan_ ref and are left to the subscription webhooks).
const RECONCILE_MIN_AGE_MS = 2 * 60000;
const RECONCILE_MAX_AGE_MS = 48 * 3600000;
const RECONCILE_LIMIT = 50;

async function reconcileSafepay(db, tenant, { now = Date.now() } = {}) {
  const pending = await db.payment.findMany({
    where: {
      tenantId: tenant.id, provider: 'safepay', status: 'pending', providerRef: { startsWith: 'track_' },
      createdAt: { lte: new Date(now - RECONCILE_MIN_AGE_MS), gte: new Date(now - RECONCILE_MAX_AGE_MS) }
    },
    orderBy: { createdAt: 'asc' },
    take: RECONCILE_LIMIT
  });
  const out = { checked: 0, provisioned: 0, errors: 0 };
  for (const p of pending) {
    out.checked++;
    try {
      const r = await verifySafepayTracker(p.providerRef, { tenantId: tenant.id, db });
      if (r.status === 'provisioned') out.provisioned++;
    } catch (e) { out.errors++; }
  }
  return out;
}

module.exports = { verifySafepayTracker, reconcileSafepay, verifyEventId, RECONCILE_MIN_AGE_MS, RECONCILE_MAX_AGE_MS };
