-- Phase F2: shared profile pools + resource ACLs.
-- Many-to-many member<->profile access on top of the existing owner/assignee model.
CREATE TABLE IF NOT EXISTS "ProfileAccess" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'use',
    "grantedByMemberId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileAccess_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfileAccess_profileId_memberId_key" ON "ProfileAccess"("profileId", "memberId");
CREATE INDEX IF NOT EXISTS "ProfileAccess_memberId_idx" ON "ProfileAccess"("memberId");
CREATE INDEX IF NOT EXISTS "ProfileAccess_profileId_idx" ON "ProfileAccess"("profileId");
