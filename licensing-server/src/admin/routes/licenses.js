'use strict';
// /v1/admin/licenses: list, grant (manual paid or complimentary licence), extend, revoke, assign to an
// install. A month is 30 days and 12 months are 365 days (util/time termDays), as for activation codes
// and one-time payments.
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { fail, invalid, notFound, settingsFor, own, pageParams, dateRange, csvList } = require('../http');
const { audit } = require('../audit');
const { addEvent, recomputeCustomer } = require('../../customers/sync');
const { termDays } = require('../../util/time');

const router = express.Router();
const DAY = 86400000;

function termEnd(b, base) {
  if (b.until !== undefined) {
    const d = new Date(String(b.until));
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return { error: { until: 'a future date' } };
    return { end: d };
  }
  const months = b.months === undefined ? null : b.months;
  const days = b.days === undefined ? null : b.days;
  if (months === null && days === null) return { error: { months: 'give months (1-120), days (1-3650) or until' } };
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) return { error: { months: 'integer 1-120' } };
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) return { error: { days: 'integer 1-3650' } };
  return { end: new Date(base + (termDays(months || 0) + (days || 0)) * DAY) };
}

function reasonOf(b) {
  return typeof b.reason === 'string' && b.reason.trim().length >= 3 && b.reason.length <= 1000 ? b.reason.trim() : null;
}

async function recompute(req, customerId) {
  if (!customerId) return;
  const s = await settingsFor(req);
  await recomputeCustomer(prisma, req.tenant.id, customerId, { graceDays: s.billing.renewalGraceDays });
}

router.get('/', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  const and = [];
  if (q.status) where.status = { in: csvList(q.status) };
  if (q.tier) where.tier = { in: csvList(q.tier) };
  if (q.customerId) where.customerId = String(q.customerId);
  if (q.installId) where.installId = String(q.installId);
  if (q.source) where.source = String(q.source) === 'checkout' ? null : String(q.source);
  if (q.complimentary !== undefined && q.complimentary !== '') where.complimentary = ['1', 'true'].includes(String(q.complimentary));
  if (q.active === '1' || q.active === 'true') and.push({ status: 'active', currentPeriodEnd: { gt: new Date() } });
  if (q.active === '0' || q.active === 'false') and.push({ OR: [{ NOT: { status: 'active' } }, { currentPeriodEnd: { lte: new Date() } }, { currentPeriodEnd: null }] });
  const r = dateRange(q, 'endsFrom', 'endsTo');
  if (r.error) return invalid(res, { [r.error]: 'invalid_date' });
  if (r.range) where.currentPeriodEnd = r.range;
  if (and.length) where.AND = and;
  const p = pageParams(q);
  const sort = ['currentPeriodEnd', 'createdAt', 'updatedAt'].includes(q.sort) ? q.sort : 'createdAt';
  const [total, items] = await Promise.all([
    prisma.license.count({ where }),
    prisma.license.findMany({ where, orderBy: [{ [sort]: q.order === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

// POST { customerId?, installId?, tier, months | days | until, plan?, complimentary?, reason }
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const tenantId = req.tenant.id;
  const errors = {};
  if (!b.customerId && !b.installId) errors.customerId = 'customerId or installId is required';
  if (!['pro', 'enterprise'].includes(b.tier)) errors.tier = 'pro or enterprise';
  if (b.complimentary !== undefined && typeof b.complimentary !== 'boolean') errors.complimentary = 'boolean';
  const reason = reasonOf(b);
  if (!reason) errors.reason = 'say why (3-1000 characters), e.g. "Invoice INV-2026-014 paid by bank transfer"';
  const t = termEnd(b, Date.now());
  if (t.error) Object.assign(errors, t.error);
  if (Object.keys(errors).length) return invalid(res, errors);

  let install = null;
  if (b.installId) {
    install = await own('install', req, b.installId);
    if (!install) return notFound(res, 'Install');
    const existing = await prisma.license.findFirst({ where: { tenantId, installId: install.id } });
    if (existing) return fail(res, 409, 'license_exists', 'This install already has a licence; extend it instead.', { licenseId: existing.id });
  }
  let customer = null;
  if (b.customerId) {
    customer = await own('customer', req, b.customerId);
    if (!customer) return notFound(res, 'Customer');
    if (install && install.customerId && install.customerId !== customer.id) {
      return fail(res, 409, 'install_other_customer', 'That install belongs to another customer.');
    }
  } else if (install && install.customerId) {
    customer = await own('customer', req, install.customerId);
  }
  if (b.plan !== undefined && b.plan !== null) {
    const plan = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId, key: String(b.plan) } } });
    if (!plan) return invalid(res, { plan: 'unknown plan key' });
  }
  const lic = await prisma.license.create({
    data: {
      tenantId, installId: install ? install.id : null, customerId: customer ? customer.id : null,
      account: customer ? customer.email : (install ? install.account : null), tier: b.tier, plan: b.plan || null,
      status: 'active', currentPeriodEnd: t.end, source: 'manual', complimentary: b.complimentary === true, note: reason
    }
  });
  if (customer) {
    await addEvent(prisma, tenantId, customer.id, 'licence_granted', { licenseId: lic.id, tier: lic.tier, until: lic.currentPeriodEnd, complimentary: lic.complimentary });
    await recompute(req, customer.id);
  }
  await audit(prisma, req, 'license.grant', { targetType: 'license', targetId: lic.id, detail: { customerId: lic.customerId, installId: lic.installId, tier: lic.tier, until: lic.currentPeriodEnd, complimentary: lic.complimentary, reason } });
  res.status(201).json({ license: lic, bound: Boolean(lic.installId) });
}));

