'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const { PrismaClient } = require('@prisma/client');
const dbCrypto = require('./dbCrypto');

let prisma = null;
let runtime = null;

// At-rest encryption state (Phase 6, Option A). When `enabled`, the on-disk DB is
// `softglaze.sqlite.enc`; a plaintext working file (`softglaze.sqlite`) only exists
// while `unlocked` (decrypted at boot, re-encrypted + shredded at quit). The AES
// key + its salt are held in memory only for the unlocked session.
const dbEnc = { enabled: false, unlocked: false, key: null, salt: null };
// Set during an enable/disable migration so getPrisma() refuses to (re)open the
// file mid-operation and create an inconsistent or empty database.
let migrating = false;

function normalizeSqliteFileUrl(filePath) {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

// --- encryption metadata sidecar (plaintext, non-secret: just a flag) ----------
// Stored OUTSIDE the database so boot can learn "is the DB encrypted?" before
// opening Prisma. It holds no password material — the .enc is self-authenticating
// via its GCM tag, so there is nothing secret to keep here.
function readSidecar() {
  try {
    if (!runtime || !fs.existsSync(runtime.sidecarPath)) return { enabled: false };
    const obj = JSON.parse(fs.readFileSync(runtime.sidecarPath, 'utf8'));
    return obj && typeof obj === 'object' ? obj : { enabled: false };
  } catch (e) {
    return { enabled: false };
  }
}

function writeSidecar(obj) {
  const tmp = `${runtime.sidecarPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, runtime.sidecarPath);
}

function clearSidecar() {
  try { fs.unlinkSync(runtime.sidecarPath); } catch (e) { /* already gone */ }
}

function configureDatabaseEnv() {
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  const dbPath = path.join(userDataDir, 'softglaze.sqlite');
  const profileRoot = path.join(userDataDir, 'softglaze_profiles');

  fs.mkdirSync(profileRoot, { recursive: true });

  process.env.DATABASE_URL = normalizeSqliteFileUrl(dbPath);

  runtime = {
    dbPath,
    encPath: `${dbPath}.enc`,
    sidecarPath: path.join(userDataDir, 'db-encryption.json'),
    profileRoot,
    databaseUrl: process.env.DATABASE_URL
  };

  // Learn the at-rest encryption state from the sidecar. If encrypted, the DB
  // starts locked — getPrisma() will refuse until unlockEncryptedDb() succeeds.
  dbEnc.enabled = Boolean(readSidecar().enabled);
  if (dbEnc.enabled) dbEnc.unlocked = false;

  return runtime;
}

function getRuntimeConfig() {
  if (!runtime) {
    return configureDatabaseEnv();
  }
  return runtime;
}

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    configureDatabaseEnv();
  }

  // Never open (and thereby auto-create) the SQLite file while it is encrypted and
  // locked, or mid-migration — that would spawn an empty plaintext DB beside the
  // real ciphertext.
  if (dbEnc.enabled && !dbEnc.unlocked) {
    const err = new Error('The database is locked.');
    err.code = 'DATABASE_LOCKED';
    throw err;
  }
  if (migrating) {
    const err = new Error('The database is busy — an encryption change is in progress.');
    err.code = 'DATABASE_BUSY';
    throw err;
  }

  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
    });
  }

  return prisma;
}

// ---------------------------------------------------------------------------
// At-rest DB encryption lifecycle (Phase 6, Option A)
// ---------------------------------------------------------------------------
function isDbEncryptionEnabled() {
  return dbEnc.enabled;
}

// True when the DB can be opened: either encryption is off, or it is on and the
// session has been unlocked.
function isDbUnlocked() {
  return !dbEnc.enabled || dbEnc.unlocked;
}

function getDbEncryptionInfo() {
  return { enabled: dbEnc.enabled, unlocked: isDbUnlocked() };
}

// Fold the WAL back into the main DB file and close the handle, so there is a
// single consistent file to encrypt/copy. Removing the (now-checkpointed) WAL
// sidecars keeps the encrypted envelope to just the main file.
async function checkpointAndDisconnect() {
  if (prisma) {
    try { await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) { /* not in WAL mode — fine */ }
  }
  await disconnectPrisma();
  if (runtime) {
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(runtime.dbPath + suffix); } catch (e) { /* none present */ }
    }
  }
}

function unlockError(e) {
  // The .enc is self-authenticating: a GCM failure means the password is wrong or
  // the file is corrupted. We can't distinguish the two, so we say both and let
  // the UI offer "try again" and "restore from backup".
  const err = new Error('Incorrect password — or the database file is corrupted. If you are sure the password is right, restore from a backup.');
  err.code = 'DB_UNLOCK_FAILED';
  err.cause = e;
  return err;
}

// Boot/unlock path. Decrypts the .enc into the working file (or adopts a
// crash-leftover plaintext, after verifying the password against the .enc), then
// holds the key for the session. Throws DB_MISSING if there is no ciphertext, or
// DB_UNLOCK_FAILED on a wrong password / corrupted file.
async function unlockEncryptedDb(password) {
  if (!dbEnc.enabled) return getDbEncryptionInfo();
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(encPath)) {
    const err = new Error('The encrypted database file is missing.');
    err.code = 'DB_MISSING';
    throw err;
  }
  const salt = await dbCrypto.readHeaderSalt(encPath);
  const key = await dbCrypto.deriveKey(password, salt);

  // A plaintext working file present alongside the .enc can only be a crash
  // leftover (a clean quit shreds it) — and it is the NEWEST copy. Keep it, but
  // still authenticate the password by decrypting the .enc into a throwaway temp
  // so a wrong password can't be accepted and later re-encrypt with a bad key.
  const leftover = fs.existsSync(dbPath) && dbCrypto.looksLikeSqlite(dbPath);
  if (leftover) {
    const verifyTmp = `${dbPath}.verify-unlock`;
    try {
      await dbCrypto.decryptDbFile(encPath, verifyTmp, key);
    } catch (e) {
      throw unlockError(e);
    } finally {
      await dbCrypto.secureUnlink(verifyTmp);
    }
  } else {
    try {
      await dbCrypto.decryptDbFile(encPath, dbPath, key);
    } catch (e) {
      throw unlockError(e);
    }
  }

  dbEnc.unlocked = true;
  dbEnc.key = key;
  dbEnc.salt = salt;
  return getDbEncryptionInfo();
}

// Quit/relock path. Re-encrypts the working file to the .enc (refreshing the
// at-rest copy with this session's changes) and shreds the plaintext, then clears
// the key from memory. Safe to call when not enabled/unlocked (no-op).
async function relockEncryptedDb() {
  if (!dbEnc.enabled || !dbEnc.unlocked || !dbEnc.key || !dbEnc.salt) return;
  const { dbPath, encPath } = runtime;
  await checkpointAndDisconnect();
  if (fs.existsSync(dbPath)) {
    await dbCrypto.encryptDbFile(dbPath, encPath, dbEnc.key, dbEnc.salt);
    await dbCrypto.secureUnlink(dbPath);
  }
  dbEnc.unlocked = false;
  dbEnc.key = null;
  dbEnc.salt = null;
}

// One-time enable migration. Backup-first, verified, reversible. The plaintext
// working file is left in place for this session (Prisma keeps using it); it is
// re-encrypted and shredded at quit. The caller is responsible for confirming the
// user understands that a lost password is unrecoverable.
async function enableDbEncryption(password) {
  if (dbEnc.enabled) return getDbEncryptionInfo();
  if (!password || String(password).length < 4) {
    throw new Error('A password of at least 4 characters is required to enable database encryption.');
  }
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(dbPath)) throw new Error('No database file was found to encrypt.');

  migrating = true;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak-${stamp}`;
  try {
    await checkpointAndDisconnect();
    fs.copyFileSync(dbPath, backupPath); // safety net while we work

    const salt = dbCrypto.newSalt();
    const key = await dbCrypto.deriveKey(password, salt);
    await dbCrypto.encryptDbFile(dbPath, encPath, key, salt);

    // Prove the encrypted copy decrypts back bit-for-bit before we trust it.
    const verifyTmp = `${dbPath}.verify-${stamp}`;
    await dbCrypto.decryptDbFile(encPath, verifyTmp, key);
    const lossless = (await dbCrypto.sha256File(dbPath)) === (await dbCrypto.sha256File(verifyTmp));
    await dbCrypto.secureUnlink(verifyTmp);
    if (!lossless) {
      await dbCrypto.secureUnlink(encPath);
      throw new Error('Encryption verification failed — the database was left unchanged.');
    }

    writeSidecar({ enabled: true, version: 1 });
    dbEnc.enabled = true;
    dbEnc.unlocked = true;
    dbEnc.key = key;
    dbEnc.salt = salt;
    // Encryption verified — the plaintext safety backup is no longer needed (and
    // keeping it would defeat the purpose).
    await dbCrypto.secureUnlink(backupPath);
    return getDbEncryptionInfo();
  } catch (e) {
    // Roll back any partial ciphertext if we never reached the committed state.
    if (!dbEnc.enabled) { try { await dbCrypto.secureUnlink(encPath); } catch (_) { /* noop */ } }
    throw e;
  } finally {
    migrating = false;
  }
}

// Reverse of enable. The live working file is ALREADY plaintext and current, so
// disabling just stops encrypting at rest: verify the password against the .enc,
// clear the sidecar, and shred the ciphertext. We never decrypt the (older) .enc
// over the (newer) working file — that would lose this session's changes.
async function disableDbEncryption(password) {
  if (!dbEnc.enabled) return getDbEncryptionInfo();
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(dbPath) || !dbCrypto.looksLikeSqlite(dbPath)) {
    throw new Error('The working database is not available — cannot safely disable encryption right now.');
  }

  // Authenticate the password against the at-rest ciphertext.
  if (fs.existsSync(encPath)) {
    const salt = await dbCrypto.readHeaderSalt(encPath);
    const key = await dbCrypto.deriveKey(password, salt);
    const verifyTmp = `${dbPath}.verify-disable`;
    try {
      await dbCrypto.decryptDbFile(encPath, verifyTmp, key);
    } catch (e) {
      const err = new Error('Incorrect password.');
      err.code = 'BAD_PASSWORD';
      throw err;
    } finally {
      await dbCrypto.secureUnlink(verifyTmp);
    }
  }

  clearSidecar();
  dbEnc.enabled = false;
  dbEnc.unlocked = false;
  dbEnc.key = null;
  dbEnc.salt = null;
  if (fs.existsSync(encPath)) await dbCrypto.secureUnlink(encPath);
  return getDbEncryptionInfo();
}

