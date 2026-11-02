'use strict';
// Binary downloads get executed, so a tampered file is RCE. Vendor hashes change every release, so
// integrity relies on TLS: https only, and every hop, redirects included, must be an allowlisted host.

// Suffix-aware host match: an allow entry "mozilla.org" matches "mozilla.org" and
// any "*.mozilla.org" subdomain, but never "notmozilla.org".
function hostAllowed(hostname, allowedHosts) {
  const h = String(hostname || '').toLowerCase();
  return allowedHosts.some((a) => h === a || h.endsWith('.' + a));
}

// Throws (fatal) unless the URL is https on an allowlisted host; returns the parsed URL.
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

// Resolves a possibly relative Location, then re-validates it so a redirect cannot leave the allowlist.
function resolveRedirect(location, baseUrl, allowedHosts, label = 'download') {
  const next = new URL(String(location), baseUrl).toString();
  assertAllowedDownloadUrl(next, allowedHosts, label);
  return next;
}

const HOSTS = {
  chrome: ['googlechromelabs.github.io', 'storage.googleapis.com', 'commondatastorage.googleapis.com', 'edgedl.me.gvt1.com'],
  firefox: ['mozilla.org', 'mozilla.net'],
  crx: ['google.com', 'googleusercontent.com', 'gvt1.com'],
  // fingerprint-chromium releases: github.com asset URLs 302 to *.githubusercontent.com,
  // so both hosts must be allowlisted.
  fpchromium: ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'codeload.github.com']
};

module.exports = { hostAllowed, assertAllowedDownloadUrl, resolveRedirect, HOSTS };
