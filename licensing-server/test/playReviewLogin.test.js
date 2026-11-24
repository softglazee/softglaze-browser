'use strict';
// Google Play review login (src/auth/reviewLogin.js, docs/PLAY-REVIEW-LOGIN.md): one fixed address, one fixed
// code from REVIEW_LOGIN_CODE_HASH, no email sent, every limit still applies, every other address unaffected.
// The config file holds the two lines at startup, so this also proves that removing them switches it off at once.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONFIG = path.join(os.tmpdir(), `sg-review-login-${process.pid}.env`);
process.env.CONFIG_ENV_FILE = CONFIG;
process.env.MASTER_KEY = process.env.MASTER_KEY || require('node:crypto').randomBytes(32).toString('base64');

// The hash is made here with the module's own helper (no server env needed for that part).
const REVIEW_EMAIL = 'play-review@softglaze.com';
const REVIEW_CODE = '482913';
const crypto = require('node:crypto');
function makeHash(code, N = 16384) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(code, salt, 32, { N, r: 8, p: 1, maxmem: 256 * N * 8 + 1024 * 1024 });
  return `scrypt:${N}:8:1:${salt.toString('base64url')}:${key.toString('base64url')}`;
}
const HASH = makeHash(REVIEW_CODE);
const writeConfig = (lines) => {
  fs.writeFileSync(CONFIG, lines.join('\n') + '\n');
  const t = new Date(Date.now() + Math.floor(Math.random() * 100000) + 1000);
  fs.utimesSync(CONFIG, t, t); // a new mtime, so the live config cache re-reads the file
};
writeConfig([`REVIEW_LOGIN_EMAIL=${REVIEW_EMAIL}`, `REVIEW_LOGIN_CODE_HASH=${HASH}`]);

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const review = require('../src/auth/reviewLogin');
const mobile = require('../src/auth/mobile');
const { getSettings } = require('../src/settings');

const { db, mail, call } = H;
let T;
const DEVICE = { platform: 'android', model: 'Pixel 9', appVersion: '1.1.0' };

// Everything the server writes to the console while `fn` runs.
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[k] = console[k];
    console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  }
  try { return { result: await fn(), lines }; } finally { Object.assign(console, orig); }
}
const sentTo = (to) => mail.sent.filter((m) => String(m.to).toLowerCase() === to.toLowerCase()).length;
const outboxTo = (to) => db.tables.emailOutbox.filter((o) => String(o.toEmail).toLowerCase() === to.toLowerCase()).length;
// The resend throttle and the strict lock are per address; each test starts clean.
const forget = (email) => { db.tables.emailVerification = db.tables.emailVerification.filter((r) => r.emailKey !== email); };
const enable = () => writeConfig([`REVIEW_LOGIN_EMAIL=${REVIEW_EMAIL}`, `REVIEW_LOGIN_CODE_HASH=${HASH}`]);

test.before(async () => {
  await H.start();
  T = (await H.seedTenant()).id;
});
test.after(async () => {
  await H.stop();
  try { fs.unlinkSync(CONFIG); } catch (_) { /* gone */ }
});
test.beforeEach(() => { enable(); forget(REVIEW_EMAIL); });

test('hash format: parse, reject weak or malformed values, constant-time match', () => {
  assert.ok(review.parseCodeHash(HASH));
  assert.equal(review.parseCodeHash('5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'), null, 'a bare sha256 is refused');
  assert.equal(review.parseCodeHash(HASH.replace('scrypt:16384', 'scrypt:1024')), null, 'N too small');
  assert.equal(review.parseCodeHash(HASH.replace('scrypt:16384', 'scrypt:20000')), null, 'N not a power of two');
  assert.equal(review.parseCodeHash('scrypt:16384:8:1:short:short'), null);
  const cfg = review.reviewConfig();
  assert.equal(cfg.email, REVIEW_EMAIL);
  assert.equal(review.reviewCodeMatches(cfg, REVIEW_CODE), true);
  assert.equal(review.reviewCodeMatches(cfg, '000000'), false);
  assert.equal(review.reviewCodeMatches(cfg, '48291'), false);
  assert.equal(review.reviewCodeMatches(cfg, `${REVIEW_CODE} `), false);
  const made = review.hashReviewCode('123456', { N: 16384 });
  assert.equal(review.reviewCodeMatches({ hash: review.parseCodeHash(made) }, '123456'), true);
  assert.throws(() => review.hashReviewCode('12345'));
});

