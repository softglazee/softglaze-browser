'use strict';
// "Continue with Facebook": the Facebook Login manual flow (authorization code), run on this server so the app
// secret never leaves it. ONE Meta app serves the desktop app, the phone app and the web app, because all three
// come back through this server's callback (PUBLIC_BASE_URL + /auth/callback/facebook, registered in the Meta app
// under Facebook Login > Settings > Valid OAuth Redirect URIs, strict mode). Meta's documentation
// (developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow, .../oidc-token, Graph API
// .../securing-requests and the User reference, checked 20 November 2026; current Graph API version v27.0):
//   1. the browser goes to https://www.facebook.com/<version>/dialog/oauth with client_id, redirect_uri, state,
//      response_type=code and scope "email,public_profile". auth_type=rerequest is added when the person
//      declined the email permission before and chose "Allow email access" (Facebook does not ask again for a
//      declined permission without it). PKCE: Meta documents code_challenge (S256) on the dialog and
//      code_verifier on the token call for its OpenID Connect code flow ("still in testing"); the manual-flow
//      page does not list it. We send both on every sign-in (where Facebook enforces PKCE the code is bound to our verifier),
//      and the app secret, the state and the browser nonce cookie (src/auth/flow.js) protect the flow either way;
//   2. GET https://graph.facebook.com/<version>/oauth/access_token with client_id, redirect_uri, client_secret,
//      code and code_verifier -> { access_token, token_type, expires_in } (a failure is { error: { message,
//      type, code } });
//   3. GET https://graph.facebook.com/<version>/me?fields=id,name,email,picture with the access token AND
//      appsecret_proof = HMAC-SHA256(access_token, app secret) (hex), so a stolen token alone cannot call the
//      Graph API as this app.
// `id` is the app-scoped Facebook user id: the stable key of the Identity. `email` is only returned when the
// person has a confirmed primary email on Facebook AND granted the email permission (Meta: "This field will not
// be returned if no valid email address is available"), so a returned address counts as verified; it can be
// missing (accounts made with a phone number, or the permission declined). See docs/FACEBOOK-SIGNIN.md for how
// a missing email is handled (only an existing Facebook link signs in; otherwise the person is told why).
// `picture` is read with the profile but not stored: SoftGlaze shows no profile photos.
// The access token is used for that one read and then dropped: it is never stored or logged.
// Plain fetch and node:crypto, no SDK. FACEBOOK_APP_ID / FACEBOOK_APP_SECRET (and the optional
// FACEBOOK_GRAPH_VERSION) are read live from config/.env.
const crypto = require('node:crypto');
const { liveEnv } = require('../../env');
const { ProviderError } = require('./github');

const ID = 'facebook';
const DEFAULT_GRAPH_VERSION = 'v27.0';
const SCOPE = 'email,public_profile';
const ME_FIELDS = 'id,name,email,picture';
const TIMEOUT_MS = 10000;

