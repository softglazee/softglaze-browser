'use strict';
// Per-tenant Stripe; the secret key comes from the tenant's sealed payment config.
//
// Checkout runs on Stripe Managed Payments (Stripe sells as merchant of record and handles sales tax),
// which needs API version 2025-03-31.basil or later, managed_payments[enabled]=true on the Checkout
// Session, and line items that are Prices of Products carrying an eligible tax code. So a plan is sold
// through the Stripe Price that has the plan's lookup key (DEFAULT_LOOKUP_KEYS, or settings
// checkout.stripeLookupKeys), never through inline price_data. The Price must charge exactly the plan's
// amount and currency, or the checkout is refused: what the app or site shows is what the card pays.
// A recurring Price opens a subscription, a one-time Price a single payment.
const Stripe = require('stripe');
const { publicBaseUrl } = require('../env');

const API_VERSION = '2025-08-27.basil';

function client(secretKey) {
  if (!secretKey) throw new Error('Tenant has no Stripe secret key configured.');
  return new Stripe(secretKey, { apiVersion: API_VERSION });
}

// Plan key on this server -> lookup key of the Price in the Stripe Product catalog.
const DEFAULT_LOOKUP_KEYS = Object.freeze({
  pro: 'pro_monthly',
  'pro-yearly': 'pro_yearly',
  'pro-lifetime': 'pro_lifetime',
  enterprise: 'enterprise_monthly',
  'enterprise-yearly': 'enterprise_yearly',
  'enterprise-lifetime': 'enterprise_lifetime'
});

// Website only: a monthly or yearly plan bought on the website is one payment for one term (an activation
// code, no renewal), so it needs a ONE-TIME Price with the plan's amount. Without that Price the website
// answers install_required ("buy it in the app"). Override per plan with checkout.stripeLookupKeys
// "web:<plan key>".
const DEFAULT_WEB_LOOKUP_KEYS = Object.freeze({
  pro: 'pro_month_once',
  'pro-yearly': 'pro_year_once',
  enterprise: 'enterprise_month_once',
  'enterprise-yearly': 'enterprise_year_once'
});

class StripeCheckoutError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function lookupKeyFor(plan, overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const own = typeof o[plan.key] === 'string' ? o[plan.key].trim() : '';
  return own || DEFAULT_LOOKUP_KEYS[plan.key] || null;
}

function webLookupKeyFor(plan, overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const k = `web:${plan.key}`;
  const own = typeof o[k] === 'string' ? o[k].trim() : '';
  return own || DEFAULT_WEB_LOOKUP_KEYS[plan.key] || null;
}

// A plan billed per month or year (as opposed to a one-time plan such as a lifetime offer).
const isTermPlan = (plan) => String(plan.interval || 'month').toLowerCase() !== 'once';

// Anything non-yearly maps to Stripe's 'month' interval.
function stripeInterval(interval) {
  return String(interval || 'month').toLowerCase() === 'year' ? 'year' : 'month';
}

async function findPrice(stripe, lookupKey) {
  if (!lookupKey) return null;
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return (list && list.data && list.data[0]) || null;
}

function checkAmount(price, plan, lookupKey) {
  const currency = String(plan.currency || 'usd').toLowerCase();
  if (price.unit_amount !== plan.amount || String(price.currency).toLowerCase() !== currency) {
    throw new StripeCheckoutError('stripe_price_mismatch',
      `The Stripe price "${lookupKey}" (${price.unit_amount} ${price.currency}) does not match the plan "${plan.key}" (${plan.amount} ${currency}).`);
  }
}

// Website, monthly or yearly plan: the one-time Price for one term, or install_required when there is none.
async function resolveWebTermPrice(stripe, plan, overrides) {
  const lookupKey = webLookupKeyFor(plan, overrides);
  const price = await findPrice(stripe, lookupKey);
  if (!price) throw new StripeCheckoutError('install_required', 'This plan can only be bought in the app.', 400);
  if (price.type === 'recurring') {
    throw new StripeCheckoutError('stripe_price_mismatch', `The Stripe price "${lookupKey}" must be a one-time price (it is sold on the website as one term).`);
  }
  checkAmount(price, plan, lookupKey);
  return price;
}

async function resolvePrice(stripe, plan, overrides) {
  const lookupKey = lookupKeyFor(plan, overrides);
  if (!lookupKey) throw new StripeCheckoutError('stripe_price_missing', `No Stripe price is set up for the plan "${plan.key}".`);
  const price = await findPrice(stripe, lookupKey);
  if (!price) throw new StripeCheckoutError('stripe_price_missing', `No active Stripe price has the lookup key "${lookupKey}".`);
  checkAmount(price, plan, lookupKey);
  if (price.type === 'recurring' && price.recurring && price.recurring.interval !== stripeInterval(plan.interval)) {
    throw new StripeCheckoutError('stripe_price_mismatch',
      `The Stripe price "${lookupKey}" bills per ${price.recurring.interval}, the plan "${plan.key}" per ${plan.interval}.`);
  }
  return price;
}

