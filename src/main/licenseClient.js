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
const { installChannel } = require('./installChannel');

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

// A lease issued for the server's free trial says so with a signed `type: 'trial'` claim (a trial plan
// key is accepted too); every other lease is a paid term.
function leaseType(payload) {
  if (String(payload.type || '').toLowerCase() === 'trial') return 'trial';
  if (/^(free-)?trial$/i.test(String(payload.plan || ''))) return 'trial';
  return 'paid';
}

// The installed app version, sent with licence calls so the owner's admin shows it.
let cachedAppVersion = null;
function appVersion() {
  if (cachedAppVersion !== null) return cachedAppVersion;
  let v = '';
  // Guarded: under plain node (tests) require('electron') is the binary path, not the API.
  try { const { app } = require('electron'); if (app && typeof app.getVersion === 'function') v = app.getVersion(); } catch (_) {}
  if (!v) { try { v = require('../../package.json').version; } catch (_) {} }
  cachedAppVersion = String(v || '').slice(0, 32);
  return cachedAppVersion;
}

// Verify a lease "<payloadB64url>.<sigB64url>". Returns
// { tenant, tier, type, exp, iat, account, plan, sub, mid, legacy } or null when invalid/expired.
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
    type: leaseType(payload),
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

function requestJson(method, pathName, body, opts = {}) {
  const cfg = tenantConfig();
  if (!cfg.enabled) return Promise.reject(new Error('Licensing backend is not configured for this build.'));
  const url = new URL(cfg.apiBaseUrl + pathName);
  const lib = url.protocol === 'http:' ? http : https;
  const payload = method === 'GET' ? null : Buffer.from(JSON.stringify(body || {}));
  const options = {
    method,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: url.pathname + url.search,
    headers: payload
      ? { 'content-type': 'application/json', 'content-length': payload.length }
      : { accept: 'application/json' }
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
        // e.g. trial_used carries reason 'machine' | 'email' | 'network'.
        if (typeof json.reason === 'string') err.reason = json.reason;
        // move_limit (one-click sign-in) says when the next move is possible.
        if (typeof json.retryAt === 'string') err.retryAt = json.retryAt;
        if (code === 'machine_mismatch') noteIssue('machine_mismatch');
        reject(err);
      });
    });
    // No HTTP answer at all (offline, DNS, refused, timed out): flagged so callers can say "offline".
    req.on('error', (e) => { if (e && typeof e === 'object') e.network = true; reject(e); });
    req.setTimeout(Number(opts.timeoutMs) || 15000, () => req.destroy(new Error('Licensing backend timed out.')));
    if (payload) req.write(payload);
    req.end();
  });
}

function postJson(pathName, body) { return requestJson('POST', pathName, body); }

