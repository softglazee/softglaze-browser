'use strict';
// One-click sign-in for the desktop app (1.0.26). The provider leg runs in the person's own browser:
//
//   app  --opens-->  GET /auth/start?provider=github&tenant=..&app_redirect=softglaze://auth&code_challenge=..
//                    &code_challenge_method=S256&state=<app state>
//        server: checks everything, stores an AuthState (10 min), sets a nonce cookie on this browser,
//        redirects to the provider with ITS OWN state and PKCE challenge
//   provider --> GET /auth/callback/github?code=..&state=..
//        server: the state must be known, unused, unexpired, for this provider, and the browser must hold the
//        nonce cookie; it trades the code with the provider (client secret, PKCE verifier), keeps only a
//        verified primary email, and hands the app a one-time code (60 s) at its registered redirect
//   app  --> POST /auth/exchange { install, code, codeVerifier }
//        server: the code must be unused and unexpired, and the verifier must match the app's S256 challenge;
//        then the account is linked (src/auth/accounts.js) and a session token is returned.
//
// The phone app (client softglaze-mobile) and the web app (client softglaze-web) use the same browser leg
// through startClientSignIn: their redirect must be on THEIR allow-list (src/auth/tokens.js), the AuthState
// remembers the client, and the one-time code is traded at /v1/mobile/auth/token or /v1/web/auth/token
// (takeClientCode: same client, same redirect_uri, PKCE verifier).
//
// The provider-side PKCE verifier is derived from the server state with a MASTER_KEY sub-key, so it is never
// stored and nobody who only sees the state in a URL can compute it. Results are plain objects; the route
// turns them into responses (src/routes/auth.js).
const { publicBaseUrl } = require('../env');
const { hmacB64url, safeEqual } = require('../crypto/derive');
const { parseEmail } = require('../customers/emailAddress');
const { isDisposableDomain } = require('../customers/disposable');
const { getProvider, ProviderError } = require('./providers');
const { checkVerification } = require('../account/verify');
const { applySignIn, resolveCustomer, signIn } = require('./accounts');
const {
  randomToken, sha256Hex, isChallenge, isVerifier, challengeOf, verifierMatches, isAppState, isOpaqueToken,
  checkAppRedirect, appRedirectUrl, checkClientRedirect, isClientState, MOBILE_CLIENT_ID, WEB_CLIENT_ID
} = require('./tokens');

const STATE_TTL_MS = 10 * 60000;
const CODE_TTL_MS = 60000;
// Browser sign-ins started per client network per hour (on top of the per-minute limiter in server.js).
const STARTS_PER_HOUR_PER_IP = 30;

const NONCE_COOKIE_PREFIX = 'sg_auth_';

function callbackUrl(providerId) {
  return `${String(publicBaseUrl).replace(/\/+$/, '')}/auth/callback/${providerId}`;
}

function providerVerifier(state) {
  return hmacB64url('auth-provider-pkce-v1', state, 32); // 43 characters, a valid PKCE verifier
}

const nonceCookieName = (authStateId) => `${NONCE_COOKIE_PREFIX}${String(authStateId).replace(/[^A-Za-z0-9]/g, '')}`;

// Stores the AuthState of one browser sign-in and builds the provider URL. Shared by the desktop (startSignIn)
// and the phone and web clients (startClientSignIn). -> { ok: true, location, cookie } or { ok: false, status, error }.
async function createAuthState(db, tenant, provider, { codeChallenge, appState, appRedirect, clientId = null, ipHash = null, rerequest = false, now = Date.now() }) {
  if (!provider.configured()) return { ok: false, status: 503, error: 'provider_unavailable' };
  if (ipHash) {
    const recent = await db.authState.count({ where: { tenantId: tenant.id, ipHash, createdAt: { gte: new Date(now - 3600000) } } });
    if (recent >= STARTS_PER_HOUR_PER_IP) return { ok: false, status: 429, error: 'rate_limited' };
  }
  const state = randomToken(32);
  const nonce = randomToken(32);
  const row = await db.authState.create({
    data: {
      tenantId: tenant.id, provider: provider.id, stateHash: sha256Hex(state), nonceHash: sha256Hex(nonce),
      codeChallenge, appState, appRedirect, clientId, ipHash,
      expiresAt: new Date(now + STATE_TTL_MS), createdAt: new Date(now)
    }
  });
  const location = provider.authorizeUrl({
    state, codeChallenge: challengeOf(providerVerifier(state)), redirectUri: callbackUrl(provider.id), nonce, rerequest
  });
  return { ok: true, location, cookie: { name: nonceCookieName(row.id), value: nonce, maxAgeSec: STATE_TTL_MS / 1000 } };
}

