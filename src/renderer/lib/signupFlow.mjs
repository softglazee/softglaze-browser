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
  'SIGNUP_INVALID_PHONE',
  'SIGNUP_USE_CASE',
  'SIGNUP_USE_CASE_OTHER',
  'CONFIRM_OFFLINE',
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
// the marketing consent (true only when the box was ticked), the email language and, from 1.0.23, the
// lead details (`lead`: leadPayload() from signupLead.mjs).
export function otpExtras({ tenant, firstName, lastName, consent, lang, lead }) {
  if (!tenant) return undefined;
  return {
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    consentMarketing: consent === true,
    lang: lang || 'en',
    ...(lead && typeof lead === 'object' ? lead : {})
  };
}

// After sign-in, account.signupStatus() decides whether the "Confirm your email" step comes first
// (tenant builds): 'confirm' for whoever may confirm (the Owner), 'confirmMember' for anyone else,
// null to go on to the licence. A missing or failed status goes on (main checks before launches).
export function confirmPhase(status) {
  if (!status || status.enabled === false || status.required !== true) return null;
  return status.canConfirm ? 'confirm' : 'confirmMember';
}

// App codes that mean our side failed (offline, server, email); the step may then offer "Continue for now".
export const OUR_SIDE_CODES = Object.freeze(['CONFIRM_OFFLINE', 'SIGNUP_OFFLINE', 'SERVER_UNAVAILABLE', 'SIGNUP_FAILED']);
export function isOurSideError(err) {
  return Boolean(err && OUR_SIDE_CODES.includes(err.code));
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

// The plan picked first: the highlighted one, else the first. Monthly plans come first when yearly ones
// are for sale too, whatever order the server lists them in.
export function defaultPlanId(plans) {
  const list = Array.isArray(plans) ? plans : [];
  const monthly = list.filter((p) => p && !/^(year|annual)/i.test(String(p.interval || p.period || '')) && Number(p.months) !== 12);
  const pool = monthly.length ? monthly : list;
  const pick = pool.find((p) => p.highlight) || pool[0];
  return pick ? pick.id : null;
}

// "$29" for US dollars, else "29 EUR"; the same format as the Billing page.
export function formatPrice(amount, currency) {
  const a = String(amount ?? '');
  return currency === 'USD' ? `$${a}` : `${a} ${currency || ''}`.trim();
}
