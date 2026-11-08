'use strict';
// Section B of the customers/trials spec (08-CUSTOMERS-TRIALS-ADMIN-SPEC.md), run against the real
// functions from ipcHandlers.js with a fake licensing server:
//   - tenant builds start the free trial on the server's ledger and store its signed lease;
//   - trial_used and offline give plain messages; a local trialEndsAt alone grants nothing;
//   - trials that were running before this version keep going until they end;
//   - accountRegister refuses a second sign-up and checks the code with the server;
//   - plans and prices come from the server (cached, built-in fallback);
//   - base builds behave exactly as before.

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.SG_TENANT_ID = 'tenant_test';
process.env.SG_API_BASE_URL = 'http://127.0.0.1:9';
process.env.SG_TENANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const { buildMain } = require('./helpers/licenseHarness');
const { machineHash } = require('../src/main/licenseClient');

const DAY = 86400000;
const b64url = (b) => Buffer.from(b).toString('base64url');
function lease(over = {}) {
  const payload = { v: 1, tenant: 'tenant_test', sub: 'inst_1', tier: 'enterprise', plan: 'trial', type: 'trial', mid: machineHash(), iat: Math.floor(Date.now() / 1000), exp: Math.floor((Date.now() + 7 * DAY) / 1000), nonce: 'n', ...over };
  const p = b64url(JSON.stringify(payload));
  return `${p}.${b64url(sign(null, Buffer.from(p), privateKey))}`;
}
// Objects made inside the vm have that realm's prototypes; compare their plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));
const httpError = (status, code, extra = {}) => Object.assign(new Error(code), { status, code, ...extra });
const offlineError = () => Object.assign(new Error('getaddrinfo ENOTFOUND api.softglaze.com'), { code: 'ENOTFOUND', network: true });

const OWNER = { id: 1, name: 'Ada Owner', email: 'ada@example.com', role: 'OWNER', status: 'active', createdAt: new Date() };
const owner = () => ({ ...OWNER });

function trialServer(over = {}) {
  const ends = new Date(Date.now() + 7 * DAY).toISOString();
  return {
    trialStart: async () => ({ lease: lease(), exp: Math.floor(Date.parse(ends) / 1000), tier: 'enterprise', currentPeriodEnd: ends, trialEndsAt: ends }),
    ...over
  };
}

// ---- trial start ----------------------------------------------------------------------------------

test('tenant: a fresh workspace has no plan until the trial starts; the local row grants nothing', async () => {
  const m = buildMain({ tenant: true, members: [owner()], activeMemberId: 1 });
  const lic = await m.fns.getLicense();
  assert.equal(lic.needsPlan, true);
  assert.equal(lic.isTrial, false);
  assert.equal(lic.isBanned, true, 'profile launches stay refused');
  assert.equal(lic.trialUsed, false);
  assert.equal(m.db.licenses.length, 1);
  assert.equal(m.db.licenses[0].trialEndsAt, null, 'no local trial is created in tenant builds');
  assert.deepEqual(plain(m.settings.get('tenantTrialCutover').legacy), {});
  await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'LICENSE_BANNED' && /Start the free trial or choose a plan/.test(e.message));
});

test('tenant: Start trial calls the server ledger and the signed lease drives the plan', async () => {
  const m = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: trialServer() });
  const view = await m.fns.startTrial();
  const call = m.calls.find((c) => c.method === 'trialStart');
  assert.deepEqual(plain(call.args[0]), { installId: 'inst_1', installSecret: 'secret_1', email: 'ada@example.com' });
  assert.equal(view.type, 'trial');
  assert.equal(view.isTrial, true);
  assert.equal(view.tier, 'enterprise');
  assert.equal(view.daysLeftTrial, 7);
  assert.deepEqual(plain(view.limits), { tier: 'enterprise', seats: 3, maxParallel: 10, auditExport: true }, 'Enterprise limits, 3 seats');
  assert.ok(Math.abs(Date.parse(view.endsAt) - (Date.now() + 7 * DAY)) < 60000, 'ends on the server end date');
  // Stored and verified the way refreshBackendLease does it.
  const cached = JSON.parse(m.settings.get('backendLease').replace(/^sealed:/, ''));
  assert.equal(cached.type, 'trial');
  assert.equal(cached.tier, 'enterprise');
  assert.equal(m.db.licenses[0].trialEndsAt.toISOString(), view.endsAt, 'the local row records the trial end');
  assert.ok(m.audits.some((a) => a.action === 'license.trial-start' && a.detail.detail.server === true));
  // Later reads keep showing the trial; launches are allowed.
  const again = await m.fns.getLicense();
  assert.equal(again.isTrial, true);
  await m.fns.assertNotBanned();
  // A second click never extends it or calls the server again.
  const before = m.calls.length;
  assert.equal((await m.fns.startTrial()).isTrial, true);
  assert.equal(m.calls.filter((c) => c.method === 'trialStart').length, 1);
  assert.ok(m.calls.length >= before);
});

