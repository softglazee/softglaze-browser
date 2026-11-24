-- Cloud sync phase 1 (docs/CLOUD-SYNC.md). Nothing changes for anyone until the Owner turns cloud sync on.
--   syncId    global id (ULID) of a profile, proxy, proxy group, group or template in the encrypted cloud
--             copy. Set the first time cloud sync sees the row. Nullable columns with no default: SQLite
--             adds them as a header-only change, no table is rebuilt and no existing row is touched.
--   WsShadow  per synced record: the state last agreed with the server and the state last applied here.
--   WsMeta    the sync cursor and the Lamport counter.
ALTER TABLE "Proxy" ADD COLUMN "syncId" TEXT;
ALTER TABLE "ProxyGroup" ADD COLUMN "syncId" TEXT;
ALTER TABLE "Group" ADD COLUMN "syncId" TEXT;
ALTER TABLE "Template" ADD COLUMN "syncId" TEXT;
ALTER TABLE "Profile" ADD COLUMN "syncId" TEXT;
CREATE UNIQUE INDEX "Proxy_syncId_key" ON "Proxy"("syncId");
CREATE UNIQUE INDEX "ProxyGroup_syncId_key" ON "ProxyGroup"("syncId");
CREATE UNIQUE INDEX "Group_syncId_key" ON "Group"("syncId");
CREATE UNIQUE INDEX "Template_syncId_key" ON "Template"("syncId");
CREATE UNIQUE INDEX "Profile_syncId_key" ON "Profile"("syncId");

CREATE TABLE "WsShadow" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "rid" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "base" TEXT NOT NULL,
    "local" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "WsMeta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);
