'use strict';
// The SoftGlaze account this workspace signed in with (one-click sign-in, 1.0.26), sealed with Electron
// safeStorage (DPAPI on Windows) in userData, next to remember-login.bin and never in the database it may unlock.
//   { v: 1, installId, customerId, email, name, provider, methods, session, sessionAt, deviceKey }
// `session` is the server's session token (Settings > Account, Sign out). `deviceKey` is the random workspace
// key of a workspace created by one-click sign-in (its vault has no password a person knows): it stays after
// Sign out, so signing in again with the same account opens the workspace, and it never leaves this computer.
// Never written without OS encryption. Dependencies are passed in, so tests run it without Electron.
const path = require('node:path');
const fs = require('node:fs');

const FILE_NAME = 'softglaze-account.bin';

// deps: { safeStorage, dir: () => userData folder }
function createAccountSession({ safeStorage, dir }) {
  const file = () => path.join(dir(), FILE_NAME);

  function available() {
    try { return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()); } catch (_) { return false; }
  }

  // -> the record, or null when absent, unreadable or the OS keychain is down for this boot.
  function read() {
    try {
      if (!fs.existsSync(file()) || !available()) return null;
      const rec = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
      return rec && typeof rec === 'object' && rec.v === 1 ? rec : null;
    } catch (_) {
      return null;
    }
  }

  function write(rec) {
    if (!available()) return false;
    try {
      fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify({ ...rec, v: 1 })));
      return true;
    } catch (_) {
      return false;
    }
  }

  // Merges `fields` into the stored record (creating it). -> true when saved.
  function patch(fields) {
    return write({ ...(read() || {}), ...fields });
  }

  // Sign out: forget the server session and the methods; keep who the workspace belongs to and its key.
  function signOut() {
    const rec = read();
    if (!rec) return;
    write({ ...rec, session: null, sessionAt: null, methods: [] });
  }

  function clear() {
    try { if (fs.existsSync(file())) fs.unlinkSync(file()); } catch (_) { /* best effort */ }
  }

  return { read, write, patch, signOut, clear, available, FILE_NAME };
}

module.exports = { createAccountSession, FILE_NAME };
