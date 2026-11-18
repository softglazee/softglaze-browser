'use strict';
// Website purchases (src/webPurchase.js): POST /v1/checkout without an install, GET /v1/checkout/status
// for the website's thanks page, one single-use activation code per paid web Payment, emailed to the
// buyer, redeemable in the app; resend from the admin; a refund voids an unused code. App purchases
// (with an installId) keep getting a licence. Real app over HTTP, in-memory Prisma, stubbed Safepay
// HTTPS and a recording SMTP transport.
const crypto = require('node:crypto');

process.env.WEB_CHECKOUT_RATE_PER_MIN = '100000';

// Recording stand-in for src/http, installed before the app loads.
const http = {
  calls: [],
  handler: null,
  async httpsRequest(method, url, opts = {}) {
    http.calls.push({ method, url, headers: opts.headers || {}, body: opts.body });
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
const transport = require('../src/email/transport');
const { verifySafepayTracker } = require('../src/safepayVerify');
const { revokeForRefund } = require('../src/licensing');
const { issueWebCode } = require('../src/webPurchase');
const { allDefaultRows } = require('../src/email/defaults');
const { processOutbox } = require('../src/email/outbox');
const { getSettings } = require('../src/settings');

const T = 'tenant1';
const SITE = 'https://browser.softglaze.com';
const DAY = 86400000;
const newTracker = () => `track_${crypto.randomUUID()}`;

test.before(async () => {
  await H.start();
  await H.seedTenant(T);
  await H.db.plan.create({ data: { tenantId: T, key: 'enterprise-yearly', name: 'Enterprise yearly', tier: 'enterprise', amount: 29000, currency: 'USD', interval: 'year', months: 12, sortOrder: 4 } });
  await H.db.plan.create({ data: { tenantId: T, key: 'pro-sub', name: 'Pro subscription', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, recurring: true, sortOrder: 5 } });
  await H.db.tenantPaymentConfig.create({ data: { tenantId: T, provider: 'safepay', enabled: true, secretsSealed: sealJson({ publicKey: 'pub_x', secretKey: 'sec_x', webhookSecret: 'wh', env: 'sandbox' }) } });
});
test.after(() => H.stop());

// Safepay: creating a tracker (+ its auth token), and the reporter's answer per tracker.
function safepay({ create = null, trackers = {} } = {}) {
  http.calls = [];
  http.handler = (method, url) => {
    if (url.endsWith('/order/payments/v3/')) return { status: 201, json: { data: { tracker: { token: create } } } };
    if (url.endsWith('/client/passport/v1/token')) return { status: 200, json: { data: 'tbt_test' } };
    const m = /\/reporter\/api\/v1\/payments\/([^/?]+)$/.exec(url);
    const tr = m && decodeURIComponent(m[1]);
    const t = tr && trackers[tr];
    if (!t) return { status: 404, json: { status: { errors: ['tracker not found'], message: 'error' } } };
    const amount = t.amount || 500;
    return { status: 200, json: { data: { tracker: { token: tr, state: t.state || 'TRACKER_ENDED', purchase_totals: { quote_amount: { currency: 'USD', amount }, base_amount: { currency: 'PKR', amount: amount * 278 } } } } } };
  };
}

const webCheckout = (body, headers = {}) => H.call('POST', '/v1/checkout', { body: { tenantId: T, provider: 'safepay', ...body }, headers });
const status = (tracker, headers = {}) => H.call('GET', `/v1/checkout/status?tenantId=${T}&tracker=${encodeURIComponent(tracker)}`, { headers });
const paymentOf = (tracker) => H.db.payment.findFirst({ where: { providerRef: tracker } });
const codesNow = () => H.db.licenseCode.findMany({ where: { tenantId: T } });
const mailsTo = (to) => H.mail.sent.filter((m) => m.to === to);
const codeIn = (text) => { const m = /\bSG-[0-9A-F]{12}\b/.exec(text || ''); return m ? m[0] : null; };

async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}

// A web checkout for `email`, and the tracker Safepay gave it.
async function buy(email, planKey = 'pro') {
  const tracker = newTracker();
  safepay({ create: tracker });
  const r = await webCheckout({ planKey, account: email }, { origin: SITE });
  assert.equal(r.status, 200, r.text);
  return { tracker, r };
}

// --- checkout ---------------------------------------------------------------------------------------
test('a website checkout (no installId) records a web Payment for the email and returns to the website', async () => {
  const { tracker, r } = await buy('  Buyer.One@Example.COM ');
  assert.equal(r.json.ref, tracker);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  const u = new URL(r.json.url);
  assert.equal(u.searchParams.get('redirect_url'), `${SITE}/buy/thanks`);
  assert.equal(u.searchParams.get('cancel_url'), `${SITE}/buy?cancelled=1`);
  const p = await paymentOf(tracker);
  assert.equal(p.status, 'pending');
  assert.equal(p.method, 'web');
  assert.equal(p.installId, null);
  assert.equal(p.account, 'buyer.one@example.com');
  assert.equal(p.amount, 500);
});

test('a website checkout needs a real, permanent email, a one-time plan and card payments', async () => {
  const before = (await H.db.payment.findMany({})).length;
  safepay({ create: newTracker() });
  for (const account of [undefined, '', 'not-an-email', 'a@b', 'x@@example.com']) {
    const r = await webCheckout({ planKey: 'pro', account });
    assert.equal(r.status, 400, String(account));
    assert.equal(r.json.error, 'invalid_email');
  }
  const d = await webCheckout({ planKey: 'pro', account: 'someone@mailinator.com' });
  assert.equal(d.status, 400);
  assert.equal(d.json.error, 'disposable_email');
  const sub = await webCheckout({ planKey: 'pro-sub', account: 'buyer@example.com' });
  assert.equal(sub.status, 400);
  assert.equal(sub.json.error, 'install_required');
  const stripe = await webCheckout({ planKey: 'pro', account: 'buyer@example.com', provider: 'stripe' });
  assert.equal(stripe.status, 400);
  assert.equal(stripe.json.error, 'install_required');
  assert.equal(http.calls.length, 0, 'nothing reached Safepay');
  assert.equal((await H.db.payment.findMany({})).length, before);
});

test('CORS: only the website origin (and localhost for development) may call checkout and status', async () => {
  for (const origin of [SITE, 'http://localhost:4321', 'http://127.0.0.1:4322']) {
    const pre = await H.call('OPTIONS', '/v1/checkout', { headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
    assert.match(pre.headers.get('access-control-allow-headers'), /Content-Type/i);
    const st = await H.call('OPTIONS', '/v1/checkout/status', { headers: { origin } });
    assert.equal(st.headers.get('access-control-allow-origin'), origin);
  }
  for (const origin of ['https://evil.example', 'https://browser.softglaze.com.evil.example', 'http://localhost.evil.example']) {
    const pre = await H.call('OPTIONS', '/v1/checkout', { headers: { origin } });
    assert.equal(pre.headers.get('access-control-allow-origin'), null, origin);
    const r = await webCheckout({ planKey: 'pro', account: 'nope' }, { origin });
    assert.equal(r.headers.get('access-control-allow-origin'), null, origin);
  }
});

test('/methods tells the website whether card checkout is on and whether it is a test (sandbox) setup', async () => {
  const r = await H.call('GET', `/v1/checkout/methods?tenantId=${T}`);
  assert.deepEqual(r.json.web, { card: true, test: true });
  assert.ok(!JSON.stringify(r.json).includes('sec_x'));
  const cfg = await H.db.tenantPaymentConfig.findFirst({ where: { tenantId: T, provider: 'safepay' } });
  await H.db.tenantPaymentConfig.update({ where: { id: cfg.id }, data: { secretsSealed: sealJson({ publicKey: 'pub_x', secretKey: 'sec_x', webhookSecret: 'wh', env: 'live' }) } });
  try {
    assert.deepEqual((await H.call('GET', `/v1/checkout/methods?tenantId=${T}`)).json.web, { card: true, test: false });
  } finally {
    await H.db.tenantPaymentConfig.update({ where: { id: cfg.id }, data: { secretsSealed: cfg.secretsSealed } });
  }
});

// --- status, code, email ------------------------------------------------------------------------------
test('paid: /status says pending, then paid; one code with the plan\'s tier and term is emailed; no licence', async () => {
  const email = 'web.buyer@example.com';
  const { tracker } = await buy(email);
  safepay({ trackers: { [tracker]: { state: 'TRACKER_STARTED' } } });
  const s1 = await status(tracker, { origin: SITE });
  assert.equal(s1.status, 200);
  assert.deepEqual(s1.json, { status: 'pending' });
  assert.equal(s1.headers.get('access-control-allow-origin'), SITE);
  assert.equal(s1.headers.get('cache-control'), 'no-store');

  const codesBefore = (await codesNow()).length;
  safepay({ trackers: { [tracker]: {} } });
  const s2 = await status(tracker);
  assert.deepEqual(s2.json, { status: 'paid' });
  assert.doesNotMatch(s2.text, /SG-|@/, 'never the code or the email');

  const p = await paymentOf(tracker);
  assert.equal(p.status, 'paid');
  const code = codeIn(p.note);
  assert.ok(code, 'the code is written on the payment');
  const codes = await codesNow();
  assert.equal(codes.length, codesBefore + 1);
  const rec = codes.find((c) => c.code === code);
  assert.equal(rec.tier, 'pro');
  assert.equal(rec.months, 1);
  assert.equal(rec.redeemedAt, null);
  assert.equal((await H.db.license.findMany({ where: { tenantId: T, account: email } })).length, 0, 'no licence for the email');

  const mails = await waitFor(() => mailsTo(email).length && mailsTo(email));
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.subject, 'Your SoftGlaze Browser activation code');
  assert.equal(codeIn(m.text), code);
  assert.ok(m.html.includes(code));
  assert.match(m.text, /Pro plan \(1 month\)/);
  assert.match(m.text, /Billing/);
  assert.match(m.text, /Have a purchase code\?/);
  assert.match(m.text, /https:\/\/browser\.softglaze\.com\/download/);
  assert.match(m.text, /support@softglaze\.com/);
  assert.match(m.text, /used for a purchase on our website/);
  assert.equal(m.list, undefined, 'transactional: no List-Unsubscribe header');
  assert.doesNotMatch(m.text + m.html, /[Uu]nsubscribe/);
  const row = await H.db.emailOutbox.findFirst({ where: { tenantId: T, dedupeKey: `activation-code:${p.id}` } });
  assert.equal(row.status, 'sent');
  assert.equal(row.category, 'essential');

  // Polling again, the return page, the cron: no second code, no second email.
  assert.deepEqual((await status(tracker)).json, { status: 'paid' });
  assert.equal((await verifySafepayTracker(tracker)).status, 'unknown');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await codesNow()).length, codesBefore + 1);
  assert.equal(mailsTo(email).length, 1);
});

