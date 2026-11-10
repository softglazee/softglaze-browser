-- Profile editor options that now apply at launch (1.0.26).
--   userAgentMode      Custom when the user picked the User-Agent in the editor (applied at launch);
--                      NULL for older profiles, which keep the browser's own User-Agent as before.
--   fontsList          JSON array of the fonts websites may see when Fonts is Custom.
--   mediaDeviceCounts  JSON object of how many microphones, speakers and cameras websites see when
--                      Media Device is Edit.
-- ProxyType also gains HTTPS (schema.prisma). SQLite stores the enum as TEXT with no CHECK constraint,
-- so that needs no SQL. Nullable columns with no default: SQLite applies ADD COLUMN as a header-only
-- change, no table is rebuilt and no existing row is touched.
ALTER TABLE "Profile" ADD COLUMN "userAgentMode" TEXT;
ALTER TABLE "Profile" ADD COLUMN "fontsList" TEXT;
ALTER TABLE "Profile" ADD COLUMN "mediaDeviceCounts" TEXT;
