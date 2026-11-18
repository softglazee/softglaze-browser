'use strict';
// Per-tenant Safepay (getsafepay.pk, Pakistani card gateway). Secrets (sealed): { publicKey, secretKey,
// webhookSecret, env? } with env 'sandbox' (default) or 'live'. Raw REST over src/http, no SDK.
//
// One-time plans: a payment session (tracker) + a hosted checkout URL; the webhook's data.tracker is
// the Payment providerRef. Recurring plans: a Safepay plan is created for THIS checkout from our Plan
// row (amount, currency, interval), so the price can never drift from the Plan table, and its token
// (plan_...) is the Payment providerRef. The token also goes into the checkout URL as `reference`;
// subscription webhooks carry data.plan_id (and data.reference, per Safepay's guide), so either one
// finds the Payment row. The Safepay subscription id (sub_...) keys the licence for renewals and
// cancellation, like the Stripe subscription id. See docs/safepay.md.
const crypto = require('node:crypto');
const { httpsRequest } = require('../http');

const HOSTS = {
  sandbox: { api: 'https://sandbox.api.getsafepay.com', checkout: 'https://sandbox.api.getsafepay.com', env: 'sandbox' },
  live: { api: 'https://api.getsafepay.com', checkout: 'https://getsafepay.com', env: 'production' }
};
const ENVS = Object.keys(HOSTS);
const hostsFor = (env) => HOSTS[String(env || '').toLowerCase() === 'live' ? 'live' : 'sandbox'];

function assertConfigured(secrets) {
  if (!secrets || !secrets.secretKey || !secrets.publicKey) throw new Error('Safepay is not configured (publicKey/secretKey).');
}

async function request(method, url, secretKey, body) {
  const { status, json } = await httpsRequest(method, url, {
    headers: { 'Content-Type': 'application/json', 'X-SFPY-MERCHANT-SECRET': secretKey },
    body: body == null ? null : body
  });
  const errors = json && json.status && Array.isArray(json.status.errors) ? json.status.errors : [];
  if (!(status >= 200 && status < 300) || !json || errors.length) {
    const msg = errors.length ? errors.join('; ') : (json && json.status && json.status.message) || `HTTP ${status}`;
    throw new Error(`Safepay: ${msg}`);
  }
  return json;
}

// POST /client/passport/v1/token -> data = the short-lived (1 h) checkout auth token ("tbt").
async function authToken(secrets) {
  const json = await request('POST', `${hostsFor(secrets.env).api}/client/passport/v1/token`, secrets.secretKey, {});
  if (!json.data || typeof json.data !== 'string') throw new Error('Safepay: no auth token in the response.');
  return json.data;
}

// Anything non-yearly maps to MONTH (as stripe.js does).
const safepayInterval = (interval) => (String(interval || 'month').toLowerCase() === 'year' ? 'YEAR' : 'MONTH');

// POST /client/plans/v1/ -> data.token (plan_...). Amount is a string in minor units.
async function createPlan(secrets, plan, product) {
  const json = await request('POST', `${hostsFor(secrets.env).api}/client/plans/v1/`, secrets.secretKey, {
    payload: {
      amount: String(plan.amount),
      currency: String(plan.currency || 'USD').toUpperCase(),
      interval: safepayInterval(plan.interval),
      interval_count: 1,
      billing_cycles: 0,
      type: 'RECURRING',
      product,
      active: true
    }
  });
  const token = json.data && json.data.token;
  if (!token) throw new Error('Safepay: no plan token in the response.');
  return String(token);
}

// POST /order/payments/v3/ -> data.tracker.token (track_...).
async function createTracker(secrets, plan, orderId) {
  const json = await request('POST', `${hostsFor(secrets.env).api}/order/payments/v3/`, secrets.secretKey, {
    merchant_api_key: secrets.publicKey,
    intent: 'CYBERSOURCE',
    mode: 'payment',
    currency: String(plan.currency || 'USD').toUpperCase(),
    amount: plan.amount,
    metadata: { order_id: String(orderId) }
  });
  const token = json.data && json.data.tracker && json.data.tracker.token;
  if (!token) throw new Error('Safepay: no tracker token in the response.');
  return String(token);
}

