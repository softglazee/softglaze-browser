'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const { PrismaClient } = require('@prisma/client');
const dbCrypto = require('./dbCrypto');
const proxySecrets = require('./proxySecrets');

let prisma = null;
let runtime = null;

// At-rest encryption state. When enabled the on-disk DB is softglaze.sqlite.enc; the plaintext
// softglaze.sqlite exists only while unlocked. Key and salt are held in memory for the session.
const dbEnc = { enabled: false, unlocked: false, key: null, salt: null, version: dbCrypto.LEGACY_VERSION };
// Set during an enable/disable migration so getPrisma() refuses to (re)open the
// file mid-operation and create an inconsistent or empty database.
let migrating = false;

function normalizeSqliteFileUrl(filePath) {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

// Encryption flag sidecar, stored outside the DB so boot knows to unlock before opening Prisma.
// Not secret: the .enc authenticates itself via its GCM tag.
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

  // The sidecar can be lost (AV, chkdsk, partial copy) and readSidecar() fails open, so an existing
  // .enc is authoritative: require unlock rather than boot an empty DB over it. Disabling shreds it.
  dbEnc.enabled = Boolean(readSidecar().enabled) || fs.existsSync(runtime.encPath);
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

  // Never open (and so auto-create) the SQLite file while locked or mid-migration:
  // it would spawn an empty plaintext DB beside the ciphertext.
  if (dbEnc.enabled && !dbEnc.unlocked) {
    const err = new Error('The database is locked.');
    err.code = 'DATABASE_LOCKED';
    throw err;
  }
  if (migrating) {
    const err = new Error('The database is busy - an encryption change is in progress.');
    err.code = 'DATABASE_BUSY';
    throw err;
  }

  if (!prisma) {
    // This extension seals proxy passwords on write and opens them on read; callers see plaintext.
    prisma = proxySecrets.extendClient(new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
    }));
  }

  return prisma;
}

function isDbEncryptionEnabled() {
  return dbEnc.enabled;
}

// True when the DB can be opened.
function isDbUnlocked() {
  return !dbEnc.enabled || dbEnc.unlocked;
}

function getDbEncryptionInfo() {
  return { enabled: dbEnc.enabled, unlocked: isDbUnlocked() };
}

// Fold the WAL into the main file and close the handle, leaving one file to encrypt or copy.
async function checkpointAndDisconnect() {
  if (prisma) {
    try { await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) { /* not in WAL mode - fine */ }
  }
  await disconnectPrisma();
  if (runtime) {
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(runtime.dbPath + suffix); } catch (e) { /* none present */ }
    }
  }
}

function unlockError(e) {
  // A GCM failure means a wrong password or a corrupted file, which can't be told apart,
  // so the message says both and the UI offers retry and restore.
  const err = new Error('Incorrect password - or the database file is corrupted. If you are sure the password is right, restore from a backup.');
  err.code = 'DB_UNLOCK_FAILED';
  err.cause = e;
  return err;
}

// Boot/unlock: decrypt the .enc into the working file (or adopt a verified crash leftover) and hold
// the key. Throws DB_MISSING without ciphertext, DB_UNLOCK_FAILED on a wrong password or corrupt file.
async function unlockEncryptedDb(password) {
  if (!dbEnc.enabled) return getDbEncryptionInfo();
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(encPath)) {
    const err = new Error('The encrypted database file is missing.');
    err.code = 'DB_MISSING';
    throw err;
  }
  const { version, salt } = await dbCrypto.readHeader(encPath);
  const key = await dbCrypto.deriveKey(password, salt, version);

  // A plaintext file beside the .enc is a crash leftover and the newest copy. Keep it, but verify the
  // password by decrypting the .enc to a temp file so a wrong password is never accepted.
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
  dbEnc.version = version;
  return getDbEncryptionInfo();
}

