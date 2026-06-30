-- Time-series proxy health history: one row per check, for latency-over-time and
-- status-timeline charts. Appended by persistProxyHealth; pruned to ~30 days on
-- startup so the table stays bounded.
CREATE TABLE IF NOT EXISTS "ProxyHealthEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "proxyId" INTEGER NOT NULL,
  "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "country" TEXT
);
CREATE INDEX IF NOT EXISTS "ProxyHealthEvent_proxyId_ts_idx" ON "ProxyHealthEvent"("proxyId", "ts");
