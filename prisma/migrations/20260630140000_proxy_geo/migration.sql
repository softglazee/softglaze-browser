-- Persist exit-node region/city (from the proxy health check) so the pool can be
-- auto-grouped by State/City, not just Country.
ALTER TABLE "Proxy" ADD COLUMN "lastRegion" TEXT;
ALTER TABLE "Proxy" ADD COLUMN "lastCity" TEXT;
