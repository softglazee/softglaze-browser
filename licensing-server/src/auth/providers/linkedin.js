'use strict';
// "Continue with LinkedIn": Sign In with LinkedIn using OpenID Connect, authorization code flow run on this server
// so the client secret never leaves it. ONE LinkedIn app (product "Sign In with LinkedIn using OpenID Connect")
// serves the desktop app, the phone app and the web app, because all three come back through this server's
// callback (PUBLIC_BASE_URL + /auth/callback/linkedin, registered under the app's Auth tab). LinkedIn's
// documentation (learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2,
// /linkedin/shared/authentication/authorization-code-flow, and the live discovery document
// https://www.linkedin.com/oauth/.well-known/openid-configuration, checked 20 November 2026):
//   1. the browser goes to https://www.linkedin.com/oauth/v2/authorization with response_type=code, client_id,
//      redirect_uri, state, scope "openid profile email", a nonce, and PKCE (code_challenge, S256). LinkedIn's
//      pages do not document PKCE for this product, but the authorization endpoint accepts it (checked with the
//      real client id) and its token errors name "code verifier"; LINKEDIN_PKCE=off leaves it out should a real
//      sign-in ever be refused for it. The person cancelling comes back as error=user_cancelled_login or
//      user_cancelled_authorize;
//   2. POST https://www.linkedin.com/oauth/v2/accessToken (form) with grant_type=authorization_code, code,
//      client_id, client_secret, redirect_uri (and code_verifier) -> { access_token, expires_in, id_token, scope }.
//      No refresh token is asked for or kept: we only need who the person is;
//   3. the ID token is checked HERE: RS256 signature against LinkedIn's keys (https://www.linkedin.com/oauth/openid/
//      jwks, cached), iss is "https://www.linkedin.com/oauth" (the discovery document; the older page says
//      "https://www.linkedin.com", accepted too), aud is our client id, exp has not passed, iat is not in the
//      future, and the nonce matches when LinkedIn includes one (it is not documented to echo it);
//   4. GET https://api.linkedin.com/v2/userinfo with the access token: its `sub` must be the ID token's, and it
//      gives email and email_verified (both optional). Only an email with email_verified === true is used, so an
//      account is linked by email only for a verified address; without one the sign-in is refused
//      (email_not_verified), as for Google.
// `sub` is LinkedIn's pairwise member id for our app: the stable key of the Identity. `picture` is not stored.
// Tokens from LinkedIn are used once and dropped: never stored or logged.
// Plain fetch and node:crypto, no SDK. LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET are read live from config/.env.
const crypto = require('node:crypto');
const { liveEnv } = require('../../env');
const { ProviderError } = require('./github');

const ID = 'linkedin';
const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const JWKS_URL = 'https://www.linkedin.com/oauth/openid/jwks';
const ISSUERS = Object.freeze(['https://www.linkedin.com/oauth', 'https://www.linkedin.com']);
const SCOPE = 'openid profile email';
const TIMEOUT_MS = 10000;
const CLOCK_SKEW_SEC = 120;
const JWKS_DEFAULT_TTL_MS = 60 * 60000;
const JWKS_MIN_REFETCH_MS = 60000;

let fetchImpl = (...args) => fetch(...args);
let nowImpl = () => Date.now();
// Tests replace LinkedIn with a fake: fn(url, init) -> a fetch Response-like { ok, status, headers?, json() }.
function setFetchForTests(fn) { fetchImpl = fn || ((...args) => fetch(...args)); jwksCache = null; }
function setNowForTests(fn) { nowImpl = fn || (() => Date.now()); }

function credentials() {
  const clientId = liveEnv('LINKEDIN_CLIENT_ID');
  const clientSecret = liveEnv('LINKEDIN_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() } : null;
}

function configured() { return Boolean(credentials()); }
const pkceOn = () => String(liveEnv('LINKEDIN_PKCE') || '').trim().toLowerCase() !== 'off';

// The OIDC nonce sent to LinkedIn: a one-way value of the browser nonce (never the cookie value itself).
function oidcNonce(browserNonce) {
  return crypto.createHash('sha256').update(`sg-linkedin-nonce-v1|${String(browserNonce || '')}`, 'utf8').digest('base64url');
}

function authorizeUrl({ state, codeChallenge, redirectUri, nonce }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPE
  });
  if (nonce) q.set('nonce', oidcNonce(nonce));
  if (pkceOn()) {
    q.set('code_challenge', codeChallenge);
    q.set('code_challenge_method', 'S256');
  }
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

async function readJson(res) {
  try { return await res.json(); } catch (_) { return null; }
}

async function call(url, init) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ProviderError('provider_error', 'network');
  }
}

