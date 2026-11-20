'use strict';
// "Continue with Facebook" (desktop, phone, web) and Meta's Data Deletion Request Callback, over HTTP against the
// real routes. Facebook is replaced by a fake that checks what Facebook checks (app id + secret, redirect URI,
// PKCE verifier) and requires a correct appsecret_proof on /me.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers/harness');
const facebook = require('../src/auth/providers/facebook');
const { EMAIL_MISSING_MESSAGE } = require('../src/auth/accounts');
const { readCode } = require('../src/auth/facebookDeletion');

const { db, call } = H;
let T;
let base;

const APP_ID = '1234567890123';
const APP_SECRET = 'fb-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64url');
function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
const clientState = () => crypto.randomBytes(8).toString('hex').slice(0, 10);

// --- The fake Facebook ---
const fb = { codes: new Map(), tokens: new Map(), tokenCalls: [], meCalls: [] };
function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), async json() { return body; } };
}
const graphErr = (status, message, code) => fakeResponse(status, { error: { message, type: 'OAuthException', code } });
facebook.setFetchForTests(async (url, init = {}) => {
  const u = new URL(url);
  const path = u.origin + u.pathname;
  const p = u.searchParams;
  if (path === `${facebook.graphBase()}/oauth/access_token`) {
    fb.tokenCalls.push(Object.fromEntries(p));
    if (p.get('client_id') !== APP_ID || p.get('client_secret') !== APP_SECRET) return graphErr(400, 'bad client', 1);
    if (p.get('redirect_uri') !== 'https://api.test/auth/callback/facebook') return graphErr(400, 'redirect_uri', 100);
    const entry = fb.codes.get(p.get('code'));
    if (!entry) return graphErr(400, 'code', 100);
    if (crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== entry.challenge) return graphErr(400, 'code_verifier', 100);
    fb.codes.delete(p.get('code'));
    const token = `EAA${crypto.randomBytes(12).toString('hex')}`;
    fb.tokens.set(token, entry.user);
    return fakeResponse(200, { access_token: token, token_type: 'bearer', expires_in: 5183944 });
  }
  if (path === `${facebook.graphBase()}/me`) {
    fb.meCalls.push(Object.fromEntries(p));
    const token = String((init.headers && init.headers.authorization) || '').replace(/^Bearer /, '');
    const user = fb.tokens.get(token);
    if (!user) return graphErr(400, 'token', 190);
    if (p.get('appsecret_proof') !== crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex')) return graphErr(400, 'appsecret_proof', 100);
    const out = { id: user.id, name: user.name, picture: { data: { url: 'https://example.invalid/p.jpg' } } };
    if (user.email) out.email = user.email;
    return fakeResponse(200, out);
  }
  return fakeResponse(404, {});
});

// The browser part after a 302 to Facebook: Facebook (fake) and our callback. -> { callback, authorize }.
async function facebookLeg(startRes, user) {
  assert.equal(startRes.status, 302, startRes.headers.get('location') || String(startRes.status));
  const loc = new URL(startRes.headers.get('location'));
  const setCookie = startRes.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  const code = `AQ${crypto.randomBytes(8).toString('hex')}`;
  fb.codes.set(code, { challenge: loc.searchParams.get('code_challenge'), user });
  const cb = await fetch(`${base}/auth/callback/facebook?code=${encodeURIComponent(code)}&state=${encodeURIComponent(loc.searchParams.get('state'))}#_=_`, {
    redirect: 'manual', headers: setCookie ? { cookie: setCookie.split(';')[0] } : {}
  });
  return { callback: cb, authorize: loc };
}

async function desktopStart(extra = {}) {
  const p = pkce();
  const q = new URLSearchParams({ provider: 'facebook', tenant: T, app_redirect: 'http://127.0.0.1:53111/auth', code_challenge: p.challenge, code_challenge_method: 'S256', state: b64url(crypto.randomBytes(24)), ...extra });
  return { p, res: await fetch(`${base}/auth/start?${q}`, { redirect: 'manual' }) };
}

const DEVICE = { platform: 'android', model: 'Pixel 9', appVersion: '1.0.0' };
const MOBILE_REDIRECT = 'softglaze-mobile://auth';
const WEB_ORIGIN = 'https://app.test';
const WEB_REDIRECT = `${WEB_ORIGIN}/auth/callback`;

function clientAuthorizeUrl(path, { client, redirect, challenge, state, extra = {} }) {
  const q = new URLSearchParams({
    client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'mobile', state, code_challenge: challenge,
    code_challenge_method: 'S256', provider: 'facebook', ...extra
  });
  return `${base}${path}?${q}`;
}

// A phone sign-in with Facebook -> { back (the redirect URL), token (the /token answer or null) }.
async function phoneFacebook(user, extra = {}) {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/mobile/auth/authorize', { client: 'softglaze-mobile', redirect: MOBILE_REDIRECT, challenge: p.challenge, state: st, extra }), { redirect: 'manual' });
  const { callback, authorize } = await facebookLeg(s, user);
  assert.equal(callback.status, 302);
  const back = new URL(callback.headers.get('location'));
  assert.equal(back.searchParams.get('state'), st);
  const code = back.searchParams.get('code');
  if (!code) return { back, authorize, token: null };
  const token = await call('POST', '/v1/mobile/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-mobile', redirect_uri: MOBILE_REDIRECT, code, code_verifier: p.verifier, device: DEVICE }
  });
  return { back, authorize, token };
}

