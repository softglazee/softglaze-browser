-- Session restore + crash recovery: one row per profile that is (or was) running.
-- status stays 'running' across a clean quit OR a crash, so the next launch can
-- offer to restore it; a deliberate user-close marks it 'closed'. crashCount is
-- bumped on each unclean disconnect (for display/history).
CREATE TABLE IF NOT EXISTS "SessionState" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "profileId" INTEGER NOT NULL,
  "engine" TEXT NOT NULL DEFAULT 'chrome',
  "status" TEXT NOT NULL DEFAULT 'running',
  "launchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "crashCount" INTEGER NOT NULL DEFAULT 0,
  "lastExitCode" INTEGER,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SessionState_profileId_key" ON "SessionState"("profileId");
CREATE INDEX IF NOT EXISTS "SessionState_status_idx" ON "SessionState"("status");
