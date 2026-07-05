'use strict';

// Field-level secret encryption for data at rest, backed by the OS keychain via
// Electron's safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on
// Linux). Used for proxy credentials and the SMTP password so they are not
// stored in plaintext in the local SQLite database.
//
// Design principle:
//  - seal(): FAIL-CLOSED for writes (audit). If OS encryption is unavailable it
//    THROWS rather than silently persisting the secret in plaintext. On the
//    Windows target DPAPI is always available, so this never fires in normal use;
//    it only guards the degenerate case where safeStorage init failed.
//  - open(): FAIL-SAFE for reads. If a value is not sealed, or decryption fails
//    for any reason, the value is returned unchanged. Pre-existing plaintext keeps
//    working and a bad decrypt can never brick a proxy or block a launch.

const { safeStorage } = require('electron');

const PREFIX = 'enc:v1:';

function isAvailable() {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  } catch (e) {
    return false;
  }
}

function isSealed(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// Encrypt a plaintext string for storage. Returns the value unchanged when it is
// empty or already sealed. audit: FAILS CLOSED — if OS encryption is unavailable
// or encryption throws, it raises instead of returning plaintext, so a real secret
// is never silently written to the database in the clear.
function seal(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  if (isSealed(plain)) return plain;
  if (!isAvailable()) {
    throw new Error('Cannot securely store this secret: OS encryption (safeStorage) is unavailable on this system.');
  }
  try {
    const buf = safeStorage.encryptString(String(plain));
    return PREFIX + buf.toString('base64');
  } catch (e) {
    throw new Error('Failed to encrypt a secret for storage: ' + (e && e.message ? e.message : 'unknown error'));
  }
}

// Decrypt a stored value. Fail-safe: non-sealed values and any decryption
// failure return the input unchanged.
function open(value) {
  if (!isSealed(value)) return value;
  if (!isAvailable()) return value;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    return safeStorage.decryptString(buf);
  } catch (e) {
    console.error('[secretStore] open failed:', e.message);
    return value;
  }
}

module.exports = { seal, open, isSealed, isAvailable };
