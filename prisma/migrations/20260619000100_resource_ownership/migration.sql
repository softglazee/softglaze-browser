ALTER TABLE "Proxy" ADD COLUMN "ownerMemberId" INTEGER;
CREATE INDEX IF NOT EXISTS "Proxy_ownerMemberId_idx" ON "Proxy"("ownerMemberId");
