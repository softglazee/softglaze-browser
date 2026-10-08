'use strict';
// Shared license provisioning, used by every payment webhook. grantMonths extends
// (or creates) a license; provisionFromPaymentRef recovers the grant details from
// the Payment row recorded at checkout, so all providers provision uniformly.
// Every function takes an optional `db` (a Prisma transaction client) so a webhook
// can make provisioning and the payment/event status change one atomic unit.
const prisma = require('./db');

const DAY = 86400000;

// Audit T2-6: an existing licence is matched by installId only. It used to match by account
// (an email from checkout metadata) too and then overwrite installId, so a one-month
// purchase made with a victim's email moved the victim's licence onto the buyer's install.
// The account is still recorded, but it never selects or re-binds a licence.
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

// Audit L2: claim the Payment recorded at checkout for (provider, providerRef) and flip
// it pending -> paid. The lookup is scoped to the provider, so a ref from one gateway can
// never settle another gateway's order, and the conditional update means only one caller
// ever wins: an already-paid (or failed/refunded) payment returns null and grants nothing.
async function claimPendingPayment(tenant, provider, providerRef, db = prisma) {
  if (!provider || !providerRef) return null;
  const payment = await db.payment.findFirst({
    where: { tenantId: tenant.id, provider: String(provider), providerRef: String(providerRef) },
    orderBy: { createdAt: 'desc' }
  });
  if (!payment || payment.status !== 'pending') return null;
  const won = await db.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'paid' } });
  return won && won.count === 1 ? { ...payment, status: 'paid' } : null;
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

// --- Subscriptions ----------------------------------------------------------
// Unlike grantMonths (additive, one-time), a subscription SETS the period end to
// an absolute date (the Stripe billing-period end), keyed primarily by the Stripe
// subscription id, so renewals are idempotent.
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

// --- Refunds and disputes (audit L8) -----------------------------------------
// The schema has no per-purchase ledger, only one licence per install whose period end
// stacks every purchase. The most conservative action it supports without taking away
// time the customer still paid for:
//  - one-time purchase: the Payment goes paid -> refunded (once; a second refund or a
//    dispute on the same charge is a no-op) and exactly the term it granted
//    (plan.months x 30 days) is removed from that install's licence. If nothing paid is
//    left, the licence is ended now with status 'canceled'.
//  - subscription: the licence keyed to the subscription is ended now ('canceled').
// Returns { changed }.
async function revokeForRefund(tenant, { provider, sessionRef, subscriptionId }, db = prisma) {
  const now = Date.now();
  if (sessionRef) {
    const payment = await db.payment.findFirst({
      where: { tenantId: tenant.id, provider: String(provider), providerRef: String(sessionRef) },
      orderBy: { createdAt: 'desc' }
    });
    if (payment) {
      const won = await db.payment.updateMany({ where: { id: payment.id, status: 'paid' }, data: { status: 'refunded' } });
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

module.exports = { grantMonths, claimPendingPayment, provisionFromPaymentRef, setSubscriptionPeriod, cancelSubscription, revokeForRefund };
