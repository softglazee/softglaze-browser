'use strict';
// Redaction for anything that leaves a tool call: the audit row, the approval dialog and error
// text. Typed text, passwords, tokens and page content never reach the log; ids, names and
// counts stay so the owner can see what happened.

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|auth|cookie|session[-_]?id|otp|totp|2fa|seed|cvv|card|iban|ssn/i;
// Free text the AI sends that can carry credentials or personal data.
const TEXT_KEYS = new Set(['text', 'value', 'markdown', 'content', 'body']);
const MAX_STRING = 200;
const MAX_ARRAY = 25;
const MAX_DEPTH = 4;

function redactValue(key, value, depth) {
  if (value == null) return value;
  if (typeof key === 'string' && SECRET_KEY.test(key)) return '[hidden]';
  if (typeof key === 'string' && TEXT_KEYS.has(key) && typeof value === 'string') {
    return `[${value.length} characters hidden]`;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => redactValue(key === 'steps' ? null : key, v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`… ${value.length - MAX_ARRAY} more`);
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(k, v, depth + 1);
    return out;
  }
  return String(value);
}

// Redacted copy of tool arguments. Macro steps keep their type and selector, never their value.
function redactArgs(args) {
  if (!args || typeof args !== 'object') return {};
  return redactValue(null, args, 0);
}

// Removes anything that looks like a credential from an error message before it is shown to an
// AI client or stored: proxy URLs with userinfo, bearer tokens and SoftGlaze tokens.
function scrubText(text) {
  return String(text == null ? '' : text)
    .replace(/\b(sgai|sg)_[A-Za-z0-9_-]{8,}/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[credentials]@')
    .slice(0, 1000);
}

module.exports = { redactArgs, scrubText, SECRET_KEY };
