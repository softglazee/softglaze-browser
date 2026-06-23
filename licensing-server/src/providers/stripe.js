'use strict';
// Per-tenant Stripe integration. The secret key comes from the tenant's sealed
// payment config (never hardcoded, never shared). Supports BOTH one-time payment
// (grant N months per payment) and recurring subscriptions (plan.recurring), each
// keyed to the plan's interval.
const Stripe = require('stripe');
const { publicBaseUrl } = require('../env');

function client(secretKey) {
  if (!secretKey) throw new Error('Tenant has no Stripe secret key configured.');
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

// Map a plan interval to a Stripe recurring interval (Stripe supports day/week/
// month/year; we treat anything non-yearly as monthly). Pure — unit-tested.
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

module.exports = { createCheckout, verifyEvent, stripeInterval };
