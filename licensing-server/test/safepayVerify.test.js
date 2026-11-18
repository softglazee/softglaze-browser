'use strict';
// Safepay without webhooks: the return page (/v1/checkout/return/success and Safepay's mangled
// /return?status=success?order_id=...&tracker=...) and the cron ask Safepay's reporter API about the
// tracker and provision only on its answer. Real app over HTTP, in-memory Prisma, stubbed HTTPS.
const crypto = require('node:crypto');

// Recording stand-in for src/http, installed before the app loads.
const http = {
  calls: [],
  handler: null,
  async httpsRequest(method, url, opts = {}) {
    http.calls.push({ method, url, headers: opts.headers || {} });
    if (!http.handler) throw new Error(`unexpected request ${method} ${url}`);
    return http.handler(method, url, opts);
  }
};
const httpPath = require.resolve('../src/http');
require.cache[httpPath] = { id: httpPath, filename: httpPath, loaded: true, exports: http };

const H = require('./helpers/harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sealJson } = require('../src/crypto/secrets');
const safepay = require('../src/providers/safepay');
const { verifySafepayTracker, reconcileSafepay } = require('../src/safepayVerify');

const T = 'tenant1';
const WH = 'sfpy_shared_secret';
const DAY = 86400000;
const TRACK = 'track_29d38387-ffcd-4234-be1e-6db073ef186e';
let n = 0;
const newTracker = () => `track_${crypto.randomUUID()}`;

test.before(async () => {
  await H.start();
  await H.seedTenant(T);
  await H.db.tenantPaymentConfig.create({ data: { tenantId: T, provider: 'safepay', enabled: true, secretsSealed: sealJson({ publicKey: 'pub_x', secretKey: 'sec_x', webhookSecret: WH, env: 'sandbox' }) } });
});
test.after(() => H.stop());

// Safepay's reporter answer for `tracker` (express-checkout doc shape: data.tracker).
function reporter(tracker, { state = 'TRACKER_ENDED', quote = { currency: 'USD', amount: 500 }, base = { currency: 'PKR', amount: 139000 }, flat = false } = {}) {
  const t = { token: tracker, environment: 'sandbox', state, intent: 'CYBERSOURCE', mode: 'payment', purchase_totals: { quote_amount: quote, base_amount: base } };
  return { status: 200, json: flat ? { ok: true, data: t } : { data: { tracker: t }, status: { errors: [], message: 'success' } } };
}
function answer(byTracker) {
  http.calls = [];
  http.handler = (method, url) => {
    const m = /\/reporter\/api\/v1\/payments\/([^/?]+)$/.exec(url);
    const tracker = m && decodeURIComponent(m[1]);
    const r = tracker && byTracker[tracker];
    if (!r) return { status: 404, json: { status: { errors: ['tracker not found'], message: 'error' } } };
    return typeof r === 'function' ? r() : r;
  };
}

async function pending(tracker, extra = {}) {
  const installId = `inst-${++n}`;
  await H.db.payment.create({ data: { tenantId: T, provider: 'safepay', providerRef: tracker, amount: 500, currency: 'USD', status: 'pending', plan: 'pro', installId, ...extra } });
  return installId;
}
const paymentOf = async (tracker) => H.db.payment.findFirst({ where: { providerRef: tracker } });
const licencesOf = async (installId) => H.db.license.findMany({ where: { tenantId: T, installId } });
const daysLeft = (lic) => Math.round((new Date(lic.currentPeriodEnd).getTime() - Date.now()) / DAY);

// --- the return page --------------------------------------------------------------------------------
test('Safepay\'s mangled return URL (status=success?order_id=...&tracker=...) shows success and provisions after the API confirms', async () => {
  const inst = await pending(TRACK);
  answer({ [TRACK]: reporter(TRACK) });
  const r = await H.call('GET', `/v1/checkout/return?status=success?order_id=sg-${T}-1&tracker=${TRACK}`, { raw: true });
  assert.equal(r.status, 200);
  assert.match(r.text, /Payment received/);
  assert.match(r.text, /Your plan will be active in a moment; you can close this window and return to the app\./);
  assert.doesNotMatch(r.text, /canceled/i);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].method, 'GET');
  assert.equal(http.calls[0].url, `https://sandbox.api.getsafepay.com/reporter/api/v1/payments/${TRACK}`);
  assert.equal(http.calls[0].headers['X-SFPY-MERCHANT-SECRET'], 'sec_x');
  assert.doesNotMatch(r.text, /sec_x|pub_x/);
  assert.equal((await paymentOf(TRACK)).status, 'paid');
  const lic = await licencesOf(inst);
  assert.equal(lic.length, 1);
  assert.equal(lic[0].status, 'active');
  assert.equal(daysLeft(lic[0]), 30);
});

