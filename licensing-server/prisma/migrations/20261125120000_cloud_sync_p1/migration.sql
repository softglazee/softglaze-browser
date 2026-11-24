-- Cloud sync phase 1 (end-to-end encrypted workspace store, /v1/sync/*, src/sync/).
-- Additive only: four new tables, nothing else is created, changed or dropped, no row is written. Every statement
-- can run twice (CREATE TABLE IF NOT EXISTS). The previous build keeps running on this schema (it never reads these
-- tables); rollback = redeploy the previous build, the tables are then simply unused.
-- The tables hold ciphertext, public keys and signatures only (the server cannot read a workspace).
-- Applied BY HAND with the mysql CLI plus a _prisma_migrations row (Prisma's schema engine hangs on Hostinger):
-- see docs/CLOUD-SYNC-SERVER.md. The DDL is what `prisma migrate diff` produces for the four models.

CREATE TABLE IF NOT EXISTS `SyncWorkspace` (
    `id` VARCHAR(22) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NOT NULL,
    `ownerSignPub` VARCHAR(43) NOT NULL,
    `keyring` LONGBLOB NOT NULL,
    `keyringVersion` INTEGER NOT NULL DEFAULT 1,
    `recoveryWrap` BLOB NOT NULL,
    `bytesUsed` INTEGER NOT NULL DEFAULT 0,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SyncWorkspace_customerId_key`(`customerId`),
    INDEX `SyncWorkspace_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `SyncDevice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workspaceId` VARCHAR(22) NOT NULL,
    `tag` VARCHAR(11) NOT NULL,
    `signPub` VARCHAR(43) NOT NULL,
    `dhPub` VARCHAR(43) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `platform` VARCHAR(10) NOT NULL,
    `certJson` TEXT NOT NULL,
    `certSig` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `SyncDevice_workspaceId_tag_key`(`workspaceId`, `tag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `SyncRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workspaceId` VARCHAR(22) NOT NULL,
    `rid` VARCHAR(22) NOT NULL,
    `version` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `body` LONGBLOB NOT NULL,
    `sig` VARCHAR(100) NOT NULL,
    `dev` VARCHAR(11) NOT NULL,
    `size` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SyncRecord_workspaceId_seq_idx`(`workspaceId`, `seq`),
    UNIQUE INDEX `SyncRecord_workspaceId_rid_key`(`workspaceId`, `rid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `SyncEnrolment` (
    `id` VARCHAR(32) NOT NULL,
    `workspaceId` VARCHAR(22) NOT NULL,
    `requestJson` TEXT NOT NULL,
    `approvalJson` MEDIUMTEXT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `SyncEnrolment_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
