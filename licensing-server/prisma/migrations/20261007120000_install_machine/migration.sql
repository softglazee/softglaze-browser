-- AlterTable
ALTER TABLE `Install` ADD COLUMN `machineBoundAt` DATETIME(3) NULL,
    ADD COLUMN `machineHash` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `License` ADD COLUMN `rebindCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rebindWindowStart` DATETIME(3) NULL;

