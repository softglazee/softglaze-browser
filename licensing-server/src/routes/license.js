'use strict';
// POST /v1/license { tenantId, installId, installSecret }
//   -> { lease, exp, tier, currentPeriodEnd }   when an active license exists
//   -> { lease: null, status }                  otherwise
//   -> 401                                      unknown install or wrong secret
// The desktop calls this on launch + periodically; it caches the signed lease and
// runs offline until it expires (LEASE_DAYS), then re-checks here.
//
// Audit T2-6: this used to match a licence by `account` (an email) taken from the request
// body, so the email was the whole credential. The licence is now found only by an
// installId the caller has proved it owns with its install secret.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { issueLease } = require('../lease');
const { authenticateInstall } = require('../installAuth');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, installId, installSecret } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required.' });
  if (!installId || !installSecret) return res.status(400).json({ error: 'installId and installSecret are required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const install = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!install) return res.status(401).json({ error: 'Unknown install or wrong install secret.' });

  const lic = await prisma.license.findFirst({ where: { tenantId: tenant.id, installId: install.id }, orderBy: { updatedAt: 'desc' } });

  const now = Date.now();
  const active = lic && lic.status === 'active' && lic.currentPeriodEnd && new Date(lic.currentPeriodEnd).getTime() > now;
  if (!active) return res.json({ lease: null, status: lic ? lic.status : 'none' });

  await prisma.install.update({ where: { id: install.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  const lease = issueLease(tenant, lic, now);
  res.json({ lease: lease.token, exp: lease.exp, tier: lease.tier, currentPeriodEnd: lic.currentPeriodEnd });
}));

module.exports = router;
