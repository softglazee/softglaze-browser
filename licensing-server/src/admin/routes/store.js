'use strict';
// /v1/admin/store: Microsoft Store subscriptions (src/store/entitlements.js).
//   GET  /status                       set-up state, counts and alerts (unverified, pending review, check errors)
//   GET  /entitlements                 list; filters status, verified, productId, customerId, installId, alert=1
//   POST /entitlements/:id/recheck     ask Microsoft again now (needs the Entra ID app and the customer's keys)
//   POST /entitlements/:id/approve     grant a pending (unverified, not auto-accepted) claim after checking it
//   POST /entitlements/:id/revoke      end it now, e.g. a refund Microsoft has not reported yet
// Store payments are in GET /v1/admin/payments?provider=microsoft_store; their licences in
// GET /v1/admin/licenses?source=microsoft_store.
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { fail, invalid, notFound, settingsFor, own, pageParams, csvList } = require('../http');
const { audit } = require('../audit');
const api = require('../../store/msStoreApi');
const { storeStatus, adminView, adminSetStatus, recheckOne, STATUSES, GRANTING } = require('../../store/entitlements');

const router = express.Router();

router.get('/status', asyncHandler(async (req, res) => {
  res.json(await storeStatus(prisma, req.tenant, { settings: await settingsFor(req) }));
}));

router.get('/entitlements', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.status) {
    const list = csvList(q.status);
    if (list.some((s) => !STATUSES.includes(s))) return invalid(res, { status: STATUSES.join(' | ') });
    where.status = { in: list };
  }
  if (q.verified === '1' || q.verified === 'true') where.verified = true;
  if (q.verified === '0' || q.verified === 'false') where.verified = false;
  if (q.productId) where.productId = { in: csvList(q.productId) };
  if (q.customerId) where.customerId = String(q.customerId);
  if (q.installId) where.installId = String(q.installId);
  // alert=1: what needs the owner: unverified access, pending review, or a failed re-check.
  if (q.alert === '1' || q.alert === 'true') {
    where.OR = [
      { verified: false, status: { in: [...GRANTING] } },
      { status: 'pending' },
      { NOT: { lastCheckError: null }, status: { in: [...GRANTING] } }
    ];
  }
  const p = pageParams(q);
  const sort = ['createdAt', 'updatedAt', 'accessUntil', 'lastClaimAt'].includes(q.sort) ? q.sort : 'updatedAt';
  const [total, rows] = await Promise.all([
    prisma.storeEntitlement.count({ where }),
    prisma.storeEntitlement.findMany({ where, orderBy: [{ [sort]: q.order === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items: rows.map(adminView), total, page: p.page, pageSize: p.pageSize });
}));

router.post('/entitlements/:id/recheck', asyncHandler(async (req, res) => {
  const ent = await own('storeEntitlement', req, req.params.id);
  if (!ent) return notFound(res, 'Store entitlement');
  const creds = await api.loadCredentials(prisma, req.tenant.id);
  if (!creds) return fail(res, 409, 'not_configured', 'Set up the Microsoft Store API credentials first (POST /v1/tenant/payment-config, provider microsoft_store).');
  if (!ent.purchaseKeySealed || !ent.collectionsKeySealed) return fail(res, 409, 'no_keys', 'The app has not sent Store ID keys for this purchase yet; they arrive with its next report.');
  const settings = await settingsFor(req);
  try {
    await recheckOne(prisma, req.tenant, ent, { creds, now: Date.now(), settings, productPlans: settings.store.productPlans || {} });
  } catch (e) {
    await prisma.storeEntitlement.update({ where: { id: ent.id }, data: { lastCheckError: String((e && e.message) || e).slice(0, 300), lastCheckedAt: new Date() } });
    return fail(res, 502, (e && e.code) || 'store_error', String((e && e.message) || e).slice(0, 300));
  }
  const row = await prisma.storeEntitlement.findUnique({ where: { id: ent.id } });
  await audit(prisma, req, 'store.recheck', { targetType: 'store_entitlement', targetId: ent.id, detail: { from: ent.status, to: row.status } });
  res.json({ entitlement: adminView(row) });
}));

function reasonOf(b) {
  return b && typeof b.reason === 'string' && b.reason.trim().length >= 3 && b.reason.length <= 1000 ? b.reason.trim() : null;
}

router.post('/entitlements/:id/approve', asyncHandler(async (req, res) => {
  const ent = await own('storeEntitlement', req, req.params.id);
  if (!ent) return notFound(res, 'Store entitlement');
  const reason = reasonOf(req.body);
  if (!reason) return invalid(res, { reason: 'say what you checked (3-1000 characters), e.g. "Seen in Partner Center acquisitions"' });
  if (ent.status !== 'pending') return fail(res, 409, 'not_pending', 'Only a pending claim can be approved.');
  if (!ent.expiresAt || new Date(ent.expiresAt).getTime() <= Date.now()) return fail(res, 409, 'expired', 'The Store period the app reported has already ended.');
  const row = await adminSetStatus(prisma, req.tenant, ent, { action: 'approve', settings: await settingsFor(req) });
  await audit(prisma, req, 'store.approve', { targetType: 'store_entitlement', targetId: ent.id, detail: { reason, until: row.accessUntil } });
  res.json({ entitlement: adminView(row) });
}));

router.post('/entitlements/:id/revoke', asyncHandler(async (req, res) => {
  const ent = await own('storeEntitlement', req, req.params.id);
  if (!ent) return notFound(res, 'Store entitlement');
  const reason = reasonOf(req.body);
  if (!reason) return invalid(res, { reason: 'say why (3-1000 characters)' });
  if (!GRANTING.has(ent.status) && ent.status !== 'pending') return fail(res, 409, 'not_active', 'This entitlement is not active.');
  const row = await adminSetStatus(prisma, req.tenant, ent, { action: 'revoke', settings: await settingsFor(req) });
  await audit(prisma, req, 'store.revoke', { targetType: 'store_entitlement', targetId: ent.id, detail: { reason, previous: ent.status } });
  res.json({ entitlement: adminView(row) });
}));

module.exports = router;
