'use strict';
// Profile archive (.sgz): a ZIP streamed through AES-256-GCM, key = scrypt(password, salt, 32).
// Layout: "SGZ1" | salt(16) | iv(12) | ciphertext | authTag(16). The tag is known only once the
// cipher finalizes, so it goes at the end and is read from the tail on import.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
// archiver is required lazily so a missing optional package disables .sgz export instead of
// breaking startup (ipcHandlers requires this module at boot).

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

    archive.pipe(cipher); // cipher 'data' is forwarded to the file above

    archive.append(
      JSON.stringify({ ...config, format: 'sgz1', exportedAt: new Date().toISOString() }, null, 2),
      { name: 'softglaze.json' }
    );
    if (userDataDir && fs.existsSync(userDataDir)) archive.directory(userDataDir, 'userData');
    archive.finalize().catch(fail);
  });
}

// Decrypts a .sgz back to its raw ZIP buffer. Throws on a wrong password or tampered file (GCM tag).
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
    throw new Error('Could not decrypt - wrong password or the archive is corrupted.');
  }
}

// Workspace backup: the SQLite file plus Setting rows in one in-memory scrypt + AES-256-GCM envelope.
// Layout: "SGZW1" | salt(16) | iv(12) | ciphertext | authTag(16); plaintext is JSON, db in base64.
// Restore checks the GCM tag before any live file is touched, so a bad backup cannot overwrite the DB.
const WS_MAGIC = Buffer.from('SGZW1');

async function exportWorkspaceArchive({ dbPath, settings = null, password, outPath }) {
  if (!password || String(password).length < 6) throw new Error('Provide an encryption password (6+ characters).');
  if (!outPath) throw new Error('No output path was provided.');
  if (!dbPath || !fs.existsSync(dbPath)) throw new Error('The workspace database file does not exist on disk.');

  const dbBytes = await fs.promises.readFile(dbPath);
  const payload = {
    format: 'sgzw1',
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    dbBytes: dbBytes.length,
    db: dbBytes.toString('base64'),
    settings: Array.isArray(settings) ? settings : null
  };
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = await scrypt(String(password), salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  await fs.promises.writeFile(outPath, Buffer.concat([WS_MAGIC, salt, iv, ciphertext, tag]));
  return { ok: true, outPath, dbBytes: dbBytes.length, settingsCount: payload.settings ? payload.settings.length : 0 };
}

// Throws on a wrong password or tampered file (GCM tag). Returns the DB Buffer and settings array;
// write them out only after this resolves.
async function restoreWorkspaceArchive(filePath, password) {
  const buf = await fs.promises.readFile(filePath);
  const minLen = WS_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (buf.length < minLen || !buf.subarray(0, WS_MAGIC.length).equals(WS_MAGIC)) {
    throw new Error('Not a valid Softglaze workspace backup.');
  }
  let off = WS_MAGIC.length;
  const salt = buf.subarray(off, off += SALT_LEN);
  const iv = buf.subarray(off, off += IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(off, buf.length - TAG_LEN);
  const key = await scrypt(String(password), salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw new Error('Could not decrypt - wrong password or the backup is corrupted.');
  }
  let payload;
  try {
    payload = JSON.parse(plaintext.toString('utf8'));
  } catch (e) {
    throw new Error('The workspace backup is unreadable (bad payload).');
  }
  if (!payload || payload.kind !== 'workspace' || typeof payload.db !== 'string') {
    throw new Error('This file is not a Softglaze workspace backup.');
  }
  return {
    db: Buffer.from(payload.db, 'base64'),
    settings: Array.isArray(payload.settings) ? payload.settings : null,
    exportedAt: payload.exportedAt || null
  };
}

module.exports = { exportProfileArchive, decryptArchive, exportWorkspaceArchive, restoreWorkspaceArchive };
