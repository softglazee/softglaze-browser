'use strict';

// Field-level encryption at rest via safeStorage (DPAPI, Keychain, libsecret) for stored secrets.
// seal() fails closed: without OS encryption it throws rather than store plaintext. open() passes
// unsealed values through and returns '' for a sealed value it cannot open.

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

// Returns empty or already-sealed values unchanged. Fails closed: throws when OS encryption is
// unavailable or fails, so a secret is never written in the clear.
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

// Unsealed values (pre-existing plaintext) pass through unchanged. A sealed value that cannot be
// opened (no OS encryption, DPAPI key changed, data copied to another user) returns '', never the
// blob: a proxy dialled with ciphertext as its password could fail auth and expose the real IP.
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
