'use strict';
// /v1/admin/payments: list, record a manual payment (invoice, bank transfer, Payoneer, 2Checkout) which
// updates the customer and can grant or extend their licence in the same call, and mark a manual
// payment refunded.
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { fail, invalid, notFound, settingsFor, own, pageParams, dateRange, csvList } = require('../http');
const { audit } = require('../audit');
const { addEvent, recomputeCustomer } = require('../../customers/sync');
const { termMs } = require('../../util/time');

const router = express.Router();
const DAY = 86400000;
const METHODS = ['invoice', 'bank_transfer', 'payoneer', '2checkout', 'other'];

router.get('/', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.status) where.status = { in: csvList(q.status) };
  if (q.provider) where.provider = { in: csvList(q.provider) };
  if (q.method) where.method = { in: csvList(q.method) };
  if (q.currency) where.currency = { in: csvList(q.currency).map((c) => c.toUpperCase()) };
  if (q.customerId) where.customerId = String(q.customerId);
  const r = dateRange(q, 'from', 'to');
  if (r.error) return invalid(res, { [r.error]: 'invalid_date' });
  if (r.range) where.paidAt = r.range;
  const p = pageParams(q);
  const sort = ['paidAt', 'createdAt', 'amount'].includes(q.sort) ? q.sort : 'createdAt';
  const [total, items] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: [{ [sort]: q.order === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

// Extend the customer's licence (or create one) for `months`. Returns the licence.
async function grantForPayment(tenantId, customer, { tier, plan, months, installId, note }) {
  const now = Date.now();
  let lic = null;
  if (installId) lic = await prisma.license.findFirst({ where: { tenantId, installId }, orderBy: { updatedAt: 'desc' } });
  if (!lic && !installId) {
    lic = await prisma.license.findFirst({ where: { tenantId, customerId: customer.id, complimentary: false }, orderBy: { updatedAt: 'desc' } });
  }
  if (lic) {
    const base = Math.max(now, lic.currentPeriodEnd ? new Date(lic.currentPeriodEnd).getTime() : 0);
    return prisma.license.update({
      where: { id: lic.id },
      data: { status: 'active', tier, plan: plan || lic.plan, currentPeriodEnd: new Date(base + termMs(months)), customerId: customer.id, revokedAt: null, revokedReason: null, note: [lic.note, note].filter(Boolean).join('\n').slice(0, 5000) }
    });
  }
  let target = installId || null;
  if (!target) {
    // The customer's one install without a licence, if there is exactly one.
    const installs = await prisma.install.findMany({ where: { tenantId, customerId: customer.id } });
    const free = [];
    for (const i of installs) if (!(await prisma.license.findFirst({ where: { tenantId, installId: i.id } }))) free.push(i);
    if (free.length === 1) target = free[0].id;
  }
  return prisma.license.create({
    data: {
      tenantId, installId: target, customerId: customer.id, account: customer.email, tier, plan: plan || null, status: 'active',
      currentPeriodEnd: new Date(now + termMs(months)), source: 'manual', note
    }
  });
}

// POST { customerId, amount (cents), currency, method, reference, paidAt?, plan?, note?,
//        grant?: true | { months?, tier?, installId? } }
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const tenantId = req.tenant.id;
  const errors = {};
  if (!Number.isInteger(b.amount) || b.amount < 1 || b.amount > 100000000) errors.amount = 'integer minor units (cents), 1 to 100000000';
  const currency = String(b.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'ISO 4217 code, e.g. USD';
  if (!METHODS.includes(b.method)) errors.method = METHODS.join(' | ');
  const reference = typeof b.reference === 'string' ? b.reference.trim() : '';
  if (reference.length < 2 || reference.length > 120) errors.reference = 'invoice number or transfer reference, 2-120 characters';
  let paidAt = new Date();
  if (b.paidAt !== undefined) {
    paidAt = new Date(String(b.paidAt));
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + DAY) errors.paidAt = 'a date, not in the future';
  }
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 2000)) errors.note = 'string, at most 2000 characters';
  if (Object.keys(errors).length) return invalid(res, errors);

  const customer = await own('customer', req, b.customerId);
  if (!customer) return notFound(res, 'Customer');
  let plan = null;
  if (b.plan) {
    plan = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId, key: String(b.plan) } } });
    if (!plan) return invalid(res, { plan: 'unknown plan key' });
  }
  const g = b.grant === true ? {} : (b.grant && typeof b.grant === 'object' ? b.grant : null);
  if (g) {
    const gErr = {};
    if (g.months !== undefined && (!Number.isInteger(g.months) || g.months < 1 || g.months > 120)) gErr['grant.months'] = 'integer 1-120';
    if (g.tier !== undefined && !['pro', 'enterprise'].includes(g.tier)) gErr['grant.tier'] = 'pro or enterprise';
    if (g.installId !== undefined) {
      const inst = await own('install', req, g.installId);
      if (!inst) gErr['grant.installId'] = 'unknown install';
      else if (inst.customerId && inst.customerId !== customer.id) gErr['grant.installId'] = 'that install belongs to another customer';
    }
    if (Object.keys(gErr).length) return invalid(res, gErr);
  }
  const dup = await prisma.payment.findFirst({ where: { tenantId, provider: 'manual', method: b.method, providerRef: reference } });
  if (dup) return fail(res, 409, 'duplicate_payment', 'A manual payment with this method and reference is already recorded.', { paymentId: dup.id });

  const payment = await prisma.payment.create({
    data: {
      tenantId, provider: 'manual', providerRef: reference, method: b.method, amount: b.amount, currency, status: 'paid', paidAt,
      customerId: customer.id, account: customer.email, plan: plan ? plan.key : null, note: b.note || null, recordedBy: req.admin.actor,
      installId: g && g.installId ? String(g.installId) : null
    }
  });
  let license = null;
  if (g) {
    license = await grantForPayment(tenantId, customer, {
      tier: g.tier || (plan && plan.tier) || 'pro',
      plan: plan ? plan.key : null,
      months: g.months || (plan && plan.months) || 1,
      installId: g.installId ? String(g.installId) : null,
      note: `Manual payment ${b.method} ${reference}`
    });
  }
  await addEvent(prisma, tenantId, customer.id, 'payment_recorded', { paymentId: payment.id, amount: payment.amount, currency, method: b.method, licenseId: license ? license.id : null });
  const s = await settingsFor(req);
  const updated = await recomputeCustomer(prisma, tenantId, customer.id, { graceDays: s.billing.renewalGraceDays });
  await audit(prisma, req, 'payment.record', { targetType: 'payment', targetId: payment.id, detail: { customerId: customer.id, amount: payment.amount, currency, method: b.method, reference, licenseId: license ? license.id : null } });
  res.status(201).json({ payment, license, customer: updated ? { id: updated.id, status: updated.status, paidUntil: updated.paidUntil, totalPaidCents: updated.totalPaidCents } : null });
}));