test('the emailed code activates the plan in the app (POST /v1/redeem), once', async () => {
  const email = 'redeemer@example.com';
  const { tracker } = await buy(email, 'enterprise-yearly');
  safepay({ trackers: { [tracker]: { amount: 29000 } } });
  assert.deepEqual((await status(tracker)).json, { status: 'paid' });
  const m = await waitFor(() => mailsTo(email)[0]);
  assert.match(m.text, /Enterprise yearly plan \(12 months\)/);
  const code = codeIn(m.text);
  const inst = await H.newInstall(T, 'web-redeemer');
  const r = await H.call('POST', '/v1/redeem', { body: { tenantId: T, code, ...inst } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { ok: true, tier: 'enterprise', months: 12 });
  const [lic] = await H.db.license.findMany({ where: { tenantId: T, installId: inst.installId } });
  assert.equal(lic.tier, 'enterprise');
  assert.equal(Math.round((new Date(lic.currentPeriodEnd).getTime() - Date.now()) / DAY), 365);
  const other = await H.newInstall(T, 'web-redeemer-2');
  assert.equal((await H.call('POST', '/v1/redeem', { body: { tenantId: T, code, ...other } })).status, 409);
});

test('without SMTP the code is kept and its email queued; the next status poll sends it', async () => {
  const email = 'nosmtp@example.com';
  const { tracker } = await buy(email);
  safepay({ trackers: { [tracker]: {} } });
  const warn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  transport.setTransportForTests(null);
  try {
    assert.deepEqual((await status(tracker)).json, { status: 'paid' });
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    transport.setTransportForTests(H.mail);
    console.warn = warn;
  }
  assert.ok(warnings.some((w) => /SMTP is not configured/.test(w)));
  const p = await paymentOf(tracker);
  assert.ok(codeIn(p.note));
  const row = await H.db.emailOutbox.findFirst({ where: { tenantId: T, dedupeKey: `activation-code:${p.id}` } });
  assert.equal(row.status, 'queued');
  assert.equal(mailsTo(email).length, 0);
  // SMTP is set now: the thanks page polls again (or the cron runs) and the email goes out.
  assert.deepEqual((await status(tracker)).json, { status: 'paid' });
  const m = await waitFor(() => mailsTo(email)[0]);
  assert.equal(codeIn(m.text), codeIn(p.note));
  const settings = await getSettings(H.db, T);
  await processOutbox(H.db, { id: T }, { settings });
  assert.equal(mailsTo(email).length, 1, 'the cron does not send it twice');
});

test('issuing a code twice for one payment reuses the code and the email (idempotent)', async () => {
  const email = 'twice@example.com';
  const { tracker } = await buy(email);
  const p = await paymentOf(tracker);
  const plan = await H.db.plan.findUnique({ where: { tenantId_key: { tenantId: T, key: 'pro' } } });
  const a = await issueWebCode({ id: T }, p, plan, H.db);
  const b = await issueWebCode({ id: T }, p, plan, H.db);
  assert.equal(a.code, b.code);
  assert.equal(a.outboxId, b.outboxId);
  assert.equal((await codesNow()).filter((c) => c.code === a.code).length, 1);
  assert.equal((await H.db.emailOutbox.findMany({ where: { tenantId: T, toEmail: email } })).length, 1);
});

test('an app purchase (with installId) still gets a licence, no code and no email; /status ignores it', async () => {
  const tracker = newTracker();
  safepay({ create: tracker });
  const r = await H.call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'pro', provider: 'safepay', installId: 'app-inst-1', account: 'app.user@example.com' } });
  assert.equal(r.status, 200);
  const u = new URL(r.json.url);
  assert.equal(u.searchParams.get('redirect_url'), 'https://api.test/v1/checkout/return/success');
  const p0 = await paymentOf(tracker);
  assert.equal(p0.method, null);
  const codesBefore = (await codesNow()).length;
  safepay({ trackers: { [tracker]: {} } });
  assert.deepEqual((await status(tracker)).json, { status: 'unknown' });
  assert.equal((await verifySafepayTracker(tracker)).status, 'provisioned');
  assert.equal((await H.db.license.findMany({ where: { tenantId: T, installId: 'app-inst-1' } })).length, 1);
  assert.equal((await codesNow()).length, codesBefore);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(mailsTo('app.user@example.com').length, 0);
});

