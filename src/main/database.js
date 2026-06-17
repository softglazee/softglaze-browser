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
// Additive, idempotent column migration for the live (userData) database.
//
// The runtime DB is created by the raw SQL in bootstrapDatabase() and lives in
// Electron's userData dir, NOT in the project folder. There is no Prisma CLI on
// an end-user's machine, so `prisma migrate` cannot run there. Instead we evolve
// the schema in code: SQLite's ALTER TABLE ... ADD COLUMN is non-destructive
// (existing rows/data are preserved), and PROFILE_COLUMNS is the single source
// of truth for every column we add to Profile over time.
// ---------------------------------------------------------------------------
const PROFILE_COLUMNS = [
  // Identity / environment
  ['browserCore', 'TEXT'], ['browserVersion', 'TEXT'], ['os', 'TEXT'], ['osVersion', 'TEXT'],
  ['userAgent', "TEXT DEFAULT 'Auto'"], ['startupUrls', 'TEXT'], ['platformAccounts', 'TEXT'],

  // WebRTC / timezone / geolocation
  ['webrtc', 'TEXT'], ['timezoneType', 'TEXT'], ['timezoneCustom', 'TEXT'],
  ['locationType', 'TEXT'], ['locationPrompt', 'TEXT'], ['locationLat', 'TEXT'],
  ['locationLng', 'TEXT'], ['locationAcc', 'TEXT'],

  // Language / display / resolution / fonts
  ['languageType', 'TEXT'], ['languageCustom', 'TEXT'], ['displayLangType', 'TEXT'],
  ['displayLangCustom', 'TEXT'], ['resolutionType', 'TEXT'], ['resolutionW', 'TEXT'],
  ['resolutionH', 'TEXT'], ['fontsType', 'TEXT'],

  // Fingerprint noise toggles (stored as 0/1)
  ['canvasNoise', 'INTEGER NOT NULL DEFAULT 1'], ['webglImageNoise', 'INTEGER NOT NULL DEFAULT 1'],
  ['audioContextNoise', 'INTEGER NOT NULL DEFAULT 1'], ['clientRectsNoise', 'INTEGER NOT NULL DEFAULT 1'],
  ['speechVoicesNoise', 'INTEGER NOT NULL DEFAULT 1'], ['mediaDevice', 'TEXT'],

  // WebGL / WebGPU
  ['webglMetadata', 'TEXT'], ['webglVendor', 'TEXT'], ['webglRenderer', 'TEXT'], ['webgpu', 'TEXT'],

  // Hardware (sent as strings from the UI)
  ['cpuType', 'TEXT'], ['cpuCores', 'TEXT'], ['ramType', 'TEXT'], ['ramGb', 'TEXT'],

  // Device identity
  ['deviceNameType', 'TEXT'], ['deviceName', 'TEXT'], ['macAddressType', 'TEXT'], ['macAddress', 'TEXT'],

  // Privacy / network / launch
  ['doNotTrack', 'TEXT'], ['portScanProtection', 'TEXT'], ['hardwareAcceleration', 'TEXT'],
  ['disableTls', 'TEXT'], ['launchArgs', 'TEXT'],

  // Advanced (extensions / sync / browser settings)
  ['advancedExt', 'TEXT'], ['advancedSync', 'TEXT'], ['syncItemsJson', 'TEXT'],
  ['advancedBrowser', 'TEXT'], ['browserSettingsJson', 'TEXT'],
  ['randomFingerprint', 'INTEGER NOT NULL DEFAULT 0'],

  // Timestamps / soft delete
  // (CURRENT_TIMESTAMP is NOT allowed as a default in ALTER ADD COLUMN, so
  //  updatedAt is added nullable here and backfilled from createdAt below.)
  ['updatedAt', 'DATETIME'],
  ['deletedAt', 'DATETIME']
];

async function ensureProfileColumns(db) {
  const rows = await db.$queryRawUnsafe('PRAGMA table_info("Profile");');
  const existing = new Set(rows.map((r) => r.name));

  const added = [];
  for (const [name, ddl] of PROFILE_COLUMNS) {
    if (existing.has(name)) continue;
    await db.$executeRawUnsafe(`ALTER TABLE "Profile" ADD COLUMN "${name}" ${ddl};`);
    added.push(name);
  }

  // Give pre-existing rows a real updatedAt so Prisma never reads NULL into the
  // non-nullable updatedAt field (which would throw on profile:list).
  if (added.includes('updatedAt')) {
    await db.$executeRawUnsafe('UPDATE "Profile" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;');
  }

  // Helps Trash / soft-delete queries in Step 2.
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Profile_deletedAt_idx" ON "Profile"("deletedAt");');

  console.log(
    added.length > 0
      ? `[DB] ensureProfileColumns added ${added.length} column(s): ${added.join(', ')}`
      : '[DB] ensureProfileColumns: schema already up to date.'
  );

  return added;
}

async function bootstrapDatabase() {
  const db = getPrisma();

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Proxy" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'HTTP',
      "host" TEXT NOT NULL,
      "port" INTEGER NOT NULL,
      "username" TEXT,
      "password" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Profile" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "title" TEXT NOT NULL,
      "proxyId" INTEGER,
      "proxyInfoString" TEXT,
      "notes" TEXT,
      "tagManagement" INTEGER NOT NULL DEFAULT 0,
      "systemProxyBehavior" TEXT NOT NULL DEFAULT 'PROFILE_PROXY',
      "dataDirName" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Profile_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
  `);

  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Proxy_host_port_idx" ON "Proxy"("host", "port");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Proxy_createdAt_idx" ON "Proxy"("createdAt");');
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_type_host_port_username_key" ON "Proxy"("type", "host", "port", "username");');
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Profile_dataDirName_key" ON "Profile"("dataDirName");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Profile_proxyId_idx" ON "Profile"("proxyId");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Profile_createdAt_idx" ON "Profile"("createdAt");');

  // Bring the live Profile table up to date with schema.prisma (additive, safe).
  await ensureProfileColumns(db);

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