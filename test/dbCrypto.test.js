'use strict';
// Unit tests for the at-rest DB encryption primitives (src/main/dbCrypto.js).
// Pure module — no Electron/Prisma — so node:test can drive it directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const dbCrypto = require('../src/main/dbCrypto');

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'sg-dbcrypto-'));
}

// A buffer that begins with the real SQLite signature (reused from the module so
// the two can never drift), padded out so it reads like a small database file.
function fakeSqliteBytes(extra = 4096) {
  return Buffer.concat([dbCrypto.SQLITE_MAGIC, crypto.randomBytes(extra)]);
}

test('encrypt → decrypt round-trips byte-for-byte', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  const original = fakeSqliteBytes();
  await fsp.writeFile(plain, original);

  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey('correct horse battery staple', salt);
  await dbCrypto.encryptDbFile(plain, enc, key, salt);

  // The encrypted file must NOT contain the plaintext SQLite magic anywhere.
  const encBytes = await fsp.readFile(enc);
  assert.equal(encBytes.indexOf(dbCrypto.SQLITE_MAGIC), -1);
  assert.ok(encBytes.subarray(0, 5).equals(dbCrypto.MAGIC));

  await dbCrypto.decryptDbFile(enc, out, key);
  const restored = await fsp.readFile(out);
  assert.ok(restored.equals(original), 'decrypted bytes match the original');

  await fsp.rm(dir, { recursive: true, force: true });
});

test('the embedded salt can be read back from the header and re-derives the key', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  const original = fakeSqliteBytes();
  await fsp.writeFile(plain, original);

  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey('pw-123456', salt);
  await dbCrypto.encryptDbFile(plain, enc, key, salt);

  // Simulate the unlock path: read salt from header, derive key from password.
  const headerSalt = await dbCrypto.readHeaderSalt(enc);
  assert.ok(headerSalt.equals(salt));
  const rederived = await dbCrypto.deriveKey('pw-123456', headerSalt);
  await dbCrypto.decryptDbFile(enc, out, rederived);
  assert.ok((await fsp.readFile(out)).equals(original));

  await fsp.rm(dir, { recursive: true, force: true });
});

test('wrong password / wrong key fails the GCM tag (no plaintext leaks)', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  await fsp.writeFile(plain, fakeSqliteBytes());

  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey('right-password', salt);
  await dbCrypto.encryptDbFile(plain, enc, key, salt);

  const wrong = await dbCrypto.deriveKey('wrong-password', salt);
  await assert.rejects(
    () => dbCrypto.decryptDbFile(enc, out, wrong),
    (e) => e.code === 'DB_DECRYPT_FAILED'
  );
  assert.equal(fs.existsSync(out), false, 'no plaintext file is written on failure');

  await fsp.rm(dir, { recursive: true, force: true });
});

test('a tampered ciphertext byte fails the GCM tag', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  await fsp.writeFile(plain, fakeSqliteBytes());

  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey('pw', salt);
  await dbCrypto.encryptDbFile(plain, enc, key, salt);

  const bytes = await fsp.readFile(enc);
  // Flip a byte inside the ciphertext region (well past the header).
  bytes[dbCrypto.MAGIC.length + dbCrypto.SALT_LEN + dbCrypto.IV_LEN + 4] ^= 0xff;
  await fsp.writeFile(enc, bytes);

  await assert.rejects(() => dbCrypto.decryptDbFile(enc, out, key), (e) => e.code === 'DB_DECRYPT_FAILED');

  await fsp.rm(dir, { recursive: true, force: true });
});

test('a truncated file is rejected by header validation', async () => {
  const dir = await tmpDir();
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  await fsp.writeFile(enc, Buffer.from('SGDB1')); // header magic only, nothing else

  const key = await dbCrypto.deriveKey('pw', dbCrypto.newSalt());
  await assert.rejects(() => dbCrypto.decryptDbFile(enc, out, key));

  await fsp.rm(dir, { recursive: true, force: true });
});

test('sha256File proves the lossless round-trip the enable migration relies on', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  await fsp.writeFile(plain, fakeSqliteBytes());

  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey('pw', salt);
  await dbCrypto.encryptDbFile(plain, enc, key, salt);
  await dbCrypto.decryptDbFile(enc, out, key);

  assert.equal(await dbCrypto.sha256File(plain), await dbCrypto.sha256File(out));

  await fsp.rm(dir, { recursive: true, force: true });
});

