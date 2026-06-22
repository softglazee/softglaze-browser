'use strict';
// ---------------------------------------------------------------------------
// Softglaze — at-rest database encryption primitives (Phase 6, Option A)
//
// These functions wrap the whole SQLite file in an AES-256-GCM envelope so that,
// when the app is closed or locked, only ciphertext (`softglaze.sqlite.enc`)
// exists on disk. The plaintext working file Prisma reads is only present while
// the app is unlocked. This is honest "encryption at rest" for the realistic
// threat (stolen laptop / disk image / file copied while the app is closed); it
// is NOT runtime memory protection — see DbEncryptionSettings.jsx for the wording
// shown to users.
//
// This module is intentionally free of Electron/Prisma deps so it can be unit
// tested directly (test/dbCrypto.test.js), the same seam pattern as
// profileArchive.js / cloudSync.js.
//
// On-disk format (header is clear-text; the salt is NOT secret — it only seasons
// the scrypt KDF, and embedding it keeps the .enc self-describing so a backup is
// recoverable from the password alone even if the metadata sidecar is lost):
//   [ "SGDB1" (5 bytes) ][ salt (16) ][ iv (12) ][ ciphertext … ][ authTag (16) ]
//   key = scrypt(password, salt, 32)
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const MAGIC = Buffer.from('SGDB1');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN; // salt + iv live in the clear header
const MIN_LEN = HEADER_LEN + TAG_LEN; // smallest possible valid file (empty ciphertext)

// SQLite files always begin with this exact 16-byte signature: the ASCII text
// "SQLite format 3" (15 bytes) followed by a NUL terminator. Defined as explicit
// bytes to avoid any source-literal whitespace ambiguity. Used to sanity-check a
// decrypted or crash-leftover file before trusting it as a database.
const SQLITE_MAGIC = Buffer.from([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00 // "ormat 3" + NUL
]);

const scrypt = promisify(crypto.scrypt);

function newSalt() {
  return crypto.randomBytes(SALT_LEN);
}

// Derive the 32-byte AES key from a password + salt. scrypt parameters match the
// rest of the codebase (Node default cost), keeping behaviour consistent.
async function deriveKey(password, salt) {
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LEN) {
    throw new Error('deriveKey requires a 16-byte salt buffer.');
  }
  return scrypt(String(password), salt, KEY_LEN);
}

// Read just the salt out of an existing .enc header. Lets the unlock path derive
// the key from the password without decrypting first, and keeps the .enc the
// authoritative source of its own salt (resilient to a lost sidecar).
async function readHeaderSalt(encPath) {
  const fh = await fsp.open(encPath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_LEN);
    const { bytesRead } = await fh.read(buf, 0, HEADER_LEN, 0);
    if (bytesRead < HEADER_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Not a valid Softglaze encrypted database (bad header).');
    }
    return Buffer.from(buf.subarray(MAGIC.length, MAGIC.length + SALT_LEN));
  } finally {
    await fh.close();
  }
}

// Encrypt plainPath → encPath with an already-derived key and the salt that key
// was derived from (re-used so the held session key keeps matching across
// re-encryptions). Writes atomically via a temp file + rename so an interrupted
// write can never leave a truncated .enc in place of a good one.
async function encryptDbFile(plainPath, encPath, key, salt) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) throw new Error('encryptDbFile requires a 32-byte key.');
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LEN) throw new Error('encryptDbFile requires a 16-byte salt.');
  const data = await fsp.readFile(plainPath);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([MAGIC, salt, iv, ciphertext, tag]);
  const tmp = `${encPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, encPath);
}

// Decrypt encPath → plainPath using an already-derived key. Throws if the GCM tag
// does not verify (wrong key or tampered/corrupted file) — so a successful return
// is itself the integrity guarantee: the plaintext is bit-identical to what was
// encrypted. Written via temp + rename for the same atomicity reason as above.
async function decryptDbFile(encPath, plainPath, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) throw new Error('decryptDbFile requires a 32-byte key.');
  const buf = await fsp.readFile(encPath);
  if (buf.length < MIN_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a valid Softglaze encrypted database (bad header).');
  }
  let off = MAGIC.length + SALT_LEN; // skip magic+salt (salt was used for key derivation by the caller)
  const iv = buf.subarray(off, off += IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(off, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    const err = new Error('Could not decrypt the database — wrong password or the file is corrupted.');
    err.code = 'DB_DECRYPT_FAILED';
    throw err;
  }
  const tmp = `${plainPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  await fsp.writeFile(tmp, plaintext);
  await fsp.rename(tmp, plainPath);
}

// SHA-256 of a file, hex. Used by the enable migration to prove the encrypted copy
// decrypts back bit-for-bit before the plaintext original is shredded.
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fsp.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

// True if the file's first bytes are the SQLite signature. Cheap sanity check used
// to recognise a crash-leftover plaintext DB (vs. junk) before adopting it.
function looksLikeSqlite(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(SQLITE_MAGIC.length);
      const read = fs.readSync(fd, head, 0, SQLITE_MAGIC.length, 0);
      return read === SQLITE_MAGIC.length && head.equals(SQLITE_MAGIC);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return false;
  }
}

// Best-effort secure delete: overwrite the file's bytes with random data once,
// then unlink. On SSDs/journaled filesystems this is not a guaranteed wipe, but
// it removes the obvious plaintext copy and is better than a plain unlink. Never
// throws — a failure here must not block the lifecycle.
async function secureUnlink(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isFile() && stat.size > 0) {
      const fh = await fsp.open(filePath, 'r+');
      try {
        await fh.write(crypto.randomBytes(stat.size), 0, stat.size, 0);
        await fh.sync();
      } finally {
        await fh.close();
      }
    }
    await fsp.unlink(filePath);
  } catch (e) {
    // File already gone or locked — nothing more we can safely do.
  }
}

module.exports = {
  MAGIC,
  SALT_LEN,
  IV_LEN,
  TAG_LEN,
  KEY_LEN,
  SQLITE_MAGIC,
  newSalt,
  deriveKey,
  readHeaderSalt,
  encryptDbFile,
  decryptDbFile,
  sha256File,
  looksLikeSqlite,
  secureUnlink
};
