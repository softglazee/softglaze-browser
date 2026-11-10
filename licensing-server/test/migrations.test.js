'use strict';
// The November 2026 migrations must be safe on the live MySQL database with real Install rows:
// additive only, no column on an existing table that is NOT NULL without a default, and the data
// migration is exactly what scripts/gen-data-migration.js produces from the built-in copy.
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test@127.0.0.1/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../scripts/gen-data-migration');
const { defaultRows } = require('../src/email/defaults');

const MIG = path.join(__dirname, '..', 'prisma', 'migrations');
const read = (d) => fs.readFileSync(path.join(MIG, d, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n');
const DDL = '20261107120000_customers_trials_email';
const DATA = '20261107120100_backfill_customers_and_seed';
const CHANNEL = '20261108120000_install_channel';
const migrationDirs = () => fs.readdirSync(MIG).filter((d) => fs.statSync(path.join(MIG, d)).isDirectory()).sort();
const EXISTING = ['Tenant', 'TenantPaymentConfig', 'Plan', 'Install', 'License', 'Payment', 'WebhookEvent', 'LicenseCode'];

test('the schema migration only adds: no DROP, no RENAME, no type change of existing columns', () => {
  const sql = read(DDL);
  assert.ok(!/\bDROP\b/i.test(sql), 'nothing is dropped');
  assert.ok(!/\bRENAME\b/i.test(sql));
  assert.ok(!/\bMODIFY\b|\bCHANGE\s+COLUMN\b/i.test(sql), 'existing columns keep their type');
  for (const t of EXISTING) assert.ok(!new RegExp('CREATE TABLE `' + t + '`').test(sql), `${t} is not re-created`);
});

test('every column added to an existing table is NULL or has a DEFAULT', () => {
  const sql = read(DDL);
  for (const t of EXISTING) {
    const m = new RegExp('ALTER TABLE `' + t + '` ([\\s\\S]*?);').exec(sql);
    if (!m) continue;
    for (const col of m[1].split(/,\s*\n?\s*(?=ADD )/)) {
      if (!/ADD COLUMN/.test(col)) continue;
      assert.ok(/\bNULL\b/.test(col) && (!/NOT NULL/.test(col) || /DEFAULT/.test(col)), `${t}: ${col.trim()}`);
    }
  }
});

test('the migrations cover every new model and the lock file is MySQL', () => {
  const sql = read(DDL);
  for (const t of ['Customer', 'CustomerEvent', 'EmailVerification', 'Trial', 'TrialAttempt', 'EmailTemplate', 'EmailOutbox', 'Setting', 'AdminKey', 'AdminAudit', 'PlanPriceHistory', 'Segment', 'MetricSnapshot', 'JobLock']) {
    assert.match(sql, new RegExp('CREATE TABLE `' + t + '`'), t);
  }
  assert.match(sql, /UNIQUE INDEX `Trial_tenantId_machineLock_key`/);
  assert.match(sql, /UNIQUE INDEX `Trial_tenantId_emailLock_key`/);
  assert.match(sql, /UNIQUE INDEX `Customer_tenantId_emailKey_key`/);
  const dirs = migrationDirs();
  assert.equal(dirs.indexOf(DATA), dirs.indexOf(DDL) + 1, 'applied in this order');
  assert.ok(dirs.indexOf(DDL) > dirs.indexOf('20261007120000_install_machine'), 'after the existing ones');
});

test('the install channel migration only adds two NULL columns and an index, after the November ones', () => {
  const sql = read(CHANNEL);
  assert.ok(!/\bDROP\b|\bRENAME\b|\bMODIFY\b|\bCHANGE\s+COLUMN\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i.test(sql), 'additive only');
  assert.match(sql, /ALTER TABLE `Install` ADD COLUMN `channel` VARCHAR\(16\) NULL;/);
  assert.match(sql, /ALTER TABLE `Customer` ADD COLUMN `firstChannel` VARCHAR\(16\) NULL;/);
  assert.match(sql, /CREATE INDEX `Install_tenantId_channel_idx` ON `Install`\(`tenantId`, `channel`\);/);
  for (const [col] of sql.matchAll(/ADD COLUMN [^;]+;/g)) assert.ok(!/NOT NULL/.test(col), col);
  const dirs = migrationDirs();
  assert.ok(dirs.indexOf(CHANNEL) > dirs.indexOf(DATA), 'runs after the customers backfill');
  // The schema says the same thing as the SQL.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const block = (name) => (new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema) || [])[1] || '';
  assert.match(block('Install'), /\n\s+channel\s+String\?\s+@db\.VarChar\(16\)/);
  assert.match(block('Install'), /@@index\(\[tenantId, channel\]\)/);
  assert.match(block('Customer'), /\n\s+firstChannel\s+String\?\s+@db\.VarChar\(16\)/);
});

test('the data migration is the generator output, guarded, and seeds the built-in copy word for word', () => {
  assert.equal(read(DATA), build().replace(/\r\n/g, '\n'));
  const sql = read(DATA);
  for (const stmt of sql.split(/;\n/).filter((s) => /^\s*(INSERT|UPDATE)/m.test(s))) {
    assert.ok(/NOT EXISTS|IS NULL/.test(stmt), `guarded: ${stmt.slice(0, 80)}`);
  }
  assert.ok(!/\bDELETE\b|\bTRUNCATE\b/i.test(sql));
  const rows = defaultRows();
  assert.equal(rows.length, 14);
  for (const r of rows) {
    assert.ok(sql.includes(`'${r.subject.replace(/'/g, "''")}'`), `${r.key}/${r.lang} subject`);
    assert.ok(sql.includes(`'${r.text.replace(/'/g, "''")}'`), `${r.key}/${r.lang} text`);
  }
});

test('the SQL email key matches emailKeyOf (Gmail and Googlemail folding)', () => {
  const sql = read(DATA);
  assert.match(sql, /IN \('gmail\.com', 'googlemail\.com'\)/);
  assert.match(sql, /REPLACE\(SUBSTRING_INDEX\(SUBSTRING_INDEX\(LOWER\(TRIM\(i\.`account`\)\), '@', 1\), '\+', 1\), '\.', ''\), '@gmail\.com'/);
});

test('the built-in copy has no em or en dashes and no hype words', () => {
  for (const r of defaultRows()) {
    const all = `${r.subject}\n${r.html}\n${r.text}`;
    assert.ok(!/[–—]/.test(all), `${r.key}/${r.lang}: no em/en dash`);
    assert.ok(!/\b(amazing|revolutionary|game.?changer|unlock|supercharge|best-in-class|cutting.?edge)\b/i.test(all), `${r.key}/${r.lang}: plain words`);
  }
});

// November 2026, Microsoft Store subscriptions: one new table, nothing else.
test('the Store entitlements migration only creates its own table', () => {
  const sql = read('20261108130000_store_entitlements');
  assert.ok(!/\bDROP\b|\bRENAME\b|\bMODIFY\b|\bCHANGE\s+COLUMN\b/i.test(sql));
  assert.match(sql, /CREATE TABLE `StoreEntitlement`/);
  assert.match(sql, /UNIQUE INDEX `StoreEntitlement_tenantId_installId_productId_key`/);
  const altered = [...sql.matchAll(/ALTER TABLE `(\w+)`/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], ['StoreEntitlement'], 'only the new table gets its foreign key');
  for (const t of EXISTING) assert.ok(!new RegExp('CREATE TABLE `' + t + '`').test(sql), `${t} is not re-created`);
});

// November 2026, app 1.0.23 sign-up lead details: six NULL columns on two existing tables, nothing else.
test('the sign-up lead fields migration only adds NULL columns, after the Store entitlements one', () => {
  const name = '20261108140000_signup_lead_fields';
  const sql = read(name);
  assert.ok(!/\bDROP\b|\bRENAME\b|\bMODIFY\b|\bCHANGE\s+COLUMN\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bCREATE\b/i.test(sql), 'additive only, no table or index');
  const added = [...sql.matchAll(/ADD COLUMN `(\w+)` ([^,;]+)/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(added, [
    ['useCase', 'VARCHAR(40) NULL'], ['useCaseOther', 'VARCHAR(200) NULL'],
    ['phone', 'VARCHAR(40) NULL'], ['company', 'VARCHAR(200) NULL'], ['useCase', 'VARCHAR(40) NULL'], ['useCaseOther', 'VARCHAR(200) NULL']
  ]);
  for (const [, def] of added) assert.ok(!/NOT NULL/.test(def), def);
  assert.deepEqual([...new Set([...sql.matchAll(/ALTER TABLE `(\w+)`/g)].map((m) => m[1]))], ['Customer', 'EmailVerification']);
  const dirs = migrationDirs();
  assert.equal(dirs.indexOf(name), dirs.indexOf('20261108130000_store_entitlements') + 1, 'runs right after the Store entitlements');
  // The schema says the same thing as the SQL.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const block = (m) => (new RegExp(`model ${m} \\{([\\s\\S]*?)\\n\\}`).exec(schema.replace(/\r\n/g, '\n')) || [])[1] || '';
  assert.match(block('Customer'), /\n\s+useCase\s+String\?\s+@db\.VarChar\(40\)/);
  assert.match(block('Customer'), /\n\s+useCaseOther\s+String\?\s+@db\.VarChar\(200\)/);
  for (const [col, n] of [['phone', 40], ['company', 200], ['useCase', 40], ['useCaseOther', 200]]) {
    assert.match(block('EmailVerification'), new RegExp(`\\n\\s+${col}\\s+String\\?\\s+@db\\.VarChar\\(${n}\\)`), col);
  }
});

// November 2026, app 1.0.26 one-click sign-in: four new tables, nothing else.
test('the one-click sign-in migration only creates its own four tables, last', () => {
  const name = '20261110120000_one_click_signin';
  const sql = read(name);
  // (ON DELETE / ON UPDATE CASCADE in the foreign keys are not statements.)
  assert.ok(!/\bDROP\b|\bRENAME\b|\bMODIFY\b|\bCHANGE\s+COLUMN\b|^\s*(UPDATE|DELETE|TRUNCATE|INSERT)\b/im.test(sql), 'additive only');
  assert.deepEqual([...sql.matchAll(/CREATE TABLE `(\w+)`/g)].map((m) => m[1]), ['Identity', 'AuthState', 'AuthCode', 'AuthSession']);
  assert.deepEqual([...new Set([...sql.matchAll(/ALTER TABLE `(\w+)`/g)].map((m) => m[1]))], ['Identity', 'AuthState', 'AuthCode', 'AuthSession'], 'only the new tables get foreign keys');
  assert.match(sql, /UNIQUE INDEX `Identity_tenantId_provider_providerUserId_key`\(`tenantId`, `provider`, `providerUserId`\)/);
  assert.match(sql, /UNIQUE INDEX `AuthState_stateHash_key`/);
  assert.match(sql, /UNIQUE INDEX `AuthCode_codeHash_key`/);
  assert.match(sql, /UNIQUE INDEX `AuthSession_tokenHash_key`/);
  assert.ok(!/ADD COLUMN/.test(sql), 'no column on an existing table');
  for (const t of EXISTING) assert.ok(!new RegExp('CREATE TABLE `' + t + '`').test(sql), `${t} is not re-created`);
  const dirs = migrationDirs();
  assert.equal(dirs[dirs.length - 1], name, 'the newest migration');
  // No secret or token column in clear: hashes only.
  for (const col of ['stateHash', 'nonceHash', 'codeHash', 'tokenHash']) assert.match(sql, new RegExp('`' + col + '` VARCHAR[(]64[)] NOT NULL'));
  assert.ok(!/`(token|code|state|nonce|accessToken|secret)` /.test(sql), 'no raw token column');
});
