-- Phase 7: device class for mobile/Android profiles. "desktop" (default) or
-- "mobile". Existing rows are desktop. The app's migration runner tolerates a
-- duplicate-column error if the schema was already grown via `prisma db push`.
ALTER TABLE "Profile" ADD COLUMN "deviceClass" TEXT DEFAULT 'desktop';
