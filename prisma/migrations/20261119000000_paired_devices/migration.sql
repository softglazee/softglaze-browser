-- SoftGlaze phone companion: phones paired with this PC. New table only, nothing else changes.
CREATE TABLE "PairedDevice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "appVersion" TEXT,
    "mailboxId" TEXT NOT NULL,
    "x25519Pub" TEXT NOT NULL,
    "ed25519Pub" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "memberId" INTEGER,
    "scopesJson" TEXT NOT NULL DEFAULT '["view"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME
);
CREATE UNIQUE INDEX "PairedDevice_deviceId_key" ON "PairedDevice"("deviceId");
CREATE UNIQUE INDEX "PairedDevice_mailboxId_key" ON "PairedDevice"("mailboxId");
CREATE INDEX "PairedDevice_keyId_idx" ON "PairedDevice"("keyId");
CREATE INDEX "PairedDevice_memberId_idx" ON "PairedDevice"("memberId");