test('phone: the review address signs in with the fixed code, no email is sent, Free plan, logged without secrets', async () => {
  const mailsBefore = mail.sent.length;
  const { result: start } = await captureLogs(() => call('POST', '/v1/mobile/auth/email/start', { body: { email: ' Play-Review@SoftGlaze.com ', device: DEVICE } }));
  assert.equal(start.status, 200, start.text);
  assert.deepEqual(Object.keys(start.json).sort(), ['challengeId', 'expiresAt', 'resendAfterSec'], 'the same answer as a sent code');
  assert.match(start.json.challengeId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(mail.sent.length, mailsBefore, 'no email at all');
  assert.equal(outboxTo(REVIEW_EMAIL), 0, 'nothing queued either');

  const wrong = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: start.json.challengeId, code: '000000', device: DEVICE } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, 'invalid_code');
  assert.equal(wrong.json.attemptsLeft, 4, 'a wrong code counts as usual');

  const { result: ok, lines } = await captureLogs(() => call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: start.json.challengeId, code: REVIEW_CODE, device: DEVICE } }));
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.account.email, REVIEW_EMAIL);
  const c = await db.customer.findUnique({ where: { id: ok.json.account.id } });
  assert.equal(c.tenantId, T, 'the normal tenant');
  const me = await call('GET', '/v1/account/me', { headers: { authorization: `Bearer ${ok.json.token}` } });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.account.plan, 'free', 'a normal customer on the Free plan');
  assert.ok(db.tables.customerEvent.some((e) => e.customerId === c.id && e.type === 'review_login' && e.data.via === 'mobile'));
  const all = lines.join('\n');
  assert.match(all, /\[review-login\] review sign-in ok: via=mobile/);
  assert.ok(!all.includes(REVIEW_CODE), 'the code is never logged');
  assert.ok(!all.includes(HASH.split(':')[5]), 'nor the hash');

  const again = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: start.json.challengeId, code: REVIEW_CODE, device: DEVICE } });
  assert.equal(again.json.error, 'code_expired', 'a challenge works once');
});

test('web and desktop email-code flows accept the review code too', async () => {
  const before = mail.sent.length;
  const ws = await call('POST', '/v1/web/auth/email/start', { body: { email: REVIEW_EMAIL } });
  assert.equal(ws.status, 200, ws.text);
  const wv = await call('POST', '/v1/web/auth/email/verify', { body: { challengeId: ws.json.challengeId, code: REVIEW_CODE } });
  assert.equal(wv.status, 200, wv.text);
  assert.equal(wv.json.account.email, REVIEW_EMAIL);

  const inst = await H.newInstall(T, 'review-desk');
  const ds = await call('POST', '/auth/email/start', { body: { tenantId: T, ...inst, email: REVIEW_EMAIL, lang: 'en' } });
  assert.equal(ds.status, 200, ds.text);
  assert.equal(ds.json.sent, true, 'the same answer as a sent code');
  const dv = await call('POST', '/auth/email/verify', { body: { tenantId: T, ...inst, email: REVIEW_EMAIL, code: REVIEW_CODE } });
  assert.equal(dv.status, 200, dv.text);
  assert.equal(dv.json.provider, 'email');
  assert.equal(mail.sent.length, before, 'no email on any client');
});

