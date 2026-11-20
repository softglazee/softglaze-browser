'use strict';
// The web app's refresh token in an HttpOnly cookie (sg_web_rt) instead of the response body.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');

const { mail, call } = H;
const ORIGIN = 'https://app.test';

test.before(async () => {
  await H.start();
  await H.seedTenant('tenant1');
  process.env.WEB_APP_ORIGINS = ORIGIN;
});
test.after(async () => {
  delete process.env.WEB_APP_ORIGINS;
  await H.stop();
});

const cookieOf = (r) => (r.headers.getSetCookie() || []).find((c) => c.startsWith('sg_web_rt='));
const valueOf = (c) => c.split(';')[0];

async function signIn(email) {
  const s = await call('POST', '/v1/web/auth/email/start', { body: { email }, headers: { origin: ORIGIN } });
  assert.equal(s.status, 200, s.text);
  return call('POST', '/v1/web/auth/email/verify', {
    body: { challengeId: s.json.challengeId, code: mail.codeFor(email), refresh_cookie: true }, headers: { origin: ORIGIN }
  });
}

test('sign in sets an HttpOnly, Strict, path-scoped cookie and leaves the token out of the body', async () => {
  const r = await signIn('cookie1@example.com');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.refresh_token, undefined);
  assert.ok(r.json.access_token);
  const c = cookieOf(r);
  assert.ok(c, 'cookie set');
  assert.match(c, /HttpOnly/i);
  assert.match(c, /SameSite=Strict/i);
  assert.match(c, /Path=\/v1\/web\/auth\/token/i);
  assert.match(c, /Secure/i); // PUBLIC_BASE_URL is https in the tests
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
});

test('refresh with the cookie rotates it; the old cookie again ends the session', async () => {
  const first = await signIn('cookie2@example.com');
  const c1 = valueOf(cookieOf(first));
  const r1 = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web', refresh_cookie: true }, headers: { cookie: c1, origin: ORIGIN } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.refresh_token, undefined);
  const c2 = valueOf(cookieOf(r1));
  assert.notEqual(c2, c1);
  const me = await call('GET', '/v1/account/me', { headers: { authorization: `Bearer ${r1.json.access_token}` } });
  assert.equal(me.status, 200);

  const replay = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web' }, headers: { cookie: c1 } });
  assert.equal(replay.status, 400);
  assert.match(cookieOf(replay) || '', /sg_web_rt=;/, 'a refused refresh clears the cookie');
  const after = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web' }, headers: { cookie: c2 } });
  assert.equal(after.status, 400, 'reuse of an old token ended the whole session');
});

test('no cookie and no body token: invalid_grant; a body token still works', async () => {
  const none = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web' } });
  assert.equal(none.status, 400);
  const s = await call('POST', '/v1/web/auth/email/start', { body: { email: 'cookie3@example.com' } });
  const v = await call('POST', '/v1/web/auth/email/verify', { body: { challengeId: s.json.challengeId, code: mail.codeFor('cookie3@example.com') } });
  assert.ok(v.json.refresh_token, 'without refresh_cookie the body keeps the token');
  const r = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web', refresh_token: v.json.refresh_token } });
  assert.equal(r.status, 200);
});

test('sign-out clears the cookie', async () => {
  const r = await signIn('cookie4@example.com');
  const out = await call('POST', '/v1/web/auth/sign-out', { headers: { authorization: `Bearer ${r.json.access_token}` } });
  assert.equal(out.status, 204);
  assert.match(cookieOf(out) || '', /sg_web_rt=;.*Path=\/v1\/web\/auth\/token/i);
});
