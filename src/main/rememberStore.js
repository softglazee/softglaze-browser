'use strict';

// Keep me signed in: stores the startup-gate credential sealed with safeStorage (DPAPI on Windows).
// Never written without OS encryption (unlike secretStore), and kept as a file in userData, not in
// the DB, which it may unlock. Off until the user opts in at login. Kinds: vault, super, member.

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
  const fp = filePath();
  try {
    if (!fs.existsSync(fp)) return null; // no remembered credential - the normal case
    // OS crypto may be down only for this boot: keep the blob and retry next launch rather than
    // delete a possibly good credential.
    if (!isAvailable()) return null;
    const buf = fs.readFileSync(fp);
    const json = safeStorage.decryptString(buf);
    const blob = JSON.parse(json);
    return blob && typeof blob === 'object' && blob.kind ? blob : null;
  } catch (e) {
    // The keychain works but the blob will not decrypt or parse: it is corrupt or sealed under another
    // OS crypto context, so it can never work. Delete it, or every boot fails at the gate; a fresh login
    // re-seals. The absent and unavailable cases above must not delete anything.
    console.error('[rememberStore] stored credential is unusable - clearing it to self-heal:', e && e.message);
    try { fs.unlinkSync(fp); } catch (e2) { /* best-effort */ }
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
