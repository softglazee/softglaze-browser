'use strict';
// Baked per-tenant config { tenantId, apiBaseUrl, publicKeyPem }; the base build ships it empty,
// which leaves licensing inactive. SG_* env vars override it only in unpackaged (dev) runs, so an
// installed app cannot be pointed at another licensing backend or signing key.
const fs = require('node:fs');
const path = require('node:path');

// License tokens and the update feed must never use cleartext http: require https except for
// loopback, and drop a bad URL (treated as unset) with a warning.
function sanitizeSecureUrl(raw, label) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { console.warn(`[tenantConfig] ignoring invalid ${label}: "${s}"`); return ''; }
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocal)) return s;
  console.warn(`[tenantConfig] ignoring non-https ${label} ("${u.protocol}//…") - secrets must not travel in cleartext.`);
  return '';
}

// Guarded: under plain node (tests) require('electron') is the binary path, not the API.
function isPackagedApp() {
  try { const { app } = require('electron'); return Boolean(app && app.isPackaged); } catch (_) { return false; }
}

function load() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'tenant.config.json'), 'utf8')) || {}; }
  catch (_) { fileCfg = {}; }
  const env = isPackagedApp() ? {} : process.env;
  const tenantId = String(env.SG_TENANT_ID || fileCfg.tenantId || '').trim();
  const apiBaseUrl = sanitizeSecureUrl(env.SG_API_BASE_URL || fileCfg.apiBaseUrl || '', 'apiBaseUrl');
  const publicKeyPem = String(env.SG_TENANT_PUBLIC_KEY || fileCfg.publicKeyPem || '').trim();
  // Buyer-owned update feed (generic URL with latest.yml and installers); empty keeps auto-update off.
  const updateFeedUrl = sanitizeSecureUrl(env.SG_UPDATE_FEED_URL || fileCfg.updateFeedUrl || '', 'updateFeedUrl');
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
