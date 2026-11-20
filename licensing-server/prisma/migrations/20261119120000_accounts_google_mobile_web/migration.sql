-- Accounts across desktop, phone and web (Google sign-in, /v1/mobile/auth/*, /v1/web/auth/*, /v1/account/*).
-- Additive only: NULL columns (or NOT NULL with a DEFAULT) on EmailVerification, AuthState and AuthSession, one
-- new table (MobileDevice) and new indexes. No existing column changes type, nothing is dropped or rewritten.
-- Existing AuthSession rows get kind = 'desktop' and expiresAt = NULL, which the server reads as "legacy, no
-- expiry", so every desktop that is signed in today stays signed in. The previous build keeps running on this
-- schema (it never reads the new columns); rollback = redeploy the previous build.

-- AlterTable
ALTER TABLE `EmailVerification` ADD COLUMN `challengeHash` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `AuthState` ADD COLUMN `clientId` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `AuthSession` ADD COLUMN `accessExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `clientId` VARCHAR(40) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `kind` VARCHAR(10) NOT NULL DEFAULT 'desktop',
    ADD COLUMN `prevRefreshHash` VARCHAR(64) NULL,
    ADD COLUMN `refreshHash` VARCHAR(64) NULL,
    ADD COLUMN `userAgent` VARCHAR(200) NULL;

-- CreateTable
CREATE TABLE `MobileDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NOT NULL,
    `authSessionId` VARCHAR(40) NOT NULL,
    `platform` VARCHAR(10) NOT NULL,
    `model` VARCHAR(100) NULL,
    `appVersion` VARCHAR(40) NULL,
    `installationId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `MobileDevice_authSessionId_key`(`authSessionId`),
    INDEX `MobileDevice_tenantId_customerId_idx`(`tenantId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `EmailVerification_challengeHash_key` ON `EmailVerification`(`challengeHash`);

-- CreateIndex
CREATE UNIQUE INDEX `AuthSession_refreshHash_key` ON `AuthSession`(`refreshHash`);

-- CreateIndex
CREATE INDEX `AuthSession_prevRefreshHash_idx` ON `AuthSession`(`prevRefreshHash`);

-- AddForeignKey
ALTER TABLE `MobileDevice` ADD CONSTRAINT `MobileDevice_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

