'use strict';
// One plain message and one app error code for each licensing-server failure seen in sign-up and the
// free trial. The renderer translates the code (gate.json / billing.json `serverErrors.<CODE>`); the
// English message is the fallback. Pure, so node:test covers it directly.
//
//   no HTTP answer (err.network)  -> *_OFFLINE
//   HTTP 5xx                      -> SERVER_UNAVAILABLE
//   a short server code (err.code) -> the context's table, then 429 -> RATE_LIMITED
//   anything else                 -> the context's fallback

const MESSAGES = Object.freeze({
  SIGNUP_INVALID_EMAIL: 'Enter a valid email address.',
  SIGNUP_DISPOSABLE_EMAIL: 'Please use a permanent email address.',
  SIGNUP_NO_MX: "We couldn't find a mail server for that address.",
  SIGNUP_BAD_CODE: "That code isn't right or has expired. Check the email or ask for a new code.",
  SIGNUP_OFFLINE: 'Connect to the internet to create your account.',
  SIGNUP_FAILED: "We couldn't check that email right now. Try again in a few minutes.",
  RATE_LIMITED: 'Too many attempts, try again in a few minutes.',
  TRIAL_USED: 'A free trial has already been used on this computer or email. Choose a plan or enter a purchase code.',
  TRIAL_OFFLINE: 'Connect to the internet to start the free trial.',
  TRIAL_VERIFY_EMAIL: 'Confirm your email address to start the free trial. We sent you a 6-digit code.',
  TRIAL_NO_EMAIL: 'Add an email address to the owner account first, then start the free trial.',
  TRIAL_FAILED: "The free trial couldn't be started right now. Try again in a few minutes.",
  SERVER_UNAVAILABLE: "Our licensing server isn't answering right now. Try again in a few minutes.",
  MACHINE_MISMATCH: 'This licence is registered to a different computer. Move it to this PC or ask your administrator to reset it.'
});

const APP_CODES = Object.freeze(Object.keys(MESSAGES));

// Server codes from POST /v1/account/verify/start and /check (spec A2). The check codes are not fixed
// by the spec, so the likely spellings are all read as a wrong or expired code.
const SIGNUP_CODES = Object.freeze({
  invalid_email: 'SIGNUP_INVALID_EMAIL',
  disposable_email: 'SIGNUP_DISPOSABLE_EMAIL',
  no_mx: 'SIGNUP_NO_MX',
  rate_limited: 'RATE_LIMITED',
  too_many_attempts: 'RATE_LIMITED',
  invalid_code: 'SIGNUP_BAD_CODE',
  wrong_code: 'SIGNUP_BAD_CODE',
  bad_code: 'SIGNUP_BAD_CODE',
  code_invalid: 'SIGNUP_BAD_CODE',
  code_expired: 'SIGNUP_BAD_CODE',
  expired_code: 'SIGNUP_BAD_CODE',
  expired: 'SIGNUP_BAD_CODE',
  no_code: 'SIGNUP_BAD_CODE',
  machine_mismatch: 'MACHINE_MISMATCH'
});

// Server codes from POST /v1/trial/start (spec A3).
const TRIAL_CODES = Object.freeze({
  trial_used: 'TRIAL_USED',
  email_not_verified: 'TRIAL_VERIFY_EMAIL',
  not_verified: 'TRIAL_VERIFY_EMAIL',
  unverified_email: 'TRIAL_VERIFY_EMAIL',
  email_unverified: 'TRIAL_VERIFY_EMAIL',
  verification_required: 'TRIAL_VERIFY_EMAIL',
  rate_limited: 'RATE_LIMITED',
  machine_mismatch: 'MACHINE_MISMATCH'
});

const CONTEXTS = Object.freeze({
  signup: { offline: 'SIGNUP_OFFLINE', fallback: 'SIGNUP_FAILED', clientFallback: 'SIGNUP_FAILED', codes: SIGNUP_CODES },
  signupCheck: { offline: 'SIGNUP_OFFLINE', fallback: 'SIGNUP_FAILED', clientFallback: 'SIGNUP_BAD_CODE', codes: SIGNUP_CODES },
  trial: { offline: 'TRIAL_OFFLINE', fallback: 'TRIAL_FAILED', clientFallback: 'TRIAL_FAILED', codes: TRIAL_CODES },
  trialVerify: { offline: 'TRIAL_OFFLINE', fallback: 'TRIAL_FAILED', clientFallback: 'TRIAL_FAILED', codes: SIGNUP_CODES },
  trialVerifyCheck: { offline: 'TRIAL_OFFLINE', fallback: 'TRIAL_FAILED', clientFallback: 'SIGNUP_BAD_CODE', codes: SIGNUP_CODES }
});

function coded(code, extra) {
  const e = new Error(MESSAGES[code] || String(code));
  e.code = code;
  e.appMapped = true;
  if (extra) Object.assign(e, extra);
  return e;
}

// err: what licenseClient rejected with ({ network } | { status, code, reason }). context: a CONTEXTS key.
function mapServerError(err, context) {
  if (err && err.appMapped) return err;
  const ctx = CONTEXTS[context] || CONTEXTS.signup;
  const e = (err && typeof err === 'object') ? err : {};
  const extra = { serverCode: e.code || null, status: Number(e.status) || null, reason: e.reason || null };
  if (e.network === true) return coded(ctx.offline, extra);
  const status = Number(e.status) || 0;
  if (status >= 500) return coded('SERVER_UNAVAILABLE', extra);
  const mapped = e.code ? ctx.codes[String(e.code)] : null;
  if (mapped) return coded(mapped, extra);
  if (status === 429) return coded('RATE_LIMITED', extra);
  // A 4xx with no known code: for a code check that is almost always a wrong or used code. A 401 is
  // this install's credentials, never the user's input.
  if (status >= 400 && status !== 401) return coded(ctx.clientFallback, extra);
  return coded(ctx.fallback, extra);
}

module.exports = { MESSAGES, APP_CODES, SIGNUP_CODES, TRIAL_CODES, coded, mapServerError };
