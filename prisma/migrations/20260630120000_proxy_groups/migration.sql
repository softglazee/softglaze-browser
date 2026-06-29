-- Proxy categories/groups (USA, UK, Japan, …) + a provider origin tag on each proxy.
CREATE TABLE IF NOT EXISTS "ProxyGroup" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "color" TEXT DEFAULT '#3b82f6',
  "ownerMemberId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProxyGroup_createdAt_idx" ON "ProxyGroup"("createdAt");
CREATE INDEX IF NOT EXISTS "ProxyGroup_ownerMemberId_idx" ON "ProxyGroup"("ownerMemberId");
ALTER TABLE "Proxy" ADD COLUMN "proxyGroupId" INTEGER;
ALTER TABLE "Proxy" ADD COLUMN "provider" TEXT;
CREATE INDEX IF NOT EXISTS "Proxy_proxyGroupId_idx" ON "Proxy"("proxyGroupId");
