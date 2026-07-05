'use strict';
// ---------------------------------------------------------------------------
// Integrity guard for main-process BINARY downloads (Chrome-for-Testing builds,
// Firefox installers, Chrome Web Store .crx). These are executed/installed, so a
// tampered download is remote code execution.
//
// We cannot pin a per-version SHA-256 for vendor builds whose hashes change on
// every release and are not published in a consumable, pinned form. So the
// integrity story is transport-based and strict:
//   • https ONLY — reject http (no TLS-stripping downgrade), and
//   • the connection AND every redirect must stay on an allowlisted VENDOR host.
// TLS then authenticates every byte as genuinely from the real vendor origin, and
// a compromised mirror / redirect substitution / MITM cannot point us at attacker
// code because the redirect target is re-validated against the allowlist.
// ---------------------------------------------------------------------------

// Suffix-aware host match: an allow entry "mozilla.org" matches "mozilla.org" and
// any "*.mozilla.org" subdomain, but never "notmozilla.org".
function hostAllowed(hostname, allowedHosts) {
  const h = String(hostname || '').toLowerCase();
  return allowedHosts.some((a) => h === a || h.endsWith('.' + a));
}

// Validate a URL for a binary download. Throws (fatal) if it is not https or its
// host is not on the vendor allowlist. Returns the parsed URL.
function assertAllowedDownloadUrl(url, allowedHosts, label = 'download') {
  let u;
  try { u = new URL(String(url)); } catch (e) { throw Object.assign(new Error(`Invalid ${label} URL.`), { fatal: true }); }
  if (u.protocol !== 'https:') {
    throw Object.assign(new Error(`Refusing non-https ${label} URL ("${u.protocol}//…").`), { fatal: true });
  }
  if (!hostAllowed(u.hostname, allowedHosts)) {
    throw Object.assign(new Error(`Refusing ${label} from untrusted host "${u.hostname}".`), { fatal: true });
  }
  return u;
}

// Resolve a (possibly relative) redirect Location against the current URL, then
// re-validate the result against the allowlist. Fixes two audit issues at once: a
// relative Location previously threw ("Invalid URL"), and a cross-host redirect was
// followed blindly.
function resolveRedirect(location, baseUrl, allowedHosts, label = 'download') {
  const next = new URL(String(location), baseUrl).toString();
  assertAllowedDownloadUrl(next, allowedHosts, label);
  return next;
}

// Vendor host allowlists per download type.
const HOSTS = {
  chrome: ['googlechromelabs.github.io', 'storage.googleapis.com', 'commondatastorage.googleapis.com', 'edgedl.me.gvt1.com'],
  firefox: ['mozilla.org', 'mozilla.net'],
  crx: ['google.com', 'googleusercontent.com', 'gvt1.com']
};

module.exports = { hostAllowed, assertAllowedDownloadUrl, resolveRedirect, HOSTS };
