'use strict';
// Shared license provisioning for every payment webhook; grants come from the Payment row recorded
// at checkout. Each function takes an optional `db` (a Prisma transaction client) so provisioning
// and the payment status change commit as one unit.
const prisma = require('./db');

const DAY = 86400000;

// Match an existing licence by installId only, never by account: the account comes from checkout
// metadata, so matching on it lets a purchase with someone else's email take over their licence.
async function grantMonths(tenant, { account, installId, tier, plan, months, providerRef }, db = prisma) {
  const now = Date.now();
  const existing = installId
    ? await db.license.findFirst({ where: { tenantId: tenant.id, installId }, orderBy: { updatedAt: 'desc' } })
    : null;
  const base = existing && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > now
    ? new Date(existing.currentPeriodEnd).getTime() : now;
  const currentPeriodEnd = new Date(base + (months || 1) * 30 * DAY);

  if (existing) {
    return db.license.update({
      where: { id: existing.id },
      data: {
        status: 'active', tier: tier || existing.tier, plan: plan || existing.plan,
        currentPeriodEnd, providerRef: providerRef || existing.providerRef,
        account: existing.account || account || null
      }
    });
  }
  return db.license.create({
    data: {
      tenantId: tenant.id, account: account || null, installId: installId || null,
      tier: tier || 'pro', plan: plan || null, status: 'active', currentPeriodEnd, providerRef: providerRef || null
    }
  });
}

// Claim the checkout Payment for (provider, providerRef) and flip it pending -> paid. Scoped to the
// provider so one gateway's ref cannot settle another's; the conditional update lets only one caller
// win, and a payment that is not pending returns null.
async function claimPendingPayment(tenant, provider, providerRef, db = prisma) {
  if (!provider || !providerRef) return null;
  const payment = await db.payment.findFirst({
    where: { tenantId: tenant.id, provider: String(provider), providerRef: String(providerRef) },
    orderBy: { createdAt: 'desc' }
  });
  if (!payment || payment.status !== 'pending') return null;
  const paidAt = new Date();
  const won = await db.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'paid', paidAt } });
  return won && won.count === 1 ? { ...payment, status: 'paid', paidAt } : null;
}

// Recover grant details from the Payment recorded at checkout (uniform across
// providers), look up the plan for tier/months, grant, and mark the payment paid.
// Returns { provisioned }. No pending Payment for this provider+ref => nothing happens.
async function provisionFromPaymentRef(tenant, provider, providerRef, fallback = {}, db = prisma) {
  const payment = await claimPendingPayment(tenant, provider, providerRef, db);
  if (!payment) return { provisioned: false };
  const planKey = payment.plan || fallback.planKey || null;
  const plan = planKey
    ? await db.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: planKey } } })
    : null;
  await grantMonths(tenant, {
    account: payment.account || fallback.account || null,
    installId: payment.installId || fallback.installId || null,
    tier: (plan && plan.tier) || fallback.tier || 'pro',
    plan: planKey,
    months: (plan && plan.months) || fallback.months || 1,
    providerRef: String(providerRef)
  }, db);
  return { provisioned: true };
}

// A subscription sets the period end to an absolute date (the Stripe billing-period end), keyed by
// the Stripe subscription id so renewals are idempotent; grantMonths is additive instead.
async function setSubscriptionPeriod(tenant, { subscriptionId, account, installId, tier, plan, periodEnd, status = 'active' }, db = prisma) {
  // Match by the subscription first (renewals), then by installId. Never by account: see
  // grantMonths. An existing licence keeps the install it is already bound to.
  let existing = subscriptionId
    ? await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } })
    : null;
  if (!existing && installId) {
    existing = await db.license.findFirst({ where: { tenantId: tenant.id, installId }, orderBy: { updatedAt: 'desc' } });
  }
  const data = {
    status,
    tier: tier || (existing && existing.tier) || 'pro',
    plan: plan || (existing && existing.plan) || null,
    currentPeriodEnd: periodEnd || (existing && existing.currentPeriodEnd) || null,
    providerRef: subscriptionId ? String(subscriptionId) : (existing && existing.providerRef) || null,
    account: (existing && existing.account) || account || null,
    installId: (existing && existing.installId) || installId || null
  };
  if (existing) return db.license.update({ where: { id: existing.id }, data });
  return db.license.create({ data: { tenantId: tenant.id, ...data } });
}

// Subscription ended / canceled at Stripe — stop issuing leases.
async function cancelSubscription(tenant, subscriptionId, db = prisma) {
  const lic = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } });
  if (lic) await db.license.update({ where: { id: lic.id }, data: { status: 'expired' } });
}

// No per-purchase ledger exists, only one licence per install stacking every purchase. One-time:
// Payment paid -> refunded once, and its term (plan.months x 30 days) is removed; with nothing paid
// left the licence ends as 'canceled'. Subscription: its licence ends now. Returns { changed }.
async function revokeForRefund(tenant, { provider, sessionRef, subscriptionId }, db = prisma) {
  const now = Date.now();
  if (sessionRef) {
    const payment = await db.payment.findFirst({
      where: { tenantId: tenant.id, provider: String(provider), providerRef: String(sessionRef) },
      orderBy: { createdAt: 'desc' }
    });
    if (payment) {
      const won = await db.payment.updateMany({ where: { id: payment.id, status: 'paid' }, data: { status: 'refunded', refundedAt: new Date(now) } });
      if (!won || won.count !== 1) return { changed: false };
      const plan = payment.plan
        ? await db.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: payment.plan } } })
        : null;
      const months = (plan && plan.months) || 1;
      let lic = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(sessionRef) }, orderBy: { updatedAt: 'desc' } });
      if (!lic && payment.installId) {
        lic = await db.license.findFirst({ where: { tenantId: tenant.id, installId: payment.installId }, orderBy: { updatedAt: 'desc' } });
      }
      if (!lic) return { changed: true };
      const end = lic.currentPeriodEnd ? new Date(lic.currentPeriodEnd).getTime() : now;
      const shortened = end - months * 30 * DAY;
      const data = shortened > now
        ? { currentPeriodEnd: new Date(shortened) }
        : { currentPeriodEnd: new Date(now), status: 'canceled' };
      await db.license.update({ where: { id: lic.id }, data });
      return { changed: true };
    }
  }
  if (subscriptionId) {
    const lic = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } });
    if (!lic || lic.status === 'canceled') return { changed: false };
    await db.license.update({ where: { id: lic.id }, data: { status: 'canceled', currentPeriodEnd: new Date(now) } });
    return { changed: true };
  }
  return { changed: false };
}

// The licence /v1/license leases from an install's licences: an active one (status active, term not
// ended) with the best tier, then the latest end; with none active, the most recently updated (its
// status is reported). Before Microsoft Store purchases an install had one licence, so the result is
// the same as the old "most recently updated" for every existing install.
const TIER_RANK = { pro: 1, enterprise: 2 };
function pickLeaseLicence(licences, now = Date.now()) {
  const list = Array.isArray(licences) ? licences.filter(Boolean) : [];
  if (!list.length) return null;
  const end = (l) => (l.currentPeriodEnd ? new Date(l.currentPeriodEnd).getTime() : 0);
  const active = list.filter((l) => l.status === 'active' && end(l) > now);
  if (active.length) {
    return active.sort((a, b) => ((TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0)) || (end(b) - end(a)))[0];
  }
  return list.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0];
}

module.exports = { pickLeaseLicence, grantMonths, claimPendingPayment, provisionFromPaymentRef, setSubscriptionPeriod, cancelSubscription, revokeForRefund };
