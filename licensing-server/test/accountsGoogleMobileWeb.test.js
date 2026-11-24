'use strict';
// Google sign-in (desktop, phone, web), the phone endpoints (/v1/mobile/*), the web sessions (/v1/web/auth/*) and
// the account API (/v1/account/*) over HTTP against the real routes. Google is replaced by a fake that signs ID
// tokens with a test RSA key and checks what Google checks (client secret, redirect URI, PKCE verifier).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers/harness');
const google = require('../src/auth/providers/google');
const github = require('../src/auth/providers/github');
const { checkClientRedirect } = require('../src/auth/tokens');
const { applyRetention } = require('../src/privacy/retention');
const { getSettings } = require('../src/settings');

const { db, mail, call } = H;
let T;
let base;

const b64url = (b) => Buffer.from(b).toString('base64url');
function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
const clientState = () => crypto.randomBytes(8).toString('hex').slice(0, 10); // like expo-auth-session: 10 characters

// --- The fake Google ---
const { privateKey: gKey, publicKey: gPub } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'kid-1';
const CLIENT_ID = 'gid.apps.googleusercontent.com';
function signJwt(claims, { kid = KID, key = gKey, alg = 'RS256' } = {}) {
  const h = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const s = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${s}`;
}
const goog = { codes: new Map(), jwksCalls: 0, tokenCalls: [] };
function fakeResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), async json() { return body; } };
}
google.setFetchForTests(async (url, init = {}) => {
  if (url === google.JWKS_URL) {
    goog.jwksCalls += 1;
    return fakeResponse(200, { keys: [{ ...gPub.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] }, { 'cache-control': 'public, max-age=3600' });
  }
  if (url === google.TOKEN_URL) {
    const p = new URLSearchParams(init.body);
    goog.tokenCalls.push(Object.fromEntries(p));
    if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== 'g-secret') return fakeResponse(401, { error: 'invalid_client' });
    if (p.get('redirect_uri') !== 'https://api.test/auth/callback/google' || p.get('grant_type') !== 'authorization_code') return fakeResponse(400, { error: 'redirect_uri_mismatch' });
    const entry = goog.codes.get(p.get('code'));
    if (!entry) return fakeResponse(400, { error: 'invalid_grant' });
    const ok = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === entry.challenge;
    if (!ok) return fakeResponse(400, { error: 'invalid_grant' });
    goog.codes.delete(p.get('code'));
    return fakeResponse(200, { access_token: 'ya29.x', id_token: entry.idToken(entry), token_type: 'Bearer', expires_in: 3599 });
  }
  return fakeResponse(404, {});
});

function claimsFor(user, nonce, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com', azp: CLIENT_ID, aud: CLIENT_ID, sub: user.sub, email: user.email, email_verified: true,
    name: user.name || null, nonce, iat: now, exp: now + 3600, ...extra
  };
}

// The browser part after a 302 to Google: Google (fake) and our callback. -> { callback, authorize }.
async function googleLeg(startRes, user, { extra = {}, token = null, cookie: useCookie = true } = {}) {
  assert.equal(startRes.status, 302, startRes.headers.get('location') || String(startRes.status));
  const loc = new URL(startRes.headers.get('location'));
  const setCookie = startRes.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  const code = `4/g_${crypto.randomBytes(6).toString('hex')}`;
  goog.codes.set(code, {
    challenge: loc.searchParams.get('code_challenge'),
    idToken: token || (() => signJwt(claimsFor(user, loc.searchParams.get('nonce'), extra)))
  });
  const cb = await fetch(`${base}/auth/callback/google?code=${encodeURIComponent(code)}&state=${encodeURIComponent(loc.searchParams.get('state'))}`, {
    redirect: 'manual', headers: useCookie && setCookie ? { cookie: setCookie.split(';')[0] } : {}
  });
  return { callback: cb, authorize: loc, setCookie };
}

const DEVICE = { platform: 'android', model: 'Pixel 9', appVersion: '1.0.0' };
const MOBILE_REDIRECT = 'softglaze-mobile://auth';
const WEB_ORIGIN = 'https://app.test';
const WEB_REDIRECT = `${WEB_ORIGIN}/auth/callback`;

function clientAuthorizeUrl(path, { client, redirect, provider = 'google', challenge, state, extra = {} }) {
  const q = new URLSearchParams({
    client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'mobile', state, code_challenge: challenge,
    code_challenge_method: 'S256', provider, ...extra
  });
  return `${base}${path}?${q}`;
}

// A full phone sign-in with Google. -> the /v1/mobile/auth/token answer.
async function phoneGoogle(user, { device = DEVICE } = {}) {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: MOBILE_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const { callback } = await googleLeg(s, user);
  assert.equal(callback.status, 302);
  const back = new URL(callback.headers.get('location'));
  assert.equal(`${back.protocol}//${back.host}`, MOBILE_REDIRECT);
  assert.equal(back.searchParams.get('state'), st);
  const code = back.searchParams.get('code');
  assert.ok(code, back.href);
  return call('POST', '/v1/mobile/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-mobile', redirect_uri: MOBILE_REDIRECT, code, code_verifier: p.verifier, device }
  });
}