// Re-key the at-rest ciphertext to a new password (called when the vault password
// changes while encryption is on, so "the vault password unlocks the DB" stays
// true). The live working file is untouched; only the .enc + held key change.
async function rekeyEncryptedDb(newPassword) {
  if (!dbEnc.enabled || !dbEnc.unlocked) return;
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(dbPath)) return;
  const salt = dbCrypto.newSalt();
  const key = await dbCrypto.deriveKey(newPassword, salt);
  await dbCrypto.encryptDbFile(dbPath, encPath, key, salt);
  dbEnc.key = key;
  dbEnc.salt = salt;
}

// ---------------------------------------------------------------------------
// Automated SQLite Migration Runner
// ---------------------------------------------------------------------------
// Split a migration SQL blob into individual statements. Quote-aware: a ';'
// inside a '...' string literal does NOT end a statement (SQLite escapes an inner
// quote by doubling it: ''). Comment lines are stripped by the caller before this.
// NOTE: trigger bodies (CREATE TRIGGER ... BEGIN ...; ...; END) are not handled —
// author such a migration as a single statement, or split it manually.
function splitSqlStatements(sql) {
  const out = [];
  let buf = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { buf += sql[++i]; } // escaped '' inside a string
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === ';') { const s = buf.trim(); if (s) out.push(s); buf = ''; continue; }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

