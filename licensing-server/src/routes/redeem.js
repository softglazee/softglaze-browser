'use strict';
// POST /v1/redeem { tenantId, code, installId?, account? }
// Backend-issued activation codes (manual sales / resellers). Replaces the old
// client-side self-signed purchase code.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
const DAY = 86400000;

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, code, installId, account } = req.body || {};
  if (!tenantId || !code) return res.status(400).json({ error: 'tenantId and code are required.' });
  if (!installId && !account) return res.status(400).json({ error: 'installId or account is required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const normalized = String(code).trim().toUpperCase();
  const rec = await prisma.licenseCode.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: normalized } } });
  if (!rec) return res.status(404).json({ error: 'Invalid code.' });
  if (rec.redeemedAt) return res.status(409).json({ error: 'This code has already been redeemed.' });

  const now = Date.now();
  const or = [installId ? { installId: String(installId) } : null, account ? { account: String(account) } : null].filter(Boolean);
  const existing = await prisma.license.findFirst({ where: { tenantId: tenant.id, OR: or }, orderBy: { updatedAt: 'desc' } });
  const base = existing && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > now
    ? new Date(existing.currentPeriodEnd).getTime() : now;
  const currentPeriodEnd = new Date(base + (rec.months || 1) * 30 * DAY);

  if (existing) {
    await prisma.license.update({ where: { id: existing.id }, data: { status: 'active', tier: rec.tier, currentPeriodEnd, installId: installId || existing.installId, account: account || existing.account } });
  } else {
    await prisma.license.create({ data: { tenantId: tenant.id, account: account || null, installId: installId || null, tier: rec.tier, status: 'active', currentPeriodEnd } });
  }
  await prisma.licenseCode.update({ where: { id: rec.id }, data: { redeemedAt: new Date(), redeemedBy: String(installId || account || 'unknown') } });

  res.json({ ok: true, tier: rec.tier, months: rec.months });
}));

module.exports = router;