test('/status answers unknown for junk, an unknown tracker or another tenant', async () => {
  safepay({});
  for (const q of ['tracker=nope', `tracker=${newTracker()}`, '']) {
    const r = await H.call('GET', `/v1/checkout/status?tenantId=${T}&${q}`);
    assert.deepEqual(r.json, { status: 'unknown' });
  }
  const { tracker } = await buy('other.tenant@example.com');
  assert.deepEqual((await H.call('GET', `/v1/checkout/status?tenantId=someone-else&tracker=${tracker}`)).json, { status: 'unknown' });
});

// --- admin + refund -----------------------------------------------------------------------------------
test('admin: the code shows on the payment and can be emailed again; other payments have none', async () => {
  const email = 'lost.mail@example.com';
  const { tracker } = await buy(email);
  safepay({ trackers: { [tracker]: {} } });
  await status(tracker);
  await waitFor(() => mailsTo(email)[0]);
  const p = await paymentOf(tracker);
  const list = await H.admin('GET', '/payments?method=web');
  assert.ok(list.json.items.some((x) => x.id === p.id && codeIn(x.note) === codeIn(p.note)));
  const r = await H.admin('POST', `/payments/${p.id}/resend-code`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.code, codeIn(p.note));
  assert.equal(r.json.redeemed, false);
  assert.equal(r.json.delivery.status, 'sent');
  assert.equal(mailsTo(email).length, 2);
  assert.equal(codeIn(mailsTo(email)[1].text), codeIn(p.note));
  // An app payment has no code to resend.
  const app = await H.db.payment.create({ data: { tenantId: T, provider: 'safepay', providerRef: newTracker(), amount: 500, status: 'paid', plan: 'pro', installId: 'x' } });
  assert.equal((await H.admin('POST', `/payments/${app.id}/resend-code`)).status, 409);
  assert.equal((await H.admin('POST', '/payments/nope/resend-code')).status, 404);
});

