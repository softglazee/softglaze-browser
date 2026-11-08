'use strict';
// POST /v1/register { tenantId, machineId, account?, installSecret?, machineHash?, appVersion?, channel? }
// -> { installId, installSecret, tenantId } on first registration (the secret is returned once),
// { installId, tenantId } with the right secret, 403 for a known machine without it.
// An install that registers with an owner email is linked to a Customer (source app, unverified until
// the email is verified through /v1/account/verify/*). channel (store | website | base) is recorded
// when valid and ignored otherwise.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registerInstall } = require('../installAuth');
const { noteInstallAccount, touchInstall } = require('../customers/sync');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, machineId, account, installSecret, machineHash, appVersion, channel } = req.body || {};
  if (!tenantId || !machineId) return res.status(400).json({ error: 'tenantId and machineId are required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const { status, body } = await registerInstall(prisma, tenant, { machineId, account, installSecret, machineHash });
  if (status === 200 && body.installId) {
    // Best effort: customer records never block a registration.
    try {
      if (account) await noteInstallAccount(prisma, tenant.id, body.installId, account);
      if (appVersion || channel) {
        const install = await prisma.install.findUnique({ where: { id: body.installId } });
        if (install) await touchInstall(prisma, install, { appVersion, channel });
      }
    } catch (e) { console.warn('[register] customer link skipped:', e && e.message); }
  }
  res.status(status).json(body);
}));

module.exports = router;
