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
const { provisionFromPaymentRef, claimPendingPayment, setSubscriptionPeriod, cancelSubscription, revokeForRefund } = require('../licensing');

const router = express.Router();
const DAY = 86400000;
// An event row that is still unprocessed this long after it was claimed belongs to an
// attempt that died mid-way (crash, killed container); a retry may take it over.
const STALE_CLAIM_MS = 10 * 60000;

async function tenantAndSecrets(tenantId, provider) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return {};
  const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider } } });
  if (!cfg) return { tenant };
  return { tenant, secrets: openJson(cfg.secretsSealed) };
}

// Audit L5: race-free, retry-safe idempotency.
//  1. Insert the WebhookEvent row FIRST. The primary key makes the insert the lock: a
//     unique-constraint violation (P2002) means another delivery owns or finished it.
//  2. prepare() does the provider calls (capture, lookups) outside any DB transaction.
//  3. The returned apply(tx) runs in one transaction together with marking the event
//     processed, so provisioning and the status change commit or roll back together.
//  4. On any failure the event row is deleted, so the provider's retry is reprocessed.
// Returns false for a duplicate, true when handled.
async function claimEvent(id, tenantId, provider, type) {
  try {
    await prisma.webhookEvent.create({ data: { id, tenantId, provider, type: type || '' } });
    return true;
  } catch (e) {
    if (!e || e.code !== 'P2002') throw e;
    const takeover = await prisma.webhookEvent.updateMany({
      where: { id, processedAt: null, receivedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      data: { receivedAt: new Date() }
    });
    return Boolean(takeover && takeover.count === 1);
  }
}

async function handleOnce(tenantId, provider, eventId, type, prepare) {
  const id = eventId ? String(eventId) : null;
  if (id && !(await claimEvent(id, tenantId, provider, type))) return false;
  try {
    const apply = await prepare();
    await prisma.$transaction(async (tx) => {
      if (apply) await apply(tx);
      if (id) await tx.webhookEvent.update({ where: { id }, data: { processedAt: new Date() } });
    });
  } catch (e) {
    if (id) await prisma.webhookEvent.delete({ where: { id } }).catch(() => {});
    throw e;
  }
  return true;
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

// Stripe checkout session that is actually paid (audit L8: completed != paid for
// delayed methods; those arrive later as checkout.session.async_payment_succeeded).
function stripeSessionApply(tenant, s) {
  if (!s || s.payment_status !== 'paid') return null;
  const md = s.metadata || {};
  if (s.mode === 'subscription' && s.subscription) {
    // Recurring: recover install/account/plan from the Payment row, key the
    // license to the subscription id. invoice.paid sets the exact period end.
    return async (tx) => {
      const payment = await claimPendingPayment(tenant, 'stripe', s.id, tx);
      if (!payment) return; // no pending checkout for this session, or already provisioned
      const planKey = payment.plan || md.planKey || null;
      const plan = planKey ? await tx.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: planKey } } }) : null;
      const months = (plan && plan.interval === 'year') ? 12 : 1;
      await setSubscriptionPeriod(tenant, {
        subscriptionId: idOf(s.subscription),
        account: payment.account || md.account || (s.customer_details && s.customer_details.email) || null,
        installId: payment.installId || md.installId || s.client_reference_id || null,
        tier: (plan && plan.tier) || md.tier || 'pro',
        plan: planKey,
        periodEnd: new Date(Date.now() + months * 30 * DAY) // provisional until invoice.paid
      }, tx);
    };
  }
  return (tx) => provisionFromPaymentRef(tenant, 'stripe', s.id, {
    account: md.account || (s.customer_details && s.customer_details.email) || null,
    installId: md.installId || s.client_reference_id || null,
    planKey: md.planKey || null, tier: md.tier, months: Number(md.months) || undefined
  }, tx);
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

    const handled = await handleOnce(tenant.id, 'stripe', event.id, event.type, async () => {
      const obj = (event.data && event.data.object) || {};
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          return stripeSessionApply(tenant, obj);
        case 'checkout.session.async_payment_failed':
          return (tx) => tx.payment.updateMany({ where: { tenantId: tenant.id, provider: 'stripe', providerRef: String(obj.id), status: 'pending' }, data: { status: 'failed' } });
        case 'invoice.paid':
        case 'invoice.payment_succeeded': {
          // Subscription renewal (and first charge): set the period end precisely.
          const line = obj.lines && obj.lines.data && obj.lines.data[0];
          const periodEnd = line && line.period && line.period.end ? new Date(line.period.end * 1000) : null;
          const subscriptionId = stripeProvider.invoiceSubscriptionId(obj);
          if (!subscriptionId || !periodEnd) return null;
          return (tx) => setSubscriptionPeriod(tenant, { subscriptionId, periodEnd, status: 'active' }, tx);
        }
        case 'customer.subscription.deleted':
          return obj.id ? (tx) => cancelSubscription(tenant, obj.id, tx) : null;
        case 'charge.refunded':
        case 'charge.dispute.created': {
          // A partial refund leaves the licence alone (the merchant chose to keep the
          // sale); a full refund or any dispute takes the purchased term back.
          if (event.type === 'charge.refunded' && !(obj.refunded === true || (obj.amount && obj.amount_refunded >= obj.amount))) return null;
          const refs = await stripeProvider.resolveChargeRefs({
            secretKey: secrets.secretKey,
            paymentIntent: obj.payment_intent,
            invoice: event.type === 'charge.refunded' ? obj.invoice : null,
            charge: event.type === 'charge.dispute.created' ? obj.charge : null
          });
          if (!refs.sessionRef && !refs.subscriptionId) {
            console.warn(`[webhook:stripe] ${event.type} ${event.id}: no matching purchase found; licence left unchanged.`);
            return null;
          }
          return (tx) => revokeForRefund(tenant, { provider: 'stripe', sessionRef: refs.sessionRef, subscriptionId: refs.subscriptionId }, tx);
        }
        default:
          return null;
      }
    });
    if (!handled) return res.json({ received: true, duplicate: true });
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
    const handled = await handleOnce(tenant.id, 'cryptomus', eventId, payload.type || 'payment', async () => {
      if (!cryptomusProvider.isPaid(payload)) return null;
      return (tx) => provisionFromPaymentRef(tenant, 'cryptomus', payload.uuid || payload.order_id, {}, tx);
    });
    if (!handled) return res.json({ received: true, duplicate: true });
    res.json({ received: true });
  } catch (e) { console.error('[webhook:cryptomus]', e && e.stack ? e.stack : e); res.status(500).json({ error: 'handler error' }); }
});

