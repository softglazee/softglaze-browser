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
// Generic HTTPS request used by the Stripe + PayPal adapters. Resolves with
// { status, json, text } and never needs a public callback URL (desktop apps
// poll for completion). A string body is sent verbatim (form-encoded); an object
// body is JSON-encoded.
// ---------------------------------------------------------------------------
function httpsRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload != null && h['Content-Length'] == null) h['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (e) { /* non-JSON response */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Payment gateway request timed out.')));
    if (payload != null) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stripe — hosted Checkout Sessions. The secret key (sk_…) lives on the source
// owner's machine; we create a one-time payment session and poll its
// payment_status. Stripe uses bracketed form-encoding, not JSON.
// ---------------------------------------------------------------------------
const STRIPE_BASE = 'https://api.stripe.com/v1';

// Recursively encode an object/array into Stripe's `a[b][0][c]=v` form syntax.
function stripeForm(obj, prefix) {
  const parts = [];
  const add = (k, val) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item && typeof item === 'object') parts.push(stripeForm(item, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (val && typeof val === 'object') {
      parts.push(stripeForm(val, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
  };
  for (const [k, v] of Object.entries(obj)) add(k, v);
  return parts.filter(Boolean).join('&');
}

async function stripeCreateInvoice(cfg, opts) {
  if (!cfg || !cfg.secretKey) throw new Error('Stripe is not configured. Add your Stripe secret key.');
  const unitAmount = Math.round(parseFloat(opts.amount) * 100); // smallest currency unit
  const body = stripeForm({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: String(opts.currency || 'USD').toLowerCase(),
        product_data: { name: opts.productName || `SoftGlaze Browser (${opts.orderId})` },
        unit_amount: unitAmount
      },
      quantity: 1
    }],
    success_url: opts.urlSuccess || 'https://softglaze.app/paid?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: opts.urlCancel || 'https://softglaze.app/cancelled',
    client_reference_id: String(opts.orderId),
    metadata: { orderId: String(opts.orderId) }
  });
  const { status, json } = await httpsRequest('POST', `${STRIPE_BASE}/checkout/sessions`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!json || json.error) throw new Error(`Stripe: ${json && json.error ? json.error.message : `HTTP ${status}`}`);
  return { uuid: json.id, orderId: opts.orderId, url: json.url, amount: opts.amount, currency: opts.currency, status: json.payment_status };
}

async function stripeGetStatus(cfg, ref) {
  const id = ref.uuid || ref.orderId;
  const { json } = await httpsRequest('GET', `${STRIPE_BASE}/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}` }
  });
  if (!json || json.error) return { status: 'unknown', isFinal: false, paid: false };
  const paid = json.payment_status === 'paid';
  return { status: json.payment_status || json.status, isFinal: paid || json.status === 'expired', paid, raw: json };
}

