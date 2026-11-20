'use strict';
// "Continue with Microsoft" (identity platform v2.0, common authority) for desktop, phone and web over HTTP against
// the real routes. Microsoft is replaced by a fake that signs ID tokens with a test RSA key and checks what Microsoft
// checks (client secret, redirect URI, PKCE verifier).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers/harness');
const microsoft = require('../src/auth/providers/microsoft');

const { db, call } = H;
let T;
let base;

const CLIENT_ID = '11112222-3333-4444-5555-666677778888';
const SECRET = 'ms-test-secret';
const PERSONAL = '9188040d-6c67-4c5b-b112-36a304b66dad';
const WORK = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const b64url = (b) => Buffer.from(b).toString('base64url');
function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
const clientState = () => crypto.randomBytes(8).toString('hex').slice(0, 10);
const guid = () => crypto.randomUUID();

const { privateKey: mKey, publicKey: mPub } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'ms-kid-1';
function signJwt(claims, { kid = KID, key = mKey, alg = 'RS256' } = {}) {
  const h = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
function fakeResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), async json() { return body; } };
}
const ms = { codes: new Map(), tokenCalls: [] };
microsoft.setFetchForTests(async (url, init = {}) => {
  if (url === microsoft.JWKS_URL) return fakeResponse(200, { keys: [{ ...mPub.export({ format: 'jwk' }), kid: KID, use: 'sig' }] });
  if (url === microsoft.TOKEN_URL) {
    const p = new URLSearchParams(init.body);
    ms.tokenCalls.push(Object.fromEntries(p));
    if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== SECRET) return fakeResponse(401, { error: 'invalid_client' });
    if (p.get('redirect_uri') !== 'https://api.test/auth/callback/microsoft') return fakeResponse(400, { error: 'invalid_grant' });
    const entry = ms.codes.get(p.get('code'));
    if (!entry) return fakeResponse(400, { error: 'invalid_grant' });
    if (crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== entry.challenge) return fakeResponse(400, { error: 'invalid_grant' });
    ms.codes.delete(p.get('code'));
    return fakeResponse(200, { token_type: 'Bearer', access_token: 'eyJ0.x', id_token: entry.idToken(entry) });
  }
  return fakeResponse(404, {});
});

function claimsFor(user, nonce, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const tid = user.tid || PERSONAL;
  const c = { aud: CLIENT_ID, iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, oid: user.oid, sub: 'pairwise-sub', name: user.name || 'Member', nonce, iat: now, nbf: now, exp: now + 3600, ver: '2.0', ...extra };
  if (user.email) c.email = user.email;
  if (user.edov !== undefined) c.xms_edov = user.edov;
  return c;
}

async function microsoftLeg(startRes, user, { extra = {}, token = null } = {}) {
  assert.equal(startRes.status, 302, startRes.headers.get('location') || String(startRes.status));
  const loc = new URL(startRes.headers.get('location'));
  const setCookie = startRes.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  const code = `M.C5${crypto.randomBytes(8).toString('hex')}`;
  ms.codes.set(code, { challenge: loc.searchParams.get('code_challenge'), idToken: token || (() => signJwt(claimsFor(user, loc.searchParams.get('nonce'), extra))) });
  const cb = await fetch(`${base}/auth/callback/microsoft?code=${encodeURIComponent(code)}&state=${encodeURIComponent(loc.searchParams.get('state'))}`, {
    redirect: 'manual', headers: setCookie ? { cookie: setCookie.split(';')[0] } : {}
  });
  return { callback: cb, authorize: loc };
}

async function desktopStart() {
  const p = pkce();
  const q = new URLSearchParams({ provider: 'microsoft', tenant: T, app_redirect: 'http://127.0.0.1:53111/auth', code_challenge: p.challenge, code_challenge_method: 'S256', state: b64url(crypto.randomBytes(24)) });
  return { p, res: await fetch(`${base}/auth/start?${q}`, { redirect: 'manual' }) };
}
async function desktopSignIn(inst, user) {
  const { p, res } = await desktopStart();
  const { callback } = await microsoftLeg(res, user);
  const back = new URL(callback.headers.get('location'));
  if (!back.searchParams.get('code')) return { error: back.searchParams.get('error') };
  return call('POST', '/auth/exchange', { body: { tenantId: T, ...inst, code: back.searchParams.get('code'), codeVerifier: p.verifier } });
}

const MOBILE_REDIRECT = 'softglaze-mobile://auth';
const WEB_ORIGIN = 'https://app.test';
const WEB_REDIRECT = `${WEB_ORIGIN}/auth/callback`;