test('tenant: 409 trial_used shows the plain message and stores nothing', async () => {
  const m = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: { trialStart: async () => { throw httpError(409, 'trial_used', { reason: 'machine' }); } } });
  await assert.rejects(m.fns.startTrial(), (e) => {
    assert.equal(e.code, 'TRIAL_USED');
    assert.equal(e.message, 'A free trial has already been used on this computer or email. Choose a plan or enter a purchase code.');
    assert.equal(e.reason, 'machine');
    return true;
  });
  assert.equal(m.settings.has('backendLease'), false);
  assert.equal((await m.fns.getLicense()).needsPlan, true);
});

test('tenant: offline says to connect, whether registering the install or starting the trial', async () => {
  const a = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: { trialStart: async () => { throw offlineError(); } } });
  await assert.rejects(a.fns.startTrial(), (e) => e.code === 'TRIAL_OFFLINE' && e.message === 'Connect to the internet to start the free trial.');
  const b = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, ensureBackendInstall: async () => { throw offlineError(); } });
  await assert.rejects(b.fns.startTrial(), (e) => e.code === 'TRIAL_OFFLINE');
  const c = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: { trialStart: async () => { throw httpError(502, null); } } });
  await assert.rejects(c.fns.startTrial(), (e) => e.code === 'SERVER_UNAVAILABLE');
});

test('tenant: a lease that does not verify is refused, never trusted', async () => {
  const m = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: trialServer({ trialStart: async () => ({ lease: 'forged.token' }) }) });
  await assert.rejects(m.fns.startTrial(), (e) => e.code === 'TRIAL_FAILED');
  assert.equal(m.settings.has('backendLease'), false);
});

test('tenant: an account made before server sign-up confirms its email with a code, then starts', async () => {
  let verified = false;
  const api = {
    trialStart: async (args) => {
      if (!verified) throw httpError(403, 'email_not_verified');
      return trialServer().trialStart(args);
    },
    verifyStart: async () => ({ sent: true }),
    verifyCheck: async ({ code }) => { if (code !== '123456') throw httpError(400, 'invalid_code'); verified = true; return { verified: true, customerId: 'cus_1' }; }
  };
  const m = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api });
  await assert.rejects(m.fns.startTrial(), (e) => e.code === 'TRIAL_VERIFY_EMAIL');
  const sent = m.calls.find((c) => c.method === 'verifyStart').args[0];
  assert.equal(sent.email, 'ada@example.com');
  assert.equal(sent.consentMarketing, false, 'no marketing consent is implied');
  await assert.rejects(m.fns.startTrial({ code: '000000' }), (e) => e.code === 'SIGNUP_BAD_CODE');
  const view = await m.fns.startTrial({ code: '123456' });
  assert.equal(view.isTrial, true);
});

// ---- local trials ---------------------------------------------------------------------------------

test('tenant: a local trialEndsAt alone no longer grants a trial', async () => {
  // The cutover was recorded before this row existed, so the row is not a legacy trial.
  const m = buildMain({
    tenant: true, members: [owner()], activeMemberId: 1,
    settings: { tenantTrialCutover: { v: 1, at: new Date(Date.now() - DAY).toISOString(), legacy: {} } },
    licenses: [{ id: 5, ownerMemberId: 1, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: new Date(Date.now() + 30 * DAY), createdAt: new Date() }]
  });
  const lic = await m.fns.getLicense();
  assert.equal(lic.isTrial, false);
  assert.equal(lic.needsPlan, true);
  await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'LICENSE_BANNED');
});

