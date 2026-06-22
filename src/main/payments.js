'use strict';
// Payment-gateway adapter. One small seam so more providers (Stripe, PayPal,
// Wise…) can be added later behind the same shape. Today: Cryptomus (crypto
// checkout). https://doc.cryptomus.com/
//
// A desktop app has no public URL for Cryptomus to call back to, so the live
// flow POLLS /v1/payment/info after the user pays in their browser. verifyWebhook
// is provided too, for when a hosted backend is added later.
const https = require('node:https');
const crypto = require('node:crypto');

const CRYPTOMUS_BASE = 'https://api.cryptomus.com/v1';

function httpsPostJson(url, bodyStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* non-JSON */ }
        if (!json) return reject(new Error(`Payment gateway returned a non-JSON response (HTTP ${res.statusCode}).`));
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Payment gateway request timed out.')));
    req.write(bodyStr);
    req.end();
  });
}

// sign = md5( base64( json_body ) + paymentApiKey )
function cryptomusSign(bodyStr, apiKey) {
  return crypto.createHash('md5').update(Buffer.from(bodyStr, 'utf8').toString('base64') + apiKey).digest('hex');
}

async function cryptomusRequest(path, body, cfg) {
  if (!cfg || !cfg.merchantId || !cfg.apiKey) {
    throw new Error('Cryptomus is not configured. A super admin must add the Merchant ID and Payment API key.');
  }
  const bodyStr = JSON.stringify(body);
  const { status, json } = await httpsPostJson(`${CRYPTOMUS_BASE}${path}`, bodyStr, {
    merchant: cfg.merchantId,
    sign: cryptomusSign(bodyStr, cfg.apiKey)
  });
  // Cryptomus wraps errors as { state: 1, message, errors }.
  if (json.state !== 0 && !json.result) {
    const msg = json.message || (json.errors ? JSON.stringify(json.errors) : `HTTP ${status}`);
    const err = new Error(`Cryptomus: ${msg}`);
    err.cryptomus = json;
    throw err;
  }
  return json.result;
}

// Create an invoice. Returns { uuid, orderId, url, amount, currency, status }.
async function cryptomusCreateInvoice(cfg, opts) {
  const body = {
    amount: String(opts.amount),
    currency: opts.currency || 'USD',
    order_id: String(opts.orderId),
    lifetime: opts.lifetime || 3600,
    is_payment_multiple: false
  };
  if (opts.urlCallback) body.url_callback = opts.urlCallback;
  if (opts.urlReturn) body.url_return = opts.urlReturn;
  if (opts.urlSuccess) body.url_success = opts.urlSuccess;
  if (opts.network) body.network = opts.network;
  if (opts.toCurrency) body.to_currency = opts.toCurrency;
  const r = await cryptomusRequest('/payment', body, cfg);
  return { uuid: r.uuid, orderId: r.order_id, url: r.url, amount: r.amount, currency: r.currency, status: r.payment_status, expiredAt: r.expired_at };
}

// Poll an invoice. Returns { status, isFinal, paid }.
async function cryptomusGetStatus(cfg, ref) {
  const body = ref.uuid ? { uuid: String(ref.uuid) } : { order_id: String(ref.orderId) };
  const r = await cryptomusRequest('/payment/info', body, cfg);
  const status = r.payment_status || r.status;
  return { status, isFinal: Boolean(r.is_final), paid: status === 'paid' || status === 'paid_over', raw: r };
}

// Lightweight credential check — list services is a cheap signed call that fails
// fast on a bad merchant/key pair.
async function cryptomusValidate(cfg) {
  try {
    await cryptomusRequest('/payment/services', {}, cfg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Verify a webhook body (for a future hosted backend). PHP escapes slashes in
// json_encode; JS does not — so we match by escaping "/" before hashing.
function cryptomusVerifyWebhook(cfg, payload) {
  if (!payload || typeof payload !== 'object') return false;
  const received = payload.sign;
  if (!received) return false;
  const data = { ...payload };
  delete data.sign;
  const jsonPhp = JSON.stringify(data).replace(/\//g, '\\/');
  const expected = cryptomusSign(jsonPhp, cfg.apiKey);
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(received))); }
  catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Self-verifying purchase codes. A code carries its own signature, so it can be
// validated OFFLINE on any machine (no backend / no shared DB) — which is what
// "register with a purchase code" needs. The source owner (super admin) holds
// the signing secret, so only codes the app issued (or the owner generates) pass.
// ---------------------------------------------------------------------------
const LICENSE_SECRET = 'SoftGlaze::license::v1::9f3a7c21';

function purchaseSig(payloadStr) {
  return crypto.createHash('sha256').update(`${LICENSE_SECRET}:${payloadStr}`).digest('hex').slice(0, 8).toUpperCase();
}

function generatePurchaseCode(months) {
  const m = String(Math.max(1, Number(months) || 1)).padStart(2, '0');
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
  const payload = `${m}-${rand}`;
  return `SGP-${payload}-${purchaseSig(payload)}`;
}

function verifyPurchaseCode(code) {
  const m = /^SGP-(\d{2})-([0-9A-F]{8})-([0-9A-F]{8})$/.exec(String(code || '').trim().toUpperCase());
  if (!m) return { valid: false };
  if (purchaseSig(`${m[1]}-${m[2]}`) !== m[3]) return { valid: false };
  return { valid: true, months: parseInt(m[1], 10) || 1 };
}

const PROVIDERS = {
  cryptomus: {
    id: 'cryptomus',
    label: 'Cryptomus (crypto)',
    createInvoice: cryptomusCreateInvoice,
    getStatus: cryptomusGetStatus,
    validate: cryptomusValidate,
    verifyWebhook: cryptomusVerifyWebhook
  }
  // Future seams — same shape:
  // stripe:  { id:'stripe',  label:'Stripe',  createInvoice, getStatus, validate },
  // paypal:  { id:'paypal',  label:'PayPal',  ... },
  // wise:    { id:'wise',    label:'Wise',    ... },
};

const PLANNED_PROVIDERS = ['stripe', 'paypal', 'wise'];

function getProvider(id) { return PROVIDERS[String(id || 'cryptomus')] || null; }

module.exports = { PROVIDERS, PLANNED_PROVIDERS, getProvider, cryptomusSign, generatePurchaseCode, verifyPurchaseCode };
