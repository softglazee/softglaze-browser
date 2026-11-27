'use strict';
// POST /v1/license { tenantId, installId, installSecret, machineHash, appVersion?, channel?, usage? } ->
//   paid:  { lease, exp, tier, currentPeriodEnd, type: 'paid', plan, limits }
//   trial: { lease, exp, tier, type: 'trial', trialEndsAt, currentPeriodEnd, plan: 'trial', limits }
//   Free:  { lease: null, status, trialEndsAt?, free: true, plan: 'free', tier: 'free', limits, usageFlags? }
//   lock:  { lease: null, status, trialEndsAt?, free: false, lockReason: 'revoked' | 'refunded' }
// 401 bad install/secret, 400 machine_required, 403 machine_mismatch. The licence is found only by the
// authenticated installId, never by email.
// Free plan (reverse trial): with no active paid licence and no running trial the install is on Free, which
// is "no lease + free: true" and never a signed lease (app 1.0.26 reads any lease as paid; it reads
// lease: null exactly as before). Only an admin revoke or a refund locks instead (lockReason).
// usage (optional): { aiActionsToday, profiles, running } (integers; anything else is ignored). On Free, more
// AI actions today than limits.aiActionsPerDay answers usageFlags: ['ai_over_limit'] and records one
// customer event free_limit_exceeded per install per UTC day (src/plans/entitlement.js).
// appVersion (optional) is recorded so the admin shows which version each customer runs; channel
// (optional: store | website | base) records where the app was installed from, anything else is ignored.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { issueLease } = require('../lease');
const { authenticateInstall } = require('../installAuth');
const { checkMachine, transferMachine } = require('../machineBinding');
const { trialLeaseFor } = require('../trials/ledger');
const { touchInstall } = require('../customers/sync');
const { pickLeaseLicence, accountLicencesFor } = require('../licensing');
const { freeLimits } = require('../plans/service');
const { limitsForLicence, lockReasonFor, parseUsage, checkFreeUsage } = require('../plans/entitlement');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, installId, installSecret, machineHash, appVersion, channel, usage } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required.' });
  if (!installId || !installSecret) return res.status(400).json({ error: 'installId and installSecret are required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const authed = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!authed) return res.status(401).json({ error: 'Unknown install or wrong install secret.' });
  const bound = await checkMachine(prisma, authed, machineHash);
  if (!bound.ok) return res.status(bound.status).json({ error: bound.error });
  const install = bound.install;

  const now = Date.now();
  await touchInstall(prisma, install, { appVersion, channel }, now).catch(() => {});
  // An install can hold more than one licence (an invoice licence and a Microsoft Store subscription,
  // or Pro then Enterprise in the Store): the active one with the best tier wins.
  // A computer signed in to an account also gets the account's active plan (bought on app.softglaze.com,
  // licensing.js accountLicencesFor), on up to that plan's number of computers.
  const own = await prisma.license.findMany({ where: { tenantId: tenant.id, installId: install.id } });
  const fromAccount = await accountLicencesFor(prisma, tenant.id, install, now, (l) => limitsForLicence(prisma, tenant.id, l));
  const lic = pickLeaseLicence([...own, ...fromAccount], now);

  const active = lic && lic.status === 'active' && lic.currentPeriodEnd && new Date(lic.currentPeriodEnd).getTime() > now;
  if (!active) {
    // No paid licence: a running server-side trial keeps the app licensed with a trial lease.
    const trial = await trialLeaseFor(prisma, tenant, install, now);
    if (trial.active) return res.json(trial.active);
    const base = { lease: null, status: lic ? lic.status : 'none', ...(trial.last ? { trialEndsAt: trial.last.endsAt } : {}) };
    const lockReason = lockReasonFor(lic);
    if (lockReason) return res.json({ ...base, free: false, lockReason });
    // Trial ended, term ended, subscription cancelled at its end, or never a trial: the Free plan.
    const limits = await freeLimits(prisma, tenant.id);
    const usageFlags = await checkFreeUsage(prisma, tenant.id, install, parseUsage(usage), limits, now);
    return res.json({ ...base, free: true, plan: 'free', tier: 'free', limits, ...(usageFlags.length ? { usageFlags } : {}) });
  }

  const lease = issueLease(tenant, lic, now, { mid: install.machineHash });
  res.json({
    lease: lease.token, exp: lease.exp, tier: lease.tier, currentPeriodEnd: lic.currentPeriodEnd, type: 'paid',
    plan: lic.plan || lease.tier, limits: await limitsForLicence(prisma, tenant.id, lic)
  });
}));

// POST /v1/license/transfer { tenantId, installId, installSecret, machineHash, proof }
// -> { ok, transferred, remaining? }. Needs the install secret and a proof of purchase; 2 per 30 days.
// Errors: 400 machine_required, 401 bad secret, 403 invalid_proof, 404 no_license, 429 transfer_limit
router.post('/transfer', asyncHandler(async (req, res) => {
  const { tenantId, installId, installSecret, machineHash, proof } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required.' });
  if (!installId || !installSecret) return res.status(400).json({ error: 'installId and installSecret are required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const install = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!install) return res.status(401).json({ error: 'Unknown install or wrong install secret.' });

  const { status, body } = await transferMachine(prisma, tenant, install, { machineHash, proof });
  res.status(status).json(body);
}));

module.exports = router;