test('tenant: a trial already running before this update keeps going until it ends, never longer', async () => {
  const ends = new Date(Date.now() + 3 * DAY);
  const m = buildMain({
    tenant: true, members: [owner()], activeMemberId: 1,
    licenses: [{ id: 1, ownerMemberId: 1, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: ends, createdAt: new Date(Date.now() - 4 * DAY) }]
  });
  const lic = await m.fns.getLicense();
  assert.equal(lic.isTrial, true);
  assert.equal(lic.daysLeftTrial, 3);
  assert.deepEqual(plain(m.settings.get('tenantTrialCutover').legacy), { 1: ends.toISOString() });
  await m.fns.assertNotBanned();
  // It counts as this computer's trial: no second one from the server.
  assert.equal((await m.fns.startTrial()).isTrial, true, 'a running trial is returned as is');
  // Pushing the row's date later does not extend it.
  m.db.licenses[0].trialEndsAt = new Date(Date.now() + 60 * DAY);
  assert.equal((await m.fns.getLicense()).daysLeftTrial, 3);
  assert.equal(m.calls.length, 0, 'the server was never asked');
});

test('tenant: a legacy trial that ended goes through grace, and the server is not asked for another', async () => {
  const m = buildMain({
    tenant: true, members: [owner()], activeMemberId: 1,
    licenses: [{ id: 1, ownerMemberId: 1, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: new Date(Date.now() - DAY), createdAt: new Date(Date.now() - 8 * DAY) }]
  });
  const lic = await m.fns.getLicense();
  assert.equal(lic.isGrace, true);
  assert.equal(lic.trialUsed, true);
  await assert.rejects(m.fns.startTrial(), (e) => e.code === 'TRIAL_USED');
  assert.equal(m.calls.length, 0);
});

test('tenant: after the server trial ends, grace and lock follow the recorded end date', async () => {
  const m = buildMain({
    tenant: true, members: [owner()], activeMemberId: 1,
    settings: { tenantTrialCutover: { v: 1, at: new Date(Date.now() - 9 * DAY).toISOString(), legacy: {} } },
    licenses: [{ id: 2, ownerMemberId: 1, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: new Date(Date.now() - DAY), createdAt: new Date(Date.now() - 8 * DAY) }]
  });
  const grace = await m.fns.getLicense();
  assert.equal(grace.isGrace, true);
  assert.equal(grace.trialUsed, true);
  m.db.licenses[0].trialEndsAt = new Date(Date.now() - 5 * DAY);
  const ended = await m.fns.getLicense();
  assert.equal(ended.isBanned, true);
  assert.notEqual(ended.needsPlan, true, 'ended, not "no plan yet"');
});

test('tenant: lease refresh keeps a valid trial lease when the server lists no licence, and clears a paid one', async () => {
  const trialLease = lease();
  const m = buildMain({
    tenant: true, members: [owner()], activeMemberId: 1,
    settings: { backendLease: `sealed:${JSON.stringify({ token: trialLease, currentPeriodEnd: null, tier: 'enterprise', type: 'trial' })}` },
    api: { license: async () => ({ lease: null, status: 'none' }) }
  });
  assert.equal(await m.fns.refreshBackendLease(), null);
  assert.deepEqual(plain(m.calls[0].args[0]), { installId: 'inst_1', installSecret: 'secret_1' });
  assert.ok(m.settings.get('backendLease'), 'trial lease kept');
  assert.equal((await m.fns.getLicense()).isTrial, true);

  const paid = buildMain({
    tenant: true, members: [owner()], activeMemberId: 1,
    settings: { backendLease: `sealed:${JSON.stringify({ token: lease({ type: undefined, plan: 'pro', tier: 'pro' }), tier: 'pro' })}` },
    api: { license: async () => ({ lease: null, status: 'canceled' }) }
  });
  await paid.fns.refreshBackendLease();
  assert.equal(paid.settings.get('backendLease'), null, 'a cancelled paid lease is cleared as before');
});

test('tenant: a paid lease lifts the licence-lapse ban the old local trial left', async () => {
  const banned = { ...owner(), status: 'banned', banReason: 'Trial and grace period ended.' };
  const m = buildMain({
    tenant: true, members: [banned], activeMemberId: 1,
    settings: { backendLease: `sealed:${JSON.stringify({ token: lease({ type: undefined, plan: 'pro', tier: 'pro' }), tier: 'pro' })}` }
  });
  const lic = await m.fns.getLicense();
  assert.equal(lic.isPaid, true);
  assert.equal(m.db.members[0].status, 'active');
  await m.fns.assertNotBanned();
});

