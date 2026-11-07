'use strict';
// Email addresses: a strict syntax check (dot-atom local part, a real-looking domain), the stored
// form (trimmed, lowercase, IDN domains in punycode) and the uniqueness key `emailKey`, which also
// folds Gmail's aliases: dots in the local part and a +tag are ignored by gmail.com and
// googlemail.com, and googlemail.com is the same mailbox as gmail.com.
// The SQL backfill in prisma/migrations/20261107120100_* computes the same key.
const { domainToASCII } = require('node:url');

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

// Returns the normalised address, or null when it is not a usable email address.
function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 254 || /[\s<>()\[\],;:"\\]/.test(s)) return null;
  const at = s.lastIndexOf('@');
  if (at <= 0 || at !== s.indexOf('@')) return null;
  const local = s.slice(0, at).toLowerCase();
  let domain = s.slice(at + 1).toLowerCase().replace(/\.$/, '');
  if (local.length > 64 || !LOCAL_RE.test(local)) return null;
  if (/[^\x00-\x7f]/.test(domain)) domain = domainToASCII(domain);
  if (!domain || domain.length > 253) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return null;
  if (!TLD_RE.test(labels[labels.length - 1])) return null;
  const out = `${local}@${domain}`;
  return out.length <= 254 ? out : null;
}

function emailDomain(normalized) {
  const s = String(normalized || '');
  return s.slice(s.lastIndexOf('@') + 1);
}

// The uniqueness key for an already-normalised address.
function emailKeyOf(normalized) {
  const s = String(normalized || '');
  const at = s.lastIndexOf('@');
  if (at <= 0) return s;
  let local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split('+')[0].replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  return s;
}

// Convenience: { email, emailKey, domain } or null.
function parseEmail(input) {
  const email = normalizeEmail(input);
  if (!email) return null;
  const emailKey = emailKeyOf(email);
  if (emailKey.startsWith('@')) return null; // "+tag@gmail.com" has no mailbox name left
  return { email, emailKey, domain: emailDomain(email) };
}

module.exports = { normalizeEmail, emailKeyOf, emailDomain, parseEmail };
