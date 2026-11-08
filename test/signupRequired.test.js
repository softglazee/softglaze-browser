'use strict';
// 1.0.23: every tenant workspace confirms its email with our licensing server ("Confirm your email"),
// with the lead details (phone, use case, company). Covers the pure rules (src/main/signupConfirm.js,
// signupLead.js and the renderer's signupLead.mjs) and the real functions from ipcHandlers.js through the
// licence harness with a fake server: server truth, the upgrade path, the already-verified path, the
// offline grace, a paid licence never locked out, a non-owner member, and base builds unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { generateKeyPairSync, sign } = require('node:crypto');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.SG_TENANT_ID = 'tenant_test';
process.env.SG_API_BASE_URL = 'http://127.0.0.1:9';
process.env.SG_TENANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const { buildMain } = require('./helpers/licenseHarness');
const { machineHash } = require('../src/main/licenseClient');
const signupConfirm = require('../src/main/signupConfirm');
const signupLead = require('../src/main/signupLead');
const serverLead = require('../licensing-server/src/account/lead');

const ROOT = path.join(__dirname, '..');
const DAY = 86400000;
const plain = (v) => JSON.parse(JSON.stringify(v));
const b64url = (b) => Buffer.from(b).toString('base64url');
const httpError = (status, code) => Object.assign(new Error(code), { status, code });
const offlineError = () => Object.assign(new Error('getaddrinfo ENOTFOUND api.softglaze.com'), { code: 'ENOTFOUND', network: true });
const renderer = (f) => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', f)).href);
const locale = (lang, ns) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`), 'utf8'));

function lease(over = {}) {
  const payload = { v: 1, tenant: 'tenant_test', sub: 'inst_1', tier: 'pro', plan: 'pro', type: 'paid', mid: machineHash(), iat: Math.floor(Date.now() / 1000), exp: Math.floor((Date.now() + 7 * DAY) / 1000), nonce: 'n', ...over };
  const p = b64url(JSON.stringify(payload));
  return `${p}.${b64url(sign(null, Buffer.from(p), privateKey))}`;
}
const paidLeaseSetting = () => `sealed:${JSON.stringify({ token: lease(), currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), tier: 'pro', type: 'paid', fetchedAt: Date.now() })}`;
const signupRecord = (rec) => `sealed:${JSON.stringify({ v: 1, installKey: 'inst_1', ...rec })}`;
const readRecord = (m) => JSON.parse(String(m.settings.get('signupConfirm')).replace(/^sealed:/, ''));

const OWNER = { id: 1, name: 'Ada Owner', email: 'ada@old.example', role: 'OWNER', status: 'active', createdAt: new Date() };
const ADMIN = { id: 2, name: 'Ben Admin', email: 'ben@example.com', role: 'ADMIN', status: 'active', parentMemberId: 1, createdAt: new Date() };
const ACCOUNT = { firstName: 'Ada', lastName: 'Owner', email: 'ada@old.example', phone: '+31 6 12345678', verified: true };
function tenantMain(opts = {}) {
  return buildMain({ tenant: true, members: [{ ...OWNER }, { ...ADMIN }], activeMemberId: 1, ...opts, settings: { account: { ...ACCOUNT }, ...(opts.settings || {}) } });
}
const statusApi = (verified, extra = {}) => ({ accountStatus: async () => ({ verified, ...(verified ? { email: 'ada@example.com' } : {}) }), ...extra });

// ---- the rules (pure) ------------------------------------------------------------------------------

test('decide: the server answer is the truth, and only this install\'s record stands in for it offline', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  const yes = signupConfirm.decide({ server: { verified: true }, cache: null, installKey: 'i1', nowMs: now });
  assert.deepEqual([yes.state, yes.required, yes.offline], ['verified', false, false]);
  assert.deepEqual(yes.cache, { v: 1, installKey: 'i1', verified: true, checkedAt: '2026-11-20T10:00:00.000Z', firstDeferredAt: null });
  // The server says no: required, even with an old "verified" record (a deleted or reset customer).
  const no = signupConfirm.decide({ server: { verified: false }, cache: yes.cache, installKey: 'i1', nowMs: now });
  assert.deepEqual([no.state, no.required], ['needed', true]);
  // Offline: this install's verified record counts, another install's does not.
  assert.equal(signupConfirm.decide({ server: null, cache: yes.cache, installKey: 'i1', nowMs: now }).state, 'verified');
  assert.equal(signupConfirm.decide({ server: null, cache: yes.cache, installKey: 'i2', nowMs: now }).state, 'deferred');
  assert.equal(signupConfirm.decide({ server: null, cache: { verified: true }, installKey: 'i1', nowMs: now }).state, 'deferred', 'a record without an install is ignored');
});

test('decide: offline lets them in for at most the 7-day licence offline window, then it is required', () => {
  const t0 = Date.parse('2026-11-20T10:00:00Z');
  assert.equal(signupConfirm.OFFLINE_DAYS, 7);
  const first = signupConfirm.decide({ server: null, cache: null, installKey: 'i1', nowMs: t0 });
  assert.deepEqual([first.state, first.required, first.offline], ['deferred', false, true]);
  assert.equal(first.deferredUntil, '2026-11-27T10:00:00.000Z');
  assert.equal(first.cache.firstDeferredAt, '2026-11-20T10:00:00.000Z', 'the window starts the first time it could not ask');
  const day6 = signupConfirm.decide({ server: null, cache: first.cache, installKey: 'i1', nowMs: t0 + 6 * DAY });
  assert.equal(day6.state, 'deferred');
  assert.equal(day6.cache.firstDeferredAt, first.cache.firstDeferredAt, 'never restarted by asking again');
  const day8 = signupConfirm.decide({ server: null, cache: day6.cache, installKey: 'i1', nowMs: t0 + 8 * DAY });
  assert.deepEqual([day8.state, day8.required], ['overdue', true]);
  // A "no" from the server keeps the anchor, so a later outage does not reopen the window.
  const no = signupConfirm.decide({ server: { verified: false }, cache: day6.cache, installKey: 'i1', nowMs: t0 + 6 * DAY });
  assert.equal(no.cache.firstDeferredAt, first.cache.firstDeferredAt);
  assert.equal(signupConfirm.decide({ server: null, cache: no.cache, installKey: 'i1', nowMs: t0 + 9 * DAY }).state, 'overdue');
});

test('decide: a paid licence is never locked out because our server cannot be reached', () => {
  const t0 = Date.parse('2026-11-20T10:00:00Z');
  const old = { v: 1, installKey: 'i1', verified: false, firstDeferredAt: new Date(t0 - 60 * DAY).toISOString() };
  const d = signupConfirm.decide({ server: null, cache: old, installKey: 'i1', paid: true, nowMs: t0 });
  assert.deepEqual([d.state, d.required, d.deferredUntil], ['deferred', false, null]);
  // ...but when the server answers, a paid customer confirms too.
  assert.equal(signupConfirm.decide({ server: { verified: false }, cache: old, installKey: 'i1', paid: true, nowMs: t0 }).required, true);
});

test('deferAfterFailure: "Continue for now" inside the window or with a paid licence only', () => {
  const t0 = Date.parse('2026-11-20T10:00:00Z');
  assert.equal(signupConfirm.deferAfterFailure({ cache: null, installKey: 'i1', nowMs: t0 }).allowed, true);
  const late = { v: 1, installKey: 'i1', verified: false, firstDeferredAt: new Date(t0 - 8 * DAY).toISOString() };
  assert.equal(signupConfirm.deferAfterFailure({ cache: late, installKey: 'i1', nowMs: t0 }).allowed, false);
  assert.equal(signupConfirm.deferAfterFailure({ cache: late, installKey: 'i1', paid: true, nowMs: t0 }).allowed, true);
  for (const code of ['CONFIRM_OFFLINE', 'SERVER_UNAVAILABLE', 'SIGNUP_FAILED']) assert.equal(signupConfirm.isOurSide({ code }), true, code);
  for (const code of ['SIGNUP_BAD_CODE', 'SIGNUP_DISPOSABLE_EMAIL', 'RATE_LIMITED']) assert.equal(signupConfirm.isOurSide({ code }), false, code);
});

// ---- lead fields -----------------------------------------------------------------------------------

test('lead fields: use case required (with text for "other"), phone optional with + and the country code', async () => {
  const n = (input) => signupLead.normalizeLead(input);
  assert.equal(n({}).error, 'SIGNUP_USE_CASE');
  assert.equal(n({ useCase: 'gambling' }).error, 'SIGNUP_USE_CASE');
  assert.equal(n({ useCase: 'other', useCaseOther: '   ' }).error, 'SIGNUP_USE_CASE_OTHER');
  assert.equal(n({ useCase: 'agency', phone: '0300 1234567' }).error, 'SIGNUP_INVALID_PHONE', 'no country code');
  assert.equal(n({ useCase: 'agency', phone: '+1 23' }).error, 'SIGNUP_INVALID_PHONE', 'too short');
  assert.equal(n({ useCase: 'agency', phone: '+1234567890123456' }).error, 'SIGNUP_INVALID_PHONE', 'more than 15 digits');
  assert.deepEqual(n({ useCase: ' Agency ', phone: ' 0092 300 1234567 ', company: '  Acme  Ltd ', useCaseOther: 'dropped' }).lead,
    { phone: '+92 300 1234567', useCase: 'agency', useCaseOther: null, company: 'Acme Ltd' });
  assert.deepEqual(n({ useCase: 'other', useCaseOther: ' Price\nchecks ' }).lead, { phone: null, useCase: 'other', useCaseOther: 'Price checks', company: null });
  assert.deepEqual(signupLead.normalizeLead({}, { requireUseCase: false }).lead, { phone: null, useCase: null, useCaseOther: null, company: null });

  const r = await renderer('signupLead.mjs');
  assert.equal(r.leadError({ useCase: '' }), 'SIGNUP_USE_CASE');
  assert.equal(r.leadError({ useCase: 'other', useCaseOther: '' }), 'SIGNUP_USE_CASE_OTHER');
  assert.equal(r.leadError({ useCase: 'agency', phone: '12345' }), 'SIGNUP_INVALID_PHONE');
  assert.equal(r.leadError({ useCase: 'agency', phone: '+44 (20) 7946-0958' }), null);
  assert.equal(r.leadError({ useCase: 'web_research' }), null, 'phone and company are optional');
  for (const ph of ['', '+92 300 1234567', '0044 20 7946 0958', '03001234567', '+1 2', 'abc']) {
    assert.equal(r.phoneError(ph), signupLead.normalizePhone(ph).error || null, `renderer and main agree on "${ph}"`);
  }
  assert.deepEqual(r.leadPayload({ phone: ' +1 202 555 0143 ', useCase: 'agency', useCaseOther: 'x', company: ' ' }), { phone: '+1 202 555 0143', useCase: 'agency' });
  assert.deepEqual(r.leadPayload({ useCase: 'other', useCaseOther: ' QA ' }), { useCase: 'other', useCaseOther: 'QA' });
});

test('the use cases match in main, the renderer and the server, and every one has a label in en and es', async () => {
  const r = await renderer('signupLead.mjs');
  assert.deepEqual([...r.USE_CASES], [...signupLead.USE_CASES]);
  assert.deepEqual([...serverLead.USE_CASES], [...signupLead.USE_CASES]);
  assert.deepEqual([...signupLead.USE_CASES], ['ecommerce', 'social_media', 'affiliate_marketing', 'agency', 'web_research', 'other'], 'the website home page use cases plus other');
  for (const lang of ['en', 'es']) {
    const g = locale(lang, 'gate');
    for (const k of signupLead.USE_CASES) assert.ok(g.lead.useCases[k], `${lang}: lead.useCases.${k}`);
  }
});

// ---- server truth, upgrade and already-verified paths ------------------------------------------------

test('upgrade path: a workspace with only a local account must confirm before the app can be used', async () => {
  const m = tenantMain({ api: statusApi(false) });
  const st = plain(await m.fns.accountSignupStatus());
  assert.equal(st.enabled, true);
  assert.equal(st.state, 'needed');
  assert.equal(st.required, true);
  assert.equal(st.canConfirm, true);
  assert.equal(st.canDefer, false, 'the server answered, so there is nothing to put off');
  assert.deepEqual(st.prefill, { firstName: 'Ada', lastName: 'Owner', email: 'ada@old.example', phone: '+31 6 12345678' }, "the Owner's details, editable");
  assert.deepEqual(plain(m.calls.find((c) => c.method === 'accountStatus').args[0]), { installId: 'inst_1', installSecret: 'secret_1' });
  // Main refuses profile launches too: the renderer gate alone is not trusted.
  await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'SIGNUP_REQUIRED');
});

test('already verified (signed up through the 1.0.22 server flow): never asked again', async () => {
  const m = tenantMain({ api: statusApi(true) });
  const st = await m.fns.accountSignupStatus();
  assert.equal(st.required, false);
  assert.equal(st.state, 'verified');
  // The licence check that follows is the usual one (no plan yet here), not the email.
  await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'LICENSE_BANNED');
  // The answer holds for the whole run without asking again.
  await m.fns.accountSignupStatus();
  assert.equal(m.calls.filter((c) => c.method === 'accountStatus').length, 1);
});

test('deleting the local record never skips the step: the next start asks the server again', async () => {
  const first = tenantMain({ api: statusApi(false) });
  assert.equal((await first.fns.accountSignupStatus()).required, true);
  assert.ok(first.settings.has('signupConfirm'));
  // A "verified" record forged for this install is not enough while the server answers.
  const forged = tenantMain({ api: statusApi(false), settings: { signupConfirm: signupRecord({ verified: true }) } });
  assert.equal((await forged.fns.accountSignupStatus()).required, true);
  // No record at all (deleted): same answer.
  const wiped = tenantMain({ api: statusApi(false) });
  assert.equal(wiped.settings.has('signupConfirm'), false);
  assert.equal((await wiped.fns.accountSignupStatus()).required, true);
});

test('offline: let in and asked again at the next start, until the 7-day window ends', async () => {
  const down = { accountStatus: async () => { throw offlineError(); } };
  const m = tenantMain({ api: down });
  const st = plain(await m.fns.accountSignupStatus());
  assert.deepEqual([st.state, st.required, st.offline], ['deferred', false, true]);
  assert.ok(Math.abs(Date.parse(st.deferredUntil) - (Date.now() + 7 * DAY)) < 60000);
  const rec = readRecord(m);
  assert.equal(rec.installKey, 'inst_1');
  assert.equal(rec.verified, false);
  // The next start, still offline, 8 days after the first: now it is required.
  const later = tenantMain({ api: down, settings: { signupConfirm: signupRecord({ verified: false, firstDeferredAt: new Date(Date.now() - 8 * DAY).toISOString() }) } });
  const st2 = await later.fns.accountSignupStatus();
  assert.deepEqual([st2.state, st2.required], ['overdue', true]);
  await assert.rejects(later.fns.assertNotBanned(), (e) => e.code === 'SIGNUP_REQUIRED');
  // A server error (5xx) or an older server without the endpoint counts as "could not ask" too.
  for (const err of [httpError(503, null), httpError(404, null)]) {
    const s = tenantMain({ api: { accountStatus: async () => { throw err; } } });
    assert.equal((await s.fns.accountSignupStatus()).state, 'deferred');
  }
  // Offline with a confirmed record for this install: nothing to ask.
  const ok = tenantMain({ api: down, settings: { signupConfirm: signupRecord({ verified: true }) } });
  assert.equal((await ok.fns.accountSignupStatus()).state, 'verified');
});

test('a paid customer is never locked out because our server is down', async () => {
  const down = { accountStatus: async () => { throw offlineError(); }, license: async () => { throw offlineError(); } };
  const m = tenantMain({
    api: down,
    settings: { backendLease: paidLeaseSetting(), signupConfirm: signupRecord({ verified: false, firstDeferredAt: new Date(Date.now() - 40 * DAY).toISOString() }) }
  });
  const st = await m.fns.accountSignupStatus();
  assert.deepEqual([st.state, st.required], ['deferred', false]);
  await m.fns.assertNotBanned(); // the paid lease launches
});

test('a team member who may not purchase sees the plain message, and cannot confirm or put it off', async () => {
  const m = tenantMain({ api: statusApi(false), activeMemberId: 2 });
  const st = plain(await m.fns.accountSignupStatus());
  assert.equal(st.required, true);
  assert.equal(st.canConfirm, false);
  assert.equal(st.prefill, null, "the Owner's details are not shown to others");
  await assert.rejects(m.fns.accountConfirmStart({ email: 'ben@example.com', firstName: 'Ben', lastName: 'A', useCase: 'agency' }), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(m.fns.accountConfirmCheck({ email: 'ben@example.com', code: '123456' }), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(m.fns.accountConfirmLater(), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'SIGNUP_REQUIRED');
});

// ---- the confirm step --------------------------------------------------------------------------------

const CONFIRM = { email: ' Ada@Example.com ', firstName: 'Ada', lastName: 'Lovelace', phone: '+44 20 7946 0958', useCase: 'other', useCaseOther: 'Price checks', company: 'ada.example', consentMarketing: false, lang: 'es' };

test('confirm start: checks the details, then asks our server for the code with the lead fields', async () => {
  const m = tenantMain({ api: statusApi(false, { verifyStart: async () => ({ ok: true, sent: true }) }) });
  await assert.rejects(m.fns.accountConfirmStart({ ...CONFIRM, useCase: '' }), (e) => e.code === 'SIGNUP_USE_CASE');
  await assert.rejects(m.fns.accountConfirmStart({ ...CONFIRM, useCaseOther: '' }), (e) => e.code === 'SIGNUP_USE_CASE_OTHER');
  await assert.rejects(m.fns.accountConfirmStart({ ...CONFIRM, phone: '7946 0958' }), (e) => e.code === 'SIGNUP_INVALID_PHONE');
  await assert.rejects(m.fns.accountConfirmStart({ ...CONFIRM, email: 'not-an-email' }), (e) => e.code === 'SIGNUP_INVALID_EMAIL');
  assert.equal(m.calls.filter((c) => c.method === 'verifyStart').length, 0, 'nothing sent for bad details');
  const r = await m.fns.accountConfirmStart(CONFIRM);
  assert.deepEqual(plain(r), { sent: true, devMode: false, via: 'server' });
  assert.deepEqual(plain(m.calls.find((c) => c.method === 'verifyStart').args[0]), {
    installId: 'inst_1', installSecret: 'secret_1', email: 'ada@example.com', name: 'Ada Lovelace', consentMarketing: false, lang: 'es',
    phone: '+44 20 7946 0958', useCase: 'other', useCaseOther: 'Price checks', company: 'ada.example'
  });
  // Optional fields left empty are not sent at all.
  await m.fns.accountConfirmStart({ email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', useCase: 'agency' });
  const last = plain(m.calls.filter((c) => c.method === 'verifyStart').at(-1).args[0]);
  assert.deepEqual(Object.keys(last).filter((k) => ['phone', 'useCase', 'useCaseOther', 'company'].includes(k)), ['useCase']);
});

test('confirm check: the server verifies, the step is done for this run and the Owner account follows', async () => {
  const m = tenantMain({
    api: statusApi(false, { verifyCheck: async ({ code }) => (code === '654321' ? { verified: true, customerId: 'cus_7' } : Promise.reject(httpError(400, 'invalid_code'))) })
  });
  assert.equal((await m.fns.accountSignupStatus()).required, true);
  await assert.rejects(m.fns.accountConfirmCheck({ email: 'ada@example.com', code: '111111' }), (e) => e.code === 'SIGNUP_BAD_CODE');
  assert.equal((await m.fns.accountSignupStatus()).required, true, 'a wrong code changes nothing');
  const r = await m.fns.accountConfirmCheck({ ...CONFIRM, code: '654321' });
  assert.deepEqual(plain(r), { verified: true });
  assert.deepEqual(plain(m.calls.find((c) => c.method === 'verifyCheck' && c.args[0].code === '654321').args[0]), { installId: 'inst_1', installSecret: 'secret_1', email: 'ada@example.com', code: '654321' });
  const st = await m.fns.accountSignupStatus();
  assert.deepEqual([st.state, st.required], ['verified', false]);
  assert.equal(readRecord(m).verified, true);
  assert.equal(m.settings.get('tenantCustomer').customerId, 'cus_7');
  // The workspace account now carries the confirmed email, so the trial and licences use it.
  const acct = m.settings.get('account');
  assert.equal(acct.email, 'ada@example.com');
  assert.equal(acct.lastName, 'Lovelace');
  assert.equal(acct.phone, '+44 20 7946 0958');
  assert.equal(m.db.members[0].email, 'ada@example.com');
  assert.equal(m.db.members[0].name, 'Ada Lovelace');
  await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'LICENSE_BANNED', 'only the usual licence check is left');
});

test('confirm check: the Owner email is not taken over when another member already uses it', async () => {
  const m = tenantMain({ api: statusApi(false, { verifyCheck: async () => ({ verified: true, customerId: 'cus_8' }) }) });
  await m.fns.accountConfirmCheck({ email: 'ben@example.com', code: '123456', firstName: 'Ada', lastName: 'Owner' });
  assert.equal(m.db.members[0].email, 'ada@old.example', 'Ben keeps his email; the Owner row is left as it was');
  assert.equal(m.settings.get('account').email, 'ben@example.com');
});

test('"Continue for now": only after our side failed, inside the window or with a paid licence', async () => {
  const flaky = { verifyStart: async () => { throw offlineError(); } };
  const m = tenantMain({ api: statusApi(false, flaky) });
  await assert.rejects(m.fns.accountConfirmLater(), (e) => e.code === 'SIGNUP_REQUIRED', 'nothing failed yet');
  await assert.rejects(m.fns.accountConfirmStart(CONFIRM), (e) => e.code === 'CONFIRM_OFFLINE');
  const st = await m.fns.accountSignupStatus();
  assert.equal(st.required, true);
  assert.equal(st.canDefer, true);
  const later = await m.fns.accountConfirmLater();
  assert.equal(later.deferred, true);
  assert.equal((await m.fns.accountSignupStatus()).required, false, 'in for this run; asked again at the next start');
  assert.ok(m.audits.some((a) => a.action === 'account.confirm-later'));

  // A person's own mistake (a disposable address) is not "our side".
  const own = tenantMain({ api: statusApi(false, { verifyStart: async () => { throw httpError(400, 'disposable_email'); } }) });
  await assert.rejects(own.fns.accountConfirmStart(CONFIRM), (e) => e.code === 'SIGNUP_DISPOSABLE_EMAIL');
  assert.equal((await own.fns.accountSignupStatus()).canDefer, false);

  // Past the window: required, unless this computer has a paid licence.
  const old = signupRecord({ verified: false, firstDeferredAt: new Date(Date.now() - 9 * DAY).toISOString() });
  const late = tenantMain({ api: statusApi(false, flaky), settings: { signupConfirm: old } });
  await assert.rejects(late.fns.accountConfirmStart(CONFIRM), (e) => e.code === 'CONFIRM_OFFLINE');
  assert.equal((await late.fns.accountSignupStatus()).canDefer, false);
  await assert.rejects(late.fns.accountConfirmLater(), (e) => e.code === 'SIGNUP_REQUIRED');
  const paid = tenantMain({ api: { ...statusApi(false, flaky), license: async () => { throw offlineError(); } }, settings: { signupConfirm: old, backendLease: paidLeaseSetting() } });
  await assert.rejects(paid.fns.accountConfirmStart(CONFIRM), (e) => e.code === 'CONFIRM_OFFLINE');
  assert.equal((await paid.fns.accountSignupStatus()).canDefer, true);
  assert.equal((await paid.fns.accountConfirmLater()).deferred, true);
});

test('first sign-up (1.0.23): the lead fields go with the code, and the confirm step never follows', async () => {
  const m = buildMain({ tenant: true, api: { verifyStart: async () => ({ sent: true }), verifyCheck: async () => ({ verified: true, customerId: 'cus_1' }) } });
  await assert.rejects(m.fns.accountSendOtp({ email: 'new@example.com', firstName: 'N', lastName: 'P' }), (e) => e.code === 'SIGNUP_USE_CASE');
  await m.fns.accountSendOtp({ email: 'new@example.com', firstName: 'N', lastName: 'P', useCase: 'ecommerce', phone: '+92 300 1234567', company: 'Shop' });
  const sent = plain(m.calls.find((c) => c.method === 'verifyStart').args[0]);
  assert.deepEqual([sent.useCase, sent.phone, sent.company], ['ecommerce', '+92 300 1234567', 'Shop']);
  await m.fns.accountRegister({ firstName: 'N', lastName: 'P', email: 'new@example.com', password: 'longpassword', code: '123456' });
  const st = await m.fns.accountSignupStatus();
  assert.deepEqual([st.state, st.required], ['verified', false]);
  assert.equal(m.calls.filter((c) => c.method === 'accountStatus').length, 0, 'no need to ask the server in this run');
  assert.equal(readRecord(m).verified, true);
});

test('base builds: no confirm step, no server call, launches unchanged', async () => {
  const m = buildMain({ tenant: false, members: [{ ...OWNER }], activeMemberId: 1, settings: { account: { ...ACCOUNT } } });
  assert.deepEqual(plain(await m.fns.accountSignupStatus()), { enabled: false, state: 'off', required: false });
  await m.fns.assertNotBanned(); // the local 7-day trial
  assert.equal(m.calls.length, 0);
  await assert.rejects(m.fns.accountConfirmStart(CONFIRM), /only used in builds with a licensing server/);
  // The base sign-up keeps sending only the email (no lead fields, no use case needed).
  const b = buildMain({ tenant: false });
  const r = await b.fns.accountSendOtp({ email: 'x@example.com' });
  assert.equal(r.sent, true);
});
