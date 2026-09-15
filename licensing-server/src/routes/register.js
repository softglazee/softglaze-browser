'use strict';
// POST /v1/register { tenantId, machineId, account?, installSecret? }
//   -> { installId, installSecret, tenantId }   first registration (secret returned ONCE)
//   -> { installId, tenantId }                  re-registration with the right secret
//   -> 403                                      known machine without its secret
// The desktop calls this once per machine and keeps the secret. Knowing a machineId used
// to be enough to get that install's id back; see installAuth.js (audit T2-6).
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registerInstall } = require('../installAuth');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, machineId, account, installSecret } = req.body || {};
  if (!tenantId || !machineId) return res.status(400).json({ error: 'tenantId and machineId are required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const { status, body } = await registerInstall(prisma, tenant, { machineId, account, installSecret });
  res.status(status).json(body);
}));

module.exports = router;