// "Allow email access" after a Facebook sign-in without an email: the app starts again with auth_type=rerequest,
// so Facebook asks for the declined email permission once more. Other providers ignore it.
const wantsRerequest = (q) => q.auth_type === 'rerequest';

// GET /auth/start. query: { provider, tenant, app_redirect, code_challenge, code_challenge_method, state, auth_type? }.
// -> { ok: true, location, cookie: { name, value, maxAgeSec } } or { ok: false, status, error }.
async function startSignIn(db, query, { ipHash = null, now = Date.now() } = {}) {
  const q = query || {};
  const provider = getProvider(q.provider);
  if (!provider) return { ok: false, status: 400, error: 'unknown_provider' };
  const tenantId = typeof q.tenant === 'string' ? q.tenant : '';
  const tenant = tenantId ? await db.tenant.findUnique({ where: { id: tenantId } }) : null;
  if (!tenant || tenant.status !== 'active') return { ok: false, status: 400, error: 'invalid_request' };
  const redirect = checkAppRedirect(q.app_redirect);
  if (!redirect) return { ok: false, status: 400, error: 'invalid_redirect' };
  if (q.code_challenge_method !== 'S256' || !isChallenge(q.code_challenge) || !isAppState(q.state)) {
    return { ok: false, status: 400, error: 'invalid_request' };
  }
  return createAuthState(db, tenant, provider, { codeChallenge: q.code_challenge, appState: q.state, appRedirect: redirect.uri, ipHash, rerequest: wantsRerequest(q), now });
}

// GET /v1/mobile/auth/authorize and /v1/web/auth/authorize (OAuth 2.0 authorization request of a public
// client, RFC 6749 4.1.1 + RFC 7636). query: { client_id, redirect_uri, response_type=code, state,
// code_challenge, code_challenge_method=S256, provider, scope?, auth_type? }. `expectClient` is the client the route serves.
// -> { ok: true, location, cookie } | { ok: false, status, error, redirect? } where `redirect` (only once the
// redirect_uri is proven to belong to the client) is where the error may be sent (RFC 6749 4.1.2.1).
async function startClientSignIn(db, tenant, query, expectClient, { ipHash = null, now = Date.now() } = {}) {
  const q = query || {};
  if (q.client_id !== expectClient) return { ok: false, status: 400, error: 'invalid_client' };
  const redirect = checkClientRedirect(expectClient, q.redirect_uri);
  if (!redirect) return { ok: false, status: 400, error: 'invalid_redirect' };
  if (!isClientState(q.state)) return { ok: false, status: 400, error: 'invalid_request' };
  const back = (error) => ({ ok: false, status: 302, error, redirect: appRedirectUrl(redirect.uri, { error, state: q.state }) });
  if (!tenant) return back('server_error');
  if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !isChallenge(q.code_challenge)) return back('invalid_request');
  const provider = getProvider(q.provider);
  if (!provider) return back(q.provider === 'apple' ? 'provider_not_configured' : 'invalid_request');
  const r = await createAuthState(db, tenant, provider, {
    codeChallenge: q.code_challenge, appState: q.state, appRedirect: redirect.uri, clientId: expectClient, ipHash, rerequest: wantsRerequest(q), now
  });
  if (!r.ok) return back(r.error === 'provider_unavailable' ? 'provider_not_configured' : r.error === 'rate_limited' ? 'rate_limited' : 'server_error');
  return r;
}