async function stripeValidate(cfg) {
  if (!cfg || !cfg.secretKey) return { ok: false, error: 'Missing Stripe secret key.' };
  try {
    const { status, json } = await httpsRequest('GET', `${STRIPE_BASE}/balance`, { headers: { Authorization: `Bearer ${cfg.secretKey}` } });
    if (json && !json.error && status === 200) return { ok: true };
    return { ok: false, error: (json && json.error && json.error.message) || `HTTP ${status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------------------------------------------------------------------------
// PayPal — Orders v2. OAuth client-credentials → create order → buyer approves
// in the browser → we capture on poll. `env` selects live vs sandbox hosts.
// ---------------------------------------------------------------------------
function paypalBase(cfg) {
  return (cfg && String(cfg.env).toLowerCase() === 'sandbox') ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

async function paypalToken(cfg) {
  if (!cfg || !cfg.clientId || !cfg.clientSecret) throw new Error('PayPal is not configured. Add your client ID and secret.');
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const { status, json } = await httpsRequest('POST', `${paypalBase(cfg)}/v1/oauth2/token`, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!json || !json.access_token) throw new Error(`PayPal authentication failed (HTTP ${status}).`);
  return json.access_token;
}

async function paypalCreateInvoice(cfg, opts) {
  const token = await paypalToken(cfg);
  const { status, json } = await httpsRequest('POST', `${paypalBase(cfg)}/v2/checkout/orders`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: String(opts.orderId), amount: { currency_code: String(opts.currency || 'USD'), value: String(opts.amount) } }],
      application_context: {
        brand_name: 'SoftGlaze Browser',
        user_action: 'PAY_NOW',
        return_url: opts.urlSuccess || 'https://softglaze.app/paid',
        cancel_url: opts.urlCancel || 'https://softglaze.app/cancelled'
      }
    }
  });
  if (!json || !json.id) throw new Error(`PayPal: could not create the order (HTTP ${status}).`);
  const approve = (json.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return { uuid: json.id, orderId: opts.orderId, url: approve ? approve.href : null, amount: opts.amount, currency: opts.currency, status: json.status };
}

async function paypalGetStatus(cfg, ref) {
  const token = await paypalToken(cfg);
  const id = ref.uuid || ref.orderId;
  const get = await httpsRequest('GET', `${paypalBase(cfg)}/v2/checkout/orders/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  let order = get.json;
  if (!order || !order.status) return { status: 'unknown', isFinal: false, paid: false };
  // The buyer approved in their browser → capture the funds now.
  if (order.status === 'APPROVED') {
    const cap = await httpsRequest('POST', `${paypalBase(cfg)}/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: {}
    });
    if (cap.json && cap.json.status) order = cap.json;
  }
  const paid = order.status === 'COMPLETED';
  return { status: order.status, isFinal: paid || order.status === 'VOIDED', paid, raw: order };
}

async function paypalValidate(cfg) {
  try { await paypalToken(cfg); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ---------------------------------------------------------------------------
// Self-verifying purchase codes — BASE / STANDALONE BUILD ONLY.
//
// A code carries its own short HMAC, validated OFFLINE with a shipped secret.
// This is inherently best-effort: the secret ships in the binary, so a base build
// can't make it un-forgeable (that's a property of any fully-offline activation).
//
// Tenant-provisioned (licensing-backend) builds DO NOT use this path at all —
// when tenantConfig().enabled is true, redeem/checkout route to the backend and
// entitlement comes from a server-signed Ed25519 lease (licenseClient.verifyLease),
// where the private key never ships. So for production/sold builds, ship a
// tenant-provisioned build and this code is dead. It remains only so the base
// build keeps a working offline trial/activation path.
//
// TODO(phase 4+): if the base build is retired, delete this block entirely.
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

// Runtime adapters. `automated` providers implement createInvoice/getStatus/
// validate (hosted checkout + poll). `manual` providers have no API — the buyer
// pays out-of-band and a Super Admin approves the payment in-app.
const PROVIDERS = {
  cryptomus: { id: 'cryptomus', kind: 'automated', createInvoice: cryptomusCreateInvoice, getStatus: cryptomusGetStatus, validate: cryptomusValidate, verifyWebhook: cryptomusVerifyWebhook },
  stripe: { id: 'stripe', kind: 'automated', createInvoice: stripeCreateInvoice, getStatus: stripeGetStatus, validate: stripeValidate },
  paypal: { id: 'paypal', kind: 'automated', createInvoice: paypalCreateInvoice, getStatus: paypalGetStatus, validate: paypalValidate },
  wise: { id: 'wise', kind: 'manual' },
  manual: { id: 'manual', kind: 'manual' }
};

// Provider metadata — the single source of truth for the Settings config UI and
// for which fields are secret (sealed at rest). `kind: 'manual'` means there is
// no automated checkout API; Wise has no merchant-checkout API for this use case,
// so it is offered as a guided bank-transfer with Super-Admin approval.
const PROVIDER_DEFS = [
  {
    id: 'cryptomus', label: 'Cryptomus (crypto)', kind: 'automated', docsUrl: 'https://doc.cryptomus.com/',
    fields: [
      { key: 'merchantId', label: 'Merchant ID (UUID)', secret: false, placeholder: '8b03432e-385b-…' },
      { key: 'apiKey', label: 'Payment API key', secret: true }
    ]
  },
  {
    id: 'stripe', label: 'Stripe (cards)', kind: 'automated', docsUrl: 'https://stripe.com/docs/api',
    fields: [
      { key: 'secretKey', label: 'Secret key (sk_live_… / sk_test_…)', secret: true }
    ]
  },
  {
    id: 'paypal', label: 'PayPal', kind: 'automated', docsUrl: 'https://developer.paypal.com/api/rest/',
    fields: [
      { key: 'clientId', label: 'Client ID', secret: false },
      { key: 'clientSecret', label: 'Client secret', secret: true },
      { key: 'env', label: 'Environment', secret: false, type: 'select', options: ['live', 'sandbox'], default: 'live' }
    ]
  },
  {
    id: 'wise', label: 'Wise (bank transfer)', kind: 'manual', docsUrl: 'https://wise.com/',
    fields: [
      { key: 'payLink', label: 'Wise payment link / WiseTag', secret: false, placeholder: 'https://wise.com/pay/me/…' },
      { key: 'instructions', label: 'Instructions shown to the buyer', secret: false, type: 'textarea' }
    ]
  },
  {
    id: 'manual', label: 'Manual payment', kind: 'manual', docsUrl: null,
    fields: [
      { key: 'instructions', label: 'Instructions shown to the buyer (bank details, crypto address, etc.)', secret: false, type: 'textarea' }
    ]
  }
];

function getProvider(id) { return PROVIDERS[String(id || '')] || null; }
function getProviderDef(id) { return PROVIDER_DEFS.find((p) => p.id === String(id || '')) || null; }

module.exports = {
  PROVIDERS,
  PROVIDER_DEFS,
  getProvider,
  getProviderDef,
  stripeForm,
  paypalBase,
  cryptomusSign,
  generatePurchaseCode,
  verifyPurchaseCode
};
