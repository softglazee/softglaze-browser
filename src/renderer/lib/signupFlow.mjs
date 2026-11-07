// Sign-up and free-trial rules for the Gate and the Billing page, kept pure so node:test can run them.
// Tenant (sellable) builds have our licensing server email and check the sign-up code and start the
// trial (one per computer and email); base builds keep the local flow unchanged.

// App error codes main sends for server sign-up and trial failures (src/main/serverErrors.js). Each
// has a `serverErrors.<CODE>` string in gate.json and billing.json, en and es.
export const SERVER_ERROR_CODES = Object.freeze([
  'SIGNUP_INVALID_EMAIL',
  'SIGNUP_DISPOSABLE_EMAIL',
  'SIGNUP_NO_MX',
  'SIGNUP_BAD_CODE',
  'SIGNUP_OFFLINE',
  'SIGNUP_FAILED',
  'RATE_LIMITED',
  'TRIAL_USED',
  'TRIAL_OFFLINE',
  'TRIAL_VERIFY_EMAIL',
  'TRIAL_NO_EMAIL',
  'TRIAL_FAILED',
  'SERVER_UNAVAILABLE',
  'MACHINE_MISMATCH'
]);

export function serverErrorKey(err) {
  const code = err && err.code;
  return SERVER_ERROR_CODES.includes(code) ? `serverErrors.${code}` : null;
}

// The translated server message when the code is known, else the error's own message, else the
// fallback key.
export function errorText(t, err, fallbackKey) {
  const key = serverErrorKey(err);
  if (key) return t(key);
  return (err && err.message) || t(fallbackKey);
}

// Extra fields for account.sendOtp. Only tenant builds send them: the name for the email greeting,
// the marketing consent (true only when the box was ticked) and the email language.
export function otpExtras({ tenant, firstName, lastName, consent, lang }) {
  if (!tenant) return undefined;
  return {
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    consentMarketing: consent === true,
    lang: lang || 'en'
  };
}

// Where the Gate goes after license:get: no plan yet (tenant builds) -> the plan step; ended or
// blocked -> the blocking screen; anything else -> the app.
export function phaseForLicense(lic) {
  if (lic && lic.needsPlan) return 'plan';
  return lic && lic.isBanned ? 'banned' : 'ready';
}

// The server asked to confirm the owner's email (an account made before server sign-up) and has
// emailed a code: the plan step shows the code box.
export function trialNeedsCode(err) {
  return Boolean(err && err.code === 'TRIAL_VERIFY_EMAIL');
}

// license.startTrial payload: the code only when one was asked for.
export function trialPayload({ codeFor, code }) {
  const c = String(code || '').replace(/\D/g, '');
  return codeFor && c.length === 6 ? { code: c } : undefined;
}

// Paid plans for the plan step (prices from the server, or the built-in fallback when offline).
export function paidPlans(plansInfo) {
  const list = plansInfo && Array.isArray(plansInfo.plans) ? plansInfo.plans : [];
  return list.filter((p) => p && p.kind !== 'trial' && p.active !== false);
}

export function defaultPlanId(plans) {
  const list = Array.isArray(plans) ? plans : [];
  const pick = list.find((p) => p.highlight) || list[0];
  return pick ? pick.id : null;
}

// "$29" for US dollars, else "29 EUR"; the same format as the Billing page.
export function formatPrice(amount, currency) {
  const a = String(amount ?? '');
  return currency === 'USD' ? `$${a}` : `${a} ${currency || ''}`.trim();
}
