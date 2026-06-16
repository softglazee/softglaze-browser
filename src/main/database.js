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
