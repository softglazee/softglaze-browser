'use strict';
// Client side of the SoftGlaze licensing backend. Two concerns:
//
//   1) verifyLease(token) — OFFLINE Ed25519 verification of a backend-signed lease
//      using the baked tenant public key. This is the trust boundary: tier/exp are
//      believed only if the signature checks out. Returns the entitlement or null.
//
//   2) api.* — thin HTTPS calls to the backend (register / checkout / license /
//      redeem). Inactive unless a tenant config is baked (tenantConfig().enabled).
//
// No new dependencies: Node's crypto.verify does Ed25519; node:https/http for I/O.
const https = require('node:https');
const http = require('node:http');
const { createPublicKey, verify: edVerify } = require('node:crypto');
const { tenantConfig } = require('./tenantConfig');

const fromB64url = (s) => Buffer.from(String(s), 'base64url');

// Verify a lease "<payloadB64url>.<sigB64url>". Returns
// { tenant, tier, exp, iat, account, plan, sub } or null when invalid/expired.
function verifyLease(token, opts = {}) {
  const cfg = tenantConfig();
  const pem = opts.publicKeyPem || cfg.publicKeyPem;
  if (!pem || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  let sig;
  try { sig = fromB64url(token.slice(dot + 1)); } catch (_) { return null; }

  let ok = false;
  try { ok = edVerify(null, Buffer.from(payloadB64), createPublicKey(pem), sig); }
  catch (_) { return null; }
  if (!ok) return null;

  let payload;
  try { payload = JSON.parse(fromB64url(payloadB64).toString('utf8')); }
  catch (_) { return null; }

  // Bind to this tenant (when the build is tenant-scoped).
  if (cfg.tenantId && payload.tenant && payload.tenant !== cfg.tenantId) return null;
  const nowSec = Math.floor((opts.nowMs || Date.now()) / 1000);
  if (!payload.exp || payload.exp < nowSec) return null; // expired

  return {
    tenant: payload.tenant || null,
    tier: payload.tier || 'pro',
    exp: payload.exp,
    iat: payload.iat || null,
    account: payload.account || null,
    plan: payload.plan || null,
    sub: payload.sub || null
  };
}

// --- thin backend transport -------------------------------------------------
function postJson(pathName, body) {
  const cfg = tenantConfig();
  if (!cfg.enabled) return Promise.reject(new Error('Licensing backend is not configured for this build.'));
  const url = new URL(cfg.apiBaseUrl + pathName);
  const lib = url.protocol === 'http:' ? http : https;
  const payload = Buffer.from(JSON.stringify(body || {}));
  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: url.pathname + url.search,
    headers: { 'content-type': 'application/json', 'content-length': payload.length }
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = {};
        try { json = data ? JSON.parse(data) : {}; } catch (_) { json = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(json.error || `Licensing backend error (${res.statusCode}).`));
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Licensing backend timed out.')));
    req.write(payload);
    req.end();
  });
}

const api = {
  register: (machineId, account) => postJson('/v1/register', { tenantId: tenantConfig().tenantId, machineId, account }),
  checkout: ({ planKey, installId, account, provider }) => postJson('/v1/checkout', { tenantId: tenantConfig().tenantId, planKey, installId, account, provider }),
  license: ({ installId, account }) => postJson('/v1/license', { tenantId: tenantConfig().tenantId, installId, account }),
  redeem: ({ code, installId, account }) => postJson('/v1/redeem', { tenantId: tenantConfig().tenantId, code, installId, account })
};

module.exports = { verifyLease, api, postJson };
