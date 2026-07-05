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

// Decrypt a stored value.
//  - A value that was never sealed (legitimate pre-existing plaintext) passes
//    through unchanged — that path must stay lossless.
//  - A SEALED value we cannot open (OS encryption unavailable, or decrypt throws
//    because the DPAPI key changed / %APPDATA% was copied to another user or
//    machine) now fails CLOSED: it returns '' ("treat as absent"), never the
//    literal enc:v1:… blob. audit: returning the sealed blob handed callers a
//    garbage credential — a proxy dialled with ciphertext-as-password (silent auth
//    failure → possible real-IP exposure for an anti-detect browser) and the sync
//    Bearer token became junk — and made "is a secret configured?" checks pass on
//    an unusable value. seal() already fails closed; open() is now symmetric.
function open(value) {
  if (!isSealed(value)) return value;
  if (!isAvailable()) { console.error('[secretStore] open: safeStorage unavailable for a sealed value; treating as absent'); return ''; }
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    return safeStorage.decryptString(buf);
  } catch (e) {
    console.error('[secretStore] open failed (returning empty, not the sealed blob):', e.message);
    return '';
  }
}

module.exports = { seal, open, isSealed, isAvailable };