test('every other address is unaffected: email sent, review code refused, its own code works', async () => {
  for (const other of ['someone@softglaze.com', 'play-review+x@softglaze.com', 'play-review@softglaze.co']) {
    const s = await call('POST', '/v1/mobile/auth/email/start', { body: { email: other, device: DEVICE } });
    assert.equal(s.status, 200, s.text);
    assert.equal(sentTo(other), 1, `${other} gets its email`);
    const own = mail.codeFor(other);
    if (own !== REVIEW_CODE) {
      const r = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: s.json.challengeId, code: REVIEW_CODE, device: DEVICE } });
      assert.equal(r.json.error, 'invalid_code', `the review code does not open ${other}`);
    }
    const ok = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: s.json.challengeId, code: own, device: DEVICE } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.account.email, other);
  }
  // Desktop: another address with the review code is refused.
  const inst = await H.newInstall(T, 'review-other');
  await call('POST', '/auth/email/start', { body: { tenantId: T, ...inst, email: 'desk-other@softglaze.com', lang: 'en' } });
  if (mail.codeFor('desk-other@softglaze.com') !== REVIEW_CODE) {
    const r = await call('POST', '/auth/email/verify', { body: { tenantId: T, ...inst, email: 'desk-other@softglaze.com', code: REVIEW_CODE } });
    assert.equal(r.json.error, 'invalid_code');
  }
});

test('disabled: missing or invalid config, or the lines removed from config/.env, is the normal flow', async () => {
  for (const lines of [[], [`REVIEW_LOGIN_EMAIL=${REVIEW_EMAIL}`], [`REVIEW_LOGIN_CODE_HASH=${HASH}`], [`REVIEW_LOGIN_EMAIL=${REVIEW_EMAIL}`, 'REVIEW_LOGIN_CODE_HASH=not-a-hash']]) {
    writeConfig(lines);
    forget(REVIEW_EMAIL);
    assert.equal(review.reviewConfig(), null, JSON.stringify(lines));
    const before = sentTo(REVIEW_EMAIL);
    const { result: s } = await captureLogs(() => call('POST', '/v1/mobile/auth/email/start', { body: { email: REVIEW_EMAIL, device: DEVICE } }));
    assert.equal(s.status, 200, s.text);
    assert.equal(sentTo(REVIEW_EMAIL), before + 1, 'a normal email is sent');
    if (mail.codeFor(REVIEW_EMAIL) !== REVIEW_CODE) {
      const r = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: s.json.challengeId, code: REVIEW_CODE, device: DEVICE } });
      assert.equal(r.json.error, 'invalid_code', 'the review code does nothing while off');
    }
  }
  // The values were copied into process.env at startup; the stale copies do not count.
  assert.equal(process.env.REVIEW_LOGIN_EMAIL, REVIEW_EMAIL);
});

test('limits: 5 wrong codes per challenge, then the strict daily lock refuses even the right code', async () => {
  const tenant = await db.tenant.findUnique({ where: { id: T } });
  const settings = await getSettings(db, T);
  let now = Date.now();
  const start = async () => {
    now += 61000; // past the resend throttle
    const s = await mobile.emailStart(db, tenant, { email: REVIEW_EMAIL }, { now, settings });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    return s.body.challengeId;
  };
  const verify = (challengeId, code) => mobile.emailVerify(db, tenant, { challengeId, code, device: DEVICE }, { client: 'softglaze-mobile', device: DEVICE, now, settings });

  const a = await start();
  for (let i = 0; i < 5; i++) assert.equal((await verify(a, String(100000 + i))).body.error, 'invalid_code');
  assert.equal((await verify(a, REVIEW_CODE)).body.error, 'too_many_attempts', 'the per-challenge limit holds for the review address');
  const b = await start();
  for (let i = 0; i < 4; i++) assert.equal((await verify(b, String(200000 + i))).body.error, 'invalid_code');
  assert.equal((await verify(b, '299999')).body.error, 'invalid_code', '10th wrong code');
  const c = await start();
  const locked = await verify(c, REVIEW_CODE);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'too_many_attempts', `${review.REVIEW_MAX_FAILURES_PER_DAY} wrong codes in 24 h lock the review address`);
  // The hourly send limit still applies: 5 codes per hour per address.
  await start(); await start();
  now += 61000;
  const sixth = await mobile.emailStart(db, tenant, { email: REVIEW_EMAIL }, { now, settings });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error, 'rate_limited');
  // A day later the lock is gone.
  now += 86400000;
  const d = await start();
  const ok = await verify(d, REVIEW_CODE);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
