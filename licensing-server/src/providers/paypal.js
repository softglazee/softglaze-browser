'use strict';
// Per-tenant PayPal (Orders v2). Secrets (sealed): { clientId, clientSecret, env,
// webhookId }. Checkout creates an order + returns the approve URL; the webhook is
// verified via PayPal's verify-webhook-signature API, then the order is captured.
const { httpsRequest } = require('../http');

const base = (env) => (String(env || '').toLowerCase() === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');

async function token({ clientId, clientSecret, env }) {
  if (!clientId || !clientSecret) throw new Error('PayPal is not configured (clientId/clientSecret).');
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const { status, json } = await httpsRequest('POST', `${base(env)}/v1/oauth2/token`, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!json || !json.access_token) throw new Error(`PayPal auth failed (HTTP ${status}).`);
  return json.access_token;
}

// plan.amount is in MINOR units (cents); PayPal wants a decimal string.
async function createCheckout({ secrets, plan, returnUrl, cancelUrl }) {
  const t = await token(secrets);
  const value = (plan.amount / 100).toFixed(2);
  const { status, json } = await httpsRequest('POST', `${base(secrets.env)}/v2/checkout/orders`, {
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: String(plan.currency || 'USD'), value } }],
      application_context: { user_action: 'PAY_NOW', return_url: returnUrl, cancel_url: cancelUrl }
    }
  });
  if (!json || !json.id) throw new Error(`PayPal: could not create order (HTTP ${status}).`);
  const approve = (json.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return { ref: json.id, url: approve ? approve.href : null };
}

async function captureOrder({ secrets, orderId }) {
  const t = await token(secrets);
  const { json } = await httpsRequest('POST', `${base(secrets.env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: {}
  });
  return json;
}

// Verify an inbound webhook against the tenant's webhookId using PayPal's API.
async function verifyWebhook({ secrets, headers, event }) {
  if (!secrets.webhookId) return false;
  const t = await token(secrets);
  const { json } = await httpsRequest('POST', `${base(secrets.env)}/v1/notifications/verify-webhook-signature`, {
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: secrets.webhookId,
      webhook_event: event
    }
  });
  return Boolean(json && json.verification_status === 'SUCCESS');
}

module.exports = { createCheckout, captureOrder, verifyWebhook };
