'use strict';
// Owner certificate: proof that this is the source owner's machine, needed for the Super Admin
// licence exemption. Ed25519-signed { v: 1, machineId, issuedAt, note, sig } in <userData>/owner.cert,
// machineId = licenseClient.machineHash(). The private key never ships (scripts/owner-cert.js signs).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tenantConfig } = require('./tenantConfig');

const OWNER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAttNJLz4QS4sIf94t+4oS4yD1/w2AHyBY8ezgKWCZhKU=
-----END PUBLIC KEY-----`;

const CERT_FILE_NAME = 'owner.cert';

// The exact bytes that are signed: fixed key order, only the four certificate fields.
function certPayload(cert) {
  return Buffer.from(JSON.stringify({
    v: 1,
    machineId: String(cert.machineId),
    issuedAt: String(cert.issuedAt),
    note: String(cert.note == null ? '' : cert.note)
  }), 'utf8');
}

function signOwnerCert(privateKeyPem, machineId, note = '', issuedAt = new Date().toISOString()) {
  const id = String(machineId || '').trim();
  if (!id) throw new Error('machineId is required.');
  const cert = { v: 1, machineId: id, issuedAt: String(issuedAt), note: String(note || '').slice(0, 200) };
  const sig = crypto.sign(null, certPayload(cert), crypto.createPrivateKey(privateKeyPem));
  return { ...cert, sig: sig.toString('base64') };
}

// A tenant/sold build names a tenant in its baked (or, in dev, env) config, read as tenantConfig.js does.
// Fails closed: an unreadable config counts as a tenant build, so the exemption is never granted.
function isTenantBuild() {
  try {
    const cfg = tenantConfig();
    return Boolean(cfg.enabled || cfg.tenantId || cfg.apiBaseUrl || cfg.publicKeyPem);
  } catch (_) { return true; }
}

// Returns { ok: true } or { ok: false, reason }.
function verifyOwnerCert(cert, opts = {}) {
  const tenantBuild = opts.tenantBuild === undefined ? isTenantBuild() : Boolean(opts.tenantBuild);
  if (tenantBuild) return { ok: false, reason: 'tenant-build' };
  if (!cert || typeof cert !== 'object' || Array.isArray(cert)) return { ok: false, reason: 'missing' };
  if (cert.v !== 1) return { ok: false, reason: 'bad-version' };
  const want = String(opts.machineId || '').trim();
  if (!want || typeof cert.machineId !== 'string' || cert.machineId !== want) return { ok: false, reason: 'wrong-machine' };
  if (typeof cert.sig !== 'string' || !cert.sig || typeof cert.issuedAt !== 'string') return { ok: false, reason: 'bad-signature' };
  let ok = false;
  try {
    const pem = opts.publicKeyPem || OWNER_PUBLIC_KEY_PEM;
    ok = crypto.verify(null, certPayload(cert), crypto.createPublicKey(pem), Buffer.from(cert.sig, 'base64'));
  } catch (_) { ok = false; }
  return ok ? { ok: true } : { ok: false, reason: 'bad-signature' };
}

function ownerCertPath(userDataDir) { return path.join(String(userDataDir), CERT_FILE_NAME); }

function readOwnerCert(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; }
}

function checkOwnerCertFile(file, opts = {}) {
  return verifyOwnerCert(readOwnerCert(file), opts);
}

// Only a Super Admin with a valid certificate is the source owner; without one the role keeps its
// label but is licensed like any Owner.
function isCertifiedSuperAdmin(member, certOk) {
  return Boolean(member && member.role === 'SUPER_ADMIN' && certOk === true);
}

module.exports = {
  OWNER_PUBLIC_KEY_PEM,
  signOwnerCert,
  isTenantBuild,
  verifyOwnerCert,
  ownerCertPath,
  checkOwnerCertFile,
  isCertifiedSuperAdmin
};
