'use strict';

// Field-level secret encryption for data at rest, backed by the OS keychain via
// Electron's safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on
// Linux). Used for proxy credentials and the SMTP password so they are not
// stored in plaintext in the local SQLite database.
//
// Design principle: FAIL-SAFE. Encryption is best-effort and never destructive.
//  - seal(): if OS encryption is unavailable, the plaintext is returned
//    unchanged (logged). Nothing is ever lost.
//  - open(): if a value is not sealed, or decryption fails for any reason, the
//    value is returned unchanged. Pre-existing plaintext keeps working and a
//    bad decrypt can never brick a proxy or block a launch.

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
// empty, already sealed, or when OS encryption is unavailable.
function seal(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  if (isSealed(plain)) return plain;
  if (!isAvailable()) return plain;
  try {
    const buf = safeStorage.encryptString(String(plain));
    return PREFIX + buf.toString('base64');
  } catch (e) {
    console.error('[secretStore] seal failed, storing plaintext:', e.message);
    return plain;
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
