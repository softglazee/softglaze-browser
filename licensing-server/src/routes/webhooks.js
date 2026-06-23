'use strict';
// POST /v1/webhooks/stripe/:tenantId  — RAW body, per-tenant signature verified.
// On a confirmed payment, extends/creates the license. Idempotent (WebhookEvent).
const express = require('express');
const prisma = require('../db');
const { openJson } = require('../crypto/secrets');
const stripeProvider = require('../providers/stripe');

const router = express.Router();
const DAY = 86400000;

// Extend an account/install's license by N months (base = later of now / current end).
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

router.post('/stripe/:tenantId', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
    if (!tenant) return res.status(404).end();
    const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider: 'stripe' } } });
    if (!cfg) return res.status(400).end();
    const secrets = openJson(cfg.secretsSealed);

    let event;
    try {
      event = stripeProvider.verifyEvent({
        secretKey: secrets.secretKey, webhookSecret: secrets.webhookSecret,
        rawBody: req.body, signature: req.get('stripe-signature')
      });
    } catch (e) {
      return res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` });
    }

    // Idempotency: ignore replays of the same provider event.
    const seen = await prisma.webhookEvent.findUnique({ where: { id: event.id } }).catch(() => null);
    if (seen) return res.json({ received: true, duplicate: true });
    await prisma.webhookEvent.create({ data: { id: event.id, tenantId: tenant.id, provider: 'stripe', type: event.type } }).catch(() => {});

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object || {};
      const md = s.metadata || {};
      const email = (s.customer_details && s.customer_details.email) || null;
      await grantMonths(tenant, {
        account: md.account || email || null,
        installId: md.installId || s.client_reference_id || null,
        tier: md.tier || 'pro',
        plan: md.planKey || null,
        months: Number(md.months) || 1,
        providerRef: s.id
      });
      await prisma.payment.updateMany({ where: { tenantId: tenant.id, providerRef: s.id }, data: { status: 'paid' } });
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[webhook:stripe]', e && e.stack ? e.stack : e);
    res.status(500).json({ error: 'Webhook handler error.' });
  }
});

module.exports = router;
