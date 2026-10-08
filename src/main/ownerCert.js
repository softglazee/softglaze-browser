'use strict';
// Owner certificate (audit L1). The Super Admin role used to carry the source-owner
// licence exemption on its own, and any customer could claim the role on a fresh
// install - unlimited enterprise use, tenant builds included. The exemption (and
// claiming the role, and the licence-management powers) now needs proof that this is
// the source owner's own machine: an Ed25519-signed certificate
//   { v: 1, machineId, issuedAt, note, sig }
// read from <userData>/owner.cert, signed by the OWNER key whose PUBLIC half is baked
// in below. The private key never ships; scripts/owner-cert.js signs certificates.
//
// machineId is the app's licensing machine id: licenseClient.machineHash() (SHA-256 of
// the OS machine identity, the same value the licensing server binds a lease to). Not
// the settings-stored getMachineId() UUID, which travels with a copied data folder.
// A tenant / sold build never honours a certificate.
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

// A tenant / sold build: anything baked (or, in dev, env-set) that names a tenant.
// Same source of truth as tenantConfig.js. Fails closed: an unreadable config counts
// as a tenant build so the exemption is never granted by accident.
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

// Only a Super Admin WITH a valid certificate is the source owner. Without one the
// role keeps its label but is licensed like any Owner.
function isCertifiedSuperAdmin(member, certOk) {
  return Boolean(member && member.role === 'SUPER_ADMIN' && certOk === true);
}

module.exports = {
  OWNER_PUBLIC_KEY_PEM,
  CERT_FILE_NAME,
  certPayload,
  signOwnerCert,
  isTenantBuild,
  verifyOwnerCert,
  ownerCertPath,
  readOwnerCert,
  checkOwnerCertFile,
  isCertifiedSuperAdmin
};
