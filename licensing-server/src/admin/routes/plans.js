'use strict';
// /v1/admin/plans: CRUD with price history. Changing a price never touches existing licences; it is
// what new checkouts, the app and the website show from then on (GET /v1/plans/public, 60 s cache).
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { fail, invalid, notFound } = require('../http');
const { audit } = require('../audit');
const { validatePlan, upsertPlan, invalidatePublicPlans, publicPlan } = require('../../plans/service');
const { asJson } = require('../../util/json');

const router = express.Router();
const view = (p) => ({ ...p, features: asJson(p.features) || [], limits: asJson(p.limits), effectiveLimits: publicPlan(p).limits });

router.get('/', asyncHandler(async (req, res) => {
  const rows = await prisma.plan.findMany({ where: { tenantId: req.tenant.id } });
  rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.amount - b.amount);
  res.json({ items: rows.map(view) });
}));

router.get('/:key', asyncHandler(async (req, res) => {
  const p = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId: req.tenant.id, key: req.params.key } } });
  if (!p) return notFound(res, 'Plan');
  res.json({ plan: view(p) });
}));

router.get('/:key/history', asyncHandler(async (req, res) => {
  const items = await prisma.planPriceHistory.findMany({ where: { tenantId: req.tenant.id, planKey: req.params.key }, orderBy: { changedAt: 'desc' } });
  res.json({ items });
}));

// POST { key, name, amount, tier?, currency?, interval?, months?, recurring?, active?, highlight?,
//        features?, limits?, sortOrder?, description?, note? }
router.post('/', asyncHandler(async (req, res) => {
  const { data, errors } = validatePlan(req.body || {}, { partial: false });
  if (errors) return invalid(res, errors);
  const exists = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId: req.tenant.id, key: data.key } } });
  if (exists) return fail(res, 409, 'plan_exists', 'A plan with this key exists; change it with PATCH.');
  const { plan } = await upsertPlan(prisma, req.tenant.id, data, { actor: req.admin.actor, note: (req.body || {}).note });
  await audit(prisma, req, 'plan.create', { targetType: 'plan', targetId: plan.key, detail: { ...data } });
  res.status(201).json({ plan: view(plan) });
}));

// PATCH /:key with any of the fields above except key; `note` explains a price change in the history.
router.patch('/:key', asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  const before = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId, key: req.params.key } } });
  if (!before) return notFound(res, 'Plan');
  const body = { ...(req.body || {}) };
  delete body.key;
  const note = body.note;
  delete body.note;
  const { data, errors } = validatePlan(body, { partial: true });
  if (errors) return invalid(res, errors);
  if (!Object.keys(data).length) return res.json({ plan: view(before), changed: [] });
  const { plan } = await upsertPlan(prisma, tenantId, { key: before.key, ...data }, { actor: req.admin.actor, note });
  const changed = Object.keys(data).filter((k) => JSON.stringify(asJson(before[k])) !== JSON.stringify(data[k]));
  const diff = {};
  for (const k of changed) diff[k] = { from: asJson(before[k]), to: data[k] };
  await audit(prisma, req, 'plan.update', { targetType: 'plan', targetId: before.key, detail: diff });
  res.json({ plan: view(plan), changed });
}));

// DELETE /:key: only a plan no licence or payment refers to; otherwise deactivate it (active: false).
router.delete('/:key', asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  const p = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId, key: req.params.key } } });
  if (!p) return notFound(res, 'Plan');
  const [lic, pay] = await Promise.all([
    prisma.license.count({ where: { tenantId, plan: p.key } }),
    prisma.payment.count({ where: { tenantId, plan: p.key } })
  ]);
  if (lic || pay) return fail(res, 409, 'plan_in_use', 'Licences or payments refer to this plan; set active to false instead.', { licenses: lic, payments: pay });
  await prisma.plan.delete({ where: { id: p.id } });
  invalidatePublicPlans(tenantId);
  await audit(prisma, req, 'plan.delete', { targetType: 'plan', targetId: p.key, detail: { amount: p.amount, currency: p.currency } });
  res.json({ ok: true, deleted: p.key });
}));

module.exports = router;
