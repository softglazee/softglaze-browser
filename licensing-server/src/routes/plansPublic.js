'use strict';
// GET /v1/plans/public?tenantId=...[&include=free,lifetime] (no auth) -> the active plans, cheapest / sortOrder first:
// [{ key, name, tier, amount, amountDecimal, currency, interval, months, highlight, features, limits:
//    { seats, maxParallel, auditExport } }]
// Without include=free the answer is exactly the one from before the Free plan (app 1.0.26 would show a
// US$0 plan as a card to buy): no tier free plan, and only those three limit keys. With include=free (app
// 1.0.27+, the website) the Free plan comes first and limits carry every key (src/plans/service.js
// TIER_LIMITS: profiles, devices, aiActionsPerDay, sync, phoneControl, partnerDeals too). Lifetime plans
// (interval once, 1200 months) appear only with include=lifetime, marked lifetime: true (src/plans/sales.js).
// amount is in minor units (cents): 2900 = US$29.00; amountDecimal is the same as a "29.00" string.
// Cached 60 s in the server and for browsers/CDNs; CORS is open because these prices are public and
// the website reads them from the visitor's browser.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { getPublicPlans } = require('../plans/service');
const { filterPublicPlans, publicOffers } = require('../plans/sales');

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
  // include=free (app 1.0.27+, the website): the Free plan first, every limit key. include=lifetime: the
  // lifetime plans too (older apps would list them as "1200 months"). Both can be asked for together.
  const include = typeof req.query.include === 'string' ? req.query.include : '';
  const want = include.split(',').map((s) => s.trim().toLowerCase());
  res.json(filterPublicPlans(await getPublicPlans(prisma, tenant.id, Date.now(), { includeFree: want.includes('free') }), include));
}));

// GET /v1/plans/offers?tenantId=... (no auth): the active offers with a cap, a sale window or a lifetime
// term, with the real numbers: [{ key, name, tier, amount, amountDecimal, currency, lifetime, cap, sold,
// remaining, state: 'open' | 'upcoming' | 'ended' | 'sold_out', startsAt, endsAt }]. sold counts paid
// payments plus checkouts still on the payment page; remaining is null without a cap. Cached 15 s.
router.get('/offers', asyncHandler(async (req, res) => {
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (!tenantId || tenantId.length > 64) return res.status(400).json({ error: 'bad_request', message: 'tenantId is required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'unknown_tenant', message: 'Unknown tenant.' });
  res.set('Cache-Control', 'public, max-age=15');
  res.json({ offers: await publicOffers(prisma, tenant.id), at: new Date().toISOString() });
}));

module.exports = router;
