-- Proxy passwords are now sealed at rest (secretStore, enc:v1:). A sealed value is not
-- deterministic, so it can no longer carry the unique key that lets rotating vendors
-- (Froxy, PacketStream, IPRoyal) hold rows that differ only by password. passwordHash is a
-- keyed HMAC-SHA256 of the plaintext password and takes over that role.
-- Index swap plus one nullable column, no table rebuild. Existing rows keep passwordHash
-- NULL here (NULLs never collide in a SQLite unique index); the startup data migration in
-- proxySecrets.migrateProxyPasswords fills the hash and seals the password, row by row.
ALTER TABLE "Proxy" ADD COLUMN "passwordHash" TEXT;
DROP INDEX IF EXISTS "Proxy_type_host_port_username_password_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_type_host_port_username_passwordHash_key" ON "Proxy"("type", "host", "port", "username", "passwordHash");