let fetchImpl = (...args) => fetch(...args);
// Tests replace Facebook with a fake: fn(url, init) -> a fetch Response-like { ok, status, json() }.
function setFetchForTests(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

function graphVersion() {
  const v = String(liveEnv('FACEBOOK_GRAPH_VERSION') || '').trim();
  return /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}
const authorizeBase = () => `https://www.facebook.com/${graphVersion()}/dialog/oauth`;
const graphBase = () => `https://graph.facebook.com/${graphVersion()}`;

function credentials() {
  const appId = liveEnv('FACEBOOK_APP_ID');
  const appSecret = liveEnv('FACEBOOK_APP_SECRET');
  return appId && appSecret ? { appId: String(appId).trim(), appSecret: String(appSecret).trim() } : null;
}

function configured() { return Boolean(credentials()); }

// The URL the browser is sent to. `rerequest` asks again for a permission the person declined before (email).
// `nonce` is not part of this flow (no ID token); the browser binding is the nonce cookie checked at our callback.
function authorizeUrl({ state, codeChallenge, redirectUri, rerequest = false }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const q = new URLSearchParams({
    client_id: c.appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  if (rerequest) q.set('auth_type', 'rerequest');
  return `${authorizeBase()}?${q.toString()}`;
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

// appsecret_proof: hex HMAC-SHA256 of the access token keyed with the app secret (Graph API "Securing Requests").
function appSecretProof(accessToken, appSecret) {
  return crypto.createHmac('sha256', String(appSecret)).update(String(accessToken), 'utf8').digest('hex');
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

const graphError = (body, fallback) => {
  const e = body && body.error;
  if (e && typeof e === 'object') return `graph_${e.code || 'error'}${e.error_subcode ? `_${e.error_subcode}` : ''}`;
  return fallback;
};

// Trades the code for a token and reads the profile.
// -> { providerUserId, email (or null), emailVerified, name, login: null }, or throws ProviderError.
async function completeSignIn({ code, codeVerifier, redirectUri }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const tq = new URLSearchParams({
    client_id: c.appId,
    redirect_uri: redirectUri,
    client_secret: c.appSecret,
    code: String(code),
    code_verifier: codeVerifier
  });
  const res = await call(`${graphBase()}/oauth/access_token?${tq.toString()}`, { method: 'GET', headers: { accept: 'application/json' } });
  const tok = await readJson(res);
  if (!res.ok || !tok || tok.error || typeof tok.access_token !== 'string' || !tok.access_token) {
    throw new ProviderError('provider_error', graphError(tok, `token_${res.status}`));
  }
  const token = tok.access_token;
  const mq = new URLSearchParams({ fields: ME_FIELDS, appsecret_proof: appSecretProof(token, c.appSecret) });
  const me = await call(`${graphBase()}/me?${mq.toString()}`, {
    method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` }
  });
  const user = await readJson(me);
  if (!me.ok || !user || user.error) throw new ProviderError('provider_error', graphError(user, `me_${me.status}`));
  const id = typeof user.id === 'string' || typeof user.id === 'number' ? String(user.id) : '';
  if (!/^[0-9]{1,30}$/.test(id)) throw new ProviderError('provider_error', 'no_user_id');
  const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null;
  return { providerUserId: id, email, emailVerified: Boolean(email), name: cleanText(user.name, 200), login: null };
}

// --- Data Deletion Request Callback (developers.facebook.com/docs/development/create-an-app/app-dashboard/
// data-deletion-callback): Meta POSTs `signed_request` = <base64url signature>.<base64url JSON payload>, the
// signature being HMAC-SHA256 of the encoded payload keyed with the app secret.
// -> the payload ({ algorithm, issued_at, user_id, ... }) or null when anything is wrong.
function parseSignedRequest(signedRequest, appSecret) {
  if (typeof signedRequest !== 'string' || signedRequest.length > 8192 || !appSecret) return null;
  const dot = signedRequest.indexOf('.');
  if (dot <= 0) return null;
  const encSig = signedRequest.slice(0, dot);
  const encPayload = signedRequest.slice(dot + 1);
  if (!/^[A-Za-z0-9_\-+/=]+$/.test(encSig) || !/^[A-Za-z0-9_\-+/=]+$/.test(encPayload)) return null;
  const toB64url = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = Buffer.from(toB64url(encSig), 'base64url');
  const expected = crypto.createHmac('sha256', String(appSecret)).update(encPayload, 'utf8').digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(toB64url(encPayload), 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!payload || typeof payload !== 'object' || String(payload.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null;
  const userId = typeof payload.user_id === 'string' || typeof payload.user_id === 'number' ? String(payload.user_id) : '';
  if (!/^[0-9]{1,30}$/.test(userId)) return null;
  return { ...payload, user_id: userId };
}

function appSecret() {
  const c = credentials();
  return c ? c.appSecret : null;
}

module.exports = {
  id: ID, SCOPE, ME_FIELDS, DEFAULT_GRAPH_VERSION, emailOptional: true, configured, authorizeUrl, completeSignIn, appSecretProof,
  parseSignedRequest, appSecret, graphVersion, authorizeBase, graphBase, setFetchForTests
};
