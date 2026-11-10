'use strict';
// "Continue with GitHub": the GitHub OAuth web application flow, run on this server so the client secret never
// leaves it (docs.github.com, "Authorizing OAuth apps" and REST "List email addresses for the authenticated
// user", checked 10 November 2026):
//   1. the browser goes to https://github.com/login/oauth/authorize with client_id, redirect_uri (our callback),
//      scope "read:user user:email", state, and PKCE (code_challenge + code_challenge_method=S256);
//   2. POST https://github.com/login/oauth/access_token (Accept: application/json) with client_id,
//      client_secret, code, redirect_uri and code_verifier. A failure answers { error, error_description }
//      (bad_verification_code, redirect_uri_mismatch, incorrect_client_credentials, unverified_user_email),
//      which can come with HTTP 200, so the body is checked, not only the status;
//   3. GET https://api.github.com/user and /user/emails with "Authorization: Bearer <token>". Only the PRIMARY
//      address with verified: true is used; without one the sign-in is refused.
// The access token is used for those two reads and then dropped: it is never stored or logged.
// Plain fetch to the documented endpoints, no SDK. GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are read live from
// config/.env (src/env.js), so the owner can add them without a restart.
const { liveEnv } = require('../../env');

const ID = 'github';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_URL = 'https://api.github.com';
const SCOPE = 'read:user user:email';
const DEFAULT_API_VERSION = '2026-03-10';
const TIMEOUT_MS = 10000;

let fetchImpl = (...args) => fetch(...args);
// Tests replace GitHub with a fake: fn(url, init) -> a fetch Response-like { ok, status, json() }.
function setFetchForTests(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

// A failure the person can be told about: 'email_not_verified' or 'provider_error' (anything else).
class ProviderError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail || null;
  }
}

function credentials() {
  const clientId = liveEnv('GITHUB_CLIENT_ID');
  const clientSecret = liveEnv('GITHUB_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() } : null;
}

function configured() { return Boolean(credentials()); }

// The URL the browser is sent to. `nonce` is not part of GitHub's OAuth flow (it has no ID token); the
// browser binding is the nonce cookie checked at our callback (src/auth/flow.js).
function authorizeUrl({ state, codeChallenge, redirectUri }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    allow_signup: 'true'
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

async function apiGet(path, token) {
  const res = await call(`${API_URL}${path}`, {
    method: 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': liveEnv('GITHUB_API_VERSION') || DEFAULT_API_VERSION,
      'user-agent': 'SoftGlaze-Licensing'
    }
  });
  const body = await readJson(res);
  if (!res.ok || !body) throw new ProviderError('provider_error', `api_${res.status}`);
  return body;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Trades the code for a token, reads the user and the primary verified email.
// -> { providerUserId, email, emailVerified: true, name, login }, or throws ProviderError.
async function completeSignIn({ code, codeVerifier, redirectUri }) {
  const c = credentials();
  if (!c) throw new ProviderError('provider_unavailable');
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SoftGlaze-Licensing' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code: String(code),
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    }).toString()
  });
  const tok = await readJson(res);
  if (tok && tok.error === 'unverified_user_email') throw new ProviderError('email_not_verified');
  if (!res.ok || !tok || tok.error || typeof tok.access_token !== 'string' || !tok.access_token) {
    throw new ProviderError('provider_error', tok && typeof tok.error === 'string' ? tok.error : `token_${res.status}`);
  }
  const token = tok.access_token;
  const [user, emails] = await Promise.all([apiGet('/user', token), apiGet('/user/emails?per_page=100', token)]);
  const id = user && (typeof user.id === 'number' || typeof user.id === 'string') ? String(user.id) : '';
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw new ProviderError('provider_error', 'no_user_id');
  const list = Array.isArray(emails) ? emails : [];
  const primary = list.find((e) => e && e.primary === true && e.verified === true && typeof e.email === 'string' && e.email);
  if (!primary) throw new ProviderError('email_not_verified');
  return {
    providerUserId: id,
    email: primary.email,
    emailVerified: true,
    name: cleanText(user.name, 200),
    login: cleanText(user.login, 100)
  };
}

module.exports = { id: ID, SCOPE, AUTHORIZE_URL, TOKEN_URL, API_URL, configured, authorizeUrl, completeSignIn, ProviderError, setFetchForTests };