// POST /:id/extend { months | days | until, reason }
router.post('/:id/extend', asyncHandler(async (req, res) => {
  const lic = await own('license', req, req.params.id);
  if (!lic) return notFound(res, 'Licence');
  const b = req.body || {};
  const reason = reasonOf(b);
  const base = Math.max(Date.now(), lic.currentPeriodEnd ? new Date(lic.currentPeriodEnd).getTime() : 0);
  const t = termEnd(b, base);
  const errors = { ...(t.error || {}), ...(reason ? {} : { reason: 'say why (3-1000 characters)' }) };
  if (Object.keys(errors).length) return invalid(res, errors);
  const updated = await prisma.license.update({
    where: { id: lic.id },
    data: { status: 'active', currentPeriodEnd: t.end, revokedAt: null, revokedReason: null, note: [lic.note, reason].filter(Boolean).join('\n').slice(0, 5000) }
  });
  if (lic.customerId) {
    await addEvent(prisma, lic.tenantId, lic.customerId, 'licence_extended', { licenseId: lic.id, from: lic.currentPeriodEnd, until: updated.currentPeriodEnd });
    await recompute(req, lic.customerId);
  }
  await audit(prisma, req, 'license.extend', { targetType: 'license', targetId: lic.id, detail: { from: lic.currentPeriodEnd, until: updated.currentPeriodEnd, reason } });
  res.json({ license: updated });
}));

// POST /:id/revoke { reason }: ends it now (status canceled); the app loses it at its next refresh.
router.post('/:id/revoke', asyncHandler(async (req, res) => {
  const lic = await own('license', req, req.params.id);
  if (!lic) return notFound(res, 'Licence');
  const reason = reasonOf(req.body || {});
  if (!reason) return invalid(res, { reason: 'say why (3-1000 characters)' });
  if (lic.status === 'canceled') return fail(res, 409, 'already_revoked', 'This licence is already revoked.');
  const now = new Date();
  const updated = await prisma.license.update({ where: { id: lic.id }, data: { status: 'canceled', currentPeriodEnd: now, revokedAt: now, revokedReason: reason } });
  if (lic.customerId) {
    await addEvent(prisma, lic.tenantId, lic.customerId, 'licence_revoked', { licenseId: lic.id });
    await recompute(req, lic.customerId);
  }
  await audit(prisma, req, 'license.revoke', { targetType: 'license', targetId: lic.id, detail: { reason, previousEnd: lic.currentPeriodEnd } });
  res.json({ license: updated });
}));

// POST /:id/assign { installId }: binds a licence granted without an install to one.
router.post('/:id/assign', asyncHandler(async (req, res) => {
  const lic = await own('license', req, req.params.id);
  if (!lic) return notFound(res, 'Licence');
  if (lic.installId) return fail(res, 409, 'already_bound', 'This licence is already bound to an install.');
  const install = await own('install', req, (req.body || {}).installId);
  if (!install) return notFound(res, 'Install');
  const other = await prisma.license.findFirst({ where: { tenantId: req.tenant.id, installId: install.id } });
  if (other) return fail(res, 409, 'license_exists', 'That install already has a licence.', { licenseId: other.id });
  if (lic.customerId && install.customerId && install.customerId !== lic.customerId) return fail(res, 409, 'install_other_customer', 'That install belongs to another customer.');
  const updated = await prisma.license.update({ where: { id: lic.id }, data: { installId: install.id, customerId: lic.customerId || install.customerId || null } });
  await audit(prisma, req, 'license.assign', { targetType: 'license', targetId: lic.id, detail: { installId: install.id } });
  if (updated.customerId) await recompute(req, updated.customerId);
  res.json({ license: updated });
}));

module.exports = router;
