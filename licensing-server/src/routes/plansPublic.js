'use strict';
// GET /v1/plans/public?tenantId=... (no auth) -> the active plans, cheapest / sortOrder first:
// [{ key, name, tier, amount, amountDecimal, currency, interval, months, highlight, features, limits:
//    { seats, maxParallel, auditExport } }]
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
  res.json(await getPublicPlans(prisma, tenant.id));
}));

module.exports = router;