// ---- plans ------------------------------------------------------------------------------------------

const SERVER_PLANS = [
  { key: 'pro', name: 'Pro', tier: 'pro', amount: 700, currency: 'USD', interval: 'month', months: 1, highlight: false, features: ['Up to 3 team members'], limits: { seats: 3, maxParallel: 3, auditExport: false } },
  { key: 'enterprise', name: 'Enterprise', tier: 'enterprise', amount: 3500, currency: 'USD', interval: 'month', months: 1, highlight: true, features: ['Up to 25 team members', 'Audit-log export'], limits: { seats: 25, maxParallel: 10, auditExport: true } }
];

test('tenant: plans and prices come from the server, cached, with the built-in list offline', async () => {
  let n = 0;
  const m = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: { plans: async () => { n += 1; return SERVER_PLANS; } } });
  const plans = await m.fns.effectiveBillingPlans();
  assert.deepEqual(plain(plans.map((p) => [p.id, p.kind, p.amount])), [['free-trial', 'trial', '0'], ['pro', 'paid', '7'], ['enterprise', 'paid', '35']]);
  assert.deepEqual(plain(plans[2].features), ['Up to 25 team members', 'Audit-log export']);
  await m.fns.effectiveBillingPlans();
  assert.equal(n, 1, 'cached');
  const info = await m.fns.getBillingPlans();
  assert.deepEqual(plain(info.plans.map((p) => p.amount)), ['0', '7', '35']);
  assert.equal((await m.fns.findTenantPlanOrThrow('')).id, 'pro', 'no plan id = the first paid plan, never the trial');
  assert.equal((await m.fns.findTenantPlanOrThrow('ENTERPRISE')).amount, '35');
  await assert.rejects(m.fns.findTenantPlanOrThrow('gone'), /no longer available/);

  const off = buildMain({ tenant: true, members: [owner()], activeMemberId: 1, api: { plans: async () => { throw offlineError(); } } });
  const fallback = await off.fns.effectiveBillingPlans();
  assert.deepEqual(plain(fallback.map((p) => [p.id, p.amount])), [['free-trial', '0'], ['pro', '5'], ['enterprise', '29']], 'the built-in DEFAULT_BILLING_PLANS');
});

// ---- sign-up ----------------------------------------------------------------------------------------

test('tenant: the sign-up code is requested from the server with the consent box, never shown in-app', async () => {
  const m = buildMain({ tenant: true, api: { verifyStart: async () => ({ sent: true }) } });
  const res = await m.fns.accountSendOtp({ email: ' New@Example.com ', firstName: 'New', lastName: 'Person', lang: 'es', useCase: 'agency' });
  assert.deepEqual(plain(res), { sent: true, devMode: false, via: 'server' });
  assert.equal('devCode' in res, false);
  const sent = m.calls[0].args[0];
  assert.equal(sent.email, 'new@example.com');
  assert.equal(sent.name, 'New Person');
  assert.equal(sent.consentMarketing, false, 'unticked unless the box was ticked');
  assert.equal(sent.lang, 'es');
  await m.fns.accountSendOtp({ email: 'new@example.com', consentMarketing: 'yes', useCase: 'agency' });
  assert.equal(m.calls[1].args[0].consentMarketing, false, 'only a real true counts');
  await m.fns.accountSendOtp({ email: 'new@example.com', consentMarketing: true, useCase: 'agency' });
  assert.equal(m.calls[2].args[0].consentMarketing, true);
  assert.equal(m.settings.has('otp:reg:new@example.com'), false, 'no local code in tenant builds');
});

test('tenant: disposable, no-MX, rate-limited and offline sign-ups get plain errors', async () => {
  const cases = [
    [httpError(400, 'disposable_email'), 'SIGNUP_DISPOSABLE_EMAIL', 'Please use a permanent email address.'],
    [httpError(400, 'no_mx'), 'SIGNUP_NO_MX', "We couldn't find a mail server for that address."],
    [httpError(429, 'rate_limited'), 'RATE_LIMITED', 'Too many attempts, try again in a few minutes.'],
    [offlineError(), 'SIGNUP_OFFLINE', 'Connect to the internet to create your account.']
  ];
  for (const [err, code, message] of cases) {
    const m = buildMain({ tenant: true, api: { verifyStart: async () => { throw err; } } });
    await assert.rejects(m.fns.accountSendOtp({ email: 'x@mailinator.com', useCase: 'ecommerce' }), (e) => e.code === code && e.message === message, code);
  }
});

