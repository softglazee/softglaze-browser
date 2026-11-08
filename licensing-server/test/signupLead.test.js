'use strict';
// App 1.0.23 sign-up: lead details on verify/start (phone, use case, company) that reach the customer only
// once the code is proven; POST /v1/account/status, the server truth the app asks on every start; and
// GET /v1/checkout/methods with the Microsoft Store sales switch (default off). Over HTTP, real routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { USE_CASES, cleanLead, cleanPhone, leadUpdate } = require('../src/account/lead');
const { seal } = require('../src/crypto/secrets');

const { db, mail, call } = H;
let T;
test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const start = (inst, email, extra = {}) => call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email, consentMarketing: false, lang: 'en', ...extra } });
const check = (inst, email) => call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email, code: mail.codeFor(email) } });
const status = (inst, extra = {}) => call('POST', '/v1/account/status', { body: { tenantId: T, ...inst, ...extra } });

// ---- the lead fields, pure ------------------------------------------------------------------------

test('lead fields: phone needs + (or 00) and 7 to 15 digits; the use case must be on the list', () => {
  assert.deepEqual(cleanPhone('+92 300 1234567'), { value: '+92 300 1234567' });
  assert.deepEqual(cleanPhone(' 0044 (20) 7946-0958 '), { value: '+44 (20) 7946-0958' }, '00 becomes +');
  assert.deepEqual(cleanPhone(''), { value: null });
  assert.deepEqual(cleanPhone(undefined), { value: null });
  for (const bad of ['03001234567', '+1 23', '+1234567890123456', '+92 abc 1234567', 12345678, '+92 300 1234567 ext 5']) {
    assert.deepEqual(cleanPhone(bad), { error: 'invalid_phone' }, String(bad));
  }
  assert.deepEqual(USE_CASES, ['ecommerce', 'social_media', 'affiliate_marketing', 'agency', 'web_research', 'other']);
  assert.deepEqual(cleanLead({}).lead, { phone: null, company: null, useCase: null, useCaseOther: null }, 'older apps send none');
  assert.deepEqual(cleanLead({ useCase: 'Agency', company: '  Acme <b>Ltd</b>  ', useCaseOther: 'ignored' }).lead,
    { phone: null, company: 'Acme b Ltd /b', useCase: 'agency', useCaseOther: null }, 'other text only with other; tags stripped');
  assert.deepEqual(cleanLead({ useCase: 'other', useCaseOther: ' Price checks\nfor clients ' }).lead.useCaseOther, 'Price checks for clients');
  assert.equal(cleanLead({ useCase: 'crypto' }).error, 'invalid_use_case');
  assert.equal(cleanLead({ phone: 'call me' }).error, 'invalid_phone');
});

test('lead update: what was just typed wins, an empty field keeps the stored value', () => {
  const c = { phone: '+1 202 555 0143', company: 'Old Co', useCase: 'other', useCaseOther: 'testing' };
  assert.deepEqual(leadUpdate(c, { phone: null, company: null, useCase: null, useCaseOther: null }), {});
  assert.deepEqual(leadUpdate(c, { phone: '+44 20 7946 0958', company: null, useCase: 'agency', useCaseOther: null }),
    { phone: '+44 20 7946 0958', useCase: 'agency', useCaseOther: null }, 'a new use case clears the old "other" text');
  assert.deepEqual(leadUpdate(c, { useCase: 'other', useCaseOther: 'QA' }), { useCaseOther: 'QA' });
});

// ---- verify/start and verify/check ----------------------------------------------------------------

test('verify/start refuses a bad phone or an unknown use case before any email is sent', async () => {
  const inst = await H.newInstall(T, 'lead-bad');
  const before = mail.sent.length;
  const p = await start(inst, 'lead-bad@example.com', { phone: '0300 1234567', useCase: 'agency' });
  assert.equal(p.status, 400);
  assert.equal(p.json.error, 'invalid_phone');
  const u = await start(inst, 'lead-bad@example.com', { useCase: 'gambling' });
  assert.equal(u.status, 400);
  assert.equal(u.json.error, 'invalid_use_case');
  assert.equal(mail.sent.length, before, 'nothing was sent');
  assert.equal(db.tables.emailVerification.filter((v) => v.installId === inst.installId).length, 0, 'no throttle was charged');
});

