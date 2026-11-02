'use strict';
// AES-256-GCM envelope for the SQLite file: only ciphertext is on disk while the app is closed/locked.
// Not runtime memory protection. Free of Electron/Prisma deps so it can be unit tested directly.
// Layout: magic(5) salt(16) iv(12) ciphertext tag(16); the clear salt keeps a backup self-describing.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const MAGIC = Buffer.from('SGDB1'); // KDF v1: Node-default scrypt
const MAGIC2 = Buffer.from('SGDB2'); // KDF v2: scrypt N=2^17 (OWASP minimum) - same layout
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN; // salt + iv live in the clear header
const MIN_LEN = HEADER_LEN + TAG_LEN; // smallest possible valid file (empty ciphertext)

// The magic selects the KDF, so a file always decrypts with the cost it was written with.
// v1 equals Node's scrypt defaults (N=16384, r=8, p=1) so existing SGDB1 files derive the same key.
// v2 uses N=2^17 (~134 MB), above Node's 32 MB maxmem default, so maxmem is raised for v2.
const LEGACY_VERSION = 1;
const CURRENT_VERSION = 2;
const KDF = {
  1: { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  2: { N: 131072, r: 8, p: 1, maxmem: 288 * 1024 * 1024 }
};
function magicForVersion(version) { return version === 2 ? MAGIC2 : MAGIC; }
function versionForMagic(headerBuf) {
  const m = headerBuf.subarray(0, MAGIC.length);
  if (m.equals(MAGIC)) return 1;
  if (m.equals(MAGIC2)) return 2;
  return 0; // unknown
}

// Every SQLite file starts with "SQLite format 3" plus NUL (16 bytes). Used to sanity-check a
// decrypted or crash-leftover file before trusting it.
const SQLITE_MAGIC = Buffer.from([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00 // "ormat 3" + NUL
]);

const scrypt = promisify(crypto.scrypt);

function newSalt() {
  return crypto.randomBytes(SALT_LEN);
}

// Derives the 32-byte AES key with the KDF for the header version (from readHeader).
// Defaults to v1 for callers that do not pass a version.
async function deriveKey(password, salt, version = LEGACY_VERSION) {
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LEN) {
    throw new Error('deriveKey requires a 16-byte salt buffer.');
  }
  const p = KDF[version] || KDF[LEGACY_VERSION];
  return scrypt(String(password), salt, KEY_LEN, { N: p.N, r: p.r, p: p.p, maxmem: p.maxmem });
}

// The .enc header is the source of truth for KDF version and salt, so a lost sidecar is harmless.
async function readHeader(encPath) {
  const fh = await fsp.open(encPath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_LEN);
    const { bytesRead } = await fh.read(buf, 0, HEADER_LEN, 0);
    const version = bytesRead >= HEADER_LEN ? versionForMagic(buf) : 0;
    if (!version) throw new Error('Not a valid Softglaze encrypted database (bad header).');
    return { version, salt: Buffer.from(buf.subarray(MAGIC.length, MAGIC.length + SALT_LEN)) };
  } finally {
    await fh.close();
  }
}

// Back-compat convenience: just the salt (unlock derives the version separately).
async function readHeaderSalt(encPath) {
  return (await readHeader(encPath)).salt;
}

// Reuses the salt the key was derived from so the held session key keeps matching.
// Writes via temp file + rename so an interrupted write never truncates a good .enc.
async function encryptDbFile(plainPath, encPath, key, salt, version = LEGACY_VERSION) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) throw new Error('encryptDbFile requires a 32-byte key.');
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LEN) throw new Error('encryptDbFile requires a 16-byte salt.');
  const data = await fsp.readFile(plainPath);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  // The magic records the KDF version; the layout after it is the same for v1 and v2.
  const out = Buffer.concat([magicForVersion(version), salt, iv, ciphertext, tag]);
  const tmp = `${encPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, encPath);
}

// Throws if the GCM tag fails (wrong key or tampered file), so a normal return proves integrity.
// Writes via temp file + rename, like encryptDbFile.
async function decryptDbFile(encPath, plainPath, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) throw new Error('decryptDbFile requires a 32-byte key.');
  const buf = await fsp.readFile(encPath);
  if (buf.length < MIN_LEN || !versionForMagic(buf)) { // accept SGDB1 or SGDB2 - identical layout
    throw new Error('Not a valid Softglaze encrypted database (bad header).');
  }
  let off = MAGIC.length + SALT_LEN; // skip magic + salt; the caller already derived the key
  const iv = buf.subarray(off, off += IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(off, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    const err = new Error('Could not decrypt the database - wrong password or the file is corrupted.');
    err.code = 'DB_DECRYPT_FAILED';
    throw err;
  }
  const tmp = `${plainPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  await fsp.writeFile(tmp, plaintext);
  await fsp.rename(tmp, plainPath);
}

// Lets the enable migration prove the encrypted copy round-trips before the plaintext is shredded.
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fsp.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

// Tells a crash-leftover plaintext DB from junk before it is adopted.
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

// Best-effort wipe: one random overwrite, then unlink. Not guaranteed on SSDs or journaled
// filesystems. Never throws, so a failure cannot block the lifecycle.
async function secureUnlink(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isFile() && stat.size > 0) {
      const fh = await fsp.open(filePath, 'r+');
      try {
        // Bounded chunks: a multi-GB DB is never held in RAM and randomBytes never gets an oversized request.
        const CHUNK = 1 << 20; // 1 MiB
        for (let offset = 0; offset < stat.size; offset += CHUNK) {
          const len = Math.min(CHUNK, stat.size - offset);
          await fh.write(crypto.randomBytes(len), 0, len, offset);
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
    }
  } catch (e) {
    // Overwrite is best-effort (a busy or locked file throws here); the delete
    // below must still run so plaintext is never left beside the ciphertext.
  }
  try {
    await fsp.unlink(filePath);
  } catch (e) {
    // Already gone or locked; nothing more can safely be done.
  }
}

module.exports = {
  MAGIC,
  MAGIC2,
  SALT_LEN,
  IV_LEN,
  TAG_LEN,
  KEY_LEN,
  LEGACY_VERSION,
  CURRENT_VERSION,
  SQLITE_MAGIC,
  newSalt,
  deriveKey,
  readHeader,
  readHeaderSalt,
  encryptDbFile,
  decryptDbFile,
  sha256File,
  looksLikeSqlite,
  secureUnlink
};
