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
const safepayProvider = require('../providers/safepay');
const { ACCOUNT_SOURCE, provisionFromPaymentRef, claimPendingPayment, setSubscriptionPeriod, cancelSubscription, revokeForRefund, flagLifetimeConflict } = require('../licensing');
const { recomputeCustomer } = require('../customers/sync');
const { handleOnce } = require('../webhookOnce');
const { termMs } = require('../util/time');

const router = express.Router();

async function tenantAndSecrets(tenantId, provider) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return {};
  const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider } } });
  if (!cfg) return { tenant };
  return { tenant, secrets: openJson(cfg.secretsSealed) };
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

// Only a paid Stripe checkout session counts: delayed methods complete unpaid and arrive later as
// checkout.session.async_payment_succeeded.
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
      const lic = await setSubscriptionPeriod(tenant, {
        subscriptionId: idOf(s.subscription),
        account: payment.account || md.account || (s.customer_details && s.customer_details.email) || null,
        installId: payment.installId || md.installId || s.client_reference_id || null,
        customerId: payment.method === ACCOUNT_SOURCE ? payment.customerId : null,
        tier: (plan && plan.tier) || md.tier || 'pro',
        plan: planKey,
        periodEnd: new Date(Date.now() + termMs(months)) // provisional until invoice.paid
      }, tx);
      if (payment.method === ACCOUNT_SOURCE && payment.customerId) await recomputeCustomer(tx, tenant.id, payment.customerId).catch(() => {});
      if (lic && lic.lifetimeGuard) await flagLifetimeConflict(tx, payment, lic, `subscription ${idOf(s.subscription)} (stripe ${s.id}, plan ${planKey || '?'})`);
    };
  }
  return (tx) => provisionFromPaymentRef(tenant, 'stripe', s.id, {
    account: md.account || (s.customer_details && s.customer_details.email) || null,
    installId: md.installId || s.client_reference_id || null,
    planKey: md.planKey || null, tier: md.tier, months: Number(md.months) || undefined
  }, tx);
}

// Stripe needs the raw body for signature verification.
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

// PayPal: verify via the API, then capture. Provision only after a COMPLETED capture (ours or
// PAYMENT.CAPTURE.COMPLETED); a failed capture throws so PayPal retries. Both events can arrive
// for one order; the Payment pending -> paid claim provisions it exactly once.
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

// Safepay: X-SFPY-SIGNATURE (HMAC-SHA256 of the raw body) is checked before the body is parsed.
// One-time: payment.succeeded settles the Payment whose providerRef is data.tracker. Subscriptions:
// subscription.payment.succeeded settles the Payment whose providerRef is the checkout's plan token
// (data.reference or data.plan_id) on the first charge, then extends the licence keyed to the Safepay
// subscription id on each renewal; subscription.cancelled ends it. Failed payments grant nothing, and
// an amount or currency that differs from the Payment row recorded at checkout grants nothing.
async function safepayPayment(tenantId, ref) {
  return prisma.payment.findFirst({ where: { tenantId, provider: 'safepay', providerRef: String(ref) }, orderBy: { createdAt: 'desc' } });
}

async function safepayApply(tenant, event) {
  const data = (event && event.data) || {};
  switch (event && event.type) {
    case 'payment.succeeded': {
      if (!data.tracker) return null;
      const payment = await safepayPayment(tenant.id, data.tracker);
      if (!payment) return null; // not a checkout of ours (e.g. the charge behind a subscription)
      if (!safepayProvider.amountMatches(data, payment)) {
        console.warn(`[webhook:safepay] ${safepayProvider.eventId(event)}: amount/currency ${data.amount} ${data.currency} does not match the checkout (${payment.amount} ${payment.currency}); not provisioned.`);
        return null;
      }
      return (tx) => provisionFromPaymentRef(tenant, 'safepay', data.tracker, {}, tx);
    }
    case 'subscription.payment.succeeded': {
      const ref = safepayProvider.subscriptionRef(data);
      const subscriptionId = safepayProvider.subscriptionId(data);
      if (!ref || !subscriptionId) return null;
      if (data.transaction_status && String(data.transaction_status).toUpperCase() !== 'COMPLETE') return null;
      const payment = await safepayPayment(tenant.id, ref);
      if (!payment) return null;
      if (!safepayProvider.amountMatches(data, payment)) {
        console.warn(`[webhook:safepay] ${safepayProvider.eventId(event)}: amount/currency ${data.amount} ${data.currency} does not match the subscription (${payment.amount} ${payment.currency}); not provisioned.`);
        return null;
      }
      const plan = payment.plan ? await prisma.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: payment.plan } } }) : null;
      const months = (plan && plan.interval === 'year') ? 12 : 1;
      const reported = safepayProvider.tsDate(data.current_period_end_date);
      const fallback = new Date(Date.now() + termMs(months));
      // Safepay's period end when it lies ahead, else one plan interval from now.
      const periodEnd = reported && reported.getTime() > Date.now() ? reported : fallback;
      return async (tx) => {
        const claimed = await claimPendingPayment(tenant, 'safepay', ref, tx);
        if (claimed) {
          const lic = await setSubscriptionPeriod(tenant, {
            subscriptionId,
            account: claimed.account || data.customer_email || null,
            installId: claimed.installId || null,
            tier: (plan && plan.tier) || 'pro',
            plan: claimed.plan || null,
            periodEnd
          }, tx);
          if (lic && lic.lifetimeGuard) await flagLifetimeConflict(tx, claimed, lic, `subscription ${subscriptionId} (safepay ${ref}, plan ${claimed.plan || '?'})`);
          return;
        }
        // Renewal: only for a subscription whose first charge was provisioned here.
        const lic = await tx.license.findFirst({ where: { tenantId: tenant.id, providerRef: String(subscriptionId) }, orderBy: { updatedAt: 'desc' } });
        if (!lic) return;
        const current = lic.currentPeriodEnd ? new Date(lic.currentPeriodEnd).getTime() : 0;
        await setSubscriptionPeriod(tenant, { subscriptionId, periodEnd: new Date(Math.max(current, periodEnd.getTime())), status: 'active' }, tx);
      };
    }
    case 'subscription.cancelled':
    case 'subscription.canceled':
    case 'subscription.ended': {
      const subscriptionId = safepayProvider.subscriptionId(data);
      return subscriptionId ? (tx) => cancelSubscription(tenant, subscriptionId, tx) : null;
    }
    default:
      // payment.failed, subscription.payment.failed, subscription.created, ...: nothing is granted.
      return null;
  }
}

router.post('/safepay/:tenantId', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    const { tenant, secrets } = await tenantAndSecrets(req.params.tenantId, 'safepay');
    if (!tenant || !secrets) return res.status(404).end();
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!safepayProvider.verifyWebhook({ secrets, rawBody, signature: req.get('x-sfpy-signature') })) return res.status(400).json({ error: 'bad signature' });
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'bad json' }); }
    if (!event || typeof event !== 'object') return res.status(400).json({ error: 'bad json' });
    const handled = await handleOnce(tenant.id, 'safepay', safepayProvider.eventId(event), event.type, () => safepayApply(tenant, event));
    if (!handled) return res.json({ received: true, duplicate: true });
    res.json({ received: true });
  } catch (e) { console.error('[webhook:safepay]', e && e.stack ? e.stack : e); res.status(500).json({ error: 'handler error' }); }
});

module.exports = router;
