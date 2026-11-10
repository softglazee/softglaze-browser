-- Profile group ownership. Groups were workspace-wide: any member could list, rename or delete every
-- group and read the tags of profiles they could not see. The creator is now stamped here and the
-- Groups list is scoped like profiles and proxies (ipcHandlers.js scopedGroupWhere).
-- Nullable with no default: existing groups keep NULL. Like older macros, they stay visible to the
-- Owner and Admins, and to any member who can see a profile inside them. SQLite applies ADD COLUMN
-- as a header-only change, so no table is rebuilt and no existing row is touched.
ALTER TABLE "Group" ADD COLUMN "ownerMemberId" INTEGER;
CREATE INDEX "Group_ownerMemberId_idx" ON "Group"("ownerMemberId");
