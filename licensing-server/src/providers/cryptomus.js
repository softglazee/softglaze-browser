'use strict';
// Per-tenant Cryptomus. Secrets (sealed): { merchantId, apiKey }. Checkout creates
// a hosted invoice + returns its URL; the webhook signature is verified OFFLINE
// (md5 of base64(body)+apiKey, with PHP-style slash escaping to match Cryptomus).
const crypto = require('node:crypto');
const { httpsRequest } = require('../http');

const BASE = 'https://api.cryptomus.com/v1';
const sign = (bodyStr, apiKey) => crypto.createHash('md5').update(Buffer.from(bodyStr, 'utf8').toString('base64') + apiKey).digest('hex');

async function request(path, body, { merchantId, apiKey }) {
  if (!merchantId || !apiKey) throw new Error('Cryptomus is not configured (merchantId/apiKey).');
  const bodyStr = JSON.stringify(body);
  const { status, json } = await httpsRequest('POST', `${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', merchant: merchantId, sign: sign(bodyStr, apiKey) },
    body: bodyStr
  });
  if (!json || (json.state !== 0 && !json.result)) {
    const msg = (json && (json.message || (json.errors && JSON.stringify(json.errors)))) || `HTTP ${status}`;
    throw new Error(`Cryptomus: ${msg}`);
  }
  return json.result;
}

// plan.amount is in MINOR units (cents); Cryptomus wants a decimal string.
async function createCheckout({ secrets, plan, orderId, returnUrl, callbackUrl }) {
  const body = {
    amount: (plan.amount / 100).toFixed(2),
    currency: String(plan.currency || 'USD'),
    order_id: String(orderId),
    lifetime: 3600
  };
  if (returnUrl) body.url_return = returnUrl;
  if (callbackUrl) body.url_callback = callbackUrl;
  const r = await request('/payment', body, { merchantId: secrets.merchantId, apiKey: secrets.apiKey });
  return { ref: r.uuid, url: r.url, orderId: r.order_id };
}

function verifyWebhook({ secrets, payload }) {
  if (!payload || typeof payload !== 'object' || !payload.sign) return false;
  const data = { ...payload };
  delete data.sign;
  const jsonPhp = JSON.stringify(data).replace(/\//g, '\\/'); // PHP json_encode escapes slashes
  const expected = sign(jsonPhp, secrets.apiKey);
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(payload.sign))); }
  catch (e) { return false; }
}

function isPaid(payload) {
  const s = payload && (payload.status || payload.payment_status);
  return s === 'paid' || s === 'paid_over';
}

module.exports = { createCheckout, verifyWebhook, isPaid };
