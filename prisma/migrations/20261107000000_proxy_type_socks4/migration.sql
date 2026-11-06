-- ProxyType gains SOCKS4 (schema.prisma). SQLite stores the enum as TEXT with no CHECK
-- constraint, so the column needs no rebuild and every existing HTTP / SOCKS5 row stays valid.
-- A row written outside Prisma with another spelling (socks4a, socks5h, https, lower case)
-- would make every read of the proxy list fail, because Prisma rejects an unknown enum value
-- on read. Those rows are rewritten to the canonical names here. OR IGNORE leaves a row as it
-- is when the rewrite would duplicate a proxy that already exists under the canonical name.
UPDATE OR IGNORE "Proxy" SET "type" = 'SOCKS4' WHERE UPPER("type") IN ('SOCKS4', 'SOCKS4A') AND "type" <> 'SOCKS4';
UPDATE OR IGNORE "Proxy" SET "type" = 'SOCKS5' WHERE UPPER("type") IN ('SOCKS5', 'SOCKS5H', 'SOCKS') AND "type" <> 'SOCKS5';
UPDATE OR IGNORE "Proxy" SET "type" = 'HTTP' WHERE UPPER("type") IN ('HTTP', 'HTTPS') AND "type" <> 'HTTP';
