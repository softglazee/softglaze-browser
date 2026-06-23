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

function load() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'tenant.config.json'), 'utf8')) || {}; }
  catch (_) { fileCfg = {}; }
  const tenantId = String(process.env.SG_TENANT_ID || fileCfg.tenantId || '').trim();
  const apiBaseUrl = String(process.env.SG_API_BASE_URL || fileCfg.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const publicKeyPem = String(process.env.SG_TENANT_PUBLIC_KEY || fileCfg.publicKeyPem || '').trim();
  // Buyer-owned auto-update feed (a generic URL hosting latest.yml + installers).
  // Empty -> auto-update stays off (the build never phones a default/seller feed).
  const updateFeedUrl = String(process.env.SG_UPDATE_FEED_URL || fileCfg.updateFeedUrl || '').trim().replace(/\/+$/, '');
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
