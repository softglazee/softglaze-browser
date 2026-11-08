'use strict';
// Lead details asked at sign-up and on the "Confirm your email" step in tenant (sellable) builds:
// phone (optional, with the country code), what the person will use SoftGlaze for (required, one
// choice, "other" with a short text) and company or website (optional). Sent to our licensing server
// with the code request (POST /v1/account/verify/start) and stored on the customer there.
// The renderer checks the same rules first (src/renderer/lib/signupLead.mjs); main checks again here,
// because the renderer is never trusted. Errors are app codes from serverErrors.js.

// The use cases on the website home page ("Who uses it"), plus "other". The server keeps the same list
// (licensing-server/src/account/lead.js); a test checks the three lists match.
const USE_CASES = Object.freeze(['ecommerce', 'social_media', 'affiliate_marketing', 'agency', 'web_research', 'other']);
const LIMITS = Object.freeze({ phone: 40, company: 120, useCaseOther: 120 });

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Loose international check: + (or 00) and the country code, 7 to 15 digits, spaces ( ) . - allowed.
// -> { value } (null when empty) or { error: 'SIGNUP_INVALID_PHONE' }.
function normalizePhone(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'string') return { error: 'SIGNUP_INVALID_PHONE' };
  let s = v.replace(/\s+/g, ' ').trim();
  if (!s) return { value: null };
  if (s.startsWith('00')) s = `+${s.slice(2).trim()}`;
  if (s.length > LIMITS.phone || !/^\+[0-9 ()\-.]+$/.test(s)) return { error: 'SIGNUP_INVALID_PHONE' };
  const digits = s.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return { error: 'SIGNUP_INVALID_PHONE' };
  return { value: s };
}

// input: { phone, useCase, useCaseOther, company }. requireUseCase: the app asks for it (true); the
// server does not, for older apps.
// -> { lead: { phone, useCase, useCaseOther, company } } or { error: <app code> }.
function normalizeLead(input, { requireUseCase = true } = {}) {
  const b = input && typeof input === 'object' ? input : {};
  const phone = normalizePhone(b.phone);
  if (phone.error) return { error: phone.error };
  const raw = typeof b.useCase === 'string' ? b.useCase.trim().toLowerCase() : '';
  if (!raw) {
    if (requireUseCase) return { error: 'SIGNUP_USE_CASE' };
  } else if (!USE_CASES.includes(raw)) {
    return { error: 'SIGNUP_USE_CASE' };
  }
  const useCase = raw || null;
  const useCaseOther = useCase === 'other' ? cleanText(b.useCaseOther, LIMITS.useCaseOther) : null;
  if (useCase === 'other' && !useCaseOther) return { error: 'SIGNUP_USE_CASE_OTHER' };
  return { lead: { phone: phone.value, useCase, useCaseOther, company: cleanText(b.company, LIMITS.company) } };
}

module.exports = { USE_CASES, LIMITS, cleanText, normalizePhone, normalizeLead };
