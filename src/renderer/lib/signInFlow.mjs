// One-click sign-in (1.0.26) rules for the Gate and Settings > Account, kept pure so node:test can run them.
// Main does the work (src/main/oneClickSignIn.js); these decide what the screens show.

// App error codes main sends for a sign-in. Each has a `errors.<CODE>` string in signin.json, en and es. The
// email-code calls also use the sign-up codes (gate.json `serverErrors.<CODE>`, signupFlow.mjs).
export const SIGNIN_ERROR_CODES = Object.freeze([
  'SIGNIN_OFFLINE', 'SIGNIN_EXPIRED', 'SIGNIN_ACCOUNT_MISMATCH', 'SIGNIN_EMAIL_MISMATCH', 'SIGNIN_EMAIL_NOT_VERIFIED',
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

// The GitHub button needs a licensing server that has GitHub keys (GET /auth/providers).
export function showGithub(info) {
  return Boolean(info && info.tenant && Array.isArray(info.providers) && info.providers.includes('github'));
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

// Settings > Account rows: one per method, GitHub first.
export function methodRows(methods) {
  const list = Array.isArray(methods) ? methods.filter((m) => m && (m.provider === 'github' || m.provider === 'email')) : [];
  const order = { github: 0, email: 1 };
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