test('lead details wait on the code and reach the customer only when it is proven', async () => {
  const inst = await H.newInstall(T, 'lead-ok');
  const s = await start(inst, 'Lead.Ok@Example.com', { name: 'Lea Ok', phone: '+92 300 1234567', useCase: 'other', useCaseOther: 'Checking prices', company: 'lea.example', appVersion: '1.0.23' });
  assert.equal(s.status, 200);
  const row = db.tables.emailVerification.find((v) => v.installId === inst.installId);
  assert.equal(row.phone, '+92 300 1234567');
  assert.equal(row.useCase, 'other');
  assert.equal(row.useCaseOther, 'Checking prices');
  assert.equal(row.company, 'lea.example');
  assert.equal(db.tables.customer.find((c) => c.emailKey === 'lead.ok@example.com'), undefined, 'no customer before the code');

  const c = await check(inst, 'lead.ok@example.com');
  assert.equal(c.status, 200);
  const cust = db.tables.customer.find((x) => x.id === c.json.customerId);
  assert.equal(cust.phone, '+92 300 1234567');
  assert.equal(cust.useCase, 'other');
  assert.equal(cust.useCaseOther, 'Checking prices');
  assert.equal(cust.company, 'lea.example');
  assert.ok(cust.emailVerifiedAt);
});

test('an older app (no lead fields) still verifies, and a later confirm fills the details in', async () => {
  const inst = await H.newInstall(T, 'lead-old');
  assert.equal((await start(inst, 'old.app@example.com')).status, 200);
  const c1 = await check(inst, 'old.app@example.com');
  assert.equal(c1.status, 200);
  const cust = () => db.tables.customer.find((x) => x.id === c1.json.customerId);
  assert.equal(cust().useCase, null);
  assert.equal(cust().phone, null);
  // The same person confirms again from 1.0.23 (on another install): the details are added.
  const inst2 = await H.newInstall(T, 'lead-old-2');
  assert.equal((await start(inst2, 'old.app@example.com', { useCase: 'ecommerce', phone: '+1 202 555 0143' })).status, 200);
  assert.equal((await check(inst2, 'old.app@example.com')).status, 200);
  assert.equal(cust().useCase, 'ecommerce');
  assert.equal(cust().phone, '+1 202 555 0143');
});

// ---- POST /v1/account/status ----------------------------------------------------------------------

test('status: false for a new install, true after verify/check on it, never from another install', async () => {
  const inst = await H.newInstall(T, 'st-1');
  const before = await status(inst, { appVersion: '1.0.23', channel: 'store' });
  assert.equal(before.status, 200);
  assert.deepEqual(before.json, { verified: false });
  assert.equal(before.headers.get('cache-control'), 'no-store');
  assert.equal(db.tables.install.find((i) => i.id === inst.installId).channel, 'store', 'the call records the channel like the others');

  assert.equal((await start(inst, 'st.one@example.com', { useCase: 'agency' })).status, 200);
  assert.deepEqual((await status(inst)).json, { verified: false }, 'a code sent is not a confirmation');
  assert.equal((await check(inst, 'st.one@example.com')).status, 200);
  assert.deepEqual((await status(inst)).json, { verified: true, email: 'st.one@example.com' });

  // Another install of the same person is asked again: the proof is per install.
  const other = await H.newInstall(T, 'st-1b');
  assert.deepEqual((await status(other)).json, { verified: false });
});

test('status: an install that only claimed an email at register is not verified', async () => {
  // 1.0.21 and older register with the owner email; the server links an unverified customer.
  const inst = await H.newInstall(T, 'st-claim', { account: 'claimed@example.com' });
  const linked = db.tables.install.find((i) => i.id === inst.installId);
  assert.ok(linked.customerId, 'linked at register');
  assert.deepEqual((await status(inst)).json, { verified: false });
});

test('status: a 1.0.22 sign-up (verified on this install) stays verified; a deleted customer is asked again', async () => {
  const inst = await H.newInstall(T, 'st-122');
  const v = await H.verify(T, inst, 'signed.up@example.com', { appVersion: '1.0.22' });
  assert.equal(v.status, 200);
  assert.equal((await status(inst)).json.verified, true);
  const del = await H.admin('DELETE', `/customers/${v.json.customerId}`);
  assert.equal(del.status, 200);
  assert.deepEqual((await status(inst)).json, { verified: false });
  await H.admin('POST', `/customers/${v.json.customerId}/restore`);
  assert.equal((await status(inst)).json.verified, true);
});

