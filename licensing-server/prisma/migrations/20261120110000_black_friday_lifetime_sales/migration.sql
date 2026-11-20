-- Black Friday 2026: lifetime plans with a sales cap and a sale window (src/plans/sales.js).
-- Additive only: three NULL columns on Plan and one new index on Payment. No existing column changes type,
-- nothing is dropped, renamed or rewritten, and no row is inserted or updated. Every existing plan keeps
-- saleCap / saleStartsAt / saleEndsAt NULL, which means "no cap, no window": exactly today's behaviour.
-- Plain MariaDB 11.8 / MySQL 8 SQL, to be applied by hand on production (see docs/BLACK-FRIDAY-2026.md).
-- Independent of 20261120120000_free_plan_partner_deals (feat/free-plan-server): either may run first.
-- Rollback: the previous build ignores the new columns; to remove them by hand:
--   ALTER TABLE `Plan` DROP COLUMN `saleCap`, DROP COLUMN `saleStartsAt`, DROP COLUMN `saleEndsAt`;
--   DROP INDEX `Payment_tenantId_plan_status_idx` ON `Payment`;

-- AlterTable
ALTER TABLE `Plan` ADD COLUMN `saleCap` INTEGER NULL,
    ADD COLUMN `saleStartsAt` DATETIME(3) NULL,
    ADD COLUMN `saleEndsAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Payment_tenantId_plan_status_idx` ON `Payment`(`tenantId`, `plan`, `status`);
