-- Microsoft Store subscriptions (src/store/entitlements.js): one row per Store add-on per install.
-- Additive only: one new table with a foreign key to Tenant. No existing table or column changes, so it
-- is safe on the live database and the previous build keeps running on it (rollback = redeploy).

-- CreateTable
CREATE TABLE `StoreEntitlement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `installId` VARCHAR(40) NOT NULL,
    `customerId` VARCHAR(40) NULL,
    `licenseId` VARCHAR(40) NULL,
    `account` VARCHAR(254) NULL,
    `productId` VARCHAR(100) NOT NULL,
    `planKey` VARCHAR(60) NULL,
    `tier` VARCHAR(20) NOT NULL DEFAULT 'pro',
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `verifyNote` VARCHAR(60) NULL,
    `expiresAt` DATETIME(3) NULL,
    `accessUntil` DATETIME(3) NULL,
    `autoRenew` BOOLEAN NULL,
    `recurrenceId` VARCHAR(100) NULL,
    `recurrenceState` VARCHAR(30) NULL,
    `storeId` VARCHAR(64) NULL,
    `skuStoreId` VARCHAR(80) NULL,
    `subscriptionKey` VARCHAR(120) NULL,
    `priceFormatted` VARCHAR(40) NULL,
    `currency` VARCHAR(3) NULL,
    `collectionsKeySealed` TEXT NULL,
    `purchaseKeySealed` TEXT NULL,
    `keysIssuedAt` DATETIME(3) NULL,
    `movedAt` DATETIME(3) NULL,
    `firstClaimAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastClaimAt` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastCheckError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StoreEntitlement_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `StoreEntitlement_tenantId_verified_status_idx`(`tenantId`, `verified`, `status`),
    INDEX `StoreEntitlement_tenantId_subscriptionKey_idx`(`tenantId`, `subscriptionKey`),
    INDEX `StoreEntitlement_tenantId_customerId_idx`(`tenantId`, `customerId`),
    UNIQUE INDEX `StoreEntitlement_tenantId_installId_productId_key`(`tenantId`, `installId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StoreEntitlement` ADD CONSTRAINT `StoreEntitlement_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

