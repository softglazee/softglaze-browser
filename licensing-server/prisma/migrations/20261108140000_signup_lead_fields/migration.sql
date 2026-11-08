-- Lead details from the app's sign-up and "Confirm your email" step (app 1.0.23): phone, what the person
-- will use SoftGlaze for, and company or website. Customer already has `phone` and `company`; it gets the
-- use case. EmailVerification holds all four until the code is proven (src/account/verify.js).
-- Additive only: six NULL columns, no index, no data change. Safe on the live database with its rows,
-- and the previous build keeps running on it (rollback = redeploy the previous build).

-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `useCase` VARCHAR(40) NULL,
    ADD COLUMN `useCaseOther` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `EmailVerification` ADD COLUMN `phone` VARCHAR(40) NULL,
    ADD COLUMN `company` VARCHAR(200) NULL,
    ADD COLUMN `useCase` VARCHAR(40) NULL,
    ADD COLUMN `useCaseOther` VARCHAR(200) NULL;
