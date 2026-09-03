-- Company address for a vault identity. `company` only ever held the company NAME,
-- so a page's "Company address" input had no field to draw from and was left blank.
-- Nullable with no default: SQLite applies this as an O(1) header-only change, so no
-- table rebuild and no existing PersonaData row is touched.
ALTER TABLE "PersonaData" ADD COLUMN "companyAddress" TEXT;
