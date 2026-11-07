'use strict';
// Spec A2 + A3: email verification by us, and the server-side trial ledger (repeat trials by machine,
// email alias and network are refused), over HTTP against the real routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');

const { db, mail, call } = H;
let T;
test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const ip = (addr) => ({ 'x-forwarded-for': addr });

test('verify/start refuses bad, disposable and mail-less addresses with clear codes', async () => {
  const inst = await H.newInstall(T, 'v-codes');
  const post = (email) => call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email, consentMarketing: false, lang: 'en' } });
  assert.equal((await post('not-an-email')).json.error, 'invalid_email');
  assert.equal((await post('a@b')).json.error, 'invalid_email');
  const d = await post('someone@mailinator.com');
  assert.equal(d.status, 400);
  assert.equal(d.json.error, 'disposable_email');
  assert.equal((await post('x@sub.guerrillamail.com')).json.error, 'disposable_email', 'subdomains of listed domains count');
  assert.equal((await post('x@nomail.example')).json.error, 'no_mx');
  assert.equal((await post('x@doesnotexist.example')).json.error, 'no_mx');
  H.dns.slow.add('slowdns.example');
  assert.equal((await post('x@slowdns.example')).status, 200, 'a DNS timeout fails open');
});

test('the owner allowlist overrides the disposable list', async () => {
  const inst = await H.newInstall(T, 'v-allow');
  const r1 = await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'qa@mailinator.com', consentMarketing: false, lang: 'en' } });
  assert.equal(r1.json.error, 'disposable_email');
  const s = await H.admin('PATCH', '/settings', { body: { email: { domainAllowlist: ['mailinator.com'] } } });
  assert.equal(s.status, 200);
  const r2 = await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'qa@mailinator.com', consentMarketing: false, lang: 'en' } });
  assert.equal(r2.status, 200);
  await H.admin('PATCH', '/settings', { body: { email: { domainAllowlist: [] } } });
});

test('a code is emailed (never returned), stored only as a hash, and verify/check links the install', async () => {
  const inst = await H.newInstall(T, 'v-happy');
  const before = mail.sent.length;
  const s = await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: '  Ana.Lopez@Example.com ', name: 'Ana Lopez', consentMarketing: true, lang: 'es', appVersion: '1.0.22' } });
  assert.equal(s.status, 200);
  assert.deepEqual(Object.keys(s.json).sort(), ['expiresInSec', 'ok', 'resendAfterSec', 'sent']);
  assert.ok(!/\d{6}/.test(s.text), 'the code is never in the response');
  assert.equal(mail.sent.length, before + 1);
  const msg = mail.last();
  assert.equal(msg.to, 'ana.lopez@example.com');
  assert.match(msg.subject, /código/);
  assert.equal(msg.list, undefined, 'a sign-in code has no unsubscribe header');
  const code = H.mail.codeFor('ana.lopez@example.com');
  const row = db.tables.emailVerification.find((v) => v.installId === inst.installId);
  assert.ok(row.codeHash && !JSON.stringify(row).includes(code), 'only a hash of the code is stored');
  const log = db.tables.emailOutbox.find((o) => o.toEmail === 'ana.lopez@example.com' && o.templateKey === 'verify_code');
  assert.equal(log.status, 'sent');
  assert.equal(log.html, null, 'the send log keeps no code');

  const c = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'ana.lopez@example.com', code } });
  assert.equal(c.status, 200);
  assert.deepEqual(Object.keys(c.json).sort(), ['customerId', 'verified']);
  assert.equal(c.json.verified, true);
  const cust = db.tables.customer.find((x) => x.id === c.json.customerId);
  assert.equal(cust.emailKey, 'ana.lopez@example.com');
  assert.ok(cust.emailVerifiedAt);
  assert.equal(cust.marketingConsent, true);
  assert.equal(cust.consentSource, 'app_signup');
  assert.equal(cust.lang, 'es');
  assert.equal(cust.source, 'app');
  const install = db.tables.install.find((i) => i.id === inst.installId);
  assert.equal(install.customerId, cust.id);
  assert.equal(install.appVersion, '1.0.22');
  // A retry after a lost response gets the same answer.
  const again = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'ana.lopez@example.com', code } });
  assert.equal(again.status, 200);
  assert.equal(again.json.customerId, cust.id);
});

