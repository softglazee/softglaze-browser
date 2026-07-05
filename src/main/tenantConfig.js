'use strict';
// Baked per-tenant config: { tenantId, apiBaseUrl, publicKeyPem }.
//
// The per-tenant build pipeline overwrites tenant.config.json with the merchant's
// values (from `provision-tenant.js`). The BASE build ships empty values, which
// means `enabled` is false and the app keeps its existing local trial/license
// behavior — the licensing backend is simply inactive.
//
// Env vars override the file (handy for dev/testing without rebaking):
//   SG_TENANT_ID, SG_API_BASE_URL, SG_TENANT_PUBLIC_KEY
const fs = require('node:fs');
const path = require('node:path');

// audit: license leases/tokens and the update feed must never travel over
// cleartext http. Require https for any real host; allow http ONLY for
// localhost/loopback (dev backends). A misconfigured http URL is dropped (treated
// as unset) with a warning rather than silently sending secrets in the clear.
function sanitizeSecureUrl(raw, label) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { console.warn(`[tenantConfig] ignoring invalid ${label}: "${s}"`); return ''; }
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocal)) return s;
  console.warn(`[tenantConfig] ignoring non-https ${label} ("${u.protocol}//…") — secrets must not travel in cleartext.`);
  return '';
}

function load() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'tenant.config.json'), 'utf8')) || {}; }
  catch (_) { fileCfg = {}; }
  const tenantId = String(process.env.SG_TENANT_ID || fileCfg.tenantId || '').trim();
  const apiBaseUrl = sanitizeSecureUrl(process.env.SG_API_BASE_URL || fileCfg.apiBaseUrl || '', 'apiBaseUrl');
  const publicKeyPem = String(process.env.SG_TENANT_PUBLIC_KEY || fileCfg.publicKeyPem || '').trim();
  // Buyer-owned auto-update feed (a generic URL hosting latest.yml + installers).
  // Empty -> auto-update stays off (the build never phones a default/seller feed).
  const updateFeedUrl = sanitizeSecureUrl(process.env.SG_UPDATE_FEED_URL || fileCfg.updateFeedUrl || '', 'updateFeedUrl');
  return {
    tenantId,
    apiBaseUrl,
    publicKeyPem,
    updateFeedUrl,
    enabled: Boolean(tenantId && apiBaseUrl && publicKeyPem)
  };
}

let cached = null;
function tenantConfig() { if (!cached) cached = load(); return cached; }
// Test seam: drop the memoized value so a test can re-read after changing env.
function _reset() { cached = null; }

module.exports = { tenantConfig, _reset };