// --- LinkedIn's signing keys ---
let jwksCache = null; // { keys: Map(kid -> KeyObject), expiresAt, fetchedAt }

function maxAgeMs(res) {
  const h = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('cache-control') : null;
  const m = h ? /max-age=(\d+)/i.exec(h) : null;
  return m ? Math.min(Number(m[1]) * 1000, 24 * 3600000) : JWKS_DEFAULT_TTL_MS;
}

async function fetchJwks() {
  const res = await call(JWKS_URL, { method: 'GET', headers: { accept: 'application/json' } });
  const body = await readJson(res);
  if (!res.ok || !body || !Array.isArray(body.keys)) throw new ProviderError('provider_error', `jwks_${res.status}`);
  const keys = new Map();
  for (const jwk of body.keys) {
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || (jwk.use && jwk.use !== 'sig') || (jwk.alg && jwk.alg !== 'RS256')) continue;
    try { keys.set(jwk.kid, crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })); } catch (_) { /* skip a bad key */ }
  }
  const now = nowImpl();
  jwksCache = { keys, expiresAt: now + maxAgeMs(res), fetchedAt: now };
  return jwksCache;
}

async function keyFor(kid) {
  const now = nowImpl();
  if (!jwksCache || jwksCache.expiresAt <= now) await fetchJwks();
  let key = jwksCache.keys.get(kid);
  if (!key && now - jwksCache.fetchedAt >= JWKS_MIN_REFETCH_MS) {
    await fetchJwks();
    key = jwksCache.keys.get(kid);
  }
  return key || null;
}

function decodePart(part) {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch (_) { return null; }
}

// Checks a LinkedIn ID token. -> the claims, or throws ProviderError('provider_error', 'id_token_<reason>').
async function verifyIdToken(idToken, { clientId, nonce }) {
  const fail = (why) => { throw new ProviderError('provider_error', `id_token_${why}`); };
  if (typeof idToken !== 'string' || idToken.length > 8192) fail('missing');
  const parts = idToken.split('.');
  if (parts.length !== 3) fail('malformed');
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims || typeof claims !== 'object') fail('malformed');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') fail('alg');
  const key = await keyFor(header.kid);
  if (!key) fail('unknown_key');
  const signed = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), key, Buffer.from(parts[2], 'base64url'));
  if (!signed) fail('signature');
  if (!ISSUERS.includes(claims.iss)) fail('iss');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) fail('aud');
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) fail('azp');
  const nowSec = Math.floor(nowImpl() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC <= nowSec) fail('expired');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SEC > nowSec) fail('iat');
  if (claims.nonce !== undefined) {
    if (typeof claims.nonce !== 'string' || !nonce) fail('nonce');
    const a = Buffer.from(claims.nonce, 'utf8');
    const b = Buffer.from(oidcNonce(nonce), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail('nonce');
  }
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(claims.sub)) fail('sub');
  return claims;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Trades the code, checks the ID token, reads userinfo. `nonce` is the browser nonce of this sign-in.
// -> { providerUserId, email, emailVerified: true, name, login: null }, or throws ProviderError.
async function completeSignIn({ code, codeVerifier, redirectUri, nonce }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri
  });
  if (pkceOn()) form.set('code_verifier', codeVerifier);
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const tok = await readJson(res);
  if (!res.ok || !tok || tok.error || typeof tok.access_token !== 'string' || typeof tok.id_token !== 'string') {
    throw new ProviderError('provider_error', tok && typeof tok.error === 'string' ? tok.error : `token_${res.status}`);
  }
  const claims = await verifyIdToken(tok.id_token, { clientId: c.clientId, nonce });
  const ui = await call(USERINFO_URL, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${tok.access_token}` } });
  const info = await readJson(ui);
  if (!ui.ok || !info || typeof info !== 'object') throw new ProviderError('provider_error', `userinfo_${ui.status}`);
  if (info.sub !== claims.sub) throw new ProviderError('provider_error', 'userinfo_sub');
  const email = typeof info.email === 'string' && info.email ? info.email : (typeof claims.email === 'string' ? claims.email : null);
  const verified = info.email !== undefined ? info.email_verified === true || info.email_verified === 'true'
    : claims.email_verified === true || claims.email_verified === 'true';
  if (!email || !verified) throw new ProviderError('email_not_verified');
  return { providerUserId: claims.sub, email, emailVerified: true, name: cleanText(info.name || claims.name, 200), login: null };
}

module.exports = {
  id: ID, SCOPE, AUTHORIZE_URL, TOKEN_URL, USERINFO_URL, JWKS_URL, ISSUERS, configured, authorizeUrl, completeSignIn, verifyIdToken,
  oidcNonce, setFetchForTests, setNowForTests
};
