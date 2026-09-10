-- Why a proxy health check failed, kept alongside the pass/fail verdict.
-- persistProxyHealth recorded only lastStatus='fail', so the gateway's own reason
-- (e.g. Apify's "Monthly usage hard limit exceeded") was lost the moment the run
-- finished and the pool showed a bare red badge with no way to tell a quota refusal
-- from a dead exit. Nullable with no default: SQLite applies this as an O(1)
-- header-only change, so no table rebuild and no existing Proxy row is touched.
ALTER TABLE "Proxy" ADD COLUMN "lastError" TEXT;
