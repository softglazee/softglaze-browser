-- Persist the proxy's last DNSBL (blocklist) result from the health checker so the
-- pool can be filtered by blacklisted / clean across sessions.
ALTER TABLE "Proxy" ADD COLUMN "lastBlacklisted" BOOLEAN;
