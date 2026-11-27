'use strict';
// Shared license provisioning for every payment webhook; grants come from the Payment row recorded
// at checkout. Each function takes an optional `db` (a Prisma transaction client) so provisioning
// and the payment status change commit as one unit.
const prisma = require('./db');
const { termMs } = require('./util/time');
const { isWebPayment, issueWebCode, voidWebCode } = require('./webPurchase');
const { isLifetime } = require('./plans/sales');
const guard = require('./plans/lifetimeGuard');

// Account licences (27 Nov 2026, src/accountCheckout.js): a plan bought while signed in on the web app sits on
// the account (customerId set, installId null, source 'account'). /v1/license leases it to the account's
// computers (routes/license.js), and /v1/account/me reports it. ACCOUNT_SOURCE marks those rows.
const ACCOUNT_SOURCE = 'account';
const accountLicenceWhere = (tenantId, customerId) => ({ tenantId, customerId: String(customerId), installId: null, source: ACCOUNT_SOURCE });

// A paid purchase that the lifetime guard did not apply (the buyer already has a lifetime licence):
// the payment stays paid (the money was taken) and gets a note for a manual refund, found in the admin
// with GET /v1/admin/payments?flag=lifetime_guard, and a warning goes to the server log.
async function flagLifetimeConflict(db, payment, lic, what) {
  const line = `${guard.FLAG} NEEDS MANUAL REFUND: ${what} was paid for install ${lic.installId || '?'}, which already has ` +
    `${lic.tier} lifetime (licence ${lic.id}). The lifetime licence was left unchanged; nothing was granted.`;
  console.warn(`[licensing] payment ${payment && payment.id ? payment.id : '?'}: ${line}`);
  if (!payment || !payment.id) return;
  const fresh = (await db.payment.findUnique({ where: { id: payment.id } })) || payment;
  if (String(fresh.note || '').includes(guard.FLAG)) return;
  await db.payment.update({ where: { id: payment.id }, data: { note: [fresh.note, line].filter(Boolean).join('\n').slice(0, 5000) } });
}

