'use strict';
// "Continue with Microsoft": Microsoft identity platform v2.0, OpenID Connect authorization code flow with PKCE, for
// personal Microsoft accounts AND work or school (Microsoft Entra) accounts of any organization (the "common"
// authority). Run on this server so the client secret never leaves it. ONE app registration serves the desktop
// app, the phone app and the web app, because all three come back through this server's callback
// (PUBLIC_BASE_URL + /auth/callback/microsoft, a "Web" platform redirect URI). Microsoft's documentation
// (learn.microsoft.com/entra/identity-platform: v2-protocols-oidc, v2-oauth2-auth-code-flow, id-token-claims-reference,
// optional-claims-reference, claims-validation; checked 20 November 2026):
//   1. the browser goes to https://login.microsoftonline.com/common/oauth2/v2.0/authorize with client_id,
//      response_type=code, redirect_uri, response_mode=query, scope "openid profile email", state, nonce, PKCE
//      (S256) and prompt=select_account. No Microsoft Graph scope: the ID token says everything we need;
//   2. POST https://login.microsoftonline.com/common/oauth2/v2.0/token (form) with client_id, client_secret,
//      grant_type=authorization_code, code, redirect_uri, code_verifier -> { id_token, access_token, ... };
//   3. the ID token is checked HERE: RS256 signature against https://login.microsoftonline.com/common/discovery/
//      v2.0/keys (cached), aud is our client id, `tid` is a GUID and `iss` is exactly
//      https://login.microsoftonline.com/<that tid>/v2.0 (the /common issuer is a template, so the token's own tid
//      is put in it), exp has not passed, iat/nbf are not in the future, the nonce is the one this sign-in sent.
// Identity key: `oid` (the user's object id, stable and unique within a tenant) together with `tid`, stored as
// "<tid>:<oid>" so the same person in two tenants is two links.
// Email (decision, docs/MICROSOFT-SIGNIN.md): Microsoft warns the `email` claim "isn't guaranteed to be correct"
// for work or school accounts, where any admin can type any address. It counts as verified (and may link to an
// existing SoftGlaze account with the same address, or create one) only when
//   - the account is a personal Microsoft account (tid 9188040d-6c67-4c5b-b112-36a304b66dad), or
//   - the token carries xms_edov: true (the optional claim "email domain owner verified", configured on the app
//     registration under Token configuration for the ID token, together with `email`).
// Otherwise the sign-in is refused with email_not_verified and nothing is linked or created: the person signs in
// another way. `preferred_username` (often the UPN) is never used as an email.
// Tokens from Microsoft are used once and dropped: never stored or logged.
// Plain fetch and node:crypto, no SDK. MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are read live from config/.env.
const crypto = require('node:crypto');
const { liveEnv } = require('../../env');
const { ProviderError } = require('./github');

const ID = 'microsoft';
const AUTHORITY = 'https://login.microsoftonline.com/common';
const AUTHORIZE_URL = `${AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_URL = `${AUTHORITY}/oauth2/v2.0/token`;
const JWKS_URL = `${AUTHORITY}/discovery/v2.0/keys`;
const CONSUMERS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const SCOPE = 'openid profile email';
const TIMEOUT_MS = 10000;
const CLOCK_SKEW_SEC = 300;
const JWKS_DEFAULT_TTL_MS = 60 * 60000;
const JWKS_MIN_REFETCH_MS = 60000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let fetchImpl = (...args) => fetch(...args);
let nowImpl = () => Date.now();
// Tests replace Microsoft with a fake: fn(url, init) -> a fetch Response-like { ok, status, headers?, json() }.
function setFetchForTests(fn) { fetchImpl = fn || ((...args) => fetch(...args)); jwksCache = null; }
function setNowForTests(fn) { nowImpl = fn || (() => Date.now()); }

function credentials() {
  const clientId = liveEnv('MICROSOFT_CLIENT_ID');
  const clientSecret = liveEnv('MICROSOFT_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() } : null;
}

function configured() { return Boolean(credentials()); }

// The client id alone (for /.well-known/microsoft-identity-association.json), or null.
function clientId() {
  const v = liveEnv('MICROSOFT_CLIENT_ID');
  const s = v ? String(v).trim() : '';
  return GUID_RE.test(s.toLowerCase()) ? s : null;
}

function oidcNonce(browserNonce) {
  return crypto.createHash('sha256').update(`sg-microsoft-nonce-v1|${String(browserNonce || '')}`, 'utf8').digest('base64url');
}

function authorizeUrl({ state, codeChallenge, redirectUri, nonce }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  if (!nonce) throw new ProviderError('provider_error', 'no_nonce');
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPE,
    state,
    nonce: oidcNonce(nonce),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
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

let jwksCache = null;

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
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || (jwk.use && jwk.use !== 'sig')) continue;
    try { keys.set(jwk.kid, crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })); } catch (_) { /* skip */ }
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

// Checks a Microsoft v2.0 ID token. -> the claims, or throws ProviderError('provider_error', 'id_token_<reason>').
async function verifyIdToken(idToken, { clientId: aud0, nonce }) {
  const fail = (why) => { throw new ProviderError('provider_error', `id_token_${why}`); };
  if (typeof idToken !== 'string' || idToken.length > 16384) fail('missing');
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
  if (claims.aud !== aud0) fail('aud');
  const tid = typeof claims.tid === 'string' ? claims.tid.toLowerCase() : '';
  if (!GUID_RE.test(tid)) fail('tid');
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) fail('iss');
  const nowSec = Math.floor(nowImpl() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC <= nowSec) fail('expired');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SEC > nowSec) fail('iat');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SEC > nowSec) fail('nbf');
  if (typeof claims.nonce !== 'string' || !nonce) fail('nonce');
  const a = Buffer.from(claims.nonce, 'utf8');
  const b = Buffer.from(oidcNonce(nonce), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail('nonce');
  const oid = typeof claims.oid === 'string' ? claims.oid.toLowerCase() : '';
  if (!GUID_RE.test(oid)) fail('oid');
  return { ...claims, tid, oid };
}

// Whether the token's email may be trusted (see the header).
function emailTrusted(claims) {
  if (typeof claims.email !== 'string' || !claims.email) return false;
  return claims.tid === CONSUMERS_TENANT || claims.xms_edov === true || claims.xms_edov === 'true' || claims.xms_edov === 1;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

async function completeSignIn({ code, codeVerifier, redirectUri, nonce }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      scope: SCOPE
    }).toString()
  });
  const tok = await readJson(res);
  if (!res.ok || !tok || tok.error || typeof tok.id_token !== 'string') {
    throw new ProviderError('provider_error', tok && typeof tok.error === 'string' ? tok.error : `token_${res.status}`);
  }
  const claims = await verifyIdToken(tok.id_token, { clientId: c.clientId, nonce });
  if (!emailTrusted(claims)) throw new ProviderError('email_not_verified');
  return { providerUserId: `${claims.tid}:${claims.oid}`, email: claims.email, emailVerified: true, name: cleanText(claims.name, 200), login: null };
}

module.exports = {
  id: ID, SCOPE, AUTHORIZE_URL, TOKEN_URL, JWKS_URL, CONSUMERS_TENANT, configured, clientId, authorizeUrl, completeSignIn,
  verifyIdToken, emailTrusted, oidcNonce, setFetchForTests, setNowForTests
};