test('wrong codes: 5 attempts, then too_many_attempts; never 401', async () => {
  const inst = await H.newInstall(T, 'v-wrong');
  await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'wrong@example.com', consentMarketing: false, lang: 'en' } });
  const real = mail.codeFor('wrong@example.com');
  const bad = real === '000000' ? '111111' : '000000';
  for (let i = 4; i >= 0; i--) {
    const r = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'wrong@example.com', code: bad } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_code');
    assert.equal(r.json.attemptsLeft, i);
  }
  const locked = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'wrong@example.com', code: real } });
  assert.equal(locked.status, 429);
  assert.equal(locked.json.error, 'too_many_attempts');
  const none = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'never-asked@example.com', code: '123456' } });
  assert.equal(none.status, 404);
  assert.equal(none.json.error, 'no_code');
  const fmt = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'wrong@example.com', code: '12ab' } });
  assert.equal(fmt.json.error, 'invalid_code');
  const auth = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, installId: inst.installId, installSecret: 'nope', email: 'wrong@example.com', code: real } });
  assert.equal(auth.status, 401, 'only a bad install secret is 401');
});

test('an expired code is refused with code_expired', async () => {
  const inst = await H.newInstall(T, 'v-expired');
  await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'late@example.com', consentMarketing: false, lang: 'en' } });
  const code = mail.codeFor('late@example.com');
  const row = db.tables.emailVerification.find((v) => v.installId === inst.installId);
  row.expiresAt = new Date(Date.now() - 1000);
  const r = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'late@example.com', code } });
  assert.equal(r.status, 410);
  assert.equal(r.json.error, 'code_expired');
});

test('resend throttle and hourly limits answer rate_limited with Retry-After', async () => {
  const inst = await H.newInstall(T, 'v-throttle');
  const body = { tenantId: T, ...inst, email: 'busy@example.com', consentMarketing: false, lang: 'en' };
  assert.equal((await call('POST', '/v1/account/verify/start', { body })).status, 200);
  const r = await call('POST', '/v1/account/verify/start', { body });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, 'rate_limited');
  assert.ok(r.json.retryAfterSec > 0 && r.json.retryAfterSec <= 60);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  // Five codes for one address within the hour, from different installs: the sixth is refused.
  for (let i = 0; i < 4; i++) {
    const other = await H.newInstall(T, `v-throttle-${i}`);
    assert.equal((await call('POST', '/v1/account/verify/start', { body: { ...body, ...other } })).status, 200);
  }
  const sixth = await H.newInstall(T, 'v-throttle-6');
  assert.equal((await call('POST', '/v1/account/verify/start', { body: { ...body, ...sixth } })).json.error, 'rate_limited');
});

test('a failed send does not lock the person out and says email_failed', async () => {
  const inst = await H.newInstall(T, 'v-smtpfail');
  mail.fail = () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
  const r = await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'smtp@example.com', consentMarketing: false, lang: 'en' } });
  mail.fail = null;
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'email_failed');
  const again = await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'smtp@example.com', consentMarketing: false, lang: 'en' } });
  assert.equal(again.status, 200, 'no resend throttle after a send that never left');
});

// ---- trials --------------------------------------------------------------------------------------

async function trial(inst, email, headers = ip('8.8.8.8')) {
  return call('POST', '/v1/trial/start', { body: { tenantId: T, ...inst, email, appVersion: '1.0.22' }, headers });
}

test('trial/start needs an email verified on this install', async () => {
  const inst = await H.newInstall(T, 't-unverified');
  const r = await trial(inst, 'nobody@example.com');
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'email_not_verified');
  // Verified on another install is not enough.
  const other = await H.newInstall(T, 't-other');
  assert.equal((await H.verify(T, other, 'shared@example.com')).status, 200);
  assert.equal((await trial(inst, 'shared@example.com')).json.error, 'email_not_verified');
});

