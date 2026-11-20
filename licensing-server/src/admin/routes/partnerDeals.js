'use strict';
// /v1/admin/partner-deals: the partner offers the app shows on the Free plan (src/partners/deals.js). Every
// change clears the public cache at once (GET /v1/partner-deals). url and logoUrl must be https.
//   GET    /         -> { items: [deal + clicks, lastClickAt] } by sortOrder
//   GET    /:id      -> { deal }
//   POST   /         { title, vendor, url, description?, code?, badge?, logoUrl?, active?, startsAt?, endsAt?, sortOrder? }
//   PATCH  /:id      any of the fields above
//   DELETE /:id
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { invalid, notFound, own } = require('../http');
const { audit } = require('../audit');
const { validateDeal, invalidatePublicDeals } = require('../../partners/deals');

const router = express.Router();
const dateJson = (v) => (v instanceof Date ? v.toISOString() : v);
const forAudit = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, dateJson(v)]));

router.get('/', asyncHandler(async (req, res) => {
  const items = await prisma.partnerDeal.findMany({ where: { tenantId: req.tenant.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  res.json({ items, totalClicks: items.reduce((s, d) => s + (d.clicks || 0), 0) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const d = await own('partnerDeal', req, req.params.id);
  if (!d) return notFound(res, 'Partner deal');
  res.json({ deal: d });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { data, errors } = validateDeal(req.body || {}, { partial: false });
  if (errors) return invalid(res, errors);
  const deal = await prisma.partnerDeal.create({ data: { tenantId: req.tenant.id, ...data } });
  invalidatePublicDeals(req.tenant.id);
  await audit(prisma, req, 'partner_deal.create', { targetType: 'partner_deal', targetId: deal.id, detail: forAudit(data) });
  res.status(201).json({ deal });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const before = await own('partnerDeal', req, req.params.id);
  if (!before) return notFound(res, 'Partner deal');
  const body = { ...(req.body || {}) };
  for (const k of ['id', 'tenantId', 'clicks', 'lastClickAt', 'createdAt', 'updatedAt']) delete body[k];
  const { data, errors } = validateDeal(body, { partial: true, current: before });
  if (errors) return invalid(res, errors);
  if (!Object.keys(data).length) return res.json({ deal: before, changed: [] });
  const deal = await prisma.partnerDeal.update({ where: { id: before.id }, data });
  invalidatePublicDeals(req.tenant.id);
  const changed = Object.keys(data).filter((k) => JSON.stringify(dateJson(before[k])) !== JSON.stringify(dateJson(data[k])));
  const diff = {};
  for (const k of changed) diff[k] = { from: dateJson(before[k]), to: dateJson(data[k]) };
  await audit(prisma, req, 'partner_deal.update', { targetType: 'partner_deal', targetId: deal.id, detail: diff });
  res.json({ deal, changed });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const d = await own('partnerDeal', req, req.params.id);
  if (!d) return notFound(res, 'Partner deal');
  await prisma.partnerDeal.delete({ where: { id: d.id } });
  invalidatePublicDeals(req.tenant.id);
  await audit(prisma, req, 'partner_deal.delete', { targetType: 'partner_deal', targetId: d.id, detail: { title: d.title, vendor: d.vendor, clicks: d.clicks } });
  res.json({ ok: true, deleted: d.id });
}));

module.exports = router;
