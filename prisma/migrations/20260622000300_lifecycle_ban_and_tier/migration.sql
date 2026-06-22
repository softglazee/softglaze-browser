-- Phase 8: trial -> grace -> ban lifecycle + recorded plan tier.
-- License gains a recorded tier (pro/enterprise); Member gains a ban reason and
-- can hold status 'banned' (status is free text, so no enum change needed). The
-- app's migration runner tolerates a duplicate-column error if the schema was
-- already grown via `prisma db push`.
ALTER TABLE "License" ADD COLUMN "tier" TEXT DEFAULT 'pro';
ALTER TABLE "Member" ADD COLUMN "banReason" TEXT;
