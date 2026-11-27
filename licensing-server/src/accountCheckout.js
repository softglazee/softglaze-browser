'use strict';
// Buying while signed in (27 November 2026): the web app's Upgrade page (app.softglaze.com/upgrade) posts
// POST /v1/account/checkout { planKey } with the account's bearer session. The plan goes on the ACCOUNT, not
// on a computer: the server opens a Stripe Checkout (Managed Payments) for the Price of that plan, a
// subscription for a monthly or yearly plan (renews until cancelled at link.com), one payment for a
// lifetime offer. The webhook grants it to the account (licensing.js, source 'account'); the account's
// computers get it on their next licence check (routes/license.js) and the phone and web app at once
// (GET /v1/account/me). No activation code, no install id.
//
// Answers { status, body }:
//   200 { url, ref }                       open url (Stripe's checkout page)
//   400 unknown_plan | 409 plan_not_purchasable | sale_not_open | sale_ended | sold_out
//   409 lifetime_active                    the account already has a lifetime licence of this tier or higher
//   409 already_subscribed                 an active subscription on the account: change it at link.com
//   503 card_unavailable                   Stripe is not set up, or its Price is missing or wrong (logged)
const { openJson } = require('./crypto/secrets');
const { getSettings } = require('./settings');
const { isPurchasable } = require('./plans/service');
const { saleBlock, invalidateOffers, isLifetime } = require('./plans/sales');
const guard = require('./plans/lifetimeGuard');
const stripeProvider = require('./providers/stripe');
const { ACCOUNT_SOURCE, accountLicenceWhere } = require('./licensing');

const WEB_APP_BASE_URL = String(process.env.WEB_APP_BASE_URL || 'https://app.softglaze.com').replace(/\/+$/, '');

async function startAccountCheckout(db, found, { planKey } = {}) {
  const customer = found.customer;
  const tenantId = customer.tenantId;
  const key = typeof planKey === 'string' ? planKey.trim() : '';
  if (!key) return { status: 400, body: { error: 'unknown_plan', message: 'Choose a plan.' } };
  const plan = await db.plan.findUnique({ where: { tenantId_key: { tenantId, key } } });
  if (!plan || !plan.active) return { status: 400, body: { error: 'unknown_plan', message: 'That plan is not on sale.' } };
  if (!isPurchasable(plan)) return { status: 409, body: { error: 'plan_not_purchasable', message: 'This plan is free and cannot be bought.' } };

  const blocked = await saleBlock(db, tenantId, plan);
  if (blocked) return { status: 409, body: { error: blocked.error, message: blocked.message, remaining: blocked.availability && blocked.availability.remaining } };

  const now = Date.now();
  const lifetime = isLifetime(plan);
  const life = await guard.findCustomerLifetimeLicence(db, tenantId, customer.id, now);
  if (life && !guard.allowedOnLifetime(life, { tier: plan.tier, lifetime })) {
    return { status: 409, body: { error: 'lifetime_active', message: `Your account already has ${life.tier === 'enterprise' ? 'Enterprise' : 'Pro'} Lifetime, so there is nothing more to buy for this plan.` } };
  }
  if (!lifetime) {
    const sub = await db.license.findFirst({
      where: { ...accountLicenceWhere(tenantId, customer.id), status: 'active', providerRef: { startsWith: 'sub_' }, currentPeriodEnd: { gt: new Date(now) } }
    });
    if (sub) {
      return { status: 409, body: { error: 'already_subscribed', message: 'Your account already has an active subscription. To change or cancel it, sign in at link.com with the email you paid with.' } };
    }
  }

  const cfg = await db.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId, provider: 'stripe' } } });
  if (!cfg || !cfg.enabled) return { status: 503, body: { error: 'card_unavailable', message: 'Card payment is not available right now. Please try again later.' } };
  const { secretKey } = openJson(cfg.secretsSealed);
  const lookupKeys = (await getSettings(db, tenantId)).checkout.stripeLookupKeys;

  let url; let ref;
  try {
    ({ url, ref } = await stripeProvider.createCheckout({
      secretKey, tenantId, plan, account: customer.email, customerId: customer.id, lookupKeys,
      successUrl: `${WEB_APP_BASE_URL}/upgrade/done?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${WEB_APP_BASE_URL}/upgrade?plan=${encodeURIComponent(plan.key)}&cancelled=1`
    }));
  } catch (e) {
    if (!(e instanceof stripeProvider.StripeCheckoutError)) throw e;
    console.error(`[checkout:account] ${e.code}: ${e.message}`);
    return { status: 503, body: { error: 'card_unavailable', message: 'Card payment is not available for this plan right now. Please contact support.' } };
  }

  await db.payment.create({
    data: {
      tenantId, provider: 'stripe', providerRef: ref ? String(ref) : null, amount: plan.amount, currency: plan.currency,
      status: 'pending', account: customer.email || null, plan: plan.key, installId: null, customerId: customer.id, method: ACCOUNT_SOURCE
    }
  });
  invalidateOffers(tenantId); // a pending payment holds a place in a capped offer
  return { status: 200, body: { url, ref } };
}

module.exports = { startAccountCheckout, WEB_APP_BASE_URL };
