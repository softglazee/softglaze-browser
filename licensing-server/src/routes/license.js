'use strict';
// POST /v1/license { tenantId, installId, installSecret, machineHash, appVersion? } -> { lease, exp, tier,
// currentPeriodEnd, type: 'paid' } | the running trial { lease, exp, tier, type: 'trial', trialEndsAt,
// currentPeriodEnd } | { lease: null, status, trialEndsAt? }; 401 bad install/secret, 400 machine_required,
// 403 machine_mismatch. The licence is found only by the authenticated installId, never by email.
// appVersion (optional) is recorded so the admin shows which version each customer runs.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { issueLease } = require('../lease');
const { authenticateInstall } = require('../installAuth');
const { checkMachine, transferMachine } = require('../machineBinding');
const { trialLeaseFor } = require('../trials/ledger');
const { touchInstall } = require('../customers/sync');
const { pickLeaseLicence } = require('../licensing');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, installId, installSecret, machineHash, appVersion } = req.body || {};
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
  await touchInstall(prisma, install, appVersion, now).catch(() => {});
  // An install can hold more than one licence (an invoice licence and a Microsoft Store subscription,
  // or Pro then Enterprise in the Store): the active one with the best tier wins.
  const lic = pickLeaseLicence(await prisma.license.findMany({ where: { tenantId: tenant.id, installId: install.id } }), now);

  const active = lic && lic.status === 'active' && lic.currentPeriodEnd && new Date(lic.currentPeriodEnd).getTime() > now;
  if (!active) {
    // No paid licence: a running server-side trial keeps the app licensed with a trial lease.
    const trial = await trialLeaseFor(prisma, tenant, install, now);
    if (trial.active) return res.json(trial.active);
    return res.json({ lease: null, status: lic ? lic.status : 'none', ...(trial.last ? { trialEndsAt: trial.last.endsAt } : {}) });
  }

  const lease = issueLease(tenant, lic, now, { mid: install.machineHash });
  res.json({ lease: lease.token, exp: lease.exp, tier: lease.tier, currentPeriodEnd: lic.currentPeriodEnd, type: 'paid' });
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