// Match an existing licence by installId only, never by account: the account comes from checkout
// metadata, so matching on it lets a purchase with someone else's email take over their licence.
// Lifetime guard (src/plans/lifetimeGuard.js): when the install has a lifetime licence, nothing changes
// unless this grant is a higher-tier lifetime, which upgrades that licence in place (its end stays the
// later of the two, never stacked). A blocked grant returns the lifetime licence with lifetimeGuard: true.
async function grantMonths(tenant, { account, installId, customerId, tier, plan, months, providerRef, lifetime = false }, db = prisma) {
  const now = Date.now();
  // No install but an account: the grant goes on the account's own licence.
  const onAccount = !installId && Boolean(customerId);
  const life = onAccount
    ? await guard.findCustomerLifetimeLicence(db, tenant.id, customerId, now)
    : await guard.findLifetimeLicence(db, tenant.id, installId, now);
  if (life) {
    if (!guard.allowedOnLifetime(life, { tier, lifetime })) return { ...life, lifetimeGuard: true };
    const end = Math.max(new Date(life.currentPeriodEnd).getTime(), now + termMs(months || 1));
    return db.license.update({
      where: { id: life.id },
      data: {
        status: 'active', tier, plan: plan || null, currentPeriodEnd: new Date(end),
        providerRef: providerRef || life.providerRef, account: life.account || account || null
      }
    });
  }
  const existing = installId
    ? await db.license.findFirst({ where: { tenantId: tenant.id, installId }, orderBy: { updatedAt: 'desc' } })
    : onAccount
      // A one-time term stacks on the account's one-time licence, never on its subscription (that one
      // follows Stripe's billing periods).
      ? await db.license.findFirst({ where: { ...accountLicenceWhere(tenant.id, customerId), NOT: { providerRef: { startsWith: 'sub_' } } }, orderBy: { updatedAt: 'desc' } })
      : null;
  const base = existing && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > now
    ? new Date(existing.currentPeriodEnd).getTime() : now;
  const currentPeriodEnd = new Date(base + termMs(months || 1));

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
      tier: tier || 'pro', plan: plan || null, status: 'active', currentPeriodEnd, providerRef: providerRef || null,
      ...(onAccount ? { customerId: String(customerId), source: ACCOUNT_SOURCE } : {})
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
// A website purchase (method 'web', no install) gets no licence: it gets one single-use activation
// code, emailed to the buyer (src/webPurchase.js), and returns { provisioned, webCode: { outboxId } }.
async function provisionFromPaymentRef(tenant, provider, providerRef, fallback = {}, db = prisma) {
  const payment = await claimPendingPayment(tenant, provider, providerRef, db);
  if (!payment) return { provisioned: false };
  const planKey = payment.plan || fallback.planKey || null;
  const plan = planKey
    ? await db.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: planKey } } })
    : null;
  if (isWebPayment(payment)) {
    // A Stripe website checkout may start without an email (Stripe's page asks for it): take the one the
    // paid session carries, so the activation code has somewhere to go.
    const fromSession = typeof fallback.account === 'string' ? fallback.account.trim().toLowerCase() : '';
    let webPayment = payment;
    if (!payment.account && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromSession)) {
      webPayment = await db.payment.update({ where: { id: payment.id }, data: { account: fromSession.slice(0, 254) } });
    }
    const { outboxId } = await issueWebCode(tenant, webPayment, plan, db);
    return { provisioned: true, webCode: { paymentId: payment.id, outboxId } };
  }
  const lic = await grantMonths(tenant, {
    account: payment.account || fallback.account || null,
    installId: payment.installId || fallback.installId || null,
    customerId: payment.method === ACCOUNT_SOURCE ? payment.customerId : null,
    tier: (plan && plan.tier) || fallback.tier || 'pro',
    plan: planKey,
    months: (plan && plan.months) || fallback.months || 1,
    providerRef: String(providerRef),
    lifetime: isLifetime(plan)
  }, db);
  if (lic && lic.lifetimeGuard) {
    await flagLifetimeConflict(db, payment, lic, `plan ${planKey || '?'} (${provider} ${providerRef})`);
    return { provisioned: false, lifetimeGuard: true };
  }
  if (payment.method === ACCOUNT_SOURCE && payment.customerId) {
    // The account's cached plan (GET /v1/account/me) follows at once, not at the next cron run.
    await require('./customers/sync').recomputeCustomer(db, tenant.id, payment.customerId).catch(() => {});
  }
  return { provisioned: true };
}

// A subscription sets the period end to an absolute date (the Stripe billing-period end), keyed by
// the Stripe subscription id so renewals are idempotent; grantMonths is additive instead.
async function setSubscriptionPeriod(tenant, { subscriptionId, account, installId, customerId, tier, plan, periodEnd, status = 'active' }, db = prisma) {
  const onAccount = !installId && Boolean(customerId);
  // Match by the subscription first (renewals), then by installId. Never by account: see
  // grantMonths. An existing licence keeps the install it is already bound to.
  const bySubscription = subscriptionId
    ? await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } })
    : null;
  let existing = bySubscription;
  if (!existing && installId) {
    existing = await db.license.findFirst({ where: { tenantId: tenant.id, installId }, orderBy: { updatedAt: 'desc' } });
  }
  // Lifetime guard: a subscription never changes a lifetime licence, nor starts on an install that has
  // one. A renewal of a subscription's own (non-lifetime) licence row is left alone. The caller flags
  // a paid first charge for a manual refund; a blocked renewal is logged.
  const now = Date.now();
  const life = (existing && guard.isLifetimeLicence(existing, null, now) ? existing : null)
    || (!bySubscription
      ? (onAccount ? await guard.findCustomerLifetimeLicence(db, tenant.id, customerId, now) : await guard.findLifetimeLicence(db, tenant.id, installId, now))
      : null);
  if (life) {
    console.warn(`[licensing] subscription ${subscriptionId || '?'} not applied: install ${life.installId || '?'} has ${life.tier} lifetime (licence ${life.id}). Cancel the subscription and refund it by hand.`);
    return { ...life, lifetimeGuard: true };
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
  return db.license.create({ data: { tenantId: tenant.id, ...data, ...(onAccount ? { customerId: String(customerId), source: ACCOUNT_SOURCE } : {}) } });
}