async function webGoogle(user) {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const { callback } = await googleLeg(s, user);
  const back = new URL(callback.headers.get('location'));
  assert.equal(back.origin + back.pathname, WEB_REDIRECT);
  return call('POST', '/v1/web/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-web', redirect_uri: WEB_REDIRECT, code: back.searchParams.get('code'), code_verifier: p.verifier },
    headers: { origin: WEB_ORIGIN }
  });
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

test.before(async () => {
  base = await H.start();
  T = (await H.seedTenant()).id;
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
  process.env.WEB_APP_ORIGINS = `${WEB_ORIGIN}, https://bad.test/path, http://evil.test`;
});
test.after(() => H.stop());

// --- Google ID token checks ---

test('Google ID tokens: signature, iss (both forms), aud, azp, exp, nonce and email_verified are all checked', async () => {
  const nonce = 'browser-nonce-value';
  const good = claimsFor({ sub: '1234567890', email: 'g@example.com' }, google.oidcNonce(nonce));
  const v = (claims, opts) => google.verifyIdToken(signJwt(claims, opts), { clientId: CLIENT_ID, nonce });
  assert.equal((await v(good)).sub, '1234567890');
  assert.equal((await v({ ...good, iss: 'accounts.google.com' })).sub, '1234567890', 'the legacy issuer form is accepted');
  const bad = async (claims, why, opts) => {
    await assert.rejects(v(claims, opts), (e) => e.code === 'provider_error' && e.detail === `id_token_${why}`, why);
  };
  await bad(good, 'signature', { key: otherKey });
  await bad(good, 'unknown_key', { kid: 'nope' });
  await bad(good, 'alg', { alg: 'HS256' });
  await bad({ ...good, iss: 'https://evil.example' }, 'iss');
  await bad({ ...good, aud: 'someone-else' }, 'aud');
  await bad({ ...good, aud: [CLIENT_ID, 'other'], azp: 'other' }, 'azp');
  await bad({ ...good, exp: Math.floor(Date.now() / 1000) - 600 }, 'expired');
  await bad({ ...good, iat: Math.floor(Date.now() / 1000) + 3600 }, 'iat');
  await bad({ ...good, nonce: google.oidcNonce('another') }, 'nonce');
  await bad({ ...good, nonce: nonce }, 'nonce'); // the raw browser nonce is never what Google gets
  await bad({ ...good, sub: '' }, 'sub');
  await assert.rejects(v({ ...good, email_verified: false }), (e) => e.code === 'email_not_verified');
  await assert.rejects(google.verifyIdToken('a.b', { clientId: CLIENT_ID, nonce }), (e) => e.detail === 'id_token_malformed');
});

test('GET /auth/providers lists Google only when both of its keys are set', async () => {
  assert.deepEqual((await call('GET', `/auth/providers?tenantId=${T}`)).json, { providers: ['google'], email: true });
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.deepEqual((await call('GET', `/auth/providers?tenantId=${T}`)).json.providers, []);
  assert.deepEqual((await call('GET', '/v1/mobile/auth/providers')).json.providers, []);
  process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
  assert.deepEqual((await call('GET', '/v1/web/auth/providers')).json.providers, ['google']);
});

// --- Desktop ---