test('a refund voids the code if it was not used yet', async () => {
  const email = 'refund.me@example.com';
  const { tracker } = await buy(email);
  safepay({ trackers: { [tracker]: {} } });
  await status(tracker);
  const code = codeIn((await paymentOf(tracker)).note);
  const r = await revokeForRefund({ id: T }, { provider: 'safepay', sessionRef: tracker });
  assert.equal(r.changed, true);
  assert.equal((await paymentOf(tracker)).status, 'refunded');
  const inst = await H.newInstall(T, 'refund-try');
  assert.equal((await H.call('POST', '/v1/redeem', { body: { tenantId: T, code, ...inst } })).status, 409);
});

test('the activation email copy has both languages, known placeholders only and no dashes', () => {
  const rows = allDefaultRows().filter((r) => r.key === 'activation_code');
  assert.deepEqual(rows.map((r) => r.lang).sort(), ['en', 'es']);
  const { unknownPlaceholders } = require('../src/email/render');
  for (const r of rows) {
    assert.equal(r.category, 'essential');
    assert.deepEqual(unknownPlaceholders(r.subject, r.html, r.text), []);
    assert.ok(!/[–—]/.test(`${r.subject}${r.html}${r.text}`));
    for (const ph of ['{{code}}', '{{downloadUrl}}', '{{supportEmail}}', '{{term}}']) assert.ok(r.text.includes(ph), `${r.lang} ${ph}`);
  }
});