test.before(async () => {
  base = await H.start();
  T = (await H.seedTenant()).id;
  process.env.MICROSOFT_CLIENT_ID = CLIENT_ID;
  process.env.MICROSOFT_CLIENT_SECRET = SECRET;
  process.env.WEB_APP_ORIGINS = WEB_ORIGIN;
});
test.after(() => H.stop());

test('providers: Microsoft is listed (second, after Google) only when both keys are set; the association file follows the client id', async () => {
  assert.deepEqual((await call('GET', `/auth/providers?tenantId=${T}`)).json.providers, ['microsoft']);
  const assoc = await call('GET', '/.well-known/microsoft-identity-association.json');
  assert.equal(assoc.status, 200);
  assert.deepEqual(assoc.json, { associatedApplications: [{ applicationId: CLIENT_ID }] });
  process.env.GOOGLE_CLIENT_ID = 'g'; process.env.GOOGLE_CLIENT_SECRET = 's';
  process.env.FACEBOOK_APP_ID = '1'; process.env.FACEBOOK_APP_SECRET = 's';
  process.env.LINKEDIN_CLIENT_ID = 'l'; process.env.LINKEDIN_CLIENT_SECRET = 's';
  process.env.GITHUB_CLIENT_ID = 'h'; process.env.GITHUB_CLIENT_SECRET = 's';
  assert.deepEqual((await call('GET', '/v1/web/auth/providers')).json.providers, ['google', 'microsoft', 'facebook', 'linkedin', 'github']);
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) delete process.env[k];
  delete process.env.MICROSOFT_CLIENT_SECRET;
  assert.deepEqual((await call('GET', '/v1/mobile/auth/providers')).json.providers, []);
  assert.equal((await desktopStart()).res.status, 503);
  process.env.MICROSOFT_CLIENT_SECRET = SECRET;
  process.env.MICROSOFT_CLIENT_ID = 'not-a-guid';
  assert.equal((await call('GET', '/.well-known/microsoft-identity-association.json')).status, 404);
  delete process.env.MICROSOFT_CLIENT_ID;
  assert.equal((await call('GET', '/.well-known/microsoft-identity-association.json')).status, 404);
  process.env.MICROSOFT_CLIENT_ID = CLIENT_ID;
});

