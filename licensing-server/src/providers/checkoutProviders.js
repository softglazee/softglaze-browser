'use strict';
// The website payment providers this server runs a checkout for (POST /v1/checkout), with the name the
// app shows for each, and the list the app offers (GET /v1/checkout/methods, app 1.0.23+). The app takes
// ids and labels from that list, so a provider added here (with its createCheckout in routes/checkout.js
// and its key fields in configFields.js) reaches the app without a new app version.
const CHECKOUT_PROVIDERS = Object.freeze({
  stripe: Object.freeze({ label: 'Stripe (cards)' }),
  paypal: Object.freeze({ label: 'PayPal' }),
  cryptomus: Object.freeze({ label: 'Cryptomus (crypto)' }),
  safepay: Object.freeze({ label: 'Safepay (cards)' })
});
const CHECKOUT_IDS = Object.freeze(Object.keys(CHECKOUT_PROVIDERS));
const { openJson } = require('../crypto/secrets');

// The website's card checkout (browser.softglaze.com/buy, src/webPurchase.js): Stripe when its keys are
// saved and enabled, else Safepay. The site shows it only when card is true, and with test true (Stripe
// test keys, Safepay sandbox) only to a tester who asks. provider tells the site which one to post.
function webCheckout(rows) {
  const stripe = rows.find((r) => r.provider === 'stripe');
  if (stripe) {
    let key = '';
    try { key = String(openJson(stripe.secretsSealed).secretKey || ''); } catch (_) { /* unreadable keys: treat as test */ }
    return { card: true, test: !/^(sk|rk)_live_/.test(key), provider: 'stripe' };
  }
  const row = rows.find((r) => r.provider === 'safepay');
  if (!row) return { card: false, test: false, provider: null };
  let env = 'sandbox';
  try { env = String(openJson(row.secretsSealed).env || 'sandbox'); } catch (_) { /* unreadable keys: treat as test */ }
  return { card: true, test: env !== 'live', provider: 'safepay' };
}

// -> { providers: [{ id, label, kind: 'automated' }], store: { salesEnabled }, web: { card, test } }
// A provider is offered when its keys are saved and enabled (TenantPaymentConfig.enabled); then
// settings.checkout.providers (when a list) picks and orders them, and settings.checkout.labels renames.
// store.salesEnabled is settings.store.salesEnabled (default false): the app also needs the Store's prices.
async function publicCheckoutMethods(db, tenantId, settings) {
  const rows = await db.tenantPaymentConfig.findMany({ where: { tenantId, enabled: true } });
  const enabled = new Set(rows.map((r) => r.provider).filter((p) => CHECKOUT_IDS.includes(p)));
  const co = (settings && settings.checkout) || {};
  const order = Array.isArray(co.providers) ? co.providers : CHECKOUT_IDS;
  const labels = co.labels && typeof co.labels === 'object' ? co.labels : {};
  const providers = [];
  for (const id of order) {
    if (!enabled.has(id) || providers.some((p) => p.id === id)) continue;
    const label = typeof labels[id] === 'string' && labels[id].trim() ? labels[id].trim() : CHECKOUT_PROVIDERS[id].label;
    providers.push({ id, label, kind: 'automated' });
  }
  return {
    providers,
    store: { salesEnabled: Boolean(settings && settings.store && settings.store.salesEnabled === true) },
    web: webCheckout(rows)
  };
}

module.exports = { CHECKOUT_PROVIDERS, CHECKOUT_IDS, publicCheckoutMethods };