test('desktop: Continue with Google links to the customer who verified the same email, with a 180-day sliding session', async () => {
  const inst = await H.newInstall(T, 'g-desk');
  assert.equal((await H.verify(T, inst, 'grace@example.com')).status, 200);
  const before = await db.customer.findFirst({ where: { tenantId: T, emailKey: 'grace@example.com' } });
  const p = pkce();
  const q = new URLSearchParams({ provider: 'google', tenant: T, app_redirect: 'http://127.0.0.1:53111/auth', code_challenge: p.challenge, code_challenge_method: 'S256', state: b64url(crypto.randomBytes(24)) });
  const s = await fetch(`${base}/auth/start?${q}`, { redirect: 'manual' });
  const { callback, authorize } = await googleLeg(s, { sub: '1092837465', email: 'Grace@Example.com', name: 'Grace Hopper' });
  assert.equal(authorize.origin + authorize.pathname, google.AUTHORIZE_URL);
  assert.equal(authorize.searchParams.get('scope'), 'openid email profile');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'https://api.test/auth/callback/google');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorize.searchParams.get('nonce'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(callback.status, 302);
  const back = new URL(callback.headers.get('location'));
  const r = await call('POST', '/auth/exchange', { body: { tenantId: T, ...inst, code: back.searchParams.get('code'), codeVerifier: p.verifier } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.provider, 'google');
  assert.equal(r.json.customer.id, before.id, 'the same verified email is the same customer');
  assert.equal(r.json.linked, 'email');
  assert.ok(r.json.methods.some((m) => m.provider === 'google' && m.email.toLowerCase() === 'grace@example.com'));
  const row = await db.authSession.findFirst({ where: { customerId: before.id, provider: 'google' } });
  assert.equal(row.kind, 'desktop');
  assert.ok(new Date(row.expiresAt).getTime() > Date.now() + 179 * 86400000);
  // An unverified Google email is refused and nothing is linked.
  const p2 = pkce();
  const q2 = new URLSearchParams({ provider: 'google', tenant: T, app_redirect: 'http://127.0.0.1:53111/auth', code_challenge: p2.challenge, code_challenge_method: 'S256', state: b64url(crypto.randomBytes(24)) });
  const s2 = await fetch(`${base}/auth/start?${q2}`, { redirect: 'manual' });
  const leg2 = await googleLeg(s2, { sub: '555', email: 'unverified@example.com' }, { extra: { email_verified: false } });
  assert.equal(new URL(leg2.callback.headers.get('location')).searchParams.get('error'), 'email_not_verified');
  assert.equal(await db.customer.count({ where: { emailKey: 'unverified@example.com' } }), 0);
});

test('desktop: legacy sessions (no end) keep working, an ended session is refused', async () => {
  const inst = await H.newInstall(T, 'legacy');
  assert.equal((await H.verify(T, inst, 'legacy@example.com')).status, 200);
  const install = await db.install.findUnique({ where: { id: inst.installId } });
  const legacyToken = b64url(crypto.randomBytes(32));
  const endedToken = b64url(crypto.randomBytes(32));
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  await db.authSession.create({ data: { tenantId: T, customerId: install.customerId, installId: inst.installId, provider: 'github', emailKey: 'legacy@example.com', tokenHash: sha(legacyToken) } });
  await db.authSession.create({ data: { tenantId: T, customerId: install.customerId, installId: inst.installId, provider: 'github', emailKey: 'legacy@example.com', tokenHash: sha(endedToken), expiresAt: new Date(Date.now() - 1000) } });
  const ok = await call('POST', '/auth/me', { body: { tenantId: T, ...inst, session: legacyToken } });
  assert.equal(ok.status, 200, ok.text);
  const row = await db.authSession.findUnique({ where: { tokenHash: sha(legacyToken) } });
  assert.equal(row.expiresAt, null, 'a legacy session is not given an end');
  assert.equal((await call('POST', '/auth/me', { body: { tenantId: T, ...inst, session: endedToken } })).status, 401);
});

// --- Phone ---

test('phone redirect allow-list: softglaze-mobile://auth for softglaze-mobile only; web origins from WEB_APP_ORIGINS', () => {
  assert.equal(checkClientRedirect('softglaze-mobile', MOBILE_REDIRECT).kind, 'client');
  assert.equal(checkClientRedirect('softglaze-web', MOBILE_REDIRECT), null);
  assert.equal(checkClientRedirect('softglaze-mobile', 'softglaze://auth'), null);
  assert.equal(checkClientRedirect('softglaze-web', WEB_REDIRECT).kind, 'client');
  for (const bad of [`${WEB_ORIGIN}/auth/callback/`, `${WEB_ORIGIN}/auth/callback?x=1`, `${WEB_ORIGIN}/other`, 'https://bad.test/path/auth/callback',
    'http://evil.test/auth/callback', 'https://evil.test/auth/callback', 'https://app.test.evil.test/auth/callback']) {
    assert.equal(checkClientRedirect('softglaze-web', bad), null, bad);
  }
  assert.equal(checkClientRedirect('softglaze-desktop', WEB_REDIRECT), null);
});

test('phone: Google sign-in, session body, refresh rotation, sign-out', async () => {
  const r = await phoneGoogle({ sub: '777000', email: 'phone@example.com', name: 'Pat Phone' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof r.json.expiresAt, 'number');
  assert.ok(r.json.expiresAt > Date.now() + 29 * 86400000);
  assert.deepEqual(Object.keys(r.json.account).sort(), ['email', 'id', 'lifetime', 'name', 'plan', 'planEndsAt', 'tier']);
  assert.equal(r.json.account.plan, 'free', 'a new account with no trial is on Free');
  assert.equal(r.json.account.lifetime, false);
  assert.equal(r.json.account.planEndsAt, null);
  assert.equal(r.json.account.email, 'phone@example.com');
  assert.equal(r.json.account.tier, 'trial');
  const dev = await db.mobileDevice.findFirst({ where: { customerId: r.json.account.id } });
  assert.equal(dev.platform, 'android');
  assert.equal(dev.model, 'Pixel 9');

  const ref = await call('POST', '/v1/mobile/auth/refresh', { headers: bearer(r.json.token) });
  assert.equal(ref.status, 200, ref.text);
  assert.notEqual(ref.json.token, r.json.token);
  assert.equal((await call('POST', '/v1/mobile/auth/refresh', { headers: bearer(r.json.token) })).status, 401, 'the old token ended');
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(ref.json.token) })).status, 200);
  const out = await call('POST', '/v1/mobile/auth/sign-out', { headers: bearer(ref.json.token) });
  assert.equal(out.status, 204);
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(ref.json.token) })).status, 401);
  assert.ok((await db.mobileDevice.findUnique({ where: { id: dev.id } })).revokedAt, 'the phone is revoked with its session');
  assert.equal((await call('POST', '/v1/mobile/auth/sign-out', { headers: bearer(ref.json.token) })).status, 204, 'signing out twice is fine');
});

