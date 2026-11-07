-- SoftGlaze AI (MCP) and Local API hardening. ApiToken gains the member it acts as, a scope, an
-- optional group limit, an expiry, a revoke time, the last client name and automation settings.
-- SQLite applies ADD COLUMN as a header-only change, so no table is rebuilt.
ALTER TABLE "ApiToken" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'api';
ALTER TABLE "ApiToken" ADD COLUMN "memberId" INTEGER;
ALTER TABLE "ApiToken" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'read';
ALTER TABLE "ApiToken" ADD COLUMN "groupIdsJson" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "ApiToken" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "ApiToken" ADD COLUMN "lastClientName" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN "createdById" INTEGER;
ALTER TABLE "ApiToken" ADD COLUMN "preApprovedJson" TEXT;
-- Developer API tokens made before this release could start profiles, so they keep the operate
-- scope. They act as the workspace owner (memberId NULL), which only an Owner could create.
UPDATE "ApiToken" SET "scope" = 'operate' WHERE "kind" = 'api';
CREATE INDEX "ApiToken_memberId_idx" ON "ApiToken"("memberId");

-- One row per AI or Local API tool call: who, which client, what (redacted), outcome and time.
CREATE TABLE "AiAuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenId" INTEGER,
    "tokenName" TEXT,
    "memberId" INTEGER,
    "clientName" TEXT,
    "transport" TEXT,
    "tool" TEXT NOT NULL,
    "summary" TEXT,
    "argsJson" TEXT,
    "outcome" TEXT NOT NULL,
    "approval" TEXT,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "AiAuditLog_at_idx" ON "AiAuditLog"("at");
CREATE INDEX "AiAuditLog_tokenId_at_idx" ON "AiAuditLog"("tokenId", "at");
