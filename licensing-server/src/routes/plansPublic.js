'use strict';
// GET /v1/plans/public?tenantId=...[&include=free] (no auth) -> the active plans, cheapest / sortOrder first:
// [{ key, name, tier, amount, amountDecimal, currency, interval, months, highlight, features, limits:
//    { seats, maxParallel, auditExport } }]
// Without include=free the answer is exactly the one from before the Free plan (app 1.0.26 would show a
// US$0 plan as a card to buy): no tier free plan, and only those three limit keys. With include=free (app
// 1.0.27+, the website) the Free plan comes first and limits carry every key (src/plans/service.js
// TIER_LIMITS: profiles, devices, aiActionsPerDay, sync, phoneControl, partnerDeals too).
// amount is in minor units (cents): 2900 = US$29.00; amountDecimal is the same as a "29.00" string.
// Cached 60 s in the server and for browsers/CDNs; CORS is open because these prices are public and
// the website reads them from the visitor's browser.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { getPublicPlans } = require('../plans/service');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

router.get('/public', asyncHandler(async (req, res) => {
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (!tenantId || tenantId.length > 64) return res.status(400).json({ error: 'bad_request', message: 'tenantId is required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'unknown_tenant', message: 'Unknown tenant.' });
  res.set('Cache-Control', 'public, max-age=60');
  const include = typeof req.query.include === 'string' ? req.query.include.split(',').map((s) => s.trim().toLowerCase()) : [];
  res.json(await getPublicPlans(prisma, tenant.id, Date.now(), { includeFree: include.includes('free') }));
}));

module.exports = router;
