-- Profile template ownership. Templates were workspace-wide: any member could list and delete every
-- template, and use one that links another member's proxy or group. The maker is now stamped here and
-- the template list is scoped like profile groups (ipcHandlers.js scopedTemplateWhere).
-- Nullable with no default: existing templates keep NULL and stay visible to the Owner and Admins.
-- SQLite applies ADD COLUMN as a header-only change, so no table is rebuilt and no row is touched.
ALTER TABLE "Template" ADD COLUMN "ownerMemberId" INTEGER;
CREATE INDEX "Template_ownerMemberId_idx" ON "Template"("ownerMemberId");