// Subscription ended / canceled at Stripe — stop issuing leases.
async function cancelSubscription(tenant, subscriptionId, db = prisma) {
  const lic = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } });
  if (lic) await db.license.update({ where: { id: lic.id }, data: { status: 'expired' } });
}

// No per-purchase ledger exists, only one licence per install stacking every purchase. One-time:
// Payment paid -> refunded once, and its term (plan.months, util/time termDays) is removed; with nothing paid
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
      // A website purchase has no licence of its own: its activation code stops working if unused.
      if (isWebPayment(payment)) { await voidWebCode(db, tenant.id, payment); return { changed: true }; }
      // The lifetime guard granted nothing for this payment: its refund takes nothing back.
      if (String(payment.note || '').includes(guard.FLAG)) return { changed: true };
      let lic = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(sessionRef) }, orderBy: { updatedAt: 'desc' } });
      if (!lic && payment.installId) {
        lic = await db.license.findFirst({ where: { tenantId: tenant.id, installId: payment.installId }, orderBy: { updatedAt: 'desc' } });
      }
      // An account subscription (src/accountCheckout.js) has no install: its licence is keyed by the
      // subscription, and refunding its charge ends it, as a refunded subscription does below.
      if (!lic && subscriptionId) {
        const sub = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } });
        if (sub && sub.status !== 'canceled') await db.license.update({ where: { id: sub.id }, data: { status: 'canceled', currentPeriodEnd: new Date(now) } });
        if (payment.customerId) await require('./customers/sync').recomputeCustomer(db, tenant.id, payment.customerId).catch(() => {});
        return { changed: true };
      }
      if (!lic) return { changed: true };
      const end = lic.currentPeriodEnd ? new Date(lic.currentPeriodEnd).getTime() : now;
      const shortened = end - termMs(months);
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

// The account's ACTIVE licences (src/accountCheckout.js) for a computer SIGNED IN to that account, on at most
// the plan's `devices` signed-in computers (the ones seen most recently). Signed in means a live desktop
// AuthSession for this install and customer (one-click or email-code sign-in): Install.customerId alone is
// not enough, because the cron links an install to a customer from the email it merely claims
// (customers/sync.js reconcileTenant). Never an ended or refunded licence, so an account licence can make a
// computer paid but never lock it.
async function liveDesktopInstallIds(db, tenantId, customerId, now) {
  const rows = await db.authSession.findMany({
    where: { tenantId, customerId: String(customerId), kind: 'desktop', revokedAt: null, NOT: { installId: '' } },
    select: { installId: true, expiresAt: true }
  });
  return new Set(rows.filter((r) => !r.expiresAt || new Date(r.expiresAt).getTime() > now).map((r) => r.installId));
}

async function accountLicencesFor(db, tenantId, install, now = Date.now(), limitsOf = null) {
  if (!install || !install.customerId) return [];
  const signedIn = await liveDesktopInstallIds(db, tenantId, install.customerId, now);
  if (!signedIn.has(install.id)) return [];
  const rows = (await db.license.findMany({ where: accountLicenceWhere(tenantId, install.customerId) }))
    .filter((l) => l.status === 'active' && l.currentPeriodEnd && new Date(l.currentPeriodEnd).getTime() > now);
  if (!rows.length) return [];
  const best = pickLeaseLicence(rows, now);
  const limits = limitsOf ? await limitsOf(best) : null;
  const devices = Math.max(1, Number(limits && limits.devices) || (best.tier === 'enterprise' ? 10 : 3));
  const recent = await db.install.findMany({
    where: { tenantId, customerId: install.customerId, id: { in: [...signedIn] } }, orderBy: { lastSeenAt: 'desc' }, take: devices, select: { id: true }
  });
  return recent.some((i) => i.id === install.id) ? rows : [];
}

module.exports = { accountLicencesFor, ACCOUNT_SOURCE, accountLicenceWhere, pickLeaseLicence, grantMonths, flagLifetimeConflict, claimPendingPayment, provisionFromPaymentRef, setSubscriptionPeriod, cancelSubscription, revokeForRefund };
