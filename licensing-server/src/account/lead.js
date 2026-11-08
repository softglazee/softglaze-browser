'use strict';
// Lead details the app sends with POST /v1/account/verify/start (app 1.0.23 and later): phone, what the
// person will use SoftGlaze for, and company or website. All optional on the server, so older apps that
// send none of them work as before; the app itself asks for the use case. A value that is sent must be
// valid, so a bad phone or an unknown use case is refused with a clear code instead of being stored.

// The use cases on the website home page ("Who uses it"), plus "other" with a short text. The app keeps
// the same list (src/main/signupLead.js, src/renderer/lib/signupLead.mjs); a test checks they match.
const USE_CASES = Object.freeze(['ecommerce', 'social_media', 'affiliate_marketing', 'agency', 'web_research', 'other']);

const MAX = Object.freeze({ phone: 40, company: 200, useCaseOther: 200 });

// Strips control characters and angle brackets, folds whitespace. '' -> null.
function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Loose international phone check: starts with + (or 00) and the country code, 7 to 15 digits (the
// E.164 maximum), spaces, brackets, dots and dashes allowed. A leading 00 is stored as +.
// -> { value } (null when empty) or { error: 'invalid_phone' }.
function cleanPhone(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'string') return { error: 'invalid_phone' };
  let s = v.replace(/\s+/g, ' ').trim();
  if (!s) return { value: null };
  if (s.startsWith('00')) s = `+${s.slice(2).trim()}`;
  if (s.length > MAX.phone || !/^\+[0-9 ()\-.]+$/.test(s)) return { error: 'invalid_phone' };
  const digits = s.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return { error: 'invalid_phone' };
  return { value: s };
}

// input: the verify/start body. -> { lead: { phone, company, useCase, useCaseOther } } or { error, field }.
// Every field is null when not sent. useCaseOther is kept only with useCase 'other'.
function cleanLead(input) {
  const b = input && typeof input === 'object' ? input : {};
  const phone = cleanPhone(b.phone);
  if (phone.error) return { error: 'invalid_phone', field: 'phone' };
  let useCase = null;
  if (b.useCase !== undefined && b.useCase !== null && b.useCase !== '') {
    useCase = typeof b.useCase === 'string' ? b.useCase.trim().toLowerCase() : '';
    if (!USE_CASES.includes(useCase)) return { error: 'invalid_use_case', field: 'useCase' };
  }
  return {
    lead: {
      phone: phone.value,
      company: cleanText(b.company, MAX.company),
      useCase,
      useCaseOther: useCase === 'other' ? cleanText(b.useCaseOther, MAX.useCaseOther) : null
    }
  };
}

// The customer fields a verified sign-up sets: what the person just typed wins over what was stored,
// and a field they left empty keeps the stored value. A new use case replaces the "other" text.
function leadUpdate(customer, lead) {
  const c = customer || {};
  const l = lead || {};
  const out = {};
  if (l.phone && l.phone !== c.phone) out.phone = l.phone;
  if (l.company && l.company !== c.company) out.company = l.company;
  if (l.useCase) {
    if (l.useCase !== c.useCase) out.useCase = l.useCase;
    const other = l.useCase === 'other' ? (l.useCaseOther || null) : null;
    if (other !== (c.useCaseOther ?? null)) out.useCaseOther = other;
  }
  return out;
}

module.exports = { USE_CASES, MAX, cleanText, cleanPhone, cleanLead, leadUpdate };
