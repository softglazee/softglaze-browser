'use strict';
// Per-tenant Stripe integration. The secret key comes from the tenant's sealed
// payment config (never hardcoded, never shared). Phase 1 uses one-time Checkout
// (mode 'payment') to match the app's "grant N months per payment" model;
// recurring subscriptions are a later phase.
const Stripe = require('stripe');
const { publicBaseUrl } = require('../env');

function client(secretKey) {
  if (!secretKey) throw new Error('Tenant has no Stripe secret key configured.');
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

async function createCheckout({ secretKey, tenantId, plan, installId, account }) {
  const stripe = client(secretKey);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: String(plan.currency || 'usd').toLowerCase(),
        unit_amount: plan.amount,
        product_data: { name: plan.name }
      }
    }],
    success_url: `${publicBaseUrl}/v1/checkout/return?status=success`,
    cancel_url: `${publicBaseUrl}/v1/checkout/return?status=cancel`,
    client_reference_id: installId || undefined,
    metadata: {
      tenantId,
      planKey: plan.key,
      tier: plan.tier,
      months: String(plan.months),
      installId: installId || '',
      account: account || ''
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

module.exports = { createCheckout, verifyEvent };