async function webFacebook(user) {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const { callback } = await facebookLeg(s, user);
  const back = new URL(callback.headers.get('location'));
  assert.equal(back.origin + back.pathname, WEB_REDIRECT);
  const code = back.searchParams.get('code');
  if (!code) return { back, token: null };
  const token = await call('POST', '/v1/web/auth/token', {
    body: { grant_type: 'authorization_code', client_id: 'softglaze-web', redirect_uri: WEB_REDIRECT, code, code_verifier: p.verifier },
    headers: { origin: WEB_ORIGIN }
  });
  return { back, token };
}

// Meta's signed_request: <base64url HMAC-SHA256(payload, secret)>.<base64url JSON payload>.
function signedRequest(payload, secret = APP_SECRET) {
  const enc = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  return `${sig}.${enc}`;
}

test.before(async () => {
  base = await H.start();
  T = (await H.seedTenant()).id;
  process.env.FACEBOOK_APP_ID = APP_ID;
  process.env.FACEBOOK_APP_SECRET = APP_SECRET;
  process.env.WEB_APP_ORIGINS = WEB_ORIGIN;
});
test.after(() => H.stop());

test('providers: Facebook is listed (between Google and GitHub) only when both of its keys are set', async () => {
  assert.deepEqual((await call('GET', `/auth/providers?tenantId=${T}`)).json, { providers: ['facebook'], email: true });
  assert.deepEqual((await call('GET', '/v1/mobile/auth/providers')).json.providers, ['facebook']);
  delete process.env.FACEBOOK_APP_SECRET;
  assert.deepEqual((await call('GET', '/v1/web/auth/providers')).json.providers, []);
  const { res } = await desktopStart();
  assert.equal(res.status, 503, 'the start page says the sign-in is not available');
  process.env.FACEBOOK_APP_SECRET = APP_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'g'; process.env.GOOGLE_CLIENT_SECRET = 's';
  process.env.GITHUB_CLIENT_ID = 'h'; process.env.GITHUB_CLIENT_SECRET = 's';
  assert.deepEqual((await call('GET', '/v1/web/auth/providers')).json.providers, ['google', 'facebook', 'github']);
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) delete process.env[k];
});

