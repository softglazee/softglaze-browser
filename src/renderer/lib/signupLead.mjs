// Lead details on the tenant sign-up and the "Confirm your email" step: phone (optional, with the
// country code), what the person will use SoftGlaze for (required, one choice, "other" with a short
// text), and company or website (optional). The same rules as src/main/signupLead.js, which checks
// again in main; a test keeps the two (and the server's list) in step. Pure, so node:test runs it.

// The use cases on the website home page ("Who uses it"), plus "other". Labels: gate.json lead.useCases.
export const USE_CASES = Object.freeze(['ecommerce', 'social_media', 'affiliate_marketing', 'agency', 'web_research', 'other']);
export const LEAD_LIMITS = Object.freeze({ phone: 40, company: 120, useCaseOther: 120 });

// null when fine (or empty), else the app error code for the gate.json serverErrors.* string.
export function phoneError(phone) {
  let s = String(phone ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2).trim()}`;
  if (s.length > LEAD_LIMITS.phone || !/^\+[0-9 ()\-.]+$/.test(s)) return 'SIGNUP_INVALID_PHONE';
  const digits = s.replace(/\D/g, '').length;
  return digits < 7 || digits > 15 ? 'SIGNUP_INVALID_PHONE' : null;
}

// The first problem with the lead fields, as an app error code, or null.
export function leadError({ phone, useCase, useCaseOther } = {}) {
  const p = phoneError(phone);
  if (p) return p;
  if (!USE_CASES.includes(String(useCase || ''))) return 'SIGNUP_USE_CASE';
  if (useCase === 'other' && !String(useCaseOther || '').trim()) return 'SIGNUP_USE_CASE_OTHER';
  return null;
}

// The fields sent to main: trimmed, the "other" text only with "other", empty ones left out.
export function leadPayload({ phone, useCase, useCaseOther, company } = {}) {
  const out = {};
  const ph = String(phone ?? '').replace(/\s+/g, ' ').trim();
  if (ph) out.phone = ph;
  if (useCase) out.useCase = String(useCase);
  const other = String(useCaseOther ?? '').trim().slice(0, LEAD_LIMITS.useCaseOther);
  if (useCase === 'other' && other) out.useCaseOther = other;
  const co = String(company ?? '').trim().slice(0, LEAD_LIMITS.company);
  if (co) out.company = co;
  return out;
}