test('looksLikeSqlite recognises a real header and rejects junk', async () => {
  const dir = await tmpDir();
  const real = path.join(dir, 'real.sqlite');
  const junk = path.join(dir, 'junk.bin');
  await fsp.writeFile(real, fakeSqliteBytes());
  await fsp.writeFile(junk, crypto.randomBytes(2048));

  assert.equal(dbCrypto.looksLikeSqlite(real), true);
  assert.equal(dbCrypto.looksLikeSqlite(junk), false);
  assert.equal(dbCrypto.looksLikeSqlite(path.join(dir, 'missing')), false);

  await fsp.rm(dir, { recursive: true, force: true });
});

// --- versioned KDF (v1 legacy / v2 strong) ---------------------------------

test('v1 deriveKey equals the original param-less scrypt (existing SGDB1 DBs still open)', async () => {
  const { promisify } = require('node:util');
  const scrypt = promisify(crypto.scrypt);
  const salt = dbCrypto.newSalt();
  // What the ORIGINAL code shipped: crypto.scrypt(password, salt, 32) with no opts.
  const legacyKey = await scrypt('vault-passphrase', salt, dbCrypto.KEY_LEN);
  // The new versioned derive at v1 must produce a byte-identical key, or every
  // already-encrypted database on disk would fail to decrypt after this change.
  const v1Key = await dbCrypto.deriveKey('vault-passphrase', salt, dbCrypto.LEGACY_VERSION);
  const v1Default = await dbCrypto.deriveKey('vault-passphrase', salt); // default = legacy
  assert.ok(v1Key.equals(legacyKey), 'explicit v1 key matches the legacy param-less key');
  assert.ok(v1Default.equals(legacyKey), 'default (no version) still derives the legacy key');
});

test('a v1-written file carries SGDB1 and readHeader reports version 1', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  const original = fakeSqliteBytes();
  await fsp.writeFile(plain, original);

  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey('pw-legacy', salt); // default v1
  await dbCrypto.encryptDbFile(plain, enc, key, salt);     // default v1 magic

  const encBytes = await fsp.readFile(enc);
  assert.ok(encBytes.subarray(0, 5).equals(dbCrypto.MAGIC), 'header is SGDB1');
  const hdr = await dbCrypto.readHeader(enc);
  assert.equal(hdr.version, 1);
  assert.ok(hdr.salt.equals(salt));
  // Unlock path: derive with the header version and decrypt.
  const k = await dbCrypto.deriveKey('pw-legacy', hdr.salt, hdr.version);
  await dbCrypto.decryptDbFile(enc, out, k);
  assert.ok((await fsp.readFile(out)).equals(original));

  await fsp.rm(dir, { recursive: true, force: true });
});

test('v2 round-trips, carries SGDB2, and derives a different (stronger) key', async () => {
  const dir = await tmpDir();
  const plain = path.join(dir, 'db.sqlite');
  const enc = path.join(dir, 'db.sqlite.enc');
  const out = path.join(dir, 'db.out.sqlite');
  const original = fakeSqliteBytes();
  await fsp.writeFile(plain, original);

  const salt = dbCrypto.newSalt();
  const v2Key = await dbCrypto.deriveKey('pw-strong', salt, dbCrypto.CURRENT_VERSION);
  const v1Key = await dbCrypto.deriveKey('pw-strong', salt, dbCrypto.LEGACY_VERSION);
  assert.ok(!v2Key.equals(v1Key), 'v2 (higher cost) yields a different key than v1');

  await dbCrypto.encryptDbFile(plain, enc, v2Key, salt, dbCrypto.CURRENT_VERSION);
  const encBytes = await fsp.readFile(enc);
  assert.ok(encBytes.subarray(0, 5).equals(dbCrypto.MAGIC2), 'header is SGDB2');

  const hdr = await dbCrypto.readHeader(enc);
  assert.equal(hdr.version, 2);
  const k = await dbCrypto.deriveKey('pw-strong', hdr.salt, hdr.version);
  await dbCrypto.decryptDbFile(enc, out, k);
  assert.ok((await fsp.readFile(out)).equals(original), 'v2 decrypts byte-for-byte');

  // Decrypting a v2 file with a v1-derived key must fail the tag (not silently pass).
  await assert.rejects(() => dbCrypto.decryptDbFile(enc, path.join(dir, 'x'), v1Key), (e) => e.code === 'DB_DECRYPT_FAILED');

  await fsp.rm(dir, { recursive: true, force: true });
});

test('secureUnlink removes the file and never throws on a missing path', async () => {
  const dir = await tmpDir();
  const f = path.join(dir, 'secret.sqlite');
  await fsp.writeFile(f, fakeSqliteBytes());
  await dbCrypto.secureUnlink(f);
  assert.equal(fs.existsSync(f), false);
  await dbCrypto.secureUnlink(path.join(dir, 'does-not-exist')); // must not throw

  await fsp.rm(dir, { recursive: true, force: true });
});
