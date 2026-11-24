'use strict';
// Google Play review login (docs/PLAY-REVIEW-LOGIN.md). Play reviewers cannot read our inbox, so ONE fixed
// address may sign in with ONE fixed 6-digit code that we type into Play Console ("App access").
//
// Off unless BOTH are set (config/.env, re-read on change; removing the lines switches it off at once):
//   REVIEW_LOGIN_EMAIL      the review address, e.g. play-review@softglaze.com
//   REVIEW_LOGIN_CODE_HASH  scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url> of the 6-digit code
//                           (made by the owner's helper script; the plain code is never stored)
//
// For that exact address only (normalised: trimmed, lowercase; the stored form AND the account key must match):
//   - asking for a code sends NO email and answers exactly like the normal flow (a verification row is still
//     written, holding the HMAC of a random code nobody gets, so every limit and throttle counts as usual);
//   - checking a code compares it in constant time with REVIEW_LOGIN_CODE_HASH instead of the row's hash. The
//     row's expiry, attempt counter, resend throttle and hourly limits all still apply, plus a strict extra
//     lock: REVIEW_MAX_FAILURES_PER_DAY wrong codes in 24 h refuse every check for this address.
// Every other address never reaches this code path. A successful review sign-in is logged (no secrets) and
// recorded as a customer event 'review_login'. The account itself is a normal customer (Free plan, normal tenant).
const crypto = require('node:crypto');
const { liveEnvFresh } = require('../env');
const { parseEmail } = require('../customers/emailAddress');
const { addEvent } = require('../customers/sync');

const REVIEW_MAX_FAILURES_PER_DAY = 10;
const HASH_RE = /^scrypt:(\d{1,8}):(\d{1,2}):(\d{1,2}):([A-Za-z0-9_-]{16,128}):([A-Za-z0-9_-]{43,128})$/;

let warned = '';
function warnOnce(msg) {
  if (warned === msg) return;
  warned = msg;
  console.warn(msg);
}

// -> { N, r, p, salt: Buffer, key: Buffer } or null.
function parseCodeHash(s) {
  const m = HASH_RE.exec(String(s || '').trim());
  if (!m) return null;
  const N = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  // N a power of two between 2^14 and 2^20; r 8 to 16; p 1 to 4 (keeps a check under ~1 s and inside maxmem).
  if (N < 16384 || N > 1048576 || (N & (N - 1)) !== 0 || r < 8 || r > 16 || p < 1 || p > 4) return null;
  const salt = Buffer.from(m[4], 'base64url');
  const key = Buffer.from(m[5], 'base64url');
  if (salt.length < 16 || key.length < 32) return null;
  return { N, r, p, salt, key };
}

// The same format the helper script writes. Used by tests and by `node -e` on a trusted computer.
function hashReviewCode(code, { N = 32768, r = 8, p = 1, salt = crypto.randomBytes(16) } = {}) {
  if (!/^\d{6}$/.test(String(code))) throw new Error('The review code must be 6 digits.');
  const key = crypto.scryptSync(String(code), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  return `scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

// -> { email, emailKey, hash } when the review login is on, else null.
function reviewConfig() {
  const email = liveEnvFresh('REVIEW_LOGIN_EMAIL');
  const hash = liveEnvFresh('REVIEW_LOGIN_CODE_HASH');
  if (!email || !hash) return null;
  const parsed = parseEmail(String(email).trim());
  const h = parseCodeHash(hash);
  if (!parsed || !h) {
    warnOnce('[review-login] REVIEW_LOGIN_EMAIL or REVIEW_LOGIN_CODE_HASH is not valid; the review login stays off.');
    return null;
  }
  return { email: parsed.email, emailKey: parsed.emailKey, hash: h };
}

// Is this parsed address ({ email, emailKey }) the review address? -> the config, or null.
function reviewFor(parsedOrRow) {
  if (!parsedOrRow) return null;
  const cfg = reviewConfig();
  if (!cfg) return null;
  return parsedOrRow.email === cfg.email && parsedOrRow.emailKey === cfg.emailKey ? cfg : null;
}

// Constant-time check of a 6-digit code against the configured hash.
function reviewCodeMatches(cfg, code) {
  if (!cfg || !/^\d{6}$/.test(String(code))) return false;
  const { N, r, p, salt, key } = cfg.hash;
  let got;
  try {
    got = crypto.scryptSync(String(code), salt, key.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  } catch (_) {
    return false;
  }
  return got.length === key.length && crypto.timingSafeEqual(got, key);
}

// The strict lock: wrong codes for the review address in the last 24 h (all clients). Every check counts one
// attempt on its row; a proven row counted one right attempt.
async function reviewLocked(db, tenantId, emailKey, now = Date.now()) {
  const rows = await db.emailVerification.findMany({ where: { tenantId, emailKey, createdAt: { gte: new Date(now - 86400000) } } });
  const failures = rows.reduce((n, row) => n + (Number(row.attempts) || 0) - (row.verifiedAt ? 1 : 0), 0);
  return failures >= REVIEW_MAX_FAILURES_PER_DAY;
}

// One line in the server log and one customer event per successful review sign-in. Never the code or hash.
async function logReviewSignIn(db, tenantId, customerId, via, now = Date.now()) {
  console.info(`[review-login] review sign-in ok: via=${via} customer=${customerId} at=${new Date(now).toISOString()}`);
  if (customerId) await addEvent(db, tenantId, customerId, 'review_login', { via }, new Date(now)).catch(() => {});
}

module.exports = {
  REVIEW_MAX_FAILURES_PER_DAY, parseCodeHash, hashReviewCode, reviewConfig, reviewFor, reviewCodeMatches, reviewLocked, logReviewSignIn
};
