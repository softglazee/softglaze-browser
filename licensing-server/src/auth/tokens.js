'use strict';
// Small, pure helpers for one-click sign-in: random tokens, hashes, PKCE (RFC 7636, S256 only) and the
// redirect allow-list for handing a one-time code back to the desktop app.
const crypto = require('node:crypto');
const { safeEqual } = require('../crypto/derive');

// 32 random bytes as base64url = 43 characters.
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// --- PKCE ---
// The app sends BASE64URL(SHA256(code_verifier)) as code_challenge (43 characters); only S256 is accepted.
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

function isChallenge(v) { return typeof v === 'string' && CHALLENGE_RE.test(v); }
function isVerifier(v) { return typeof v === 'string' && VERIFIER_RE.test(v); }
function challengeOf(verifier) {
  return crypto.createHash('sha256').update(String(verifier), 'ascii').digest('base64url');
}
// Constant-time check that `verifier` belongs to `challenge`.
function verifierMatches(verifier, challenge) {
  if (!isVerifier(verifier) || !isChallenge(challenge)) return false;
  return safeEqual(challengeOf(verifier), challenge);
}

// The app's own state (it checks the value it gets back): 16 to 128 base64url characters.
const APP_STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
function isAppState(v) { return typeof v === 'string' && APP_STATE_RE.test(v); }

// The one-time codes and session tokens this server issues: 43 base64url characters.
const OPAQUE_RE = /^[A-Za-z0-9_-]{43}$/;
function isOpaqueToken(v) { return typeof v === 'string' && OPAQUE_RE.test(v); }

// --- Where the app may receive the code ---
// Exactly the protocol the installer and the Store package register, or a loopback listener on 127.0.0.1 with
// a port (RFC 8252 section 7.3). Nothing else, so a code can never be handed to a web page.
const PROTOCOL_REDIRECT = 'softglaze://auth';
const LOOPBACK_RE = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/auth$/;

// -> { uri, kind: 'protocol' | 'loopback', port? } or null when not allowed.
function checkAppRedirect(value) {
  if (typeof value !== 'string') return null;
  if (value === PROTOCOL_REDIRECT) return { uri: value, kind: 'protocol' };
  const m = LOOPBACK_RE.exec(value);
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1024 || port > 65535) return null;
  return { uri: value, kind: 'loopback', port };
}

// The app's redirect with the result as query parameters (code + state, or error + state).
function appRedirectUrl(uri, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
  return `${uri}?${q.toString()}`;
}

module.exports = {
  randomToken, sha256Hex, isChallenge, isVerifier, challengeOf, verifierMatches, isAppState, isOpaqueToken,
  PROTOCOL_REDIRECT, checkAppRedirect, appRedirectUrl
};
