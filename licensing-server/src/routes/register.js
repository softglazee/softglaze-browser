'use strict';
// POST /v1/register { tenantId, machineId, account?, installSecret?, machineHash? }
// -> { installId, installSecret, tenantId } on first registration (the secret is returned once),
// { installId, tenantId } with the right secret, 403 for a known machine without it.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registerInstall } = require('../installAuth');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, machineId, account, installSecret, machineHash } = req.body || {};
  if (!tenantId || !machineId) return res.status(400).json({ error: 'tenantId and machineId are required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const { status, body } = await registerInstall(prisma, tenant, { machineId, account, installSecret, machineHash });
  res.status(status).json(body);
}));

module.exports = router;