test('a trial returns a signed trial lease in the existing format, bound to the machine', async () => {
  const inst = await H.newInstall(T, 't-ok');
  assert.equal((await H.verify(T, inst, 'trial.user@example.com', {}, ip('8.8.4.4'))).status, 200);
  const r = await trial(inst, 'trial.user@example.com', ip('8.8.4.4'));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.type, 'trial');
  assert.equal(r.json.tier, 'enterprise');
  assert.ok(r.json.currentPeriodEnd && r.json.trialEndsAt);
  assert.ok(H.leaseVerifies(r.json.lease, H.getTenantKeys().publicKeyPem), 'verifies with the tenant public key');
  const { payload } = H.decodeLease(r.json.lease);
  assert.equal(payload.type, 'trial', 'type is in the signed payload');
  assert.equal(payload.plan, 'trial');
  assert.equal(payload.tier, 'enterprise');
  assert.equal(payload.mid, inst.machineHash);
  assert.equal(payload.sub, inst.installId);
  assert.equal(payload.tenant, T);
  const days = (payload.exp * 1000 - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7.01, `exp = 7 days (got ${days})`);
  assert.equal(r.json.exp, payload.exp);

  // Asking again during the trial returns the same trial, never a longer one.
  const again = await trial(inst, 'trial.user@example.com', ip('8.8.4.4'));
  assert.equal(again.status, 200);
  assert.equal(new Date(again.json.trialEndsAt).getTime(), new Date(r.json.trialEndsAt).getTime());
  assert.equal(db.tables.trial.filter((t) => t.installId === inst.installId).length, 1);

  // /v1/license keeps returning the trial lease while it runs.
  const lic = await call('POST', '/v1/license', { body: { tenantId: T, ...inst, appVersion: '1.0.23' } });
  assert.equal(lic.status, 200);
  assert.equal(lic.json.type, 'trial');
  assert.equal(H.decodeLease(lic.json.lease).payload.type, 'trial');
  assert.ok(H.leaseVerifies(lic.json.lease, H.getTenantKeys().publicKeyPem));
  assert.equal(db.tables.install.find((i) => i.id === inst.installId).appVersion, '1.0.23');

  const cust = db.tables.customer.find((c) => c.emailKey === 'trial.user@example.com');
  assert.equal(cust.statusAuto, 'trial');
  assert.equal(cust.tier, 'enterprise');
  assert.ok(cust.trialStartedAt && cust.trialEndsAt);
  assert.equal(cust.appVersion, '1.0.23');
  assert.ok(db.tables.customerEvent.some((e) => e.customerId === cust.id && e.type === 'trial_started'));
  // Only an HMAC of the IP is stored.
  const t = db.tables.trial.find((x) => x.installId === inst.installId);
  assert.match(t.ipHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(db.tables.trial).includes('8.8.4.4'));
  assert.ok(!JSON.stringify(db.tables.trialAttempt).includes('8.8.4.4'));

  // After the trial: no lease, and trialEndsAt says why.
  t.endsAt = new Date(Date.now() - 1000);
  const after = await call('POST', '/v1/license', { body: { tenantId: T, ...inst } });
  assert.equal(after.json.lease, null);
  assert.ok(after.json.trialEndsAt);
});

test('repeat trials are refused: same machine, same email (Gmail alias), same network', async () => {
  const a = await H.newInstall(T, 't-a');
  assert.equal((await H.verify(T, a, 'John.Smith@gmail.com', {}, ip('1.1.1.1'))).status, 200);
  assert.equal((await trial(a, 'John.Smith@gmail.com', ip('1.1.1.1'))).status, 200);

  // Same machine, new install (reinstall with a new data folder) and a different verified email.
  const sameMachine = await H.newInstall(T, 't-a-reinstall');
  const row = db.tables.install.find((i) => i.id === sameMachine.installId);
  row.machineHash = a.machineHash;
  assert.equal((await H.verify(T, { ...sameMachine, machineHash: a.machineHash }, 'second@example.com', {}, ip('1.0.0.1'))).status, 200);
  const m = await trial({ ...sameMachine, machineHash: a.machineHash }, 'second@example.com', ip('1.0.0.1'));
  assert.equal(m.status, 409);
  assert.deepEqual({ error: m.json.error, reason: m.json.reason }, { error: 'trial_used', reason: 'machine' });

  // Another machine, same Gmail mailbox written differently.
  const b = await H.newInstall(T, 't-b');
  assert.equal((await H.verify(T, b, 'johnsmith+trial@googlemail.com', {}, ip('9.9.9.9'))).status, 200);
  const e = await trial(b, 'johnsmith+trial@googlemail.com', ip('9.9.9.9'));
  assert.equal(e.status, 409);
  assert.equal(e.json.reason, 'email');

  // Same network: two trials in 30 days are allowed, the third is not.
  const n1 = await H.newInstall(T, 't-n1');
  const n2 = await H.newInstall(T, 't-n2');
  const n3 = await H.newInstall(T, 't-n3');
  for (const [inst, em] of [[n1, 'n1@example.com'], [n2, 'n2@example.com'], [n3, 'n3@example.com']]) {
    assert.equal((await H.verify(T, inst, em, {}, ip('5.5.5.5'))).status, 200);
  }
  assert.equal((await trial(n1, 'n1@example.com', ip('5.5.5.5'))).status, 200);
  assert.equal((await trial(n2, 'n2@example.com', ip('5.5.5.5'))).status, 200);
  const third = await trial(n3, 'n3@example.com', ip('5.5.5.5'));
  assert.equal(third.status, 409);
  assert.equal(third.json.reason, 'network');
  // A client-written X-Forwarded-For entry does not change the network: the rightmost entry counts.
  const spoof = await trial(n3, 'n3@example.com', { 'x-forwarded-for': '7.7.7.7, 5.5.5.5' });
  assert.equal(spoof.json.reason, 'network');

  const outcomes = db.tables.trialAttempt.map((x) => x.outcome);
  for (const o of ['granted', 'used_machine', 'used_email', 'used_network']) assert.ok(outcomes.includes(o), o);
});