// Quit/relock: re-encrypt the working file to the .enc, shred the plaintext, drop the key.
// No-op unless enabled and unlocked.
async function relockEncryptedDb() {
  if (!dbEnc.enabled || !dbEnc.unlocked || !dbEnc.key || !dbEnc.salt) return;
  const { dbPath, encPath } = runtime;
  await checkpointAndDisconnect();
  if (fs.existsSync(dbPath)) {
    // Re-encrypt with the version the file was opened as (no forced in-place
    // re-key - the held key was derived with that version's cost).
    await dbCrypto.encryptDbFile(dbPath, encPath, dbEnc.key, dbEnc.salt, dbEnc.version || dbCrypto.LEGACY_VERSION);
    await dbCrypto.secureUnlink(dbPath);
  }
  dbEnc.unlocked = false;
  dbEnc.key = null;
  dbEnc.salt = null;
}

// One-time enable migration: backup-first, verified, reversible. The plaintext stays for this session
// and is encrypted and shredded at quit. The caller confirms the user knows a lost password is final.
async function enableDbEncryption(password) {
  if (dbEnc.enabled) return getDbEncryptionInfo();
  if (!password || String(password).length < 8) {
    throw new Error('A password of at least 8 characters is required to enable database encryption.');
  }
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(dbPath)) throw new Error('No database file was found to encrypt.');

  migrating = true;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak-${stamp}`;
  try {
    await checkpointAndDisconnect();
    fs.copyFileSync(dbPath, backupPath); // safety net during migration

    const salt = dbCrypto.newSalt();
    const version = dbCrypto.CURRENT_VERSION; // new databases use the strong (v2) KDF
    const key = await dbCrypto.deriveKey(password, salt, version);
    await dbCrypto.encryptDbFile(dbPath, encPath, key, salt, version);

    // Prove the encrypted copy decrypts back bit-for-bit before trusting it.
    const verifyTmp = `${dbPath}.verify-${stamp}`;
    await dbCrypto.decryptDbFile(encPath, verifyTmp, key);
    const lossless = (await dbCrypto.sha256File(dbPath)) === (await dbCrypto.sha256File(verifyTmp));
    await dbCrypto.secureUnlink(verifyTmp);
    if (!lossless) {
      await dbCrypto.secureUnlink(encPath);
      throw new Error('Encryption verification failed - the database was left unchanged.');
    }

    writeSidecar({ enabled: true, version });
    dbEnc.enabled = true;
    dbEnc.unlocked = true;
    dbEnc.key = key;
    dbEnc.salt = salt;
    dbEnc.version = version;
    // Verified, so drop the plaintext backup; keeping it would defeat the purpose.
    await dbCrypto.secureUnlink(backupPath);
    return getDbEncryptionInfo();
  } catch (e) {
    // Roll back partial ciphertext if the committed state was never reached.
    if (!dbEnc.enabled) { try { await dbCrypto.secureUnlink(encPath); } catch (_) { /* noop */ } }
    throw e;
  } finally {
    migrating = false;
  }
}

// Disable: the working file is already current plaintext, so verify the password, clear the sidecar
// and shred the .enc. Never decrypt the older .enc over the newer working file.
async function disableDbEncryption(password) {
  if (!dbEnc.enabled) return getDbEncryptionInfo();
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(dbPath) || !dbCrypto.looksLikeSqlite(dbPath)) {
    throw new Error('The working database is not available - cannot safely disable encryption right now.');
  }

  // Authenticate the password against the at-rest ciphertext.
  if (fs.existsSync(encPath)) {
    const { version, salt } = await dbCrypto.readHeader(encPath);
    const key = await dbCrypto.deriveKey(password, salt, version);
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

// Re-key the .enc to a new vault password so the vault password keeps unlocking the DB.
// Only the .enc and the held key change.
async function rekeyEncryptedDb(newPassword) {
  if (!dbEnc.enabled || !dbEnc.unlocked) {
    const err = new Error('Cannot re-key: the database is not unlocked.');
    err.code = 'DB_NOT_UNLOCKED';
    throw err;
  }
  const { dbPath, encPath } = runtime;
  if (!fs.existsSync(dbPath)) {
    const err = new Error('Cannot re-key: the working database file is missing.');
    err.code = 'DB_MISSING';
    throw err;
  }
  // Fold WAL commits into the main file and block Prisma access before reading it, so the new .enc has
  // every row and no torn snapshot. The guards above throw so a re-key that can't run never leaves
  // the .enc on the old key while the caller commits the new vault password.
  migrating = true;
  try {
    await checkpointAndDisconnect();
    const salt = dbCrypto.newSalt();
    // A password change is a natural re-key point: upgrade to the strong (v2) KDF,
    // so existing users migrate off the legacy cost the next time they change it.
    const version = dbCrypto.CURRENT_VERSION;
    const key = await dbCrypto.deriveKey(newPassword, salt, version);
    await dbCrypto.encryptDbFile(dbPath, encPath, key, salt, version);
    dbEnc.key = key;
    dbEnc.salt = salt;
    dbEnc.version = version;
    try { writeSidecar({ enabled: true, version }); } catch (e) { /* sidecar is advisory; the .enc header is authoritative */ }
  } finally {
    migrating = false;
  }
}

// Split migration SQL into statements, quote-aware ('' escapes a quote inside a string literal).
// The caller strips comment lines first. Trigger bodies (BEGIN ...; END) are not handled.
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

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_AppMigrations" (
      "id" TEXT PRIMARY KEY,
      "appliedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Baseline a legacy database that has tables but no migration history,
  // or init would fail with "table Proxy already exists".
  const existingTables = await db.$queryRawUnsafe(`SELECT name AS "name" FROM sqlite_master WHERE type='table' AND name='Proxy';`);
  // AS on every raw read: SQLite does not guarantee result column names without it, and a
  // key of "id" with its quotes would make every migration look unapplied.
  const appliedRecords = await db.$queryRawUnsafe(`SELECT "id" AS "id" FROM "_AppMigrations";`);
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

  // Packaged builds read the unpacked prisma folder outside app.asar.
  const isPackaged = app.isPackaged;
  const basePath = isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'prisma', 'migrations')
    : path.join(__dirname, '../../prisma/migrations');

  if (!fs.existsSync(basePath)) {
    console.warn('[DB] Migrations directory not found at:', basePath);
    return;
  }

  // Migration folders start with a 14-digit timestamp.
  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  const migrationFolders = entries
    .filter(entry => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(entry => entry.name)
    .sort();

  for (const folder of migrationFolders) {
    if (!appliedSet.has(folder)) {
      console.log(`[DB] Applying new migration: ${folder}`);
      const sqlPath = path.join(basePath, folder, 'migration.sql');

      if (fs.existsSync(sqlPath)) {
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Strip full-line SQL comments (the driver throws SQLITE_MISUSE, code 21, on them),
        // then split: the driver runs one statement per call.
        const cleaned = sqlContent
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n');
        const statements = splitSqlStatements(cleaned);

        await db.$transaction(async (tx) => {
          for (const statement of statements) {
            try {
              await tx.$executeRawUnsafe(statement + ';');
            } catch (e) {
              // Tolerate only idempotent `prisma db push` drift: duplicate ADD COLUMN, existing INDEX/TRIGGER.
              // Anything else (even an existing CREATE TABLE) throws and rolls back the transaction, so the
              // migration retries next boot instead of committing a half-applied, data-losing rebuild.
              const msg = String((e && e.message) || e).toLowerCase();
              const stmt = String(statement || '').trim().toLowerCase();
              const dupColumnOnAddColumn = msg.includes('duplicate column name') && /^alter\s+table\b[\s\S]*\badd\s+column\b/.test(stmt);
              const idxOrTriggerExists = msg.includes('already exists') && /^create\s+(unique\s+)?(index|trigger)\b/.test(stmt);
              if (dupColumnOnAddColumn || idxOrTriggerExists) {
                continue;
              }
              throw e;
            }
          }
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

  await applyMigrations(db);

  // Idempotent: seal plaintext proxy passwords and fill passwordHash; failing rows are logged and kept.
  try { await proxySecrets.migrateProxyPasswords(db); } catch (e) { console.error('[DB] proxy password migration skipped:', e && e.message ? e.message : e); }

  return true;
}

async function disconnectPrisma() {
  proxySecrets.resetHashKeyCache(); // a restored / re-keyed database carries its own hash key
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
  // At-rest encryption lifecycle
  isDbEncryptionEnabled,
  isDbUnlocked,
  getDbEncryptionInfo,
  unlockEncryptedDb,
  relockEncryptedDb,
  enableDbEncryption,
  disableDbEncryption,
  rekeyEncryptedDb
};