// POST /:id/refund { reason }: manual payments only (gateway refunds arrive by webhook). The licence is
// not changed here; revoke it with POST /v1/admin/licenses/:id/revoke if that is wanted.
router.post('/:id/refund', asyncHandler(async (req, res) => {
  const p = await own('payment', req, req.params.id);
  if (!p) return notFound(res, 'Payment');
  if (p.provider !== 'manual') return fail(res, 409, 'not_manual', 'Refund gateway payments at the gateway; its webhook updates the record.');
  if (p.status !== 'paid') return fail(res, 409, 'not_paid', 'Only a paid payment can be refunded.');
  const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 1000) return invalid(res, { reason: 'say why (3-1000 characters)' });
  const updated = await prisma.payment.update({ where: { id: p.id }, data: { status: 'refunded', refundedAt: new Date(), note: [p.note, `Refunded: ${reason}`].filter(Boolean).join('\n').slice(0, 5000) } });
  if (p.customerId) {
    await addEvent(prisma, p.tenantId, p.customerId, 'payment_refunded', { paymentId: p.id, amount: p.amount, currency: p.currency });
    const s = await settingsFor(req);
    await recomputeCustomer(prisma, p.tenantId, p.customerId, { graceDays: s.billing.renewalGraceDays });
  }
  await audit(prisma, req, 'payment.refund', { targetType: 'payment', targetId: p.id, detail: { amount: p.amount, currency: p.currency, reason } });
  res.json({ payment: updated });
}));

module.exports = router;
