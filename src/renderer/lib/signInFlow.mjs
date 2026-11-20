// One-click sign-in (1.0.26) rules for the Gate and Settings > Account, kept pure so node:test can run them.
// Main does the work (src/main/oneClickSignIn.js); these decide what the screens show.

// App error codes main sends for a sign-in. Each has a `errors.<CODE>` string in signin.json, en and es. The
// email-code calls also use the sign-up codes (gate.json `serverErrors.<CODE>`, signupFlow.mjs).
export const SIGNIN_ERROR_CODES = Object.freeze([
  'SIGNIN_OFFLINE', 'SIGNIN_EXPIRED', 'SIGNIN_ACCOUNT_MISMATCH', 'SIGNIN_EMAIL_MISMATCH', 'SIGNIN_EMAIL_NOT_VERIFIED', 'SIGNIN_EMAIL_MISSING',
  'SIGNIN_DISPOSABLE_EMAIL', 'SIGNIN_UNAVAILABLE', 'SIGNIN_FAILED', 'SIGNIN_TIMEOUT', 'SIGNIN_NOT_ALLOWED',
  'SIGNIN_KEY_LOST', 'SIGNIN_SESSION_ENDED', 'SIGNIN_BAD_INPUT', 'MOVE_FAILED'
]);

// The translated text for a sign-in error, or null when the person cancelled (nothing to show).
// t: the 'signin' namespace; tGate: the 'gate' namespace (sign-up codes); fallbackKey: a 'signin' key.
export function signInErrorText(t, tGate, err, fallbackKey = 'errors.SIGNIN_FAILED') {
  const code = err && err.code;
  if (code === 'SIGNIN_CANCELLED') return null;
  if (SIGNIN_ERROR_CODES.includes(code)) return t(`errors.${code}`);
  if (typeof code === 'string' && /^(SIGNUP_[A-Z_]+|RATE_LIMITED|SERVER_UNAVAILABLE)$/.test(code)) return tGate(`serverErrors.${code}`);
  return (err && err.message) || t(fallbackKey);
}

// A provider's button needs a licensing server that has that provider's keys (GET /auth/providers).
export function showProvider(info, provider) {
  return Boolean(info && info.tenant && Array.isArray(info.providers) && info.providers.includes(provider));
}
export function showGithub(info) { return showProvider(info, 'github'); }
export function showGoogle(info) { return showProvider(info, 'google'); }
export function showFacebook(info) { return showProvider(info, 'facebook'); }
export function showLinkedin(info) { return showProvider(info, 'linkedin'); }

// The provider buttons to draw, in the app's order (Google first, as most people have a Google account, then
// Facebook, LinkedIn and GitHub).
export const PROVIDER_ORDER = Object.freeze(['google', 'facebook', 'linkedin', 'github']);
export function providerButtons(info) {
  return PROVIDER_ORDER.filter((p) => showProvider(info, p));
}

// The name shown in "Continue in your browser" texts.
export const PROVIDER_NAMES = Object.freeze({ google: 'Google', facebook: 'Facebook', linkedin: 'LinkedIn', github: 'GitHub' });

// A Facebook sign-in that shared no email: the panel offers "Allow email access" (Facebook asks again).
export function offerEmailRerequest(err) {
  return Boolean(err && err.code === 'SIGNIN_EMAIL_MISSING');
}

// Where the Gate goes after a sign-in: the optional use-case question once after a one-click sign-up when the
// account has no answer yet, else the licence check.
export function phaseAfterSignIn(result) {
  return result && result.outcome === 'created' && result.askUseCase ? 'usecase' : 'licensing';
}

// The licence is on another computer and can be moved here (billing.json store.result.inUse).
export function canOfferMove(licence) {
  return Boolean(licence && licence.state === 'elsewhere');
}

// billing.json key for a failed move, or null for the generic text.
export function moveErrorKey(err) {
  return err && err.code === 'MOVE_LIMIT' ? 'store.result.moveLimit' : null;
}

// Settings > Account rows: one per method, Google, Facebook, LinkedIn, GitHub, then the email code.
export function methodRows(methods) {
  const order = { google: 0, facebook: 1, linkedin: 2, github: 3, email: 4 };
  const list = Array.isArray(methods) ? methods.filter((m) => m && Object.prototype.hasOwnProperty.call(order, m.provider)) : [];
  return list.slice().sort((a, b) => order[a.provider] - order[b.provider]).map((m) => ({
    provider: m.provider,
    email: m.email || null,
    login: m.login || null,
    lastUsedAt: m.lastUsedAt || null,
    linkedAt: m.linkedAt || null
  }));
}

export function sixDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}
