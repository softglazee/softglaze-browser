-- Audit-trail indexes for the team activity feed + export, which filter by member
-- and by action over a date range. The ActivityLog table already exists (older
-- migration); these are purely additive and safe to re-run (IF NOT EXISTS). System
-- / security events with no associated profile are stored with profileId 0 (no
-- profile has id 0; the feed treats a falsy profileId as a "System" actor).
CREATE INDEX IF NOT EXISTS "ActivityLog_memberId_createdAt_idx" ON "ActivityLog"("memberId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");
