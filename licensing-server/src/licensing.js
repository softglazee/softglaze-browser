'use strict';
// Shared license provisioning, used by every payment webhook. grantMonths extends
// (or creates) a license; provisionFromPaymentRef recovers the grant details from
// the Payment row recorded at checkout, so all providers provision uniformly.
const prisma = require('./db');

const DAY = 86400000;

async function grantMonths(tenant, { account, installId, tier, plan, months, providerRef }) {
  const now = Date.now();
  const or = [account ? { account } : null, installId ? { installId } : null].filter(Boolean);
  const existing = or.length
    ? await prisma.license.findFirst({ where: { tenantId: tenant.id, OR: or }, orderBy: { updatedAt: 'desc' } })
    : null;
  const base = existing && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > now
    ? new Date(existing.currentPeriodEnd).getTime() : now;
  const currentPeriodEnd = new Date(base + (months || 1) * 30 * DAY);

  if (existing) {
    return prisma.license.update({
      where: { id: existing.id },
      data: {
        status: 'active', tier: tier || existing.tier, plan: plan || existing.plan,
        currentPeriodEnd, providerRef: providerRef || existing.providerRef,
        installId: installId || existing.installId, account: account || existing.account
      }
    });
  }
  return prisma.license.create({
    data: {
      tenantId: tenant.id, account: account || null, installId: installId || null,
      tier: tier || 'pro', plan: plan || null, status: 'active', currentPeriodEnd, providerRef: providerRef || null
    }
  });
}

// Recover grant details from the Payment recorded at checkout (uniform across
// providers), look up the plan for tier/months, grant, and mark the payment paid.
async function provisionFromPaymentRef(tenant, providerRef, fallback = {}) {
  const payment = providerRef
    ? await prisma.payment.findFirst({ where: { tenantId: tenant.id, providerRef: String(providerRef) }, orderBy: { createdAt: 'desc' } })
    : null;
  const planKey = (payment && payment.plan) || fallback.planKey || null;
  const plan = planKey
    ? await prisma.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: planKey } } })
    : null;
  await grantMonths(tenant, {
    account: (payment && payment.account) || fallback.account || null,
    installId: (payment && payment.installId) || fallback.installId || null,
    tier: (plan && plan.tier) || fallback.tier || 'pro',
    plan: planKey,
    months: (plan && plan.months) || fallback.months || 1,
    providerRef: providerRef ? String(providerRef) : null
  });
  if (payment) await prisma.payment.update({ where: { id: payment.id }, data: { status: 'paid' } }).catch(() => {});
}

module.exports = { grantMonths, provisionFromPaymentRef };
