'use strict';
// "Continue with LinkedIn" (Sign In with LinkedIn using OpenID Connect) for desktop, phone and web over HTTP against
// the real routes. LinkedIn is replaced by a fake that signs ID tokens with a test RSA key, serves userinfo, and
// checks what LinkedIn checks (client secret, redirect URI, PKCE verifier).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers/harness');
const linkedin = require('../src/auth/providers/linkedin');

const { db, call } = H;
let T;
let base;

const CLIENT_ID = '86testclientid';
const SECRET = 'WPL_AP1.test-secret';
const b64url = (b) => Buffer.from(b).toString('base64url');
function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
const clientState = () => crypto.randomBytes(8).toString('hex').slice(0, 10);

// --- The fake LinkedIn ---
const { privateKey: lKey, publicKey: lPub } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'd929668a-test';
function signJwt(claims, { kid = KID, key = lKey, alg = 'RS256' } = {}) {
  const h = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const s = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${s}`;
}
function fakeResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), async json() { return body; } };
}
const li = { codes: new Map(), tokens: new Map(), tokenCalls: [] };
linkedin.setFetchForTests(async (url, init = {}) => {
  if (url === linkedin.JWKS_URL) return fakeResponse(200, { keys: [{ ...lPub.export({ format: 'jwk' }), kid: KID }] });
  if (url === linkedin.TOKEN_URL) {
    const p = new URLSearchParams(init.body);
    li.tokenCalls.push(Object.fromEntries(p));
    if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== SECRET) return fakeResponse(401, { error: 'invalid_client' });
    if (p.get('redirect_uri') !== 'https://api.test/auth/callback/linkedin' || p.get('grant_type') !== 'authorization_code') return fakeResponse(400, { error: 'invalid_redirect_uri' });
    const entry = li.codes.get(p.get('code'));
    if (!entry) return fakeResponse(401, { error: 'invalid_request' });
    if (entry.challenge && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== entry.challenge) return fakeResponse(400, { error: 'invalid_redirect_uri' });
    li.codes.delete(p.get('code'));
    const access = `AQV${crypto.randomBytes(10).toString('hex')}`;
    li.tokens.set(access, entry);
    return fakeResponse(200, { access_token: access, expires_in: 5183999, scope: 'email,openid,profile', token_type: 'Bearer', id_token: entry.idToken(entry) });
  }
  if (url === linkedin.USERINFO_URL) {
    const entry = li.tokens.get(String(init.headers.authorization || '').replace(/^Bearer /, ''));
    if (!entry) return fakeResponse(401, { status: 401, serviceErrorCode: 65600, message: 'Invalid access token' });
    return fakeResponse(200, entry.userinfo);
  }
  return fakeResponse(404, {});
});

function claimsFor(user, nonce, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const c = { iss: 'https://www.linkedin.com/oauth', aud: CLIENT_ID, sub: user.sub, name: user.name || null, iat: now, exp: now + 3600, ...extra };
  if (user.email) { c.email = user.email; c.email_verified = user.email_verified !== false; }
  if (nonce) c.nonce = nonce;
  return c;
}

// The browser part after a 302 to LinkedIn. user: { sub, email?, email_verified?, name? }.
async function linkedinLeg(startRes, user, { extra = {}, echoNonce = true, token = null } = {}) {
  assert.equal(startRes.status, 302, startRes.headers.get('location') || String(startRes.status));
  const loc = new URL(startRes.headers.get('location'));
  const setCookie = startRes.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  const code = `AQT${crypto.randomBytes(8).toString('hex')}`;
  const userinfo = { sub: user.sub, name: user.name || 'Member', given_name: 'M', family_name: 'X', picture: 'https://media.example/p.jpg', locale: 'en-US' };
  if (user.email) { userinfo.email = user.email; userinfo.email_verified = user.email_verified !== false; }
  li.codes.set(code, {
    challenge: loc.searchParams.get('code_challenge'),
    userinfo,
    idToken: token || (() => signJwt(claimsFor(user, echoNonce ? loc.searchParams.get('nonce') : null, extra)))
  });
  const cb = await fetch(`${base}/auth/callback/linkedin?code=${encodeURIComponent(code)}&state=${encodeURIComponent(loc.searchParams.get('state'))}`, {
    redirect: 'manual', headers: setCookie ? { cookie: setCookie.split(';')[0] } : {}
  });
  return { callback: cb, authorize: loc };
}

async function desktopStart() {
  const p = pkce();
  const q = new URLSearchParams({ provider: 'linkedin', tenant: T, app_redirect: 'http://127.0.0.1:53111/auth', code_challenge: p.challenge, code_challenge_method: 'S256', state: b64url(crypto.randomBytes(24)) });
  return { p, res: await fetch(`${base}/auth/start?${q}`, { redirect: 'manual' }) };
}

const DEVICE = { platform: 'ios', model: 'iPhone 17', appVersion: '1.0.0' };
const MOBILE_REDIRECT = 'softglaze-mobile://auth';
const WEB_ORIGIN = 'https://app.test';
const WEB_REDIRECT = `${WEB_ORIGIN}/auth/callback`;
function clientAuthorizeUrl(path, { client, redirect, challenge, state }) {
  const q = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'mobile', state, code_challenge: challenge, code_challenge_method: 'S256', provider: 'linkedin' });
  return `${base}${path}?${q}`;
}

test.before(async () => {
  base = await H.start();
  T = (await H.seedTenant()).id;
  process.env.LINKEDIN_CLIENT_ID = CLIENT_ID;
  process.env.LINKEDIN_CLIENT_SECRET = SECRET;
  process.env.WEB_APP_ORIGINS = WEB_ORIGIN;
});
test.after(() => H.stop());

test('providers: LinkedIn is listed only when both keys are set, after Google, Microsoft and Facebook', async () => {
  assert.deepEqual((await call('GET', `/auth/providers?tenantId=${T}`)).json.providers, ['linkedin']);
  delete process.env.LINKEDIN_CLIENT_SECRET;
  assert.deepEqual((await call('GET', '/v1/mobile/auth/providers')).json.providers, []);
  assert.equal((await desktopStart()).res.status, 503);
  process.env.LINKEDIN_CLIENT_SECRET = SECRET;
  process.env.GOOGLE_CLIENT_ID = 'g'; process.env.GOOGLE_CLIENT_SECRET = 's';
  process.env.FACEBOOK_APP_ID = '1'; process.env.FACEBOOK_APP_SECRET = 's';
  process.env.MICROSOFT_CLIENT_ID = 'm'; process.env.MICROSOFT_CLIENT_SECRET = 's';
  process.env.GITHUB_CLIENT_ID = 'h'; process.env.GITHUB_CLIENT_SECRET = 's';
  assert.deepEqual((await call('GET', '/v1/web/auth/providers')).json.providers, ['google', 'microsoft', 'facebook', 'linkedin', 'github']);
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) delete process.env[k];
});

test('the authorization URL: LinkedIn endpoint, our redirect, openid profile email, state, nonce, PKCE (LINKEDIN_PKCE=off drops it)', async () => {
  const loc = new URL((await desktopStart()).res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(loc.searchParams.get('response_type'), 'code');
  assert.equal(loc.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://api.test/auth/callback/linkedin');
  assert.equal(loc.searchParams.get('scope'), 'openid profile email');
  assert.match(loc.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(loc.searchParams.get('nonce'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('client_secret'), null);
  process.env.LINKEDIN_PKCE = 'off';
  const off = new URL((await desktopStart()).res.headers.get('location'));
  assert.equal(off.searchParams.get('code_challenge'), null);
  delete process.env.LINKEDIN_PKCE;
});

test('ID tokens: signature, iss (both forms), aud, exp, iat, sub and the nonce (when LinkedIn echoes it) are checked', async () => {
  const nonce = 'browser-nonce';
  const good = claimsFor({ sub: 'abc123XYZ', email: 'l@example.com' }, linkedin.oidcNonce(nonce));
  const v = (claims, opts) => linkedin.verifyIdToken(signJwt(claims, opts), { clientId: CLIENT_ID, nonce });
  assert.equal((await v(good)).sub, 'abc123XYZ');
  assert.equal((await v({ ...good, iss: 'https://www.linkedin.com' })).sub, 'abc123XYZ');
  const { nonce: _n, ...noNonce } = good;
  assert.equal((await v(noNonce)).sub, 'abc123XYZ', 'LinkedIn does not always echo the nonce');
  const bad = async (claims, why, opts) => assert.rejects(v(claims, opts), (e) => e.code === 'provider_error' && e.detail === `id_token_${why}`, why);
  await bad(good, 'signature', { key: otherKey });
  await bad(good, 'unknown_key', { kid: 'nope' });
  await bad(good, 'alg', { alg: 'HS256' });
  await bad({ ...good, iss: 'https://accounts.google.com' }, 'iss');
  await bad({ ...good, aud: 'other-client' }, 'aud');
  await bad({ ...good, exp: Math.floor(Date.now() / 1000) - 600 }, 'expired');
  await bad({ ...good, iat: Math.floor(Date.now() / 1000) + 3600 }, 'iat');
  await bad({ ...good, nonce: linkedin.oidcNonce('another') }, 'nonce');
  await bad({ ...good, sub: '' }, 'sub');
});

test('desktop: links to the customer with the same VERIFIED email; secret + verifier on the token call', async () => {
  const inst = await H.newInstall(T, 'li-desk');
  assert.equal((await H.verify(T, inst, 'grace@example.com')).status, 200);
  const before = await db.customer.findFirst({ where: { tenantId: T, emailKey: 'grace@example.com' } });
  const { p, res } = await desktopStart();
  const { callback } = await linkedinLeg(res, { sub: 'grace-li-1', email: 'grace@example.com', name: 'Grace Hopper' });
  const back = new URL(callback.headers.get('location'));
  assert.ok(back.searchParams.get('code'), back.href);
  const last = li.tokenCalls[li.tokenCalls.length - 1];
  assert.ok(last.code_verifier && last.client_secret === SECRET);
  const r = await call('POST', '/auth/exchange', { body: { tenantId: T, ...inst, code: back.searchParams.get('code'), codeVerifier: p.verifier } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.provider, 'linkedin');
  assert.equal(r.json.customer.id, before.id);
  assert.equal(r.json.linked, 'email');
  assert.ok(r.json.methods.some((m) => m.provider === 'linkedin'));
});

test('an unverified or missing LinkedIn email is refused and never linked', async () => {
  const inst = await H.newInstall(T, 'li-unv');
  assert.equal((await H.verify(T, inst, 'victim@example.com')).status, 200);
  const { res } = await desktopStart();
  const { callback } = await linkedinLeg(res, { sub: 'attacker-1', email: 'victim@example.com', email_verified: false });
  assert.equal(new URL(callback.headers.get('location')).searchParams.get('error'), 'email_not_verified');
  assert.equal(await db.identity.count({ where: { provider: 'linkedin', providerUserId: 'attacker-1' } }), 0);
  const { res: res2 } = await desktopStart();
  const leg2 = await linkedinLeg(res2, { sub: 'no-mail-1' });
  assert.equal(new URL(leg2.callback.headers.get('location')).searchParams.get('error'), 'email_not_verified');
});

test('phone and web: LinkedIn sign-in; cancel codes come back as access_denied; a bad ID token fails', async () => {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: MOBILE_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const { callback } = await linkedinLeg(s, { sub: 'phone-li-1', email: 'phone.li@example.com', name: 'Phone Li' }, { echoNonce: false });
  const back = new URL(callback.headers.get('location'));
  const tok = await call('POST', '/v1/mobile/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-mobile', redirect_uri: MOBILE_REDIRECT, code: back.searchParams.get('code'), code_verifier: p.verifier, device: DEVICE }
  });
  assert.equal(tok.status, 200, tok.text);
  assert.equal(tok.json.account.email, 'phone.li@example.com');

  const p2 = pkce();
  const st2 = clientState();
  const w = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p2.challenge, state: st2 }), { redirect: 'manual' });
  const wl = await linkedinLeg(w, { sub: 'phone-li-1', email: 'phone.li@example.com' });
  const wb = new URL(wl.callback.headers.get('location'));
  const wt = await call('POST', '/v1/web/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-web', redirect_uri: WEB_REDIRECT, code: wb.searchParams.get('code'), code_verifier: p2.verifier },
    headers: { origin: WEB_ORIGIN }
  });
  assert.equal(wt.status, 200, wt.text);
  assert.equal(wt.json.account.id, tok.json.account.id, 'the same LinkedIn member is the same account');

  for (const error of ['user_cancelled_login', 'user_cancelled_authorize']) {
    const c = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p2.challenge, state: st2 }), { redirect: 'manual' });
    const loc = new URL(c.headers.get('location'));
    const ck = c.headers.getSetCookie().find((x) => x.startsWith('sg_auth_'));
    const cb = await fetch(`${base}/auth/callback/linkedin?error=${error}&error_description=x&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie: ck.split(';')[0] } });
    assert.equal(new URL(cb.headers.get('location')).searchParams.get('error'), 'access_denied', error);
  }

  const b = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p2.challenge, state: st2 }), { redirect: 'manual' });
  const forged = signJwt(claimsFor({ sub: 'x', email: 'x@example.com' }, null), { key: otherKey });
  const bl = await linkedinLeg(b, { sub: 'x', email: 'x@example.com' }, { token: () => forged });
  assert.equal(new URL(bl.callback.headers.get('location')).searchParams.get('error'), 'failed');
});
