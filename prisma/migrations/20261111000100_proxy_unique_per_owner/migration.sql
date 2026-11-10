-- One proxy per member, not per workspace. The unique key (type, host, port, username, passwordHash)
-- let only one member save a given proxy: a second member who typed the same credentials was linked
-- to the first member's row (their profile title then showed in that member's pool, and the row did
-- not count against their own proxy limit) or told it "already exists" in a pool they cannot see.
-- The owner joins the key, so each member can keep their own row; duplicates within one member's
-- pool are still refused, and the app checks the member's visible pool before adding
-- (ipcHandlers.js findVisibleProxy). SQLite never matches NULLs in a unique index, so rows without
-- an owner (single-user mode, the Super Admin) keep the old key through a partial index.
-- Index swap only, no table rebuild, no Proxy row is touched. Every existing row already satisfies
-- both new indexes: they hold the old key's columns (plus the owner) over the same or fewer rows.
DROP INDEX IF EXISTS "Proxy_type_host_port_username_passwordHash_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_type_host_port_username_passwordHash_ownerMemberId_key" ON "Proxy"("type", "host", "port", "username", "passwordHash", "ownerMemberId");
CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_unowned_identity_key" ON "Proxy"("type", "host", "port", "username", "passwordHash") WHERE "ownerMemberId" IS NULL;
