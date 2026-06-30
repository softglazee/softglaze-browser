'use strict';

// "Keep me signed in on this device" — persists the credential that opens the
// startup gate (workspace vault password, the DB-at-rest key, or a super/team
// member login) so the user is not asked for it again after an app restart.
//
// CRITICAL DESIGN NOTES
//  - The blob is sealed with the OS keychain via Electron's safeStorage (DPAPI on
//    Windows). It is encrypted to the logged-in Windows account — never written in
//    plaintext. If OS encryption is unavailable we REFUSE to write (a login secret
//    must never hit disk in the clear), unlike secretStore which fails open.
//  - It is stored as a FILE in userData, NOT in the SQLite Setting table. The DB may
//    be encrypted-at-rest and therefore unreadable at boot — the whole point of this
//    file is to hold the key that decrypts it, so it cannot live inside it.
//  - Default is OFF: the file only exists once the user ticks the checkbox at login.
//
// Blob shape (discriminated by `kind`):
//   { kind: 'vault',  password }                 — workspace vault / DB-at-rest key
//   { kind: 'super',  identifier, password }     — Super Admin source-owner login
//   { kind: 'member', identifier, password }     — team-member login

const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');

const FILE_NAME = 'remember-login.bin';

function filePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function isAvailable() {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  } catch (e) {
    return false;
  }
}

// Seal + persist the blob. Returns { ok, reason }. Never throws.
function write(blob) {
  if (!blob || typeof blob !== 'object' || !blob.kind) return { ok: false, reason: 'invalid' };
  if (!isAvailable()) return { ok: false, reason: 'unavailable' };
  try {
    const buf = safeStorage.encryptString(JSON.stringify(blob));
    fs.writeFileSync(filePath(), buf);
    return { ok: true };
  } catch (e) {
    console.error('[rememberStore] write failed:', e && e.message);
    return { ok: false, reason: e && e.message };
  }
}

// Read + unseal the blob, or null when absent/unreadable. Never throws.
function read() {
  try {
    const fp = filePath();
    if (!fs.existsSync(fp)) return null;
    if (!isAvailable()) return null;
    const buf = fs.readFileSync(fp);
    const json = safeStorage.decryptString(buf);
    const blob = JSON.parse(json);
    return blob && typeof blob === 'object' && blob.kind ? blob : null;
  } catch (e) {
    console.error('[rememberStore] read failed:', e && e.message);
    return null;
  }
}

function clear() {
  try {
    const fp = filePath();
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {
    console.error('[rememberStore] clear failed:', e && e.message);
  }
}

function exists() {
  try {
    return fs.existsSync(filePath());
  } catch (e) {
    return false;
  }
}

// Lightweight, non-secret status for the renderer (never exposes the blob).
function status() {
  const present = exists();
  let kind = null;
  if (present) {
    const blob = read();
    kind = blob ? blob.kind : null;
  }
  return { enabled: present, available: isAvailable(), kind };
}

module.exports = { write, read, clear, exists, status, isAvailable };
