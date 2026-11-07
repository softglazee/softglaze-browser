'use strict';
// Scheduler entry point, run every 15 minutes by the host's cron (see docs/DEPLOY.md for the exact
// Hostinger command, which goes through scripts/cron.sh). Prints one JSON line of counts: no email
// addresses, no secrets. Exit code 1 when a step failed, so the cron log shows it.
const path = require('node:path');

process.chdir(path.join(__dirname, '..'));
require('../src/env');
const prisma = require('../src/db');
const { runCron } = require('../src/cron');

runCron(prisma)
  .then((r) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
    const failed = r.tenants && Object.values(r.tenants).some((t) => t.errors && t.errors.length);
    if (failed) process.exitCode = 1;
  })
  .catch((e) => { console.error(JSON.stringify({ at: new Date().toISOString(), error: e && e.message ? e.message : String(e) })); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
