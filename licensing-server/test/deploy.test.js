'use strict';
// Audit L12 + L14: the schema ships as versioned migrations applied with
// `prisma migrate deploy` (never `db push --accept-data-loss`), and the image installs
// from the lockfile without dev dependencies and runs as a non-root user.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const MIG = path.join(ROOT, 'prisma', 'migrations');

test('a baseline migration and the lock file exist', () => {
  const dirs = fs.readdirSync(MIG).filter((d) => fs.statSync(path.join(MIG, d)).isDirectory()).sort();
  assert.ok(dirs.length >= 1);
  assert.match(dirs[0], /^\d{14}_init$/);
  const init = read(`prisma/migrations/${dirs[0]}/migration.sql`);
  for (const t of ['Tenant', 'TenantPaymentConfig', 'Plan', 'Install', 'License', 'Payment', 'WebhookEvent', 'LicenseCode']) {
    assert.match(init, new RegExp('CREATE TABLE `' + t + '`'), `init creates ${t}`);
  }
  assert.match(read('prisma/migrations/migration_lock.toml'), /provider = "mysql"/);
  assert.match(read('prisma/schema.prisma'), /provider = "mysql"/);
});

test('every column in the schema WebhookEvent model is covered by the migrations', () => {
  const all = fs.readdirSync(MIG).filter((d) => fs.statSync(path.join(MIG, d)).isDirectory())
    .map((d) => read(`prisma/migrations/${d}/migration.sql`)).join('\n');
  assert.match(all, /ADD COLUMN `processedAt`/);
});

test('compose applies migrations with migrate deploy and never db push', () => {
  const compose = read('docker-compose.yml');
  const code = compose.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/db push/.test(code), 'db push must be gone');
  assert.ok(!/accept-data-loss/.test(code));
  assert.match(compose, /prisma", "migrate", "deploy"/);
  assert.match(compose, /migrate:\n\s+condition: service_completed_successfully/);
});

test('README documents baselining an existing database', () => {
  assert.match(read('README.md'), /prisma migrate resolve --applied \d{14}_init/);
});

test('Dockerfile: lockfile install, no dev deps at runtime, non-root user', () => {
  const df = read('Dockerfile');
  assert.match(df, /COPY package\.json package-lock\.json \.\//);
  assert.match(df, /AS build/);
  assert.match(df, /RUN npm ci && npx prisma generate/);
  assert.match(df, /npm ci --omit=dev/);
  assert.match(df, /COPY --from=build \/app\/node_modules\/\.prisma/);
  assert.ok(!/npm install/.test(df), 'npm install must not be used');
  const runtime = df.slice(df.lastIndexOf('FROM '));
  assert.match(runtime, /\nUSER node\n/);
  assert.ok(runtime.indexOf('USER node') < runtime.indexOf('CMD'));
});