const query = (params) => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  .join('&');

// The hosted one-time checkout, as @sfpy/node-core's checkouts.payment.create builds it.
function paymentCheckoutUrl(env, { tracker, tbt, redirectUrl, cancelUrl, orderId }) {
  const h = hostsFor(env);
  return `${h.checkout}/embedded/?${query({ environment: h.env, tracker, tbt, source: 'hosted', order_id: orderId, redirect_url: redirectUrl, cancel_url: cancelUrl })}`;
}

// The subscription checkout (/checkout/auth/login).
function subscriptionCheckoutUrl(env, { planId, authToken: token, reference, redirectUrl, cancelUrl }) {
  const h = hostsFor(env);
  return `${h.checkout}/checkout/auth/login?${query({ plan_id: planId, auth_token: token, env: h.env, reference, redirect_url: redirectUrl, cancel_url: cancelUrl })}`;
}

// -> { url, ref, recurring }. ref is what the webhook looks the Payment up by.
async function createCheckout({ secrets, plan, orderId, returnUrl, cancelUrl }) {
  assertConfigured(secrets);
  if (!Number.isInteger(plan.amount) || plan.amount <= 0) throw new Error('Safepay: the plan has no amount.');
  if (plan.recurring) {
    const planId = await createPlan(secrets, plan, `${plan.key}:${orderId}`);
    const token = await authToken(secrets);
    return { recurring: true, ref: planId, url: subscriptionCheckoutUrl(secrets.env, { planId, authToken: token, reference: planId, redirectUrl: returnUrl, cancelUrl }) };
  }
  const tracker = await createTracker(secrets, plan, orderId);
  const tbt = await authToken(secrets);
  return { recurring: false, ref: tracker, url: paymentCheckoutUrl(secrets.env, { tracker, tbt, orderId, redirectUrl: returnUrl, cancelUrl }) };
}

// X-SFPY-SIGNATURE = hex HMAC-SHA256(webhookSecret, raw body). Checked on the raw bytes before any
// parsing; an unset secret rejects everything (an empty HMAC key would let anyone sign).
function verifyWebhook({ secrets, rawBody, signature }) {
  if (!secrets || typeof secrets.webhookSecret !== 'string' || !secrets.webhookSecret) return false;
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody == null ? '' : rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', secrets.webhookSecret).update(body).digest();
  const got = Buffer.from(signature.trim(), 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// Event id for dedup: Safepay's payloads carry it as `token` (evt_...); the subscription guide calls it `id`.
const eventId = (event) => (event && (event.token || event.id)) || null;
// The Payment providerRef a subscription event belongs to (see the header comment).
const subscriptionRef = (data) => (data && (data.reference || data.plan_id)) || null;
const subscriptionId = (data) => (data && (data.subscription_id || data.sub_id || data.id)) || null;
// Timestamps come as { seconds, nanos }.
function tsDate(v) {
  const s = v && typeof v === 'object' ? Number(v.seconds) : Number(v);
  return Number.isFinite(s) && s > 0 ? new Date(s * 1000) : null;
}
// The event amount and currency must be exactly what our Payment row recorded at checkout.
function amountMatches(data, payment) {
  if (!data || !payment) return false;
  return Number(data.amount) === Number(payment.amount)
    && String(data.currency || '').toUpperCase() === String(payment.currency || '').toUpperCase();
}

module.exports = {
  ENVS, hostsFor, createCheckout, createPlan, createTracker, authToken, paymentCheckoutUrl, subscriptionCheckoutUrl,
  verifyWebhook, eventId, subscriptionRef, subscriptionId, tsDate, amountMatches, safepayInterval
};