test('/return/success with Safepay\'s appended ?order_id&tracker provisions; the flat reporter shape works too', async () => {
  const tr = newTracker();
  const inst = await pending(tr);
  answer({ [tr]: reporter(tr, { flat: true }) });
  const r = await H.call('GET', `/v1/checkout/return/success?order_id=sg-${T}-2&tracker=${tr}`, { raw: true });
  assert.match(r.text, /Payment received/);
  assert.equal((await paymentOf(tr)).status, 'paid');
  assert.equal((await licencesOf(inst)).length, 1);
});

test('a tracker Safepay does not report TRACKER_ENDED grants nothing (the page still says received)', async () => {
  const tr = newTracker();
  const inst = await pending(tr);
  answer({ [tr]: reporter(tr, { state: 'TRACKER_STARTED' }) });
  const r = await H.call('GET', `/v1/checkout/return/success?tracker=${tr}`, { raw: true });
  assert.match(r.text, /Payment received/);
  assert.equal((await paymentOf(tr)).status, 'pending');
  assert.equal((await licencesOf(inst)).length, 0);
  // Not ended is not final: a later check that sees it ended still provisions.
  answer({ [tr]: reporter(tr) });
  assert.equal((await verifySafepayTracker(tr)).status, 'provisioned');
  assert.equal((await licencesOf(inst)).length, 1);
});

test('an ended tracker for another amount or currency grants nothing', async () => {
  const a = newTracker(); const b = newTracker(); const c = newTracker();
  await pending(a); await pending(b); await pending(c);
  answer({
    [a]: reporter(a, { quote: { currency: 'USD', amount: 100 }, base: { currency: 'PKR', amount: 27800 } }),
    [b]: reporter(b, { quote: { currency: 'PKR', amount: 500 }, base: { currency: 'PKR', amount: 500 } }),
    // Safepay reporting only the settled PKR amount for our USD checkout is not accepted either.
    [c]: reporter(c, { quote: null, base: { currency: 'PKR', amount: 139000 } })
  });
  const w = console.warn; console.warn = () => {};
  try {
    for (const tr of [a, b, c]) assert.equal((await verifySafepayTracker(tr)).status, 'mismatch');
  } finally { console.warn = w; }
  for (const tr of [a, b, c]) assert.equal((await paymentOf(tr)).status, 'pending');
});

test('a quote matching only on the base amount counts (Safepay quoting in the settlement currency)', async () => {
  const tr = newTracker();
  await pending(tr);
  answer({ [tr]: reporter(tr, { quote: { currency: 'PKR', amount: 139000 }, base: { currency: 'USD', amount: 500 } }) });
  assert.equal((await verifySafepayTracker(tr)).status, 'provisioned');
});

test('the query string alone grants nothing: Safepay API errors, unknown and foreign trackers', async () => {
  const tr = newTracker();
  const inst = await pending(tr);
  answer({}); // Safepay answers 404 for everything
  const w = console.warn; console.warn = () => {};
  try {
    const r = await H.call('GET', `/v1/checkout/return/success?tracker=${tr}`, { raw: true });
    assert.equal(r.status, 200);
  } finally { console.warn = w; }
  assert.equal((await paymentOf(tr)).status, 'pending');
  assert.equal((await licencesOf(inst)).length, 0);

  answer({});
  await H.call('GET', `/v1/checkout/return/success?tracker=${newTracker()}`, { raw: true });
  await H.call('GET', '/v1/checkout/return/success?tracker=../../admin', { raw: true });
  assert.equal(http.calls.length, 0, 'no pending Safepay payment -> Safepay is not even asked');

  // A Stripe payment with a tracker-shaped ref is not a Safepay payment.
  const st = newTracker();
  await H.db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: st, amount: 500, currency: 'USD', status: 'pending', plan: 'pro' } });
  assert.equal((await verifySafepayTracker(st)).status, 'unknown');
  assert.equal((await verifySafepayTracker(tr, { tenantId: 'other' })).status, 'unknown');
  assert.equal((await verifySafepayTracker('not-a-tracker')).status, 'invalid');
});

test('cancel pages never ask Safepay; the old ?status= routes keep working', async () => {
  answer({});
  const c1 = await H.call('GET', `/v1/checkout/return/cancel?order_id=x&tracker=${TRACK}`, { raw: true });
  assert.match(c1.text, /Checkout canceled/);
  const c2 = await H.call('GET', '/v1/checkout/return?status=cancel', { raw: true });
  assert.match(c2.text, /Checkout canceled/);
  const s = await H.call('GET', '/v1/checkout/return?status=success', { raw: true });
  assert.match(s.text, /Payment received/);
  assert.equal(http.calls.length, 0);
});