// --- PayPal (verify via API, then capture the approved order) ---------------
// Audit L6: provision only after a capture that PayPal reports COMPLETED (from our own
// capture call, or from PAYMENT.CAPTURE.COMPLETED). A failed capture throws, the event
// is released and PayPal retries it. Both events can arrive for one order; the Payment
// pending -> paid claim provisions it exactly once.
router.post('/paypal/:tenantId', express.json({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    const { tenant, secrets } = await tenantAndSecrets(req.params.tenantId, 'paypal');
    if (!tenant || !secrets) return res.status(404).end();
    const event = req.body || {};
    if (!(await paypalProvider.verifyWebhook({ secrets, headers: req.headers, event }))) return res.status(400).json({ error: 'bad signature' });
    const handled = await handleOnce(tenant.id, 'paypal', event.id, event.event_type, async () => {
      const resource = event.resource || {};
      if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
        const orderId = resource.id;
        if (!orderId) return null;
        const capture = await paypalProvider.captureOrder({ secrets, orderId });
        if (!paypalProvider.isCaptureCompleted(capture)) return null; // pending / already captured: CAPTURE.COMPLETED provisions
        return (tx) => provisionFromPaymentRef(tenant, 'paypal', orderId, {}, tx);
      }
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const orderId = resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.order_id;
        if (!orderId || resource.status !== 'COMPLETED') return null;
        return (tx) => provisionFromPaymentRef(tenant, 'paypal', orderId, {}, tx);
      }
      return null;
    });
    if (!handled) return res.json({ received: true, duplicate: true });
    res.json({ received: true });
  } catch (e) { console.error('[webhook:paypal]', e && e.stack ? e.stack : e); res.status(500).json({ error: 'handler error' }); }
});

module.exports = router;
