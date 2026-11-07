-- Customers, trial ledger, email verification, email outbox/templates, settings, scoped admin keys,
-- admin audit, plan price history, segments, daily metric snapshots and the cron lock.
-- Additive only: new tables, and new columns on Plan/Install/License/Payment that are NULL or have
-- defaults, so it is safe on the live database with its existing rows. Data backfill is the next migration.

-- AlterTable
ALTER TABLE `Plan` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `features` JSON NULL,
    ADD COLUMN `highlight` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `limits` JSON NULL,
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `Install` ADD COLUMN `appVersion` VARCHAR(40) NULL,
    ADD COLUMN `customerId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `License` ADD COLUMN `complimentary` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `customerId` VARCHAR(191) NULL,
    ADD COLUMN `note` TEXT NULL,
    ADD COLUMN `revokedAt` DATETIME(3) NULL,
    ADD COLUMN `revokedReason` TEXT NULL,
    ADD COLUMN `source` VARCHAR(20) NULL;

-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `customerId` VARCHAR(191) NULL,
    ADD COLUMN `method` VARCHAR(30) NULL,
    ADD COLUMN `note` TEXT NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `recordedBy` VARCHAR(160) NULL,
    ADD COLUMN `refundedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `emailKey` VARCHAR(254) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `name` VARCHAR(200) NULL,
    `company` VARCHAR(200) NULL,
    `country` VARCHAR(2) NULL,
    `phone` VARCHAR(40) NULL,
    `lang` VARCHAR(10) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'app',
    `status` VARCHAR(20) NOT NULL DEFAULT 'lead',
    `statusAuto` VARCHAR(20) NOT NULL DEFAULT 'lead',
    `statusOverride` VARCHAR(20) NULL,
    `statusNote` TEXT NULL,
    `tier` VARCHAR(20) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NULL,
    `appVersion` VARCHAR(40) NULL,
    `trialStartedAt` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `paidSince` DATETIME(3) NULL,
    `paidUntil` DATETIME(3) NULL,
    `complimentaryUntil` DATETIME(3) NULL,
    `totalPaidCents` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NULL,
    `marketingConsent` BOOLEAN NOT NULL DEFAULT false,
    `consentAt` DATETIME(3) NULL,
    `consentSource` VARCHAR(40) NULL,
    `unsubscribedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `tags` JSON NULL,
    `tagIndex` VARCHAR(1000) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Customer_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `Customer_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `Customer_tenantId_lastSeenAt_idx`(`tenantId`, `lastSeenAt`),
    INDEX `Customer_tenantId_deletedAt_idx`(`tenantId`, `deletedAt`),
    UNIQUE INDEX `Customer_tenantId_emailKey_key`(`tenantId`, `emailKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerEvent_tenantId_type_at_idx`(`tenantId`, `type`, `at`),
    INDEX `CustomerEvent_tenantId_customerId_at_idx`(`tenantId`, `customerId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailVerification` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `installId` VARCHAR(40) NOT NULL,
    `customerId` VARCHAR(40) NULL,
    `email` VARCHAR(254) NOT NULL,
    `emailKey` VARCHAR(254) NOT NULL,
    `name` VARCHAR(200) NULL,
    `lang` VARCHAR(10) NULL,
    `country` VARCHAR(2) NULL,
    `consentMarketing` BOOLEAN NOT NULL DEFAULT false,
    `codeHash` VARCHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `ipHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailVerification_tenantId_installId_emailKey_idx`(`tenantId`, `installId`, `emailKey`),
    INDEX `EmailVerification_tenantId_emailKey_createdAt_idx`(`tenantId`, `emailKey`, `createdAt`),
    INDEX `EmailVerification_tenantId_ipHash_createdAt_idx`(`tenantId`, `ipHash`, `createdAt`),
    INDEX `EmailVerification_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trial` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NULL,
    `installId` VARCHAR(40) NULL,
    `machineHash` VARCHAR(64) NOT NULL,
    `emailKeyHash` VARCHAR(64) NOT NULL,
    `ipHash` VARCHAR(64) NULL,
    `machineLock` VARCHAR(64) NULL,
    `emailLock` VARCHAR(64) NULL,
    `networkCounted` BOOLEAN NOT NULL DEFAULT true,
    `tier` VARCHAR(20) NOT NULL DEFAULT 'enterprise',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NOT NULL,
    `convertedAt` DATETIME(3) NULL,
    `resetAt` DATETIME(3) NULL,
    `resetReason` TEXT NULL,
    `resetBy` VARCHAR(160) NULL,

    INDEX `Trial_tenantId_ipHash_startedAt_idx`(`tenantId`, `ipHash`, `startedAt`),
    INDEX `Trial_tenantId_customerId_idx`(`tenantId`, `customerId`),
    INDEX `Trial_tenantId_installId_idx`(`tenantId`, `installId`),
    INDEX `Trial_tenantId_startedAt_idx`(`tenantId`, `startedAt`),
    UNIQUE INDEX `Trial_tenantId_machineLock_key`(`tenantId`, `machineLock`),
    UNIQUE INDEX `Trial_tenantId_emailLock_key`(`tenantId`, `emailLock`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrialAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `installId` VARCHAR(40) NULL,
    `outcome` VARCHAR(30) NOT NULL,
    `ipHash` VARCHAR(64) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrialAttempt_tenantId_at_idx`(`tenantId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `lang` VARCHAR(10) NOT NULL DEFAULT 'en',
    `name` VARCHAR(120) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `html` TEXT NOT NULL,
    `text` TEXT NOT NULL,
    `builtIn` BOOLEAN NOT NULL DEFAULT false,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `updatedBy` VARCHAR(160) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailTemplate_tenantId_key_lang_key`(`tenantId`, `key`, `lang`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NULL,
    `toEmail` VARCHAR(254) NOT NULL,
    `templateKey` VARCHAR(60) NULL,
    `category` VARCHAR(20) NOT NULL,
    `campaignId` VARCHAR(40) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `subject` VARCHAR(255) NOT NULL,
    `html` MEDIUMTEXT NULL,
    `text` MEDIUMTEXT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'queued',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `messageId` VARCHAR(255) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(160) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailOutbox_tenantId_status_nextAttemptAt_idx`(`tenantId`, `status`, `nextAttemptAt`),
    INDEX `EmailOutbox_tenantId_customerId_idx`(`tenantId`, `customerId`),
    INDEX `EmailOutbox_tenantId_campaignId_idx`(`tenantId`, `campaignId`),
    INDEX `EmailOutbox_tenantId_sentAt_idx`(`tenantId`, `sentAt`),
    UNIQUE INDEX `EmailOutbox_tenantId_dedupeKey_key`(`tenantId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` VARCHAR(160) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Setting_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminKey` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `scopes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AdminKey_keyHash_key`(`keyHash`),
    INDEX `AdminKey_tenantId_label_idx`(`tenantId`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAudit` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actor` VARCHAR(160) NOT NULL,
    `keyId` VARCHAR(40) NULL,
    `action` VARCHAR(60) NOT NULL,
    `targetType` VARCHAR(30) NULL,
    `targetId` VARCHAR(64) NULL,
    `detail` JSON NULL,

    INDEX `AdminAudit_tenantId_at_idx`(`tenantId`, `at`),
    INDEX `AdminAudit_tenantId_targetType_targetId_idx`(`tenantId`, `targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanPriceHistory` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `planKey` VARCHAR(191) NOT NULL,
    `oldAmount` INTEGER NULL,
    `newAmount` INTEGER NOT NULL,
    `oldCurrency` VARCHAR(3) NULL,
    `newCurrency` VARCHAR(3) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changedBy` VARCHAR(160) NULL,
    `note` TEXT NULL,

    INDEX `PlanPriceHistory_tenantId_planKey_changedAt_idx`(`tenantId`, `planKey`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Segment` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `filters` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Segment_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MetricSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `data` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MetricSnapshot_tenantId_day_key`(`tenantId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobLock` (
    `name` VARCHAR(60) NOT NULL,
    `lockedUntil` DATETIME(3) NULL,
    `holder` VARCHAR(80) NULL,
    `lastStartedAt` DATETIME(3) NULL,
    `lastFinishedAt` DATETIME(3) NULL,
    `lastResult` JSON NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Install_tenantId_customerId_idx` ON `Install`(`tenantId`, `customerId`);

-- CreateIndex
CREATE INDEX `License_tenantId_customerId_idx` ON `License`(`tenantId`, `customerId`);

-- CreateIndex
CREATE INDEX `Payment_tenantId_customerId_idx` ON `Payment`(`tenantId`, `customerId`);

-- CreateIndex
CREATE INDEX `Payment_tenantId_paidAt_idx` ON `Payment`(`tenantId`, `paidAt`);

-- AddForeignKey
ALTER TABLE `Install` ADD CONSTRAINT `Install_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `License` ADD CONSTRAINT `License_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerEvent` ADD CONSTRAINT `CustomerEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailVerification` ADD CONSTRAINT `EmailVerification_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Trial` ADD CONSTRAINT `Trial_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrialAttempt` ADD CONSTRAINT `TrialAttempt_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplate` ADD CONSTRAINT `EmailTemplate_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailOutbox` ADD CONSTRAINT `EmailOutbox_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Setting` ADD CONSTRAINT `Setting_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminKey` ADD CONSTRAINT `AdminKey_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAudit` ADD CONSTRAINT `AdminAudit_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanPriceHistory` ADD CONSTRAINT `PlanPriceHistory_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Segment` ADD CONSTRAINT `Segment_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MetricSnapshot` ADD CONSTRAINT `MetricSnapshot_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

