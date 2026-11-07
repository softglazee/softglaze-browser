#!/bin/bash
# Applies prisma/migrations to the live database, on the Hostinger server, from the app folder:
#   bash scripts/migrate-deploy.sh
# 1. backs the database up (scripts/db-backup.js -> ~/backups, stops if that fails);
# 2. makes Prisma's schema engine executable (Hostinger's npm install drops the +x bit);
# 3. runs `prisma migrate deploy` with DATABASE_URL from config/.env (localhost -> 127.0.0.1, as the
#    app does) using the newest Node the host has;
# 4. prints `prisma migrate status`.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE="$(ls -d /opt/alt/alt-nodejs*/root/usr/bin/node 2>/dev/null | sort -V | tail -1)"
[ -n "$NODE" ] || NODE="$(command -v node)"
echo "App folder: $(pwd -P)   Node: $NODE ($("$NODE" -v))"

"$NODE" scripts/db-backup.js

chmod +x node_modules/@prisma/engines/schema-engine-* node_modules/prisma/schema-engine-* 2>/dev/null || true

# DATABASE_URL exactly as the app sees it (config/.env, localhost forced to IPv4), without printing it.
DATABASE_URL="$("$NODE" -e "require('./src/env'); process.stdout.write(process.env.DATABASE_URL)")"
export DATABASE_URL
"$NODE" node_modules/prisma/build/index.js migrate deploy
"$NODE" node_modules/prisma/build/index.js migrate status || true
