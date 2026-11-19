'use strict';
// "Continue with Google": OpenID Connect authorization code flow with PKCE, run on this server so the client
// secret never leaves it. ONE Google OAuth client of type "Web application" serves the desktop app, the phone
// app and the web app, because all three come back through this server's callback
// (PUBLIC_BASE_URL + /auth/callback/google). Google's documentation (developers.google.com/identity/
// openid-connect/openid-connect and /reference, checked 19 November 2026):
//   1. the browser goes to https://accounts.google.com/o/oauth2/v2/auth with client_id, redirect_uri,
//      response_type=code, scope "openid email profile", state, nonce and PKCE (S256);
//   2. POST https://oauth2.googleapis.com/token (form) with code, client_id, client_secret, redirect_uri,
//      grant_type=authorization_code and code_verifier -> { id_token, access_token, ... };
//   3. the ID token is checked HERE, never trusted as is: RS256 signature against Google's keys
//      (https://www.googleapis.com/oauth2/v3/certs, cached per its Cache-Control max-age), iss is
//      "https://accounts.google.com" or "accounts.google.com", aud is our client id (azp too when aud is a
//      list), exp has not passed, iat is not in the future, nonce is the one this sign-in sent, and
//      email_verified is true. Only then are sub (the stable Google user id) and email used.
// The nonce sent to Google is derived from the browser's nonce cookie (src/auth/flow.js), so the raw cookie
// value never appears in a URL. Tokens from Google are used once and dropped: never stored or logged.
// Plain fetch and node:crypto, no SDK. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are read live from config/.env.
const crypto = require('node:crypto');
const { liveEnv } = require('../../env');
const { ProviderError } = require('./github');

const ID = 'google';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = Object.freeze(['https://accounts.google.com', 'accounts.google.com']);
const SCOPE = 'openid email profile';
const TIMEOUT_MS = 10000;
const CLOCK_SKEW_SEC = 120;
const JWKS_DEFAULT_TTL_MS = 60 * 60000;
const JWKS_MIN_REFETCH_MS = 60000; // an unknown key id refetches at most once a minute

let fetchImpl = (...args) => fetch(...args);
let nowImpl = () => Date.now();
// Tests replace Google with a fake: fn(url, init) -> a fetch Response-like { ok, status, headers?, json() }.
function setFetchForTests(fn) { fetchImpl = fn || ((...args) => fetch(...args)); jwksCache = null; }
function setNowForTests(fn) { nowImpl = fn || (() => Date.now()); }

function credentials() {
  const clientId = liveEnv('GOOGLE_CLIENT_ID');
  const clientSecret = liveEnv('GOOGLE_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() } : null;
}

function configured() { return Boolean(credentials()); }

// The OIDC nonce for Google: a one-way value of the browser nonce (43 base64url characters).
function oidcNonce(browserNonce) {
  return crypto.createHash('sha256').update(`sg-oidc-nonce-v1|${String(browserNonce || '')}`, 'utf8').digest('base64url');
}

function authorizeUrl({ state, codeChallenge, redirectUri, nonce }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  if (!nonce) throw new ProviderError('provider_error', 'no_nonce');
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
    nonce: oidcNonce(nonce),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Let the person pick the account each time (shared computers, several Google accounts).
    prompt: 'select_account'
  });
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

// --- Google's signing keys ---
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
    await fetchJwks(); // Google rotated its keys since the last fetch
    key = jwksCache.keys.get(kid);
  }
  return key || null;
}

function decodePart(part) {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch (_) { return null; }
}

// Checks a Google ID token. -> the claims, or throws ProviderError('provider_error', <reason>)
// ('email_not_verified' when the token is good but Google has not verified the address).
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
  if (typeof claims.nonce !== 'string' || !nonce) fail('nonce');
  const a = Buffer.from(claims.nonce, 'utf8');
  const b = Buffer.from(oidcNonce(nonce), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail('nonce');
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) fail('sub');
  if (typeof claims.email !== 'string' || !claims.email) throw new ProviderError('email_not_verified');
  // Google sends a boolean; very old tokens used the string "true".
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw new ProviderError('email_not_verified');
  return claims;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Trades the code for tokens and checks the ID token. `nonce` is the browser nonce of this sign-in.
// -> { providerUserId, email, emailVerified: true, name, login: null }, or throws ProviderError.
async function completeSignIn({ code, codeVerifier, redirectUri, nonce }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    }).toString()
  });
  const tok = await readJson(res);
  if (!res.ok || !tok || tok.error || typeof tok.id_token !== 'string') {
    throw new ProviderError('provider_error', tok && typeof tok.error === 'string' ? tok.error : `token_${res.status}`);
  }
  const claims = await verifyIdToken(tok.id_token, { clientId: c.clientId, nonce });
  return {
    providerUserId: claims.sub,
    email: claims.email,
    emailVerified: true,
    name: cleanText(claims.name, 200),
    login: null
  };
}

module.exports = {
  id: ID, SCOPE, AUTHORIZE_URL, TOKEN_URL, JWKS_URL, ISSUERS, configured, authorizeUrl, completeSignIn, verifyIdToken, oidcNonce,
  setFetchForTests, setNowForTests
};
