'use strict';
// Per-tenant, signature-verified payment webhooks. Each provider verifies with the
// tenant's own sealed secrets, dedups by event id (WebhookEvent), then provisions
// the license uniformly from the Payment row recorded at checkout.
const express = require('express');
const prisma = require('../db');
const { openJson } = require('../crypto/secrets');
const stripeProvider = require('../providers/stripe');
const paypalProvider = require('../providers/paypal');
const cryptomusProvider = require('../providers/cryptomus');
const { provisionFromPaymentRef } = require('../licensing');

const router = express.Router();

async function tenantAndSecrets(tenantId, provider) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return {};
  const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider } } });
  if (!cfg) return { tenant };
  return { tenant, secrets: openJson(cfg.secretsSealed) };
}

// Idempotency guard: true => first time (proceed), false => replay (skip).
async function firstTime(tenantId, provider, eventId, type) {
  if (!eventId) return true;
  const seen = await prisma.webhookEvent.findUnique({ where: { id: String(eventId) } }).catch(() => null);
  if (seen) return false;
  await prisma.webhookEvent.create({ data: { id: String(eventId), tenantId, provider, type: type || '' } }).catch(() => {});
  return true;
}

// --- Stripe (raw body for signature verification) ---------------------------
router.post('/stripe/:tenantId', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const { tenant, secrets } = await tenantAndSecrets(req.params.tenantId, 'stripe');
    if (!tenant || !secrets) return res.status(404).end();
    let event;
    try {
      event = stripeProvider.verifyEvent({ secretKey: secrets.secretKey, webhookSecret: secrets.webhookSecret, rawBody: req.body, signature: req.get('stripe-signature') });
    } catch (e) { return res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` }); }

    if (!(await firstTime(tenant.id, 'stripe', event.id, event.type))) return res.json({ received: true, duplicate: true });
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object || {};
      const md = s.metadata || {};
      await provisionFromPaymentRef(tenant, s.id, {
        account: md.account || (s.customer_details && s.customer_details.email) || null,
        installId: md.installId || s.client_reference_id || null,
        planKey: md.planKey || null, tier: md.tier, months: Number(md.months) || undefined
      });
    }
    res.json({ received: true });
  } catch (e) { console.error('[webhook:stripe]', e && e.stack ? e.stack : e); res.status(500).json({ error: 'handler error' }); }
});

// --- Cryptomus (offline sign verification) ----------------------------------
router.post('/cryptomus/:tenantId', express.json({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    const { tenant, secrets } = await tenantAndSecrets(req.params.tenantId, 'cryptomus');
    if (!tenant || !secrets) return res.status(404).end();
    const payload = req.body || {};
    if (!cryptomusProvider.verifyWebhook({ secrets, payload })) return res.status(400).json({ error: 'bad signature' });
    const eventId = `cmus_${payload.uuid || payload.order_id || ''}_${payload.status || payload.payment_status || ''}`;
    if (!(await firstTime(tenant.id, 'cryptomus', eventId, payload.type || 'payment'))) return res.json({ received: true, duplicate: true });
    if (cryptomusProvider.isPaid(payload)) await provisionFromPaymentRef(tenant, payload.uuid || payload.order_id);
    res.json({ received: true });
  } catch (e) { console.error('[webhook:cryptomus]', e && e.stack ? e.stack : e); res.status(500).json({ error: 'handler error' }); }
});

// --- PayPal (verify via API, then capture the approved order) ---------------
router.post('/paypal/:tenantId', express.json({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    const { tenant, secrets } = await tenantAndSecrets(req.params.tenantId, 'paypal');
    if (!tenant || !secrets) return res.status(404).end();
    const event = req.body || {};
    if (!(await paypalProvider.verifyWebhook({ secrets, headers: req.headers, event }))) return res.status(400).json({ error: 'bad signature' });
    if (!(await firstTime(tenant.id, 'paypal', event.id, event.event_type))) return res.json({ received: true, duplicate: true });
    const resource = event.resource || {};
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = resource.id;
      await paypalProvider.captureOrder({ secrets, orderId }).catch(() => {}); // capture, then provision
      await provisionFromPaymentRef(tenant, orderId);
    } else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.order_id;
      if (orderId) await provisionFromPaymentRef(tenant, orderId);
    }
    res.json({ received: true });
  } catch (e) { console.error('[webhook:paypal]', e && e.stack ? e.stack : e); res.status(500).json({ error: 'handler error' }); }
});

module.exports = router;
