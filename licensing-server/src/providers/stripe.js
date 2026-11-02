'use strict';
// Per-tenant Stripe; the secret key comes from the tenant's sealed payment config. Supports one-time
// payments (N months each) and recurring subscriptions (plan.recurring), keyed to the plan's interval.
const Stripe = require('stripe');
const { publicBaseUrl } = require('../env');

function client(secretKey) {
  if (!secretKey) throw new Error('Tenant has no Stripe secret key configured.');
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

// Anything non-yearly maps to Stripe's 'month' interval.
function stripeInterval(interval) {
  return String(interval || 'month').toLowerCase() === 'year' ? 'year' : 'month';
}

async function createCheckout({ secretKey, tenantId, plan, installId, account }) {
  const stripe = client(secretKey);
  const recurring = Boolean(plan.recurring);
  const price_data = {
    currency: String(plan.currency || 'usd').toLowerCase(),
    unit_amount: plan.amount,
    product_data: { name: plan.name }
  };
  if (recurring) price_data.recurring = { interval: stripeInterval(plan.interval) };

  const session = await stripe.checkout.sessions.create({
    mode: recurring ? 'subscription' : 'payment',
    line_items: [{ quantity: 1, price_data }],
    success_url: `${publicBaseUrl}/v1/checkout/return?status=success`,
    cancel_url: `${publicBaseUrl}/v1/checkout/return?status=cancel`,
    client_reference_id: installId || undefined,
    metadata: {
      tenantId, planKey: plan.key, tier: plan.tier,
      months: String(plan.months), recurring: String(recurring),
      installId: installId || '', account: account || ''
    }
  });
  return { url: session.url, ref: session.id };
}

// Verify + parse an inbound Stripe webhook using the tenant's webhook signing
// secret. Throws if the signature is invalid (the caller returns 400).
function verifyEvent({ secretKey, webhookSecret, rawBody, signature }) {
  if (!webhookSecret) throw new Error('Tenant has no Stripe webhook secret configured.');
  return client(secretKey).webhooks.constructEvent(rawBody, signature, webhookSecret);
}

// Newer Stripe API versions move the subscription id to invoice.parent.subscription_details,
// and the payload follows the endpoint's API version, so read both.
function invoiceSubscriptionId(inv) {
  if (!inv) return null;
  const pick = (v) => (v && typeof v === 'object' ? v.id : v) || null;
  const direct = pick(inv.subscription);
  if (direct) return String(direct);
  const nested = inv.parent && inv.parent.subscription_details && pick(inv.parent.subscription_details.subscription);
  return nested ? String(nested) : null;
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

// Map a refunded or disputed charge to what it paid for: a one-time purchase via its Checkout
// Session (listed by payment_intent), a subscription via its invoice. Either ref may be null.
async function resolveChargeRefs({ secretKey, paymentIntent, invoice, charge }) {
  const stripe = client(secretKey);
  let sessionRef = null;
  let subscriptionId = null;
  const pi = idOf(paymentIntent);
  if (pi) {
    const list = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
    const s = list && list.data && list.data[0];
    if (s) {
      sessionRef = s.id;
      subscriptionId = idOf(s.subscription);
    }
  }
  if (!sessionRef && !subscriptionId) {
    let inv = invoice || null;
    if (!inv && charge) {
      const ch = typeof charge === 'object' ? charge : await stripe.charges.retrieve(String(charge));
      inv = ch && ch.invoice;
    }
    if (inv) {
      const invObj = typeof inv === 'object' ? inv : await stripe.invoices.retrieve(String(inv));
      subscriptionId = invoiceSubscriptionId(invObj);
    }
  }
  return { sessionRef, subscriptionId };
}

module.exports = { createCheckout, verifyEvent, stripeInterval, invoiceSubscriptionId, resolveChargeRefs };
