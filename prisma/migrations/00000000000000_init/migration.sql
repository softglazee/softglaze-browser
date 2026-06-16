-- Initial SoftGlaze Browser SQLite schema
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

CREATE INDEX IF NOT EXISTS "Proxy_host_port_idx" ON "Proxy"("host", "port");
CREATE INDEX IF NOT EXISTS "Proxy_createdAt_idx" ON "Proxy"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_type_host_port_username_key" ON "Proxy"("type", "host", "port", "username");
CREATE UNIQUE INDEX IF NOT EXISTS "Profile_dataDirName_key" ON "Profile"("dataDirName");
CREATE INDEX IF NOT EXISTS "Profile_proxyId_idx" ON "Profile"("proxyId");
CREATE INDEX IF NOT EXISTS "Profile_createdAt_idx" ON "Profile"("createdAt");
