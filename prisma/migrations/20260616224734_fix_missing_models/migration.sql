/*
  Warnings:

  - The primary key for the `Group` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `updatedAt` on the `Group` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `Group` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - You are about to drop the column `advancedBrowser` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `advancedExt` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `advancedSync` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `audioContextNoise` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `browserCore` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `browserSettingsJson` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `browserVersion` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `canvasNoise` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `clientRectsNoise` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `cpuCores` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `cpuType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `deviceName` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `deviceNameType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `disableTls` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `displayLangCustom` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `displayLangType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `doNotTrack` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `fontsType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `hardwareAcceleration` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `languageCustom` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `languageType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `launchArgs` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `locationAcc` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `locationLat` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `locationLng` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `locationPrompt` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `locationType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `macAddress` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `macAddressType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `mediaDevice` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `os` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `osVersion` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `platformAccounts` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `portScanProtection` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `ramGb` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `ramType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `randomFingerprint` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionH` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionW` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `speechVoicesNoise` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `startupUrls` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `syncItemsJson` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `timezoneCustom` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `timezoneType` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `webglImageNoise` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `webglMetadata` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `webglRenderer` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `webglVendor` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `webgpu` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `webrtc` on the `Profile` table. All the data in the column will be lost.
  - You are about to alter the column `groupId` on the `Profile` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Group" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Group" ("createdAt", "id", "name") SELECT "createdAt", "id", "name" FROM "Group";
DROP TABLE "Group";
ALTER TABLE "new_Group" RENAME TO "Group";
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");
CREATE TABLE "new_Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "proxyId" INTEGER,
    "proxyInfoString" TEXT,
    "notes" TEXT,
    "tagManagement" INTEGER NOT NULL DEFAULT 0,
    "systemProxyBehavior" TEXT NOT NULL DEFAULT 'PROFILE_PROXY',
    "dataDirName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "groupId" INTEGER,
    CONSTRAINT "Profile_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Profile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("createdAt", "dataDirName", "deletedAt", "groupId", "id", "notes", "proxyId", "proxyInfoString", "systemProxyBehavior", "tagManagement", "title") SELECT "createdAt", "dataDirName", "deletedAt", "groupId", "id", "notes", "proxyId", "proxyInfoString", "systemProxyBehavior", "tagManagement", "title" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_dataDirName_key" ON "Profile"("dataDirName");
CREATE INDEX "Profile_proxyId_idx" ON "Profile"("proxyId");
CREATE INDEX "Profile_groupId_idx" ON "Profile"("groupId");
CREATE INDEX "Profile_createdAt_idx" ON "Profile"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
