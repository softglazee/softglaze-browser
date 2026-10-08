-- Let one gateway hold several sticky sessions that differ only in the PASSWORD.
-- Froxy, PacketStream and IPRoyal keep the same username and put the session and country
-- in the password, so the old unique key (type, host, port, username) rejected every row
-- after the first: "Unique constraint failed on the fields: (type,host,port,username)".
-- The pull already de-duplicates on the password for those vendors (dedupeOnPassword);
-- the index now agrees. Index swap only, no table rebuild, no Proxy row is touched.
DROP INDEX IF EXISTS "Proxy_type_host_port_username_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_type_host_port_username_password_key" ON "Proxy"("type", "host", "port", "username", "password");
