'use strict';
// POST /v1/license { tenantId, installId?, account? }
//   -> { lease, exp, tier, currentPeriodEnd }   when an active license exists
//   -> { lease: null, status }                  otherwise
// The desktop calls this on launch + periodically; it caches the signed lease and
// runs offline until it expires (LEASE_DAYS), then re-checks here.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { issueLease } = require('../lease');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, installId, account } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required.' });
  if (!installId && !account) return res.status(400).json({ error: 'installId or account is required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const or = [installId ? { installId: String(installId) } : null, account ? { account: String(account) } : null].filter(Boolean);
  const lic = await prisma.license.findFirst({ where: { tenantId: tenant.id, OR: or }, orderBy: { updatedAt: 'desc' } });

  const now = Date.now();
  const active = lic && lic.status === 'active' && lic.currentPeriodEnd && new Date(lic.currentPeriodEnd).getTime() > now;
  if (!active) return res.json({ lease: null, status: lic ? lic.status : 'none' });

  if (installId) {
    await prisma.install.updateMany({ where: { tenantId: tenant.id, id: String(installId) }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const lease = issueLease(tenant, lic, now);
  res.json({ lease: lease.token, exp: lease.exp, tier: lease.tier, currentPeriodEnd: lic.currentPeriodEnd });
}));

module.exports = router;
