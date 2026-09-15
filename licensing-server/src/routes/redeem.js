'use strict';
// POST /v1/redeem { tenantId, code, installId, installSecret }
// Backend-issued activation codes (manual sales / resellers). Replaces the old
// client-side self-signed purchase code.
//
// Audit T2-6: redeem used to accept `account` alone and matched an existing licence by that
// email, then overwrote its installId with the caller's. Redeeming a cheap code with a
// victim's email therefore moved the victim's licence onto the attacker's machine. The
// code now applies only to an install the caller has authenticated, and the licence is
// matched by that installId alone.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { authenticateInstall } = require('../installAuth');

const router = express.Router();
const DAY = 86400000;

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, code, installId, installSecret } = req.body || {};
  if (!tenantId || !code) return res.status(400).json({ error: 'tenantId and code are required.' });
  if (!installId || !installSecret) return res.status(400).json({ error: 'installId and installSecret are required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  // Authenticate BEFORE the code is claimed, so a bad secret cannot burn a code.
  const install = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!install) return res.status(401).json({ error: 'Unknown install or wrong install secret.' });

  const normalized = String(code).trim().toUpperCase();
  const rec = await prisma.licenseCode.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: normalized } } });
  if (!rec) return res.status(404).json({ error: 'Invalid code.' });
  if (rec.redeemedAt) return res.status(409).json({ error: 'This code has already been redeemed.' });

  // Atomically claim the code: only the first concurrent request whose WHERE still sees
  // redeemedAt:null wins. Closes the check-then-act race where two requests both pass the
  // check above and both redeem the same single-use code.
  const claim = await prisma.licenseCode.updateMany({
    where: { id: rec.id, redeemedAt: null },
    data: { redeemedAt: new Date(), redeemedBy: install.id }
  });
  if (claim.count === 0) return res.status(409).json({ error: 'This code has already been redeemed.' });

  const now = Date.now();
  const existing = await prisma.license.findFirst({ where: { tenantId: tenant.id, installId: install.id }, orderBy: { updatedAt: 'desc' } });
  const base = existing && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > now
    ? new Date(existing.currentPeriodEnd).getTime() : now;
  const currentPeriodEnd = new Date(base + (rec.months || 1) * 30 * DAY);

  if (existing) {
    await prisma.license.update({ where: { id: existing.id }, data: { status: 'active', tier: rec.tier, currentPeriodEnd } });
  } else {
    await prisma.license.create({ data: { tenantId: tenant.id, account: install.account || null, installId: install.id, tier: rec.tier, status: 'active', currentPeriodEnd } });
  }
  // (the code was already marked redeemed by the atomic claim above)

  res.json({ ok: true, tier: rec.tier, months: rec.months });
}));

module.exports = router;
