'use strict';
// ---------------------------------------------------------------------------
// Softglaze Pro — Encrypted Profile Archive (.sgz)
//
// Packages a profile's userDataDir cache + a config manifest into a single ZIP,
// streamed through AES-256-GCM into a portable, password-protected `.sgz` file.
//
// On-disk format (header is clear-text; none of it is secret):
//   [ "SGZ1" (4 bytes) ][ salt (16) ][ iv (12) ][ ciphertext … ][ authTag (16) ]
//   key = scrypt(password, salt, 32)
//
// Streaming keeps memory flat for multi-GB caches: archiver → cipher → file.
// The GCM auth tag is only known once the cipher finalizes, so it is appended at
// the end and read back from the tail on import (see decryptArchive).
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
// archiver is required lazily inside exportProfileArchive() so a missing optional
// package degrades .sgz export instead of bricking app startup (profileArchive is
// required at boot by ipcHandlers). decryptArchive needs no third-party deps.

const MAGIC = Buffer.from('SGZ1');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const scrypt = promisify(crypto.scrypt);

async function exportProfileArchive({ userDataDir, config = {}, password, outPath }) {
  if (!password || String(password).length < 6) throw new Error('Provide an encryption password (6+ characters).');
  if (!outPath) throw new Error('No output path was provided.');
  if (userDataDir && !fs.existsSync(userDataDir)) throw new Error('The profile data directory does not exist on disk.');

  let archiver;
  try {
    archiver = require('archiver');
  } catch (e) {
    throw new Error('Archive export is unavailable: the "archiver" package is not installed.');
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = await scrypt(String(password), salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const out = fs.createWriteStream(outPath);
  out.write(Buffer.concat([MAGIC, salt, iv])); // clear-text header
  cipher.on('data', (chunk) => { out.write(chunk); });

  const archive = archiver('zip', { zlib: { level: 9 } });

  return await new Promise((resolve, reject) => {
    let plainBytes = 0;
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      try { cipher.destroy(); } catch (_) {}
      try { out.destroy(); } catch (_) {}
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    archive.on('warning', (err) => { if (err && err.code !== 'ENOENT') fail(err); });
    archive.on('error', fail);
    archive.on('data', (d) => { plainBytes += d.length; });
    cipher.on('error', fail);
    out.on('error', fail);

    // Cipher finished → append the GCM auth tag, then close the file.
    cipher.on('end', () => {
      try {
        const tag = cipher.getAuthTag();
        out.write(tag, () => out.end());
      } catch (e) { fail(e); }
    });
    out.on('close', () => { if (!settled) { settled = true; resolve({ ok: true, outPath, plainBytes }); } });

    archive.pipe(cipher); // archive(readable) → cipher(transform); cipher 'data' is forwarded above

    archive.append(
      JSON.stringify({ ...config, format: 'sgz1', exportedAt: new Date().toISOString() }, null, 2),
      { name: 'softglaze.json' }
    );
    if (userDataDir && fs.existsSync(userDataDir)) archive.directory(userDataDir, 'userData');
    archive.finalize().catch(fail);
  });
}

// Inverse of the header layout — decrypts a `.sgz` back to its raw ZIP buffer.
// Provided so the matching importer (and tests) can round-trip without guessing
// the framing. Throws on a wrong password / tampered file (GCM tag mismatch).
async function decryptArchive(filePath, password) {
  const buf = await fs.promises.readFile(filePath);
  if (buf.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Not a valid Softglaze (.sgz) archive.');
  }
  let off = MAGIC.length;
  const salt = buf.subarray(off, off += SALT_LEN);
  const iv = buf.subarray(off, off += IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(off, buf.length - TAG_LEN);
  const key = await scrypt(String(password), salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw new Error('Could not decrypt — wrong password or the archive is corrupted.');
  }
}

module.exports = { exportProfileArchive, decryptArchive };