test('status: wrong install secret is 401, missing fields 400, unknown tenant 404', async () => {
  const inst = await H.newInstall(T, 'st-auth');
  assert.equal((await status({ ...inst, installSecret: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/v1/account/status', { body: { tenantId: T } })).status, 400);
  assert.equal((await call('POST', '/v1/account/status', { body: { tenantId: 'nope', ...inst } })).status, 404);
});

// ---- admin customers: the new fields --------------------------------------------------------------

test('admin: customers carry useCase and useCaseOther, filter by use case, and the CSV has both columns', async () => {
  const inst = await H.newInstall(T, 'adm-lead');
  await H.verify(T, inst, 'adm.lead@example.com', { useCase: 'web_research', phone: '+31 6 12345678', company: 'Research BV' });
  const list = await H.admin('GET', '/customers?useCase=web_research');
  assert.equal(list.status, 200);
  const item = list.json.items.find((c) => c.email === 'adm.lead@example.com');
  assert.ok(item, 'found by use case');
  assert.equal(item.useCase, 'web_research');
  assert.equal(item.useCaseOther, null);
  assert.equal(item.phone, '+31 6 12345678');
  assert.equal(item.company, 'Research BV');
  assert.ok(list.json.items.every((c) => c.useCase === 'web_research'));
  const none = await H.admin('GET', '/customers?useCase=none');
  assert.ok(none.json.items.every((c) => c.useCase === null));
  assert.equal((await H.admin('GET', '/customers?useCase=crypto')).status, 400);

  const csv = await H.admin('GET', '/customers/export?useCase=web_research', { raw: true });
  assert.equal(csv.status, 200);
  const [header, ...rows] = csv.text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  const cols = header.split(',');
  assert.ok(cols.indexOf('useCase') > cols.indexOf('phone') && cols.indexOf('useCaseOther') === cols.indexOf('useCase') + 1);
  const row = rows.find((r) => r.includes('adm.lead@example.com')).split(',');
  assert.equal(row[cols.indexOf('useCase')], 'web_research');
  assert.equal(row[cols.indexOf('phone')], "'+31 6 12345678", 'a leading + is escaped against spreadsheet formulas');
});

// ---- GET /v1/checkout/methods ---------------------------------------------------------------------

async function enableProvider(provider, enabled = true) {
  const existing = db.tables.tenantPaymentConfig.find((r) => r.tenantId === T && r.provider === provider);
  if (existing) { existing.enabled = enabled; return; }
  await db.tenantPaymentConfig.create({ data: { tenantId: T, provider, enabled, secretsSealed: seal('{}') } });
}
const methods = () => call('GET', `/v1/checkout/methods?tenantId=${T}`);

test('checkout methods: none until a provider is enabled; Store sales are off by default', async () => {
  const r = await methods();
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { providers: [], store: { salesEnabled: false } });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
  assert.equal((await call('GET', '/v1/checkout/methods')).status, 400);
  assert.equal((await call('GET', '/v1/checkout/methods?tenantId=nope')).status, 404);
});

test('checkout methods: enabled providers with server labels; the Entra ID app is never a method', async () => {
  await enableProvider('paypal');
  await enableProvider('stripe');
  await enableProvider('cryptomus', false);
  await enableProvider('microsoft_store');
  const r = await methods();
  assert.deepEqual(r.json.providers, [
    { id: 'stripe', label: 'Stripe (cards)', kind: 'automated' },
    { id: 'paypal', label: 'PayPal', kind: 'automated' }
  ]);
  assert.ok(!JSON.stringify(r.json).includes('secret'), 'no secrets');
});

test('checkout methods: settings.checkout picks, orders and renames; the admin switches Store sales on', async () => {
  const s = await H.admin('PATCH', '/settings', { body: { checkout: { providers: ['paypal', 'cryptomus', 'stripe'], labels: { paypal: 'PayPal or card' } }, store: { salesEnabled: true } } });
  assert.equal(s.status, 200);
  assert.equal(s.json.settings.store.salesEnabled, true);
  const r = await methods();
  assert.deepEqual(r.json.providers.map((p) => [p.id, p.label]), [['paypal', 'PayPal or card'], ['stripe', 'Stripe (cards)']], 'cryptomus is listed but not enabled');
  assert.deepEqual(r.json.store, { salesEnabled: true });
  const st = await H.admin('GET', '/store/status');
  assert.equal(st.json.salesEnabled, true, 'the admin Store status shows the switch');

  assert.deepEqual((await H.admin('PATCH', '/settings', { body: { checkout: { providers: [] } } })).status, 200);
  assert.deepEqual((await methods()).json.providers, [], 'an empty list offers none');

  const bad = await H.admin('PATCH', '/settings', { body: { checkout: { providers: ['Stripe!'], labels: { paypal: '' } }, store: { salesEnabled: 'yes' } } });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ['checkout.labels', 'checkout.providers', 'store.salesEnabled']);

  await H.admin('PATCH', '/settings', { body: { checkout: { providers: null, labels: {} }, store: { salesEnabled: false } } });
  const back = await methods();
  assert.deepEqual(back.json.providers.map((p) => p.id), ['stripe', 'paypal']);
  assert.equal(back.json.store.salesEnabled, false);
});
