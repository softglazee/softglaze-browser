-- Team Extensions: locally-stored, unzipped Chrome extensions mounted at launch.
CREATE TABLE IF NOT EXISTS "Extension" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "chromeId" TEXT NOT NULL, "version" TEXT, "localPath" TEXT NOT NULL, "isGlobal" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS "Extension_chromeId_key" ON "Extension"("chromeId");
CREATE INDEX IF NOT EXISTS "Extension_isGlobal_idx" ON "Extension"("isGlobal");