// GET /auth/callback/:provider. cookies: { name: value } from the request.
// -> { kind: 'page', status, page } (no trusted app redirect: a forged, replayed or expired callback), or
//    { kind: 'app', url, redirectKind, outcome } with outcome 'signed_in' | an error code for the app.
async function finishCallback(db, providerId, query, cookies, { now = Date.now() } = {}) {
  const q = query || {};
  const provider = getProvider(providerId);
  const state = typeof q.state === 'string' ? q.state : '';
  if (!provider || !state || state.length > 200) return { kind: 'page', status: 400, page: 'expired' };
  const st = await db.authState.findUnique({ where: { stateHash: sha256Hex(state) } });
  if (!st || st.provider !== provider.id) return { kind: 'page', status: 400, page: 'expired' };
  const nonce = cookies ? cookies[nonceCookieName(st.id)] : null;
  if (typeof nonce !== 'string' || !safeEqual(sha256Hex(nonce), st.nonceHash)) return { kind: 'page', status: 400, page: 'expired' };
  if (st.usedAt || new Date(st.expiresAt).getTime() <= now) return { kind: 'page', status: 400, page: 'expired' };
  const claim = await db.authState.updateMany({ where: { id: st.id, usedAt: null }, data: { usedAt: new Date(now) } });
  if (claim.count !== 1) return { kind: 'page', status: 400, page: 'expired' };

  const redirect = st.clientId ? checkClientRedirect(st.clientId, st.appRedirect) : checkAppRedirect(st.appRedirect);
  if (!redirect) return { kind: 'page', status: 400, page: 'expired' };
  const toApp = (params, outcome) => ({ kind: 'app', url: appRedirectUrl(redirect.uri, { ...params, state: st.appState }), redirectKind: redirect.kind, outcome });

  // The phone and web clients speak OAuth: access_denied is the standard "the person said no".
  const cancelled = st.clientId ? 'access_denied' : 'cancelled';
  if (typeof q.error === 'string' && q.error) return toApp({ error: q.error === 'access_denied' ? cancelled : 'failed' }, 'cancelled');
  const code = typeof q.code === 'string' ? q.code : '';
  if (!code || code.length > 200) return toApp({ error: 'failed' }, 'failed');

  let profile;
  try {
    profile = await provider.completeSignIn({ code, codeVerifier: providerVerifier(state), redirectUri: callbackUrl(provider.id), nonce });
  } catch (e) {
    const reason = e instanceof ProviderError && e.code === 'email_not_verified' ? 'email_not_verified' : 'failed';
    if (reason === 'failed') console.warn('[auth] provider sign-in failed:', provider.id, e && (e.detail || e.message));
    return toApp({ error: reason }, reason);
  }
  // A provider that may send no email (Facebook: a phone-number account, or the email permission declined) signs
  // in only a person who already linked this provider id; anyone else is told why (email_missing) and offered
  // to allow email access (auth_type=rerequest), Google or email sign-in. Nothing is created without an email.
  const noEmail = provider.emailOptional === true && !profile.email;
  let parsed = null;
  if (noEmail) {
    if (!(await linkedIdentity(db, st.tenantId, provider.id, profile.providerUserId))) return toApp({ error: 'email_missing' }, 'email_missing');
  } else {
    parsed = parseEmail(profile.email);
    if (!parsed || profile.emailVerified !== true) return toApp({ error: 'email_not_verified' }, 'email_not_verified');
    const { getSettings } = require('../settings');
    const settings = await getSettings(db, st.tenantId);
    if (isDisposableDomain(parsed.domain, { allow: settings.email.domainAllowlist, block: settings.email.domainBlocklist })) {
      return toApp({ error: 'disposable_email' }, 'disposable_email');
    }
  }
  const appCode = randomToken(32);
  await db.authCode.create({
    data: {
      tenantId: st.tenantId, authStateId: st.id, provider: provider.id, codeHash: sha256Hex(appCode),
      profile: {
        providerUserId: profile.providerUserId, email: parsed ? parsed.email : null, emailVerified: Boolean(parsed),
        name: profile.name || null, login: profile.login || null
      },
      expiresAt: new Date(now + CODE_TTL_MS), createdAt: new Date(now)
    }
  });
  return toApp({ code: appCode }, 'signed_in');
}

// An Identity of this provider id whose customer still exists in the tenant (or null).
async function linkedIdentity(db, tenantId, provider, providerUserId) {
  const id = String(providerUserId || '');
  if (!id) return null;
  const identity = await db.identity.findUnique({ where: { tenantId_provider_providerUserId: { tenantId, provider, providerUserId: id } } });
  if (!identity) return null;
  const c = await db.customer.findUnique({ where: { id: identity.customerId } });
  return c && c.tenantId === tenantId ? identity : null;
}

const INVALID_GRANT = { status: 400, body: { error: 'invalid_grant', message: 'This sign-in has expired or was already used. Please sign in again.' } };