test('phone: the token endpoint refuses a wrong verifier, another redirect, a reused code and a missing device', async () => {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: MOBILE_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const { callback } = await googleLeg(s, { sub: '888', email: 'strict@example.com' });
  const code = new URL(callback.headers.get('location')).searchParams.get('code');
  const body = { grant_type: 'authorization_code', client_id: 'softglaze-mobile', redirect_uri: MOBILE_REDIRECT, code, code_verifier: p.verifier, device: DEVICE };
  assert.equal((await call('POST', '/v1/mobile/auth/token', { body: { ...body, device: undefined } })).json.error, 'invalid_request');
  assert.equal((await call('POST', '/v1/mobile/auth/token', { body: { ...body, grant_type: 'password' } })).json.error, 'unsupported_grant_type');
  const wrong = await call('POST', '/v1/mobile/auth/token', { body: { ...body, code_verifier: pkce().verifier } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, 'invalid_grant');
  assert.equal((await call('POST', '/v1/mobile/auth/token', { body })).json.error, 'invalid_grant', 'a code is spent by the first attempt');
});

test('phone: authorize errors (unknown client or redirect = page; Apple = provider_not_configured; plain PKCE refused)', async () => {
  const p = pkce();
  const page = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-web', redirect: MOBILE_REDIRECT, challenge: p.challenge, state: clientState() }), { redirect: 'manual' });
  assert.equal(page.status, 400);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const bad = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: 'https://evil.example/cb', challenge: p.challenge, state: clientState() }), { redirect: 'manual' });
  assert.equal(bad.status, 400, 'never redirected to an unknown address');
  const st = clientState();
  const apple = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: MOBILE_REDIRECT, provider: 'apple', challenge: p.challenge, state: st }), { redirect: 'manual' });
  assert.equal(apple.status, 302);
  const a = new URL(apple.headers.get('location'));
  assert.equal(a.searchParams.get('error'), 'provider_not_configured');
  assert.equal(a.searchParams.get('state'), st);
  const plain = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: MOBILE_REDIRECT, challenge: p.challenge, state: st, extra: { code_challenge_method: 'plain' } }), { redirect: 'manual' });
  assert.equal(new URL(plain.headers.get('location')).searchParams.get('error'), 'invalid_request');
});