// web: a website purchase (no install). It takes one-time Prices only (the buyer gets an activation
// code by email, a fixed term): a lifetime offer's own Price, or for a monthly/yearly plan its one-time
// web Price (one term, no renewal). It returns to the website. The email is pre-filled when the site
// sent one; otherwise Stripe's page asks for it and the webhook takes it from the paid session.
// customerId (account purchase, src/accountCheckout.js): the plan goes on the signed-in account, not on a
// computer: subscriptions are allowed without an install, and successUrl / cancelUrl return to the web app.
async function createCheckout({ secretKey, tenantId, plan, installId, account, web = false, siteBaseUrl = '', lookupKeys, customerId, successUrl, cancelUrl }) {
  const stripe = client(secretKey);
  const price = web && isTermPlan(plan) ? await resolveWebTermPrice(stripe, plan, lookupKeys) : await resolvePrice(stripe, plan, lookupKeys);
  const recurring = price.type === 'recurring';
  if (web && recurring) throw new StripeCheckoutError('install_required', 'This plan can only be bought in the app.', 400);

  const metadata = {
    tenantId, planKey: plan.key, tier: plan.tier,
    months: String(plan.months), recurring: String(recurring),
    installId: installId || '', account: account || '', ...(web ? { method: 'web' } : {}),
    ...(customerId ? { customerId: String(customerId), method: 'account' } : {})
  };
  const params = {
    mode: recurring ? 'subscription' : 'payment',
    managed_payments: { enabled: true },
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: successUrl || (web ? `${siteBaseUrl}/buy/thanks?provider=stripe&session_id={CHECKOUT_SESSION_ID}` : `${publicBaseUrl}/v1/checkout/return?status=success`),
    cancel_url: cancelUrl || (web ? `${siteBaseUrl}/buy?cancelled=1` : `${publicBaseUrl}/v1/checkout/return?status=cancel`),
    client_reference_id: installId || undefined,
    metadata
  };
  if (recurring) params.subscription_data = { metadata };
  else params.payment_intent_data = { metadata };
  if ((web || customerId) && account) params.customer_email = account;

  const session = await stripe.checkout.sessions.create(params);
  return { url: session.url, ref: session.id };
}

// A Checkout Session id as Stripe makes them (cs_test_... / cs_live_...), for the website's status check.
const isSessionId = (v) => typeof v === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(v);

// The session as Stripe has it now, for a status check that does not wait for the webhook.
async function retrieveSession({ secretKey, sessionId }) {
  return client(secretKey).checkout.sessions.retrieve(sessionId);
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
// On basil a Charge no longer names its invoice: the invoice is found by listing the invoice
// payments of the PaymentIntent (docs: billing/subscriptions/webhooks, refunds on basil).
async function resolveChargeRefs({ secretKey, paymentIntent, invoice, charge }) {
  const stripe = client(secretKey);
  let sessionRef = null;
  let subscriptionId = null;
  let pi = idOf(paymentIntent);
  let inv = invoice || null;
  if (!pi && charge) {
    const ch = typeof charge === 'object' ? charge : await stripe.charges.retrieve(String(charge));
    pi = idOf(ch && ch.payment_intent);
    if (!inv && ch && ch.invoice) inv = ch.invoice;
  }
  if (pi) {
    const list = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
    const s = list && list.data && list.data[0];
    if (s) {
      sessionRef = s.id;
      subscriptionId = idOf(s.subscription);
    }
  }
  if (!sessionRef && !subscriptionId) {
    if (!inv && pi && stripe.invoicePayments) {
      const ip = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: pi }, status: 'paid', limit: 1 });
      const row = ip && ip.data && ip.data[0];
      if (row && row.invoice) inv = row.invoice;
    }
    if (inv) {
      const invObj = typeof inv === 'object' ? inv : await stripe.invoices.retrieve(String(inv));
      subscriptionId = invoiceSubscriptionId(invObj);
    }
  }
  return { sessionRef, subscriptionId };
}

// End a subscription at Stripe now (after a full refund or a dispute), so it never charges again.
// A refund alone never cancels a subscription in Stripe. Already ended -> 'already'; else 'canceled'.
async function cancelSubscription({ secretKey, subscriptionId }) {
  const stripe = client(secretKey);
  const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
  if (!sub || ['canceled', 'incomplete_expired'].includes(sub.status)) return 'already';
  await stripe.subscriptions.cancel(String(subscriptionId), { prorate: false });
  return 'canceled';
}

module.exports = {
  API_VERSION, cancelSubscription, DEFAULT_LOOKUP_KEYS, DEFAULT_WEB_LOOKUP_KEYS, StripeCheckoutError, webLookupKeyFor,
  createCheckout, retrieveSession, isSessionId, verifyEvent, stripeInterval, invoiceSubscriptionId, resolveChargeRefs, lookupKeyFor
};
