-- Macro ownership (audit T2-5). Macros were global: any member could read every recorded
-- login macro, including typed password values, and rewrite or delete anyone's macros.
-- The creator is now stamped here and lists are scoped to the member's visible subtree.
-- Nullable with no default: existing macros and the seeded starters keep NULL and stay
-- visible to owners and admins. SQLite applies ADD COLUMN as a header-only change, so no
-- table rebuild and no existing row is touched.
ALTER TABLE "Macro" ADD COLUMN "ownerMemberId" INTEGER;
CREATE INDEX "Macro_ownerMemberId_idx" ON "Macro"("ownerMemberId");