test('phone: email code sign-in (challengeId), wrong and used codes, and the phone limit', async () => {
  process.env.MOBILE_PHONES_ALLOWED = '2';
  const start = await call('POST', '/v1/mobile/auth/email/start', { body: { email: 'Mia@Example.com', device: DEVICE } });
  assert.equal(start.status, 200, start.text);
  assert.match(start.json.challengeId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof start.json.expiresAt, 'number');
  assert.ok(start.json.resendAfterSec > 0);
  assert.equal((await call('POST', '/v1/mobile/auth/email/start', { body: { email: 'mia@example.com', device: DEVICE } })).status, 429, 'resend throttle');
  const code = mail.codeFor('mia@example.com');
  assert.match(code, /^\d{6}$/);
  const wrong = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: start.json.challengeId, code: code === '000000' ? '111111' : '000000', device: DEVICE } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, 'invalid_code');
  const ok = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: start.json.challengeId, code, device: { ...DEVICE, id: 'install-aaaaaaaaaaaaaaaa' } } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.account.email.toLowerCase(), 'mia@example.com');
  const again = await call('POST', '/v1/mobile/auth/email/verify', { body: { challengeId: start.json.challengeId, code, device: DEVICE } });
  assert.equal(again.json.error, 'code_expired', 'a code works once');
  const customerId = ok.json.account.id;
  assert.ok((await db.identity.findFirst({ where: { customerId, provider: 'email' } })), 'email is a sign-in method');

  // Same email, other provider: the same customer. Second phone: allowed (limit 2). Third: phone_limit.
  const g = await phoneGoogle({ sub: '999111', email: 'mia@example.com' }, { device: { ...DEVICE, model: 'Galaxy', id: 'install-bbbbbbbbbbbbbbbb' } });
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.account.id, customerId);
  const third = await phoneGoogle({ sub: '999111', email: 'mia@example.com' }, { device: { ...DEVICE, model: 'Third', id: 'install-cccccccccccccccc' } });
  assert.equal(third.status, 403);
  assert.equal(third.json.error, 'phone_limit');
  // The same phone signing in again replaces its old session instead of taking a slot.
  const same = await phoneGoogle({ sub: '999111', email: 'mia@example.com' }, { device: { ...DEVICE, model: 'Galaxy', id: 'install-bbbbbbbbbbbbbbbb' } });
  assert.equal(same.status, 200, same.text);
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(g.json.token) })).status, 401, 'the replaced session ended');

  // Sign out all phones.
  const all = await call('POST', '/v1/mobile/auth/sign-out-all', { headers: bearer(same.json.token) });
  assert.equal(all.status, 200);
  assert.equal(all.json.revoked, 2);
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(ok.json.token) })).status, 401);
  delete process.env.MOBILE_PHONES_ALLOWED;
});

test('phone: the relay entitlement is an Ed25519 token the relay format accepts; Free accounts get type free', async () => {
  const r = await phoneGoogle({ sub: '424242', email: 'ent@example.com' });
  assert.equal((await call('POST', '/v1/mobile/entitlement', { headers: bearer(r.json.token), body: {} })).json.error, 'entitlement_unavailable');
  const kp = crypto.generateKeyPairSync('ed25519');
  process.env.RELAY_ENTITLEMENT_SIGNING_KEY = kp.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const pub = kp.publicKey.export({ format: 'jwk' }).x; // what the relay gets as RELAY_ENTITLEMENT_PUBKEY
  // No plan, no trial: the Free plan (phone view + approve) gets a free token, unless switched off.
  const free = await call('POST', '/v1/mobile/entitlement', { headers: bearer(r.json.token), body: {} });
  assert.equal(free.status, 200, free.text);
  assert.equal(free.json.payload.type, 'free');
  assert.equal(free.json.payload.tier, 'free');
  assert.ok(free.json.exp * 1000 <= Date.now() + 7 * 86400000 + 1000);
  process.env.MOBILE_ENTITLEMENT_FREE = '0';
  assert.equal((await call('POST', '/v1/mobile/entitlement', { headers: bearer(r.json.token), body: {} })).json.error, 'no_entitlement');
  delete process.env.MOBILE_ENTITLEMENT_FREE;
  const until = new Date(Date.now() + 30 * 86400000);
  await db.customer.update({ where: { id: r.json.account.id }, data: { status: 'paid', tier: 'enterprise', paidUntil: until } });
  const e = await call('POST', '/v1/mobile/entitlement', { headers: bearer(r.json.token), body: { mailbox: 'mbx_12345678' } });
  assert.equal(e.status, 200, e.text);
  const [body, sig] = e.json.token.split('.');
  // Exactly the relay's check (relay/src/entitlement.ts): Ed25519 over the UTF-8 of the first part.
  const pubKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub }, format: 'jwk' });
  assert.ok(crypto.verify(null, Buffer.from(body, 'utf8'), pubKey, Buffer.from(sig, 'base64url')));
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  assert.equal(payload.customer, r.json.account.id);
  assert.equal(payload.tier, 'enterprise');
  assert.equal(payload.type, 'paid');
  assert.equal(payload.mailbox, 'mbx_12345678');
  assert.ok(payload.exp * 1000 > Date.now() && payload.exp * 1000 <= Date.now() + 7 * 86400000 + 1000, 'at most the 7-day offline grace');
  assert.equal(typeof payload.phonesAllowed, 'number');
  delete process.env.RELAY_ENTITLEMENT_SIGNING_KEY;
});

