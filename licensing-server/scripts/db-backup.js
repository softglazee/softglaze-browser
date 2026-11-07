'use strict';
// Dumps the licensing database to ~/backups/sg-licensing-<UTC time>.sql (mode 600) with mysqldump,
// using DATABASE_URL from the environment / config/.env. The password goes to mysqldump through the
// MYSQL_PWD environment variable, never on a command line. Prints the file path.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

process.chdir(path.join(__dirname, '..'));
require('../src/env');

const u = new URL(process.env.DATABASE_URL);
const dir = path.join(os.homedir(), 'backups');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
const file = path.join(dir, `sg-licensing-${stamp}.sql`);
const out = fs.openSync(file, 'w', 0o600);
const bin = fs.existsSync('/usr/bin/mysqldump') ? '/usr/bin/mysqldump' : 'mysqldump';
const child = spawn(bin, [
  '--single-transaction', '--routines', '--no-tablespaces',
  '-h', u.hostname === 'localhost' ? '127.0.0.1' : u.hostname, '-P', u.port || '3306',
  '-u', decodeURIComponent(u.username), decodeURIComponent(u.pathname.slice(1))
], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(u.password) }, stdio: ['ignore', out, 'inherit'] });
child.on('close', (code) => {
  fs.closeSync(out);
  if (code !== 0 || fs.statSync(file).size < 100) { console.error(`BACKUP FAILED (mysqldump exit ${code}). Do not migrate.`); process.exit(1); }
  console.log(`Backup written: ${file} (${fs.statSync(file).size} bytes)`);
});
