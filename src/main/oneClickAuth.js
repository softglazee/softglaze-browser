'use strict';
// One-click sign-in (1.0.26), the pure parts: PKCE (RFC 7636, S256), the page the system browser opens on our
// licensing server, and reading the answer that comes back through softglaze://auth or the loopback listener
// (src/main/authLoopback.js). No Electron here, so node:test covers it directly. The server side is
// licensing-server/src/auth/flow.js.
const crypto = require('node:crypto');

const PROTOCOL = 'softglaze';
const PROTOCOL_REDIRECT = 'softglaze://auth';
// Sign-in providers the app knows. Google and Microsoft come next; their buttons appear when the server
// lists them in GET /auth/providers.
const PROVIDERS = Object.freeze(['github']);
// Errors the server may send back with the redirect (licensing-server/src/auth/flow.js).
const RESULT_ERRORS = Object.freeze(['cancelled', 'email_not_verified', 'disposable_email', 'failed']);

const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

function newPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeOf(verifier) };
}

function challengeOf(verifier) {
  return crypto.createHash('sha256').update(String(verifier), 'ascii').digest('base64url');
}

function newState() {
  return crypto.randomBytes(24).toString('base64url');
}

function sameState(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The page on our server that starts a provider sign-in.
function startUrl({ apiBaseUrl, tenantId, provider, appRedirect, codeChallenge, state }) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown sign-in provider: ${provider}`);
  const base = String(apiBaseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base)) throw new Error('The licensing server address is not set.');
  const q = new URLSearchParams({
    provider,
    tenant: String(tenantId || ''),
    app_redirect: appRedirect,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  });
  return `${base}/auth/start?${q.toString()}`;
}

// Reads the query of a result URL: { code, state } on success, { error, state } on a refusal, else null.
function readResult(searchParams) {
  const state = searchParams.get('state') || '';
  if (!STATE_RE.test(state)) return null;
  const error = searchParams.get('error');
  if (error) return { error: RESULT_ERRORS.includes(error) ? error : 'failed', state };
  const code = searchParams.get('code') || '';
  return CODE_RE.test(code) ? { code, state } : null;
}

// softglaze://auth?code=..&state=.. (some browsers add a slash: softglaze://auth/?code=..). Anything else,
// including the invite links (softglaze://invite/...), is not a sign-in result: null.
function parseProtocolUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (u.protocol !== `${PROTOCOL}:` || u.hostname.toLowerCase() !== 'auth') return null;
  if (u.pathname !== '' && u.pathname !== '/') return null;
  return readResult(u.searchParams);
}

// The softglaze:// URL among the arguments Windows passes to the app (second-instance argv, process.argv).
function findProtocolUrl(argv) {
  const list = Array.isArray(argv) ? argv : [];
  return list.find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`)) || null;
}

module.exports = {
  PROTOCOL, PROTOCOL_REDIRECT, PROVIDERS, RESULT_ERRORS, newPkce, challengeOf, newState, sameState, startUrl,
  readResult, parseProtocolUrl, findProtocolUrl
};