test('desktop: the account session of the app also gets a relay entitlement (the PC companion sends it); web tokens do not', async () => {
  const kp = crypto.generateKeyPairSync('ed25519');
  process.env.RELAY_ENTITLEMENT_SIGNING_KEY = kp.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const inst = await H.newInstall(T, 'relay-ent');
  assert.equal((await H.verify(T, inst, 'pcent@example.com')).status, 200);
  const install = await db.install.findUnique({ where: { id: inst.installId } });
  const token = b64url(crypto.randomBytes(32));
  const ended = b64url(crypto.randomBytes(32));
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const sess = { tenantId: T, customerId: install.customerId, installId: inst.installId, provider: 'google', emailKey: 'pcent@example.com', kind: 'desktop' };
  await db.authSession.create({ data: { ...sess, tokenHash: sha(token), expiresAt: new Date(Date.now() + 86400000) } });
  await db.authSession.create({ data: { ...sess, tokenHash: sha(ended), expiresAt: new Date(Date.now() - 1000) } });
  const e = await call('POST', '/v1/mobile/entitlement', { headers: bearer(token), body: { mailbox: 'pcmailbox_1234' } });
  assert.equal(e.status, 200, e.text);
  assert.equal(e.json.payload.mailbox, 'pcmailbox_1234');
  assert.equal(e.json.payload.customer, install.customerId);
  assert.equal((await call('POST', '/v1/mobile/entitlement', { headers: bearer(ended), body: {} })).status, 401);
  const w = await webGoogle({ sub: '7171', email: 'webent@example.com' });
  assert.equal((await call('POST', '/v1/mobile/entitlement', { headers: bearer(w.json.access_token), body: {} })).status, 401);
  delete process.env.RELAY_ENTITLEMENT_SIGNING_KEY;
});

// --- Web ---