async function applyMigrations(db) {
  console.log('[DB] Starting automated migration runner...');

  // 1. Ensure the migration tracking table exists
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_AppMigrations" (
      "id" TEXT PRIMARY KEY,
      "appliedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. BASELINING LOGIC: Check if this is an older database that already has tables
  // but no migration history. This prevents the "table Proxy already exists" crash.
  const existingTables = await db.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='Proxy';`);
  const appliedRecords = await db.$queryRawUnsafe(`SELECT "id" FROM "_AppMigrations";`);
  const appliedSet = new Set(appliedRecords.map(r => r.id));

  if (existingTables.length > 0 && appliedSet.size === 0) {
    console.log('[DB] Legacy database detected. Baselining initial migrations...');
    // Mark the two existing migrations as already applied so they don't run again
    const baselineMigrations = ['20260616224355_init', '20260616224734_fix_missing_models'];
    for (const m of baselineMigrations) {
      await db.$executeRawUnsafe(`INSERT OR IGNORE INTO "_AppMigrations" ("id") VALUES (?);`, m);
      appliedSet.add(m);
    }
  }

  // 3. Locate the migrations directory
  // In production (app.asar), the prisma folder is unpacked.
  const isPackaged = app.isPackaged;
  const basePath = isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'prisma', 'migrations')
    : path.join(__dirname, '../../prisma/migrations');

  if (!fs.existsSync(basePath)) {
    console.warn('[DB] Migrations directory not found at:', basePath);
    return;
  }

  // 4. Read migration folders (they start with a 14-digit timestamp)
  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  const migrationFolders = entries
    .filter(entry => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(entry => entry.name)
    .sort();

  // 5. Apply new migrations sequentially
  for (const folder of migrationFolders) {
    if (!appliedSet.has(folder)) {
      console.log(`[DB] Applying new migration: ${folder}`);
      const sqlPath = path.join(basePath, folder, 'migration.sql');

      if (fs.existsSync(sqlPath)) {
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Strip full-line SQL comments first — a comment-bearing statement makes
        // the SQLite driver throw SQLITE_MISUSE (code 21). Then split into single
        // statements (the driver executes one statement per call).
        const cleaned = sqlContent
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n');
        const statements = splitSqlStatements(cleaned);

        // Execute inside a transaction
        await db.$transaction(async (tx) => {
          for (const statement of statements) {
            try {
              await tx.$executeRawUnsafe(statement + ';');
            } catch (e) {
              // Idempotent DDL tolerance: a column/table/index that already exists
              // is the desired end state, not an error. This happens because the
              // schema was grown with `prisma db push` during development — the live
              // table already has columns a backfill migration also adds. SQLite
              // can't express "ADD COLUMN IF NOT EXISTS", so we swallow exactly these
              // and re-throw everything else (real errors still stop the run). The
              // "duplicate column"/"already exists" errors don't abort the SQLite
              // transaction, so the remaining statements still apply.
              const msg = String((e && e.message) || e).toLowerCase();
              if (msg.includes('duplicate column name') || msg.includes('already exists')) {
                continue;
              }
              throw e;
            }
          }
          // Record successful application
          await tx.$executeRawUnsafe(`INSERT INTO "_AppMigrations" ("id") VALUES (?);`, folder);
        });

        console.log(`[DB] Successfully applied: ${folder}`);
      } else {
        console.warn(`[DB] No migration.sql found in ${folder}`);
      }
    }
  }

  console.log('[DB] All migrations are up to date.');
}

async function bootstrapDatabase() {
  const db = getPrisma();

  // Run the safe SQL migration reader
  await applyMigrations(db);

  return true;
}

async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

module.exports = {
  configureDatabaseEnv,
  getRuntimeConfig,
  getPrisma,
  bootstrapDatabase,
  disconnectPrisma,
  // Phase 6 — at-rest encryption lifecycle
  isDbEncryptionEnabled,
  isDbUnlocked,
  getDbEncryptionInfo,
  unlockEncryptedDb,
  relockEncryptedDb,
  enableDbEncryption,
  disableDbEncryption,
  rekeyEncryptedDb
};