test('the authorize URL: common v2.0 endpoint, redirect, openid profile email, state, nonce, PKCE S256, select_account', async () => {
  const loc = new URL((await desktopStart()).res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(loc.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://api.test/auth/callback/microsoft');
  assert.equal(loc.searchParams.get('response_type'), 'code');
  assert.equal(loc.searchParams.get('response_mode'), 'query');
  assert.equal(loc.searchParams.get('scope'), 'openid profile email');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.match(loc.searchParams.get('nonce'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(loc.searchParams.get('prompt'), 'select_account');
});

test('ID tokens: signature, aud, the tid-templated issuer, exp, nbf, iat, nonce and oid are checked', async () => {
  const nonce = 'browser-nonce';
  const good = claimsFor({ oid: guid(), tid: WORK, email: 'a@contoso.com' }, microsoft.oidcNonce(nonce));
  const v = (claims, opts) => microsoft.verifyIdToken(signJwt(claims, opts), { clientId: CLIENT_ID, nonce });
  assert.equal((await v(good)).tid, WORK);
  const bad = async (claims, why, opts) => assert.rejects(v(claims, opts), (e) => e.code === 'provider_error' && e.detail === `id_token_${why}`, why);
  await bad(good, 'signature', { key: otherKey });
  await bad(good, 'unknown_key', { kid: 'nope' });
  await bad(good, 'alg', { alg: 'none' });
  await bad({ ...good, aud: 'another-app' }, 'aud');
  await bad({ ...good, iss: 'https://login.microsoftonline.com/{tenantid}/v2.0' }, 'iss');
  await bad({ ...good, iss: `https://login.microsoftonline.com/${PERSONAL}/v2.0` }, 'iss', undefined); // issuer of another tenant
  await bad({ ...good, tid: 'common', iss: 'https://login.microsoftonline.com/common/v2.0' }, 'tid');
  await bad({ ...good, exp: Math.floor(Date.now() / 1000) - 900 }, 'expired');
  await bad({ ...good, nbf: Math.floor(Date.now() / 1000) + 3600 }, 'nbf');
  await bad({ ...good, nonce: microsoft.oidcNonce('other') }, 'nonce');
  await bad({ ...good, oid: 'x' }, 'oid');
  // The email rule.
  assert.equal(microsoft.emailTrusted({ tid: PERSONAL, email: 'p@outlook.com' }), true, 'personal Microsoft account');
  assert.equal(microsoft.emailTrusted({ tid: WORK, email: 'a@contoso.com', xms_edov: true }), true, 'domain owner verified');
  assert.equal(microsoft.emailTrusted({ tid: WORK, email: 'a@contoso.com' }), false, 'work account without xms_edov');
  assert.equal(microsoft.emailTrusted({ tid: WORK, email: 'a@contoso.com', xms_edov: false }), false);
  assert.equal(microsoft.emailTrusted({ tid: PERSONAL }), false, 'no email');
});

test('desktop: a personal account links to the customer with the same email; identity key = tid:oid', async () => {
  const inst = await H.newInstall(T, 'ms-desk');
  assert.equal((await H.verify(T, inst, 'pat@example.com')).status, 200);
  const before = await db.customer.findFirst({ where: { tenantId: T, emailKey: 'pat@example.com' } });
  const oid = guid();
  const r = await desktopSignIn(inst, { oid, tid: PERSONAL, email: 'pat@example.com', name: 'Pat' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.provider, 'microsoft');
  assert.equal(r.json.customer.id, before.id);
  assert.equal(r.json.linked, 'email');
  assert.ok(await db.identity.findFirst({ where: { provider: 'microsoft', providerUserId: `${PERSONAL}:${oid}` } }));
  const last = ms.tokenCalls[ms.tokenCalls.length - 1];
  assert.ok(last.code_verifier && last.client_secret === SECRET && last.grant_type === 'authorization_code');
});

test('work or school: an email without xms_edov never links to (or creates) an account; with xms_edov it does', async () => {
  const inst = await H.newInstall(T, 'ms-work');
  assert.equal((await H.verify(T, inst, 'ceo@contoso.com')).status, 200);
  const count = await db.customer.count({ where: { tenantId: T } });
  const attacker = guid();
  const r = await desktopSignIn(inst, { oid: attacker, tid: WORK, email: 'ceo@contoso.com' });
  assert.equal(r.error, 'email_not_verified');
  assert.equal(await db.identity.count({ where: { provider: 'microsoft', providerUserId: `${WORK}:${attacker}` } }), 0);
  const fresh = await desktopSignIn(inst, { oid: guid(), tid: WORK, email: 'new.person@contoso.com', edov: false });
  assert.equal(fresh.error, 'email_not_verified');
  assert.equal(await db.customer.count({ where: { tenantId: T } }), count, 'no account was created');
  const ok = await desktopSignIn(inst, { oid: guid(), tid: WORK, email: 'ceo@contoso.com', edov: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.linked, 'email');
});

test('phone and web: Microsoft sign-in; the same tid:oid is the same account; cancel = access_denied', async () => {
  const user = { oid: guid(), tid: PERSONAL, email: 'mobile.ms@example.com', name: 'Mobile' };
  const p = pkce();
  const st = clientState();
  const q = new URLSearchParams({ client_id: 'softglaze-mobile', redirect_uri: MOBILE_REDIRECT, response_type: 'code', scope: 'mobile', state: st, code_challenge: p.challenge, code_challenge_method: 'S256', provider: 'microsoft' });
  const s = await fetch(`${base}/v1/mobile/auth/authorize?${q}`, { redirect: 'manual' });
  const { callback } = await microsoftLeg(s, user);
  const back = new URL(callback.headers.get('location'));
  const tok = await call('POST', '/v1/mobile/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-mobile', redirect_uri: MOBILE_REDIRECT, code: back.searchParams.get('code'), code_verifier: p.verifier, device: { platform: 'android', model: 'Pixel', appVersion: '1.0.0' } }
  });
  assert.equal(tok.status, 200, tok.text);

  const p2 = pkce();
  const wq = new URLSearchParams({ client_id: 'softglaze-web', redirect_uri: WEB_REDIRECT, response_type: 'code', scope: 'web', state: st, code_challenge: p2.challenge, code_challenge_method: 'S256', provider: 'microsoft' });
  const w = await fetch(`${base}/v1/web/auth/authorize?${wq}`, { redirect: 'manual' });
  const wl = await microsoftLeg(w, user);
  const wb = new URL(wl.callback.headers.get('location'));
  const wt = await call('POST', '/v1/web/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-web', redirect_uri: WEB_REDIRECT, code: wb.searchParams.get('code'), code_verifier: p2.verifier },
    headers: { origin: WEB_ORIGIN }
  });
  assert.equal(wt.status, 200, wt.text);
  assert.equal(wt.json.account.id, tok.json.account.id);

  const c = await fetch(`${base}/v1/web/auth/authorize?${wq}`, { redirect: 'manual' });
  const loc = new URL(c.headers.get('location'));
  const ck = c.headers.getSetCookie().find((x) => x.startsWith('sg_auth_'));
  const cb = await fetch(`${base}/auth/callback/microsoft?error=access_denied&error_subcode=cancel&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie: ck.split(';')[0] } });
  assert.equal(new URL(cb.headers.get('location')).searchParams.get('error'), 'access_denied');
});