test('web: Google sign-in, CORS only for WEB_APP_ORIGINS, 15-minute access token, rotating refresh with reuse detection', async () => {
  const r = await webGoogle({ sub: '31337', email: 'web@example.com', name: 'Wendy Web' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('access-control-allow-origin'), WEB_ORIGIN);
  assert.equal(r.json.token_type, 'Bearer');
  assert.ok(r.json.expires_in > 800 && r.json.expires_in <= 900);
  assert.match(r.json.refresh_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.json.account.email, 'web@example.com');

  const pre = await fetch(`${base}/v1/account/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.test', 'access-control-request-method': 'GET' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null, 'no CORS for another origin');
  const pre2 = await fetch(`${base}/v1/account/me`, { method: 'OPTIONS', headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' } });
  assert.equal(pre2.status, 204);
  assert.equal(pre2.headers.get('access-control-allow-origin'), WEB_ORIGIN);
  assert.match(pre2.headers.get('access-control-allow-headers'), /Authorization/);

  const me = await call('GET', '/v1/account/me', { headers: { ...bearer(r.json.access_token), origin: WEB_ORIGIN } });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.account.name, 'Wendy Web');
  assert.ok(me.json.methods.some((m) => m.provider === 'google'));

  const ref = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web', refresh_token: r.json.refresh_token } });
  assert.equal(ref.status, 200, ref.text);
  assert.notEqual(ref.json.refresh_token, r.json.refresh_token);
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(r.json.access_token) })).status, 401, 'the old access token ended');
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(ref.json.access_token) })).status, 200);
  // Reusing the rotated-away refresh token ends the whole session.
  const replay = await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web', refresh_token: r.json.refresh_token } });
  assert.equal(replay.json.error, 'invalid_grant');
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(ref.json.access_token) })).status, 401);
  assert.equal((await call('POST', '/v1/web/auth/token', { body: { grant_type: 'refresh_token', client_id: 'softglaze-web', refresh_token: ref.json.refresh_token } })).json.error, 'invalid_grant');
});

test('web: an expired access token is refused; a web token is never a desktop session', async () => {
  const r = await webGoogle({ sub: '600', email: 'exp@example.com' });
  const row = await db.authSession.findFirst({ where: { kind: 'web', emailKey: 'exp@example.com' } });
  await db.authSession.update({ where: { id: row.id }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(r.json.access_token) })).status, 401);
  const inst = await H.newInstall(T, 'cross');
  assert.equal((await call('POST', '/auth/me', { body: { tenantId: T, ...inst, session: r.json.access_token } })).status, 401);
});

test('account API: sessions list, revoke one, delete request to support, licence summary, sign out everywhere', async () => {
  const w = await webGoogle({ sub: '7001', email: 'acct@example.com' });
  const ph = await phoneGoogle({ sub: '7001', email: 'acct@example.com' });
  const h = bearer(w.json.access_token);
  const list = await call('GET', '/v1/account/sessions', { headers: h });
  assert.equal(list.status, 200);
  assert.equal(list.json.sessions.length, 2);
  const cur = list.json.sessions.find((s) => s.current);
  assert.equal(cur.kind, 'web');
  const phone = list.json.sessions.find((s) => s.kind === 'mobile');
  assert.equal(phone.device.model, 'Pixel 9');
  assert.ok(!JSON.stringify(list.json).includes('Hash'), 'no hashes leave the server');

  assert.equal((await call('POST', '/v1/account/sessions/nope/revoke', { headers: h })).status, 404);
  const other = await webGoogle({ sub: '7002', email: 'someone-else@example.com' });
  const otherRow = await db.authSession.findFirst({ where: { emailKey: 'someone-else@example.com' } });
  assert.equal((await call('POST', `/v1/account/sessions/${otherRow.id}/revoke`, { headers: h })).status, 404, 'not another account\'s session');
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(other.json.access_token) })).status, 200);
  const rv = await call('POST', `/v1/account/sessions/${phone.id}/revoke`, { headers: h });
  assert.equal(rv.json.revoked, true);
  assert.equal((await call('GET', '/v1/account/me', { headers: bearer(ph.json.token) })).status, 401);

  const del = await call('POST', '/v1/account/delete-request', { headers: h, body: { reason: 'Not using it <b>anymore</b>' } });
  assert.equal(del.status, 202);
  const row = await db.emailOutbox.findFirst({ where: { dedupeKey: { startsWith: 'delete-request:' } } });
  assert.equal(row.toEmail, 'support@softglaze.com');
  assert.match(row.text, /acct@example\.com/);
  assert.ok(!row.html.includes('<b>anymore'), 'the reason is escaped in the HTML');
  assert.equal((await call('POST', '/v1/account/delete-request', { headers: h, body: {} })).json.alreadyRequestedToday, true);

  const lic = await call('GET', '/v1/account/licence', { headers: h });
  assert.equal(lic.status, 200);
  assert.equal(lic.json.tier, 'trial');
  assert.ok(Array.isArray(lic.json.licences));

  const all = await call('POST', '/v1/account/sign-out-all', { headers: h });
  assert.equal(all.status, 200);
  assert.equal((await call('GET', '/v1/account/me', { headers: h })).status, 401);
});

test('retention removes phone and web sessions that ended over 30 days ago, with their phones; desktop rows stay', async () => {
  const ph = await phoneGoogle({ sub: '8080', email: 'old@example.com' });
  const row = await db.authSession.findFirst({ where: { kind: 'mobile', emailKey: 'old@example.com' } });
  await db.authSession.update({ where: { id: row.id }, data: { revokedAt: new Date(Date.now() - 31 * 86400000) } });
  const desktopBefore = await db.authSession.count({ where: { kind: 'desktop' } });
  const settings = await getSettings(db, T);
  const tenant = await db.tenant.findUnique({ where: { id: T } });
  await applyRetention(db, tenant, { settings });
  assert.equal(await db.authSession.findUnique({ where: { id: row.id } }), null);
  assert.equal(await db.mobileDevice.findFirst({ where: { authSessionId: row.id } }), null);
  assert.equal(await db.authSession.count({ where: { kind: 'desktop' } }), desktopBefore);
  assert.ok(ph.json.token);
});

test('the phone and web endpoints answer 503 when the account tenant cannot be decided', async () => {
  process.env.ACCOUNT_TENANT_ID = 'no-such-tenant';
  const r = await call('POST', '/v1/mobile/auth/email/start', { body: { email: 'x@example.com', device: DEVICE } });
  assert.equal(r.status, 503);
  process.env.ACCOUNT_TENANT_ID = T;
  assert.equal((await call('POST', '/v1/web/auth/email/start', { body: { email: 'tenant-ok@example.com' } })).status, 200);
  delete process.env.ACCOUNT_TENANT_ID;
  assert.ok(github.id);
});

test('account plan fields: free, trial, monthly Pro, Pro Lifetime (plan key and 50-year term), ended Pro on phone, web, /me and /licence', async () => {
  const DAYMS = 86400000;
  const now = Date.now();
  const r = await phoneGoogle({ sub: '515151', email: 'plans@example.com' });
  const id = r.json.account.id;
  const h = bearer(r.json.token);
  const me = async () => (await call('GET', '/v1/account/me', { headers: h })).json.account;
  const lic = async () => (await call('GET', '/v1/account/licence', { headers: h })).json;

  // Trial: plan trial, planEndsAt = the trial end; tier stays 'trial' for older apps.
  const trialEnd = new Date(now + 5 * DAYMS);
  await db.customer.update({ where: { id }, data: { status: 'trial', tier: 'enterprise', trialEndsAt: trialEnd } });
  let a = await me();
  assert.deepEqual([a.tier, a.plan, a.lifetime], ['trial', 'trial', false]);
  assert.equal(new Date(a.planEndsAt).getTime(), trialEnd.getTime());
  // A trial row whose end passed (before the next recompute) is Free.
  await db.customer.update({ where: { id }, data: { trialEndsAt: new Date(now - DAYMS) } });
  assert.equal((await me()).plan, 'free');

  // Monthly Pro: planEndsAt = the licence end.
  const monthEnd = new Date(now + 30 * DAYMS);
  const l1 = await db.license.create({ data: { tenantId: T, customerId: id, tier: 'pro', plan: 'pro', status: 'active', currentPeriodEnd: monthEnd } });
  await db.customer.update({ where: { id }, data: { status: 'paid', tier: 'pro', paidUntil: monthEnd } });
  a = await me();
  assert.deepEqual([a.tier, a.plan, a.lifetime], ['pro', 'pro', false]);
  assert.equal(new Date(a.planEndsAt).getTime(), monthEnd.getTime());
  let L = await lic();
  assert.deepEqual([L.plan, L.lifetime, L.free], ['pro', false, false]);
  assert.equal(new Date(L.planEndsAt).getTime(), monthEnd.getTime());

  // Pro Lifetime by plan key (an end under 50 years): lifetime, no planEndsAt.
  await db.plan.create({ data: { tenantId: T, key: 'pro-lifetime', name: 'Pro Lifetime', tier: 'pro', amount: 10000, currency: 'USD', interval: 'once', months: 1200, sortOrder: 9 } });
  await db.license.update({ where: { id: l1.id }, data: { plan: 'pro-lifetime' } });
  a = await me();
  assert.deepEqual([a.plan, a.lifetime, a.planEndsAt], ['pro', true, null]);

  // Pro Lifetime by term (a redeemed lifetime code: no plan key, ends ~2126), on the phone refresh and the web body too.
  const far = new Date(now + 36500 * DAYMS);
  await db.license.update({ where: { id: l1.id }, data: { plan: null, currentPeriodEnd: far } });
  await db.customer.update({ where: { id }, data: { paidUntil: far } });
  const ref = await call('POST', '/v1/mobile/auth/refresh', { headers: h });
  assert.equal(ref.status, 200, ref.text);
  assert.deepEqual([ref.json.account.tier, ref.json.account.plan, ref.json.account.lifetime, ref.json.account.planEndsAt], ['pro', 'pro', true, null]);
  const w = await webGoogle({ sub: '515151', email: 'plans@example.com' });
  assert.deepEqual([w.json.account.plan, w.json.account.lifetime, w.json.account.planEndsAt], ['pro', true, null]);
  L = await (await call('GET', '/v1/account/licence', { headers: bearer(ref.json.token) })).json;
  assert.deepEqual([L.plan, L.lifetime, L.planEndsAt], ['pro', true, null]);

  // A refunded (canceled) lifetime licence never counts as lifetime: the active monthly Enterprise decides.
  await db.license.update({ where: { id: l1.id }, data: { status: 'canceled' } });
  const entEnd = new Date(now + 20 * DAYMS);
  await db.license.create({ data: { tenantId: T, customerId: id, tier: 'enterprise', plan: 'enterprise', status: 'active', currentPeriodEnd: entEnd } });
  await db.customer.update({ where: { id }, data: { tier: 'enterprise' } });
  const wme = await call('GET', '/v1/account/me', { headers: bearer(w.json.access_token) });
  assert.deepEqual([wme.json.account.plan, wme.json.account.lifetime], ['enterprise', false]);
  assert.equal(new Date(wme.json.account.planEndsAt).getTime(), entEnd.getTime());

  // The paid term ended but the row still says paid / enterprise (no recompute yet): Free, tier back to 'trial'.
  await db.license.updateMany({ where: { customerId: id }, data: { currentPeriodEnd: new Date(now - 10 * DAYMS) } });
  await db.customer.update({ where: { id }, data: { paidUntil: new Date(now - 10 * DAYMS) } });
  const ref2 = await call('POST', '/v1/mobile/auth/refresh', { headers: bearer(ref.json.token) });
  assert.deepEqual([ref2.json.account.tier, ref2.json.account.plan, ref2.json.account.lifetime, ref2.json.account.planEndsAt], ['trial', 'free', false, null]);
});
