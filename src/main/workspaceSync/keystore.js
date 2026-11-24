'use strict';
// Cloud sync keys of this PC, sealed with Electron safeStorage (DPAPI / Keychain / libsecret) in userData:
//   { v: 1, identity: StoredIdentity (this device's X25519 + Ed25519 keys),
//     mkSeed: base64url | null (the workspace Member Key seed), workspaceId, customerId, deviceName }
// Never written without OS encryption and never put in the database, so a copied database alone opens
// nothing in the cloud. Dependencies are passed in, so tests run it without Electron.
const path = require('node:path');
const fs = require('node:fs');

const FILE_NAME = 'softglaze-cloud-sync.bin';

function createKeystore({ safeStorage, dir }) {
  const file = () => path.join(dir(), FILE_NAME);

  function available() {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
    } catch (_) {
      return false;
    }
  }

  function read() {
    try {
      if (!fs.existsSync(file()) || !available()) return null;
      const rec = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
      return rec && rec.v === 1 ? rec : null;
    } catch (_) {
      return null;
    }
  }

  function write(rec) {
    if (!available()) {
      const e = new Error('Cloud sync needs the operating system key store (it is not available on this computer).');
      e.code = 'NO_OS_ENCRYPTION';
      throw e;
    }
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify({ ...rec, v: 1 })));
    fs.renameSync(tmp, file());
  }

  function patch(fields) {
    write({ ...(read() || {}), ...fields });
  }

  function clear() {
    try {
      if (fs.existsSync(file())) fs.unlinkSync(file());
    } catch (_) {
      /* best effort */
    }
  }

  return { read, write, patch, clear, available, FILE_NAME };
}

module.exports = { createKeystore, FILE_NAME };
