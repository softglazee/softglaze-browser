'use strict';
// Client for the SoftGlaze licensing backend. verifyLease() checks a backend-signed lease offline
// (Ed25519, baked tenant public key): tier/exp are trusted only if the signature verifies.
// api.* are thin HTTPS calls, inactive unless a tenant config is baked in.
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createPublicKey, createHash, verify: edVerify } = require('node:crypto');
const { tenantConfig } = require('./tenantConfig');

const fromB64url = (s) => Buffer.from(String(s), 'base64url');

// The server binds each install to one machine hash, signed into the lease as `mid`: SHA-256 of the
// OS machine id (MachineGuid, IOPlatformUUID, /etc/machine-id) salted with the tenant id. Not the
// getMachineId() UUID in ipcHandlers, which travels with a copied data folder.
function readOsMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
      const m = /MachineGuid\s+REG_\w+\s+(\S+)/i.exec(out);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 5000, encoding: 'utf8' });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v; } catch (_) {}
      }
    }
  } catch (_) {}
  // Last resort when the OS id is unreadable: stable host facts. Weaker, but still per-machine.
  const cpu = (os.cpus() || [])[0];
  return ['fallback', os.hostname(), process.platform, os.arch(), cpu ? cpu.model : '', os.totalmem()].join('|');
}

let cachedMachineHash = null;
function machineHash() {
  if (!cachedMachineHash) {
    cachedMachineHash = createHash('sha256').update(`softglaze-mid:v1:${tenantConfig().tenantId || ''}:${readOsMachineId()}`, 'utf8').digest('hex');
  }
  return cachedMachineHash;
}

// Last licensing problem for the renderer to explain, e.g. { reason: 'machine_mismatch' }. Cleared by
// the next successful lease fetch or a verified lease for this machine.
let lastIssue = null;
function noteIssue(reason) { lastIssue = { reason, at: Date.now() }; }
function licenseIssue() { return lastIssue ? { ...lastIssue } : null; }
function clearLicenseIssue() { lastIssue = null; }

// Verify a lease "<payloadB64url>.<sigB64url>". Returns
// { tenant, tier, exp, iat, account, plan, sub, mid, legacy } or null when invalid/expired.
// opts.machineHash overrides this machine's hash (tests).
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

  // A tenant-scoped build requires a matching tenant claim, so a tenant-less lease cannot activate
  // under it. The base build (no cfg.tenantId) stays unbound.
  if (cfg.tenantId && payload.tenant !== cfg.tenantId) return null;
  const nowSec = Math.floor((opts.nowMs || Date.now()) / 1000);
  if (!payload.exp || payload.exp < nowSec) return null; // expired

  // A lease with a mid must carry this machine's hash. A mid-less (legacy) lease is honoured only
  // until its short LEASE_DAYS expiry and is flagged so the caller fetches a bound one.
  const legacy = !payload.mid;
  if (!legacy) {
    const own = opts.machineHash || machineHash();
    if (String(payload.mid) !== own) { noteIssue('machine_mismatch'); return null; }
    if (lastIssue && lastIssue.reason === 'machine_mismatch') clearLicenseIssue();
  }

  return {
    tenant: payload.tenant || null,
    tier: payload.tier || 'pro',
    exp: payload.exp,
    iat: payload.iat || null,
    account: payload.account || null,
    plan: payload.plan || null,
    sub: payload.sub || null,
    mid: payload.mid || null,
    legacy
  };
}

const ERROR_TEXT = {
  machine_mismatch: 'This licence is registered to a different computer. Move it to this PC or ask your administrator to reset it.',
  machine_required: 'This app version is too old for the licensing server. Update the app.',
  transfer_limit: 'This licence has already been moved twice in the last 30 days.',
  invalid_proof: 'That activation code or payment reference does not match this licence.',
  no_license: 'There is no licence on this install to move.'
};

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
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve(json); return; }
        // Short error codes (machine_mismatch, transfer_limit, ...) are kept on err.code so
        // the caller can map them to a UI state; the message stays human-readable.
        const code = typeof json.error === 'string' && /^[a-z_]+$/.test(json.error) ? json.error : null;
        const err = new Error(code ? (ERROR_TEXT[code] || code) : (json.error || `Licensing backend error (${res.statusCode}).`));
        if (code) err.code = code;
        err.status = res.statusCode;
        if (code === 'machine_mismatch') noteIssue('machine_mismatch');
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Licensing backend timed out.')));
    req.write(payload);
    req.end();
  });
}

// The licensing server issues a per-install secret at first registration and requires it for
// license and redeem. An email is never a credential.
const api = {
  register: (machineId, account, installSecret) => postJson('/v1/register', { tenantId: tenantConfig().tenantId, machineId, account, installSecret, machineHash: machineHash() }),
  checkout: ({ planKey, installId, account, provider }) => postJson('/v1/checkout', { tenantId: tenantConfig().tenantId, planKey, installId, account, provider }),
  // license() resolving means this machine is accepted, so any machine_mismatch is cleared.
  license: ({ installId, installSecret }) => postJson('/v1/license', { tenantId: tenantConfig().tenantId, installId, installSecret, machineHash: machineHash() })
    .then((r) => { clearLicenseIssue(); return r; }),
  // Self-service move to this PC: install secret + proof of purchase (redeemed code or
  // payment reference), at most 2 per licence per 30 days (server-enforced).
  transfer: ({ installId, installSecret, proof }) => postJson('/v1/license/transfer', { tenantId: tenantConfig().tenantId, installId, installSecret, machineHash: machineHash(), proof })
    .then((r) => { clearLicenseIssue(); return r; }),
  redeem: ({ code, installId, installSecret }) => postJson('/v1/redeem', { tenantId: tenantConfig().tenantId, code, installId, installSecret })
};

module.exports = { verifyLease, api, postJson, machineHash, licenseIssue, clearLicenseIssue };
