'use strict';
// POST /v1/register { tenantId, machineId, account? } -> { installId, tenantId }
// The desktop calls this once per machine; the lease is bound to the install.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, machineId, account } = req.body || {};
  if (!tenantId || !machineId) return res.status(400).json({ error: 'tenantId and machineId are required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const install = await prisma.install.upsert({
    where: { tenantId_machineId: { tenantId: tenant.id, machineId: String(machineId) } },
    update: { lastSeenAt: new Date(), ...(account ? { account: String(account) } : {}) },
    create: { tenantId: tenant.id, machineId: String(machineId), account: account ? String(account) : null }
  });
  res.json({ installId: install.id, tenantId: tenant.id });
}));

module.exports = router;
