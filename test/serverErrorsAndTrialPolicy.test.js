'use strict';
// Error mapping for server sign-up and trials (src/main/serverErrors.js) and the pure trial rules
// (src/main/tenantTrial.js): which local licence rows still count, the "no plan" and trial views.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { MESSAGES, APP_CODES, mapServerError, coded } = require('../src/main/serverErrors');
const tenantTrial = require('../src/main/tenantTrial');
const tierPolicy = require('../src/main/tierPolicy');

const ROOT = path.join(__dirname, '..');
const locale = (lang, ns) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`), 'utf8'));
const http = (status, code, extra = {}) => Object.assign(new Error(code || 'x'), { status, code, ...extra });
const DAY = 86400000;

// ---- error mapping -------------------------------------------------------------------------------

test('sign-up errors map to the plain messages the spec asks for', () => {
  const m = (err, ctx = 'signup') => { const e = mapServerError(err, ctx); return [e.code, e.message]; };
  assert.deepEqual(m(http(400, 'disposable_email')), ['SIGNUP_DISPOSABLE_EMAIL', 'Please use a permanent email address.']);
  assert.deepEqual(m(http(400, 'no_mx')), ['SIGNUP_NO_MX', "We couldn't find a mail server for that address."]);
  assert.deepEqual(m(http(429, 'rate_limited')), ['RATE_LIMITED', 'Too many attempts, try again in a few minutes.']);
  assert.deepEqual(m(http(429, null)), ['RATE_LIMITED', 'Too many attempts, try again in a few minutes.'], 'a bare 429 too');
  assert.deepEqual(m(http(400, 'invalid_email')), ['SIGNUP_INVALID_EMAIL', 'Enter a valid email address.']);
  assert.deepEqual(m({ network: true, code: 'ECONNREFUSED' }), ['SIGNUP_OFFLINE', 'Connect to the internet to create your account.']);
  assert.equal(m(http(503, null))[0], 'SERVER_UNAVAILABLE');
  // A code check: unknown 4xx is a wrong or used code; 401 is the install, never the user.
  assert.equal(m(http(400, 'invalid_code'), 'signupCheck')[0], 'SIGNUP_BAD_CODE');
  assert.equal(m(http(410, 'something_new'), 'signupCheck')[0], 'SIGNUP_BAD_CODE');
  assert.equal(m(http(401, null), 'signupCheck')[0], 'SIGNUP_FAILED');
  assert.equal(m(http(400, 'something_new'), 'signup')[0], 'SIGNUP_FAILED');
});

test('trial errors: trial_used keeps its reason, offline says connect, unknown says try later', () => {
  const used = mapServerError(http(409, 'trial_used', { reason: 'email' }), 'trial');
  assert.equal(used.code, 'TRIAL_USED');
  assert.equal(used.message, 'A free trial has already been used on this computer or email. Choose a plan or enter a purchase code.');
  assert.equal(used.reason, 'email');
  assert.equal(used.status, 409);
  assert.equal(mapServerError({ network: true }, 'trial').message, 'Connect to the internet to start the free trial.');
  assert.equal(mapServerError(http(403, 'email_not_verified'), 'trial').code, 'TRIAL_VERIFY_EMAIL');
  assert.equal(mapServerError(http(403, 'machine_mismatch'), 'trial').code, 'MACHINE_MISMATCH');
  assert.equal(mapServerError(http(500, null), 'trial').code, 'SERVER_UNAVAILABLE');
  assert.equal(mapServerError(new TypeError('bug'), 'trial').code, 'TRIAL_FAILED', 'a local bug is not reported as offline');
  const once = mapServerError(http(409, 'trial_used'), 'trial');
  assert.equal(mapServerError(once, 'signup'), once, 'already mapped errors pass through');
  assert.equal(coded('TRIAL_OFFLINE').appMapped, true);
});

test('every app error code has a translated string in gate and billing, en and es', async () => {
  const { SERVER_ERROR_CODES } = await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'signupFlow.mjs')).href);
  assert.deepEqual([...SERVER_ERROR_CODES].sort(), [...APP_CODES].sort(), 'renderer and main list the same codes');
  for (const ns of ['gate', 'billing']) {
    const en = locale('en', ns).serverErrors;
    const es = locale('es', ns).serverErrors;
    for (const code of APP_CODES) {
      assert.equal(en[code], MESSAGES[code], `en ${ns} ${code} matches main`);
      assert.equal(typeof es[code], 'string', `es ${ns} ${code}`);
      assert.notEqual(es[code], en[code], `es ${ns} ${code} is translated`);
    }
  }
});

// ---- trial rules ---------------------------------------------------------------------------------

test('the cutover records only the trials that existed, with their end dates', () => {
  const ends = new Date(Date.now() + 2 * DAY);
  const cut = tenantTrial.buildCutover([
    { id: 1, type: 'trial', trialEndsAt: ends },
    { id: 2, type: 'trial', trialEndsAt: null },
    { id: 3, type: 'paid', trialEndsAt: ends }
  ], '2026-11-07T00:00:00.000Z');
  assert.deepEqual(cut, { v: 1, at: '2026-11-07T00:00:00.000Z', legacy: { 1: ends.toISOString() } });
});

test('localDecision: legacy trials count (capped), anything else needs the server', () => {
  const now = Date.now();
  const legacyEnd = new Date(now + 3 * DAY).toISOString();
  const cut = { legacy: { 7: legacyEnd } };
  const legacy = tenantTrial.localDecision({ id: 7, type: 'trial', trialEndsAt: new Date(now + 90 * DAY) }, cut, now);
  assert.equal(legacy.kind, 'local');
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.lic.trialEndsAt, legacyEnd, 'never later than when it was recorded');
  assert.equal(tenantTrial.localDecision({ id: 8, type: 'trial', trialEndsAt: null }, cut, now).kind, 'none');
  assert.deepEqual(tenantTrial.localDecision({ id: 8, type: 'trial', trialEndsAt: new Date(now + DAY) }, cut, now), { kind: 'none', trialUsed: true });
  assert.equal(tenantTrial.localDecision({ id: 8, type: 'trial', trialEndsAt: new Date(now - DAY) }, cut, now).kind, 'local', 'an ended server trial runs grace');
  assert.equal(tenantTrial.localDecision({ id: 9, type: 'paid', trialEndsAt: new Date(now + DAY) }, cut, now).kind, 'local');
  assert.deepEqual(tenantTrial.localDecision(null, cut, now), { kind: 'none', trialUsed: false });
  assert.equal(tenantTrial.localDecision({ id: 7, type: 'trial', trialEndsAt: null }, { legacy: {} }, now).kind, 'none', 'an empty cutover honours nothing');
});

test('the no-plan view blocks launches and asks for a plan; the trial view has Trial limits', () => {
  const none = tenantTrial.noPlanView({ trialUsed: false });
  assert.equal(none.isBanned, true);
  assert.equal(none.needsPlan, true);
  assert.equal(none.isTrial, false);
  assert.equal(none.state, 'none');
  const blocked = tenantTrial.noPlanView({ adminBlocked: true });
  assert.equal(blocked.needsPlan, false);
  assert.equal(blocked.state, 'banned');
  const ends = new Date(Date.now() + 7 * DAY).toISOString();
  const trial = tenantTrial.trialViewFromLease({ tier: 'enterprise', exp: Math.floor(Date.parse(ends) / 1000), currentPeriodEnd: ends }, Date.now());
  assert.equal(trial.type, 'trial');
  assert.equal(trial.state, 'trialing');
  assert.equal(trial.daysLeftTrial, 7);
  assert.equal(trial.endsAt, ends);
  const l = tierPolicy.limitsForLicense(trial);
  assert.deepEqual({ tier: l.tier, seats: l.seats, maxParallel: l.maxParallel, auditExport: l.auditExport }, { tier: 'enterprise', seats: 3, maxParallel: 10, auditExport: true });
});
