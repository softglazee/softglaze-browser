'use strict';
// Baked per-tenant config { tenantId, apiBaseUrl, publicKeyPem, updateFeedUrl, checkoutProviders?,
// distribution? }; the base build ships it empty,
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

// Providers the licensing server can run a checkout for (licensing-server/src/routes/checkout.js).
const CHECKOUT_PROVIDERS = ['cryptomus', 'stripe', 'paypal'];

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
  // Payment providers switched on for this tenant on the licensing server. A customer's fresh install
  // has no local gateway config, so a tenant build offers exactly these at checkout. Unknown names are
  // dropped; the server still refuses any provider it hasn't enabled.
  const rawProviders = env.SG_CHECKOUT_PROVIDERS
    ? String(env.SG_CHECKOUT_PROVIDERS).split(',')
    : (Array.isArray(fileCfg.checkoutProviders) ? fileCfg.checkoutProviders : []);
  const checkoutProviders = [...new Set(rawProviders
    .map((p) => String(p).trim().toLowerCase())
    .filter((p) => CHECKOUT_PROVIDERS.includes(p)))];
  // 'store' when scripts/build-store.js made this build (see installChannel.js). Baked only, no env.
  const distribution = String(fileCfg.distribution || '').trim().toLowerCase() === 'store' ? 'store' : '';
  return {
    tenantId,
    apiBaseUrl,
    publicKeyPem,
    updateFeedUrl,
    checkoutProviders,
    distribution,
    enabled: Boolean(tenantId && apiBaseUrl && publicKeyPem)
  };
}

let cached = null;
function tenantConfig() { if (!cached) cached = load(); return cached; }
// Test seam: drop the memoized value so a test can re-read after changing env.
function _reset() { cached = null; }

module.exports = { tenantConfig, _reset };