test('the dialog URL: v27.0, our redirect, state, code, email+public_profile, PKCE S256; auth_type=rerequest only when asked', async () => {
  const { res } = await desktopStart();
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.facebook.com/v27.0/dialog/oauth');
  assert.equal(loc.searchParams.get('client_id'), APP_ID);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://api.test/auth/callback/facebook');
  assert.equal(loc.searchParams.get('response_type'), 'code');
  assert.equal(loc.searchParams.get('scope'), 'email,public_profile');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.match(loc.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(loc.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(loc.searchParams.get('auth_type'), null);
  assert.equal(loc.searchParams.get('client_secret'), null);
  const again = new URL((await desktopStart({ auth_type: 'rerequest' })).res.headers.get('location'));
  assert.equal(again.searchParams.get('auth_type'), 'rerequest');
  process.env.FACEBOOK_GRAPH_VERSION = 'v28.0';
  assert.match((await desktopStart()).res.headers.get('location'), /^https:\/\/www\.facebook\.com\/v28\.0\/dialog\/oauth\?/);
  process.env.FACEBOOK_GRAPH_VERSION = 'not-a-version';
  assert.match((await desktopStart()).res.headers.get('location'), /\/v27\.0\/dialog\/oauth\?/);
  delete process.env.FACEBOOK_GRAPH_VERSION;
});

test('desktop: Continue with Facebook links to the customer who verified the same email (token call has secret + verifier, /me has appsecret_proof)', async () => {
  const inst = await H.newInstall(T, 'fb-desk');
  assert.equal((await H.verify(T, inst, 'ada@example.com')).status, 200);
  const before = await db.customer.findFirst({ where: { tenantId: T, emailKey: 'ada@example.com' } });
  const { p, res } = await desktopStart();
  const { callback } = await facebookLeg(res, { id: '10161234567890', email: 'Ada@Example.com', name: 'Ada Lovelace' });
  assert.equal(callback.status, 302);
  const back = new URL(callback.headers.get('location'));
  assert.ok(back.searchParams.get('code'), back.href);
  const last = fb.tokenCalls[fb.tokenCalls.length - 1];
  assert.ok(last.code_verifier && last.client_secret === APP_SECRET);
  assert.equal(fb.meCalls[fb.meCalls.length - 1].fields, 'id,name,email,picture');
  const r = await call('POST', '/auth/exchange', { body: { tenantId: T, ...inst, code: back.searchParams.get('code'), codeVerifier: p.verifier } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.provider, 'facebook');
  assert.equal(r.json.customer.id, before.id);
  assert.equal(r.json.linked, 'email');
  assert.ok(r.json.methods.some((m) => m.provider === 'facebook' && m.email.toLowerCase() === 'ada@example.com'));
  const identity = await db.identity.findFirst({ where: { provider: 'facebook', providerUserId: '10161234567890' } });
  assert.equal(identity.customerId, before.id);
});

test('no email and no link: email_missing, nothing is created; rerequest is offered; the desktop page explains it', async () => {
  const count = await db.customer.count({ where: { tenantId: T } });
  const { back, authorize, token } = await phoneFacebook({ id: '777000111', name: 'Phone Only' });
  assert.equal(token, null);
  assert.equal(back.searchParams.get('error'), 'email_missing');
  assert.equal(authorize.searchParams.get('auth_type'), null);
  assert.equal(await db.customer.count({ where: { tenantId: T } }), count);
  assert.equal(await db.identity.count({ where: { provider: 'facebook', providerUserId: '777000111' } }), 0);
  // The app asks again with auth_type=rerequest; this time the person allows the email.
  const again = await phoneFacebook({ id: '777000111', name: 'Phone Only', email: 'phone.only@example.com' }, { auth_type: 'rerequest' });
  assert.equal(again.authorize.searchParams.get('auth_type'), 'rerequest');
  assert.equal(again.token.status, 200, again.token.text);
  assert.equal(again.token.json.account.email, 'phone.only@example.com');
  // Web: the same refusal comes back to the web app's callback.
  const web = await webFacebook({ id: '777000222', name: 'No Mail' });
  assert.equal(web.back.searchParams.get('error'), 'email_missing');
  // Desktop protocol redirect gets the explaining page.
  const p = pkce();
  const q = new URLSearchParams({ provider: 'facebook', tenant: T, app_redirect: 'softglaze://auth', code_challenge: p.challenge, code_challenge_method: 'S256', state: b64url(crypto.randomBytes(24)) });
  const s = await fetch(`${base}/auth/start?${q}`, { redirect: 'manual' });
  const { callback } = await facebookLeg(s, { id: '777000333' });
  assert.equal(callback.status, 200);
  const html = await callback.text();
  assert.match(html, /didn(&#39;|')t share an email/);
  assert.match(html, /error=email_missing/);
  assert.match(EMAIL_MISSING_MESSAGE, /Use Google or email sign-in, or allow email access\./);
});

test('no email but already linked: signs in by the Facebook id, the stored email stays (phone and web)', async () => {
  const first = await phoneFacebook({ id: '888000111', email: 'linked@example.com', name: 'Linked' });
  assert.equal(first.token.status, 200, first.token.text);
  const customerId = first.token.json.account.id;
  // Later the person removed the email permission on Facebook.
  const phone = await phoneFacebook({ id: '888000111', name: 'Linked' });
  assert.equal(phone.token.status, 200, phone.token.text);
  assert.equal(phone.token.json.account.id, customerId);
  assert.equal(phone.token.json.account.email, 'linked@example.com');
  const web = await webFacebook({ id: '888000111', name: 'Linked' });
  assert.equal(web.token.status, 200, web.token.text);
  assert.equal(web.token.json.account.id, customerId);
  const identity = await db.identity.findFirst({ where: { provider: 'facebook', providerUserId: '888000111' } });
  assert.equal(identity.email, 'linked@example.com');
  assert.equal(identity.emailVerified, true);
});

test('a refused code exchange (wrong PKCE verifier) or a cancelled dialog, never signed in', async () => {
  const p = pkce();
  const st = clientState();
  const s = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const loc = new URL(s.headers.get('location'));
  const setCookie = s.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  // Facebook registered a different challenge for this code: the verifier check fails at the token call.
  fb.codes.set('AQwrong', { challenge: 'x'.repeat(43), user: { id: '1', email: 'x@example.com' } });
  const cb = await fetch(`${base}/auth/callback/facebook?code=AQwrong&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie: setCookie.split(';')[0] } });
  assert.equal(new URL(cb.headers.get('location')).searchParams.get('error'), 'failed');
  // The person cancelled in Facebook's dialog.
  const s2 = await fetch(clientAuthorizeUrl('/v1/web/auth/authorize', { client: 'softglaze-web', redirect: WEB_REDIRECT, challenge: p.challenge, state: st }), { redirect: 'manual' });
  const loc2 = new URL(s2.headers.get('location'));
  const ck2 = s2.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  const cb2 = await fetch(`${base}/auth/callback/facebook?error=access_denied&error_code=200&error_reason=user_denied&state=${encodeURIComponent(loc2.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie: ck2.split(';')[0] } });
  assert.equal(new URL(cb2.headers.get('location')).searchParams.get('error'), 'access_denied');
});

test('signed_request: HMAC-SHA256 with the app secret, base64url, algorithm and user_id are all checked', () => {
  const good = { algorithm: 'HMAC-SHA256', issued_at: 1291836800, expires: 1291840400, user_id: '218471' };
  assert.equal(facebook.parseSignedRequest(signedRequest(good), APP_SECRET).user_id, '218471');
  // Standard base64 with padding (the PHP sample's tr() form) is accepted too.
  const enc = Buffer.from(JSON.stringify(good)).toString('base64');
  const sig = crypto.createHmac('sha256', APP_SECRET).update(enc).digest('base64');
  assert.equal(facebook.parseSignedRequest(`${sig}.${enc}`, APP_SECRET).user_id, '218471');
  assert.equal(facebook.parseSignedRequest(signedRequest(good, 'another-secret'), APP_SECRET), null);
  assert.equal(facebook.parseSignedRequest(signedRequest({ ...good, algorithm: 'none' }), APP_SECRET), null);
  assert.equal(facebook.parseSignedRequest(signedRequest({ ...good, user_id: '../x' }), APP_SECRET), null);
  const [s1, p1] = signedRequest(good).split('.');
  const tampered = b64url(JSON.stringify({ ...good, user_id: '999' }));
  assert.equal(facebook.parseSignedRequest(`${s1}.${tampered}`, APP_SECRET), null);
  assert.equal(facebook.parseSignedRequest(`${s1}${p1}`, APP_SECRET), null);
  assert.equal(facebook.parseSignedRequest('', APP_SECRET), null);
  assert.equal(facebook.parseSignedRequest(signedRequest(good), ''), null);
  assert.equal(facebook.appSecretProof('tok', 'sec'), crypto.createHmac('sha256', 'sec').update('tok').digest('hex'));
});

test('data deletion callback: unlinks the Facebook identity, ends its sessions, keeps the account; status page by code', async () => {
  const first = await phoneFacebook({ id: '999000111', email: 'deleteme@example.com', name: 'Delete Me' });
  assert.equal(first.token.status, 200, first.token.text);
  const customerId = first.token.json.account.id;
  const identity = await db.identity.findFirst({ where: { provider: 'facebook', providerUserId: '999000111' } });
  const live = await db.authSession.findFirst({ where: { identityId: identity.id } });
  assert.equal(live.revokedAt, null);

  // Wrong signature: refused, nothing removed.
  const bad = await call('POST', '/auth/facebook/data-deletion', {
    body: `signed_request=${encodeURIComponent(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '999000111' }, 'nope'))}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_signed_request');
  assert.ok(await db.identity.findFirst({ where: { provider: 'facebook', providerUserId: '999000111' } }));

  const r = await call('POST', '/auth/facebook/data-deletion', {
    body: `signed_request=${encodeURIComponent(signedRequest({ algorithm: 'HMAC-SHA256', issued_at: Math.floor(Date.now() / 1000), user_id: '999000111' }))}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.confirmation_code, /^[0-9a-z]+$/);
  assert.equal(r.json.url, `https://api.test/auth/facebook/deletion-status?code=${r.json.confirmation_code}`);
  assert.equal(readCode(r.json.confirmation_code).removed, 1);
  assert.equal(await db.identity.count({ where: { provider: 'facebook', providerUserId: '999000111' } }), 0);
  assert.ok((await db.authSession.findUnique({ where: { id: live.id } })).revokedAt, 'the session that used it is ended');
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  assert.ok(customer && !customer.deletedAt, 'the SoftGlaze account itself stays');
  assert.ok((await db.customerEvent.findMany({ where: { customerId } })).some((e) => e.type === 'facebook_data_deleted'));
  // The phone's old token no longer works.
  const me = await call('POST', '/v1/mobile/auth/refresh', { headers: { authorization: `Bearer ${first.token.json.token}` } });
  assert.equal(me.status, 401);

  // JSON body works too, and an unknown user still gets a confirmation (0 removed).
  const r2 = await call('POST', '/auth/facebook/data-deletion', { body: { signed_request: signedRequest({ algorithm: 'HMAC-SHA256', user_id: '42' }) } });
  assert.equal(r2.status, 200);
  assert.equal(readCode(r2.json.confirmation_code).removed, 0);

  const page = await fetch(r.json.url.replace('https://api.test', base));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Your Facebook data was deleted/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const forged = r.json.confirmation_code.slice(0, -1) + (r.json.confirmation_code.endsWith('0') ? '1' : '0');
  assert.equal((await fetch(`${base}/auth/facebook/deletion-status?code=${forged}`)).status, 404);
  assert.equal((await fetch(`${base}/auth/facebook/deletion-status?code=%3Cscript%3E`)).status, 404);

  delete process.env.FACEBOOK_APP_SECRET;
  const off = await call('POST', '/auth/facebook/data-deletion', { body: { signed_request: signedRequest({ algorithm: 'HMAC-SHA256', user_id: '42' }) } });
  assert.equal(off.status, 503);
  process.env.FACEBOOK_APP_SECRET = APP_SECRET;
});