test('tenant: accountRegister checks the code with the server, then creates the Owner', async () => {
  const m = buildMain({ tenant: true, api: { verifyCheck: async ({ code }) => (code === '654321' ? { verified: true, customerId: 'cus_9' } : Promise.reject(httpError(400, 'invalid_code'))) } });
  const input = { firstName: 'Ada', lastName: 'Owner', email: 'ada@example.com', phone: '+1 555 0100', password: 'longpassword', code: '111111' };
  await assert.rejects(m.fns.accountRegister(input), (e) => e.code === 'SIGNUP_BAD_CODE');
  assert.equal(m.db.members.length, 0, 'nothing created on a wrong code');
  const res = await m.fns.accountRegister({ ...input, code: '654321' });
  assert.equal(res.ok, true);
  assert.equal(m.db.members.length, 1);
  assert.equal(m.db.members[0].role, 'OWNER');
  assert.deepEqual(plain(m.calls.at(-1).args[0]), { installId: 'inst_1', installSecret: 'secret_1', email: 'ada@example.com', code: '654321' });
  assert.equal(m.settings.get('tenantCustomer').customerId, 'cus_9');
  assert.equal(m.settings.get('account').verified, true);
});

test('accountRegister refuses a second sign-up in every build, before any code is checked', async () => {
  for (const tenant of [true, false]) {
    const m = buildMain({ tenant, members: [owner()], api: { verifyCheck: async () => ({ verified: true }) } });
    const input = { firstName: 'Eve', lastName: 'Second', email: 'eve@example.com', password: 'longpassword', code: '123456' };
    await assert.rejects(m.fns.accountRegister(input), (e) => e.code === 'ALREADY_SETUP');
    await assert.rejects(m.fns.accountSendOtp({ email: 'eve@example.com' }), (e) => e.code === 'ALREADY_SETUP');
    assert.equal(m.calls.length, 0, 'the server is never asked');
    assert.equal(m.db.members.length, 1);
  }
  // A workspace password already set also refuses.
  const vault = buildMain({ settings: { vault: { enabled: true } } });
  await assert.rejects(vault.fns.assertFirstRunSetup(), (e) => e.code === 'ALREADY_SETUP');
  // An unreadable member count refuses (it used to count as zero).
  const broken = buildMain({});
  broken.db.member.failCount = true;
  await assert.rejects(broken.fns.assertFirstRunSetup(), (e) => e.code === 'ALREADY_SETUP');
  // The certified Super Admin is not a member row, so with only the Super Admin signed in the first
  // Owner can still be registered.
  const superOnly = buildMain({ activeMemberId: -1 });
  await superOnly.fns.assertFirstRunSetup();
});

// ---- base builds --------------------------------------------------------------------------------------

test('base build: the local trial, sign-up code and plan catalog are unchanged', async () => {
  const m = buildMain({ tenant: false, members: [owner()], activeMemberId: 1, settings: { billingPlans: [{ id: 'pro', name: 'Pro', amount: '9', tier: 'pro' }] } });
  const lic = await m.fns.getLicense();
  assert.equal(lic.isTrial, true, 'a new workspace starts on the local 7-day trial');
  assert.equal(lic.daysLeftTrial, 7);
  assert.equal(lic.needsPlan, undefined);
  assert.ok(m.db.licenses[0].trialEndsAt instanceof Date);
  assert.equal((await m.fns.startTrial()).isTrial, true, 'a running trial is returned unchanged');
  await m.fns.assertNotBanned();
  const plans = await m.fns.effectiveBillingPlans();
  assert.deepEqual(plain(plans.map((p) => [p.id, p.amount])), [['pro', '9']], "the Super Admin's saved catalog");
  assert.equal(m.settings.has('tenantTrialCutover'), false);
  assert.equal(m.calls.length, 0, 'no licensing server call');
  // Sign-up keeps the local code (shown in-app without SMTP, as before).
  const fresh = buildMain({ tenant: false });
  const res = await fresh.fns.accountSendOtp({ email: 'a@b.co' });
  assert.equal(res.devMode, true);
  assert.match(res.devCode, /^\d{6}$/);
  assert.ok(fresh.settings.get('otp:reg:a@b.co').hash);
});
