'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const { PrismaClient } = require('@prisma/client');

let prisma = null;
let runtime = null;

function normalizeSqliteFileUrl(filePath) {
  return `file:${filePath.replace(/\\/g, '/')}`;
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
    profileRoot,
    databaseUrl: process.env.DATABASE_URL
  };

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

  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
    });
  }

  return prisma;
}

// ---------------------------------------------------------------------------
// Automated SQLite Migration Runner
// ---------------------------------------------------------------------------
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
      await db.$executeRawUnsafe(`INSERT OR IGNORE INTO "_AppMigrations" ("id") VALUES ('${m}');`);
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
        
        // Split by statement to execute sequentially
        const statements = sqlContent.split(';').map(s => s.trim()).filter(s => s.length > 0);
        
        // Execute inside a transaction
        await db.$transaction(async (tx) => {
          for (const statement of statements) {
            await tx.$executeRawUnsafe(statement + ';');
          }
          // Record successful application
          await tx.$executeRawUnsafe(`INSERT INTO "_AppMigrations" ("id") VALUES ('${folder}');`);
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
  disconnectPrisma
};