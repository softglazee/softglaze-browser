-- Where each install came from, reported by the app from 1.0.23: store | website | base.
-- Additive only: two NULL columns and one index, safe on the live database with its existing rows.
-- Installs from older apps keep NULL (shown as "unknown" in the admin metrics).

-- AlterTable
ALTER TABLE `Install` ADD COLUMN `channel` VARCHAR(16) NULL;

-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `firstChannel` VARCHAR(16) NULL;

-- CreateIndex
CREATE INDEX `Install_tenantId_channel_idx` ON `Install`(`tenantId`, `channel`);