// --- exactly once with the webhook ------------------------------------------------------------------
async function webhook(event) {
  const body = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', WH).update(body).digest('hex');
  return H.call('POST', `/v1/webhooks/safepay/${T}`, { body, headers: { 'content-type': 'application/json', 'x-sfpy-signature': sig } });
}
const paidEvent = (tracker) => ({ token: `evt_${crypto.randomUUID()}`, type: 'payment.succeeded', data: { tracker, state: 'TRACKER_ENDED', amount: 500, currency: 'USD' } });

test('verification then a late webhook: provisioned once', async () => {
  const tr = newTracker();
  const inst = await pending(tr);
  answer({ [tr]: reporter(tr) });
  assert.equal((await verifySafepayTracker(tr)).status, 'provisioned');
  assert.equal((await webhook(paidEvent(tr))).status, 200);
  const lic = await licencesOf(inst);
  assert.equal(lic.length, 1);
  assert.equal(daysLeft(lic[0]), 30);
});

test('webhook then the return page: provisioned once, Safepay not asked', async () => {
  const tr = newTracker();
  const inst = await pending(tr);
  assert.equal((await webhook(paidEvent(tr))).status, 200);
  answer({ [tr]: reporter(tr) });
  await H.call('GET', `/v1/checkout/return/success?tracker=${tr}`, { raw: true });
  assert.equal(http.calls.length, 0);
  assert.equal(daysLeft((await licencesOf(inst))[0]), 30);
});

test('concurrent checks (return page reloads) provision once', async () => {
  const tr = newTracker();
  const inst = await pending(tr);
  answer({ [tr]: reporter(tr) });
  const rs = await Promise.all([verifySafepayTracker(tr), verifySafepayTracker(tr), verifySafepayTracker(tr)]);
  assert.equal(rs.filter((r) => r.status === 'provisioned').length, 1);
  const lic = await licencesOf(inst);
  assert.equal(lic.length, 1);
  assert.equal(daysLeft(lic[0]), 30);
});

// --- cron -------------------------------------------------------------------------------------------
test('cron reconcile checks one-time Safepay payments pending 2 min to 48 h, nothing else', async () => {
  const now = Date.now();
  const due = newTracker(); const fresh = newTracker(); const old = newTracker(); const notYet = newTracker();
  const instDue = await pending(due, { createdAt: new Date(now - 5 * 60000) });
  await pending(fresh, { createdAt: new Date(now - 30000) });
  await pending(old, { createdAt: new Date(now - 3 * DAY) });
  await pending(notYet, { createdAt: new Date(now - 10 * 60000) });
  await pending('plan_abc', { createdAt: new Date(now - 5 * 60000) });
  answer({ [due]: reporter(due), [notYet]: reporter(notYet, { state: 'TRACKER_STARTED' }), [fresh]: reporter(fresh), [old]: reporter(old) });
  const out = await reconcileSafepay(H.db, { id: T }, { now });
  assert.equal(out.provisioned, 1);
  assert.equal(out.errors, 0);
  const asked = http.calls.map((c) => c.url.split('/').pop());
  assert.ok(asked.includes(due) && asked.includes(notYet));
  assert.ok(!asked.includes(fresh) && !asked.includes(old) && !asked.includes('plan_abc'));
  assert.equal((await paymentOf(due)).status, 'paid');
  assert.equal((await licencesOf(instDue)).length, 1);
  assert.equal((await paymentOf(fresh)).status, 'pending');
  assert.equal((await paymentOf(old)).status, 'pending');
});

// --- provider helpers -------------------------------------------------------------------------------
test('trackerPays needs TRACKER_ENDED, the same tracker and a matching quote or base amount', () => {
  const p = { providerRef: 'track_a', amount: 500, currency: 'USD' };
  const t = (o) => ({ token: 'track_a', state: 'TRACKER_ENDED', quote: { amount: 500, currency: 'USD' }, base: { amount: 139000, currency: 'PKR' }, ...o });
  assert.equal(safepay.trackerPays(t(), p), true);
  assert.equal(safepay.trackerPays(t({ state: 'TRACKER_STARTED' }), p), false);
  assert.equal(safepay.trackerPays(t({ token: 'track_b' }), p), false);
  assert.equal(safepay.trackerPays(t({ quote: { amount: 501, currency: 'USD' } }), p), false);
  assert.equal(safepay.trackerPays(t({ quote: null, base: { amount: 500, currency: 'usd' } }), p), true);
  assert.equal(safepay.isTrackerToken(TRACK), true);
  assert.equal(safepay.isTrackerToken('track_../x'), false);
});
