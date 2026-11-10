-- One-click sign-in (app 1.0.26, src/auth/): sign-in methods (Identity), the browser leg of a provider
-- sign-in (AuthState, 10 minutes), one-time exchange codes (AuthCode, 60 seconds) and app sessions
-- (AuthSession, only token hashes). Additive only: four new tables with a foreign key to Tenant. No
-- existing table or column changes, so it is safe on the live database and the previous build keeps
-- running on it (rollback = redeploy the previous build; the tables are then unused).

-- CreateTable
CREATE TABLE `Identity` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `providerUserId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `login` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    INDEX `Identity_tenantId_customerId_idx`(`tenantId`, `customerId`),
    UNIQUE INDEX `Identity_tenantId_provider_providerUserId_key`(`tenantId`, `provider`, `providerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthState` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `stateHash` VARCHAR(64) NOT NULL,
    `nonceHash` VARCHAR(64) NOT NULL,
    `codeChallenge` VARCHAR(64) NOT NULL,
    `appState` VARCHAR(128) NOT NULL,
    `appRedirect` VARCHAR(100) NOT NULL,
    `ipHash` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuthState_stateHash_key`(`stateHash`),
    INDEX `AuthState_tenantId_ipHash_createdAt_idx`(`tenantId`, `ipHash`, `createdAt`),
    INDEX `AuthState_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthCode` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `authStateId` VARCHAR(40) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `profile` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuthCode_codeHash_key`(`codeHash`),
    INDEX `AuthCode_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSession` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(40) NOT NULL,
    `installId` VARCHAR(40) NOT NULL,
    `identityId` VARCHAR(40) NULL,
    `provider` VARCHAR(20) NOT NULL,
    `emailKey` VARCHAR(254) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `ipHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AuthSession_tokenHash_key`(`tokenHash`),
    INDEX `AuthSession_tenantId_installId_customerId_idx`(`tenantId`, `installId`, `customerId`),
    INDEX `AuthSession_tenantId_customerId_idx`(`tenantId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Identity` ADD CONSTRAINT `Identity_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthState` ADD CONSTRAINT `AuthState_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthCode` ADD CONSTRAINT `AuthCode_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