// The licensing server issues a per-install secret at first registration and requires it for
// license and redeem. An email is never a credential.
const api = {
  // `channel` (store | website | base, see installChannel.js) rides on register, licence refresh,
  // verify/start and trial/start, so the owner's admin can count installs by where they came from.
  register: (machineId, account, installSecret) => postJson('/v1/register', { tenantId: tenantConfig().tenantId, machineId, account, installSecret, machineHash: machineHash(), channel: installChannel() }),
  checkout: ({ planKey, installId, account, provider }) => postJson('/v1/checkout', { tenantId: tenantConfig().tenantId, planKey, installId, account, provider }),
  // license() resolving means this machine is accepted, so any machine_mismatch is cleared.
  license: ({ installId, installSecret }) => postJson('/v1/license', { tenantId: tenantConfig().tenantId, installId, installSecret, machineHash: machineHash(), appVersion: appVersion(), channel: installChannel() })
    .then((r) => { clearLicenseIssue(); return r; }),
  // Self-service move to this PC: install secret + proof of purchase (redeemed code or
  // payment reference), at most 2 per licence per 30 days (server-enforced).
  transfer: ({ installId, installSecret, proof }) => postJson('/v1/license/transfer', { tenantId: tenantConfig().tenantId, installId, installSecret, machineHash: machineHash(), proof })
    .then((r) => { clearLicenseIssue(); return r; }),
  redeem: ({ code, installId, installSecret }) => postJson('/v1/redeem', { tenantId: tenantConfig().tenantId, code, installId, installSecret }),
  // Sign-up email check by the licensing server: it emails a 6-digit code from its own address
  // (never shown in-app) and refuses invalid_email, disposable_email, no_mx and rate_limited.
  // From 1.0.23 also the lead details (phone, useCase, useCaseOther, company), each only when filled.
  verifyStart: ({ installId, installSecret, email, name, consentMarketing, lang, phone, useCase, useCaseOther, company }) => postJson('/v1/account/verify/start', {
    tenantId: tenantConfig().tenantId, installId, installSecret, email, name: name || undefined, consentMarketing: consentMarketing === true, lang: lang || 'en',
    phone: phone || undefined, useCase: useCase || undefined, useCaseOther: useCaseOther || undefined, company: company || undefined,
    appVersion: appVersion(), channel: installChannel()
  }),
  // -> { verified: true, customerId }; links this install to the verified customer.
  verifyCheck: ({ installId, installSecret, email, code }) => postJson('/v1/account/verify/check', { tenantId: tenantConfig().tenantId, installId, installSecret, email, code }),
  // The trial ledger: one free trial per computer and per email. -> the signed trial lease, or 409 trial_used.
  trialStart: ({ installId, installSecret, email }) => postJson('/v1/trial/start', { tenantId: tenantConfig().tenantId, installId, installSecret, machineHash: machineHash(), email, appVersion: appVersion(), channel: installChannel() }),
  // -> { verified, email? }: does this install have a customer whose email the server verified? Asked on
  // every start (signupConfirm.js), so it gives up quickly when the server cannot be reached.
  accountStatus: ({ installId, installSecret }) => requestJson('POST', '/v1/account/status', { tenantId: tenantConfig().tenantId, installId, installSecret, appVersion: appVersion(), channel: installChannel() }, { timeoutMs: 6000 }),
  // Public price list (no auth): the active plans and their prices.
  plans: () => requestJson('GET', `/v1/plans/public?tenantId=${encodeURIComponent(tenantConfig().tenantId)}`, null, { timeoutMs: 8000 }),
  // Public (no auth): the website payment providers switched on for this tenant, with their names, and
  // whether Microsoft Store sales are on. -> { providers: [{ id, label, kind }], store: { salesEnabled } }
  checkoutMethods: () => requestJson('GET', `/v1/checkout/methods?tenantId=${encodeURIComponent(tenantConfig().tenantId)}`, null, { timeoutMs: 8000 }),

  // One-click sign-in (1.0.26, licensing-server/src/routes/auth.js). The browser leg runs in the system browser;
  // these are the app's own calls, each with the install secret.
  // -> { providers: ['github'], email: true }: the sign-in providers whose keys the server has.
  authProviders: () => requestJson('GET', `/auth/providers?tenantId=${encodeURIComponent(tenantConfig().tenantId)}`, null, { timeoutMs: 6000 }),
  // The one-time code from softglaze://auth (or the loopback listener) and the PKCE verifier -> the sign-in.
  authExchange: ({ installId, installSecret, code, codeVerifier, expectCustomerId }) => postJson('/auth/exchange', {
    tenantId: tenantConfig().tenantId, installId, installSecret, code, codeVerifier, expectCustomerId: expectCustomerId || undefined,
    appVersion: appVersion(), channel: installChannel()
  }),
  // "Continue with email": the same 6-digit code as verify/start, which then IS the sign-in.
  authEmailStart: ({ installId, installSecret, email, lang }) => postJson('/auth/email/start', {
    tenantId: tenantConfig().tenantId, installId, installSecret, email, lang: lang || 'en', appVersion: appVersion(), channel: installChannel()
  }),
  authEmailVerify: ({ installId, installSecret, email, code, expectCustomerId }) => postJson('/auth/email/verify', {
    tenantId: tenantConfig().tenantId, installId, installSecret, email, code, expectCustomerId: expectCustomerId || undefined
  }),
  // -> { signedIn, provider, customer, methods, licence } or 401 session_invalid.
  authMe: ({ installId, installSecret, session }) => requestJson('POST', '/auth/me', { tenantId: tenantConfig().tenantId, installId, installSecret, session }, { timeoutMs: 8000 }),
  authProfile: ({ installId, installSecret, session, useCase, useCaseOther }) => requestJson('POST', '/auth/profile', { tenantId: tenantConfig().tenantId, installId, installSecret, session, useCase, useCaseOther }, { timeoutMs: 8000 }),
  // -> { ok, moved, remaining } | 429 move_limit (2 moves per licence per 30 days).
  authMoveLicence: ({ installId, installSecret, session }) => postJson('/auth/licence/move', { tenantId: tenantConfig().tenantId, installId, installSecret, session, move: true }),
  authLogout: ({ installId, installSecret, session }) => requestJson('POST', '/auth/logout', { tenantId: tenantConfig().tenantId, installId, installSecret, session }, { timeoutMs: 6000 })
};

module.exports = { verifyLease, api, postJson, machineHash, appVersion, licenseIssue, clearLicenseIssue };
