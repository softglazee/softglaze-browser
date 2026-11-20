'use strict';
// Partner deals for the Free plan card (src/partners/deals.js). No auth; CORS open like /v1/plans/public.
//   GET  /v1/partner-deals?tenantId=...        -> { deals: [{ id, title, vendor, description, url, code, badge,
//                                                 logoUrl }], disclosure } (active, in their date window, by
//                                                 sortOrder, at most 6; cached 5 minutes here and for browsers)
//   POST /v1/partner-deals/:id/click { tenantId } -> { ok: true } (counts a click of a live deal; 404 otherwise)
// Errors: 400 bad_request, 404 unknown_tenant | not_found, 429 rate_limited. Nothing about the person who
// clicks is stored: only the deal's counter and the time of its last click.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { rateLimit } = require('../middleware/rateLimit');
const { getPublicDeals, countClick } = require('../partners/deals');

const router = express.Router();
// A click is cheap to fake; this keeps one address from running the counter up (on top of the general limit).
const clickLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.DEAL_CLICK_RATE_PER_MIN) || 20 });

router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

async function tenantOf(raw, res) {
  const tenantId = typeof raw === 'string' ? raw : '';
  if (!tenantId || tenantId.length > 64) { res.status(400).json({ error: 'bad_request', message: 'tenantId is required.' }); return null; }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') { res.status(404).json({ error: 'unknown_tenant', message: 'Unknown tenant.' }); return null; }
  return tenant;
}

router.get('/', asyncHandler(async (req, res) => {
  const tenant = await tenantOf(req.query.tenantId, res);
  if (!tenant) return;
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await getPublicDeals(prisma, tenant.id));
}));

router.post('/:id/click', clickLimiter, asyncHandler(async (req, res) => {
  const tenant = await tenantOf((req.body || {}).tenantId, res);
  if (!tenant) return;
  res.set('Cache-Control', 'no-store');
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)) return res.status(404).json({ error: 'not_found', message: 'Unknown deal.' });
  if (!await countClick(prisma, tenant.id, id)) return res.status(404).json({ error: 'not_found', message: 'Unknown deal.' });
  res.json({ ok: true });
}));

module.exports = router;