test('IPv6 addresses count per /64, and private addresses are not counted', async () => {
  const insts = [];
  for (let i = 0; i < 3; i++) {
    const inst = await H.newInstall(T, `t-v6-${i}`);
    assert.equal((await H.verify(T, inst, `v6-${i}@example.com`, {}, ip('2001:4860::1'))).status, 200);
    insts.push(inst);
  }
  assert.equal((await trial(insts[0], 'v6-0@example.com', ip('2001:4860:0:0::aaaa'))).status, 200);
  assert.equal((await trial(insts[1], 'v6-1@example.com', ip('2001:4860::bbbb:1'))).status, 200);
  assert.equal((await trial(insts[2], 'v6-2@example.com', ip('2001:4860:0:0:ffff::9'))).json.reason, 'network', 'same /64');

  const lan = [];
  for (let i = 0; i < 3; i++) {
    const inst = await H.newInstall(T, `t-lan-${i}`);
    assert.equal((await H.verify(T, inst, `lan-${i}@example.com`)).status, 200);
    lan.push(inst);
  }
  for (let i = 0; i < 3; i++) assert.equal((await trial(lan[i], `lan-${i}@example.com`, ip('192.168.1.20'))).status, 200, 'a private address never blocks');
});

test('an admin reset allows one more trial; an install with a licence gets already_licensed', async () => {
  const inst = await H.newInstall(T, 't-reset');
  assert.equal((await H.verify(T, inst, 'reset.me@example.com', {}, ip('3.3.3.3'))).status, 200);
  assert.equal((await trial(inst, 'reset.me@example.com', ip('3.3.3.3'))).status, 200);
  const t = db.tables.trial.find((x) => x.installId === inst.installId);
  t.endsAt = new Date(Date.now() - 1000);
  assert.equal((await trial(inst, 'reset.me@example.com', ip('3.3.3.3'))).json.reason, 'machine');
  const reset = await H.admin('POST', `/trials/${t.id}/reset`, { body: { release: 'all', reason: 'Support ticket 42: trial broke' } });
  assert.equal(reset.status, 200, reset.text);
  const again = await trial(inst, 'reset.me@example.com', ip('3.3.3.3'));
  assert.equal(again.status, 200);
  assert.equal(db.tables.trial.filter((x) => x.installId === inst.installId).length, 2, 'history kept');

  const paid = await H.newInstall(T, 't-paid');
  assert.equal((await H.verify(T, paid, 'paid.already@example.com')).status, 200);
  await db.license.create({ data: { tenantId: T, installId: paid.installId, tier: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000) } });
  const r = await trial(paid, 'paid.already@example.com');
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'already_licensed');
});

test('trial/start checks the machine binding like /v1/license', async () => {
  const inst = await H.newInstall(T, 't-mid');
  assert.equal((await H.verify(T, inst, 'mid@example.com')).status, 200);
  const wrong = await call('POST', '/v1/trial/start', { body: { tenantId: T, ...inst, machineHash: H.mh('another-pc'), email: 'mid@example.com' } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.error, 'machine_mismatch');
  const none = await call('POST', '/v1/trial/start', { body: { tenantId: T, installId: inst.installId, installSecret: inst.installSecret, email: 'mid@example.com' } });
  assert.equal(none.json.error, 'machine_required');
});

test('a paid lease now says type paid, and /v1/license records appVersion', async () => {
  const inst = await H.newInstall(T, 'paid-lease');
  await db.license.create({ data: { tenantId: T, installId: inst.installId, tier: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86400000) } });
  const r = await call('POST', '/v1/license', { body: { tenantId: T, ...inst, appVersion: '1.0.22' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, 'paid');
  assert.equal(H.decodeLease(r.json.lease).payload.type, 'paid');
  assert.equal(db.tables.install.find((i) => i.id === inst.installId).appVersion, '1.0.22');
});