// POST /auth/exchange { code, codeVerifier, expectCustomerId? } on an authenticated install.
// Every failure of the code itself (unknown, used, expired, another tenant, wrong verifier) is the same
// invalid_grant, and a code is spent by the first attempt, right or wrong.
async function exchangeCode(db, tenant, install, input, { ipHash = null, now = Date.now(), settings }) {
  const b = input || {};
  if (!isOpaqueToken(b.code) || !isVerifier(b.codeVerifier)) return INVALID_GRANT;
  const row = await db.authCode.findUnique({ where: { codeHash: sha256Hex(b.code) } });
  if (!row || row.tenantId !== tenant.id) return INVALID_GRANT;
  const claim = await db.authCode.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date(now) } }, data: { usedAt: new Date(now) } });
  if (claim.count !== 1) return INVALID_GRANT;
  const st = await db.authState.findUnique({ where: { id: row.authStateId } });
  if (!st || st.tenantId !== tenant.id || !verifierMatches(b.codeVerifier, st.codeChallenge)) return INVALID_GRANT;
  const profile = row.profile && typeof row.profile === 'object' ? row.profile : {};
  return signIn(db, tenant, install, row.provider, profile, { expectCustomerId: cleanId(b.expectCustomerId), ipHash, now, settings });
}

// POST /v1/mobile/auth/token and /v1/web/auth/token (grant_type=authorization_code): the one-time code from the
// client's redirect. Same rules as exchangeCode, plus the code must have been issued to this client for this
// exact redirect_uri (RFC 6749 4.1.3). -> { ok: true, provider, profile } | INVALID_GRANT.
async function takeClientCode(db, tenant, input, clientId, { now = Date.now() } = {}) {
  const b = input || {};
  if (!tenant || !isOpaqueToken(b.code) || !isVerifier(b.code_verifier)) return INVALID_GRANT;
  if (b.client_id !== clientId) return INVALID_GRANT;
  const row = await db.authCode.findUnique({ where: { codeHash: sha256Hex(b.code) } });
  if (!row || row.tenantId !== tenant.id) return INVALID_GRANT;
  const claim = await db.authCode.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date(now) } }, data: { usedAt: new Date(now) } });
  if (claim.count !== 1) return INVALID_GRANT;
  const st = await db.authState.findUnique({ where: { id: row.authStateId } });
  if (!st || st.tenantId !== tenant.id || st.clientId !== clientId || st.appRedirect !== b.redirect_uri) return INVALID_GRANT;
  if (!verifierMatches(b.code_verifier, st.codeChallenge)) return INVALID_GRANT;
  const profile = row.profile && typeof row.profile === 'object' ? row.profile : {};
  return { ok: true, provider: row.provider, profile };
}

function cleanId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null;
}

// POST /auth/email/verify { email, code, expectCustomerId? }: the 6-digit code from POST /auth/email/start (the
// same code, template, limits and checks as /v1/account/verify) IS the sign-in. A workspace that expects its own
// account refuses another address before the code is spent.
async function emailSignIn(db, tenant, install, input, { ipHash = null, now = Date.now(), settings }) {
  const b = input || {};
  const parsed = parseEmail(b.email);
  if (!parsed) return { status: 400, body: { error: 'invalid_email', message: 'That email address does not look right.' } };
  const before = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId: tenant.id, emailKey: parsed.emailKey } } });
  const expect = cleanId(b.expectCustomerId);
  if (expect && (!before || before.id !== expect)) {
    return { status: 409, body: { error: 'account_mismatch', message: 'This workspace belongs to a different SoftGlaze account.' } };
  }
  const checked = await checkVerification(db, tenant, install, b, { now, settings });
  if (checked.status !== 200) return checked;
  const customer = await db.customer.findUnique({ where: { id: checked.body.customerId } });
  if (!customer) return INVALID_GRANT;
  // checkVerification created or updated the customer and linked the install; add the method and the session.
  const profile = { providerUserId: parsed.emailKey, email: parsed.email, emailVerified: true, name: null, login: null };
  let identity = await db.identity.findUnique({ where: { tenantId_provider_providerUserId: { tenantId: tenant.id, provider: 'email', providerUserId: parsed.emailKey } } });
  if (identity && identity.customerId !== customer.id) identity = { stale: identity };
  const how = !before ? 'new' : (identity && !identity.stale ? 'identity' : 'email');
  const resolved = { identity, customer, how, parsed, providerUserId: parsed.emailKey };
  return { status: 200, body: await applySignIn(db, tenant, install, 'email', profile, resolved, { ipHash, now, settings, attached: true }) };
}

module.exports = {
  STATE_TTL_MS, CODE_TTL_MS, STARTS_PER_HOUR_PER_IP, NONCE_COOKIE_PREFIX, callbackUrl, providerVerifier, nonceCookieName,
  startSignIn, startClientSignIn, finishCallback, exchangeCode, takeClientCode, emailSignIn, resolveCustomer, INVALID_GRANT,
  MOBILE_CLIENT_ID, WEB_CLIENT_ID
};
