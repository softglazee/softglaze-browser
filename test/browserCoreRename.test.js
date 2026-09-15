'use strict';
// The browser engines are named "Chromium" and "Firefox". The previous names were
// another vendor's product names; they are accepted as INPUT aliases only (old
// exports, other tools' spreadsheets, pre-rename sync payloads) and must never be
// stored, exported or shown. The one-off migration rewrites existing rows.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { BROWSER_CORE, normalizeBrowserCore, toStoredBrowserCore } = require('../src/main/importParser');

const ROOT = path.join(__dirname, '..');
const LEGACY = /sun\s*browser|flower\s*browser/i;
const MIGRATION = path.join(ROOT, 'prisma', 'migrations', '20260915120000_browser_core_rename', 'migration.sql');

test('normalizeBrowserCore maps current and legacy names to the canonical identifiers', () => {
  const cases = [
    ['Chromium', 'Chromium'], ['chrome', 'Chromium'], ['Chrome', 'Chromium'], ['blink', 'Chromium'],
    ['SunBrowser', 'Chromium'], ['sun browser', 'Chromium'], ['sun', 'Chromium'],
    ['Firefox', 'Firefox'], ['gecko', 'Firefox'], ['FlowerBrowser', 'Firefox'], ['flower', 'Firefox']
  ];
  for (const [input, expected] of cases) assert.equal(normalizeBrowserCore(input), expected, input);
  assert.equal(normalizeBrowserCore(''), null);
  assert.equal(normalizeBrowserCore(null), null);
  assert.equal(normalizeBrowserCore('Safari'), null);
});

test('toStoredBrowserCore never yields a legacy name and keeps "not provided" distinct', () => {
  for (const input of ['SunBrowser', 'FlowerBrowser', 'Chrome', 'Chromium', 'Firefox', 'Edge', 'whatever']) {
    const stored = toStoredBrowserCore(input);
    assert.ok(Object.values(BROWSER_CORE).includes(stored), `${input} -> ${stored}`);
  }
  assert.equal(toStoredBrowserCore('Edge'), 'Chromium', 'the launcher routes every non-Firefox profile to Chromium');
  assert.equal(toStoredBrowserCore(undefined), undefined);
  assert.equal(toStoredBrowserCore(null), null);
  assert.equal(toStoredBrowserCore(''), '');
});

// Same comment stripping + statement split the runtime migration runner uses
// (src/main/database.js applyMigrations / splitSqlStatements).
function statementsOf(sql) {
  const cleaned = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  const out = [];
  let buf = '';
  let inStr = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") { if (cleaned[i + 1] === "'") buf += cleaned[++i]; else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

test('the rename migration rewrites profiles and template snapshots', (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { t.skip('node:sqlite is not available in this Node build'); return; }

  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE "Profile" ("id" INTEGER PRIMARY KEY, "browserCore" TEXT)');
  db.exec('CREATE TABLE "Template" ("id" INTEGER PRIMARY KEY, "dataJson" TEXT)');
  const insertProfile = db.prepare('INSERT INTO "Profile" ("id", "browserCore") VALUES (?, ?)');
  [[1, 'SunBrowser'], [2, 'FlowerBrowser'], [3, 'Chrome'], [4, null], [5, ''], [6, 'Chromium'], [7, 'Firefox']]
    .forEach(([id, core]) => insertProfile.run(id, core));
  const insertTemplate = db.prepare('INSERT INTO "Template" ("id", "dataJson") VALUES (?, ?)');
  insertTemplate.run(1, JSON.stringify({ os: 'Windows', browserCore: 'SunBrowser', webglVendor: 'Google Inc. (NVIDIA)' }));
  insertTemplate.run(2, JSON.stringify({ os: 'macOS', browserCore: 'FlowerBrowser' }));
  insertTemplate.run(3, JSON.stringify({ os: 'Linux', browserCore: 'Chrome' }));
  insertTemplate.run(4, JSON.stringify({ os: 'Windows', browserCore: 'Chromium', notes: 'Chrome profile' }));

  for (const statement of statementsOf(fs.readFileSync(MIGRATION, 'utf8'))) db.exec(statement + ';');

  const cores = Object.fromEntries(db.prepare('SELECT "id", "browserCore" FROM "Profile"').all().map((r) => [r.id, r.browserCore]));
  assert.deepEqual(cores, { 1: 'Chromium', 2: 'Firefox', 3: 'Chromium', 4: 'Chromium', 5: 'Chromium', 6: 'Chromium', 7: 'Firefox' });

  const tpl = Object.fromEntries(db.prepare('SELECT "id", "dataJson" FROM "Template"').all().map((r) => [r.id, JSON.parse(r.dataJson)]));
  assert.equal(tpl[1].browserCore, 'Chromium');
  assert.equal(tpl[1].webglVendor, 'Google Inc. (NVIDIA)', 'other snapshot fields are untouched');
  assert.equal(tpl[2].browserCore, 'Firefox');
  assert.equal(tpl[3].browserCore, 'Chromium');
  assert.equal(tpl[4].browserCore, 'Chromium');
  assert.equal(tpl[4].notes, 'Chrome profile', 'only the browserCore value is rewritten');
});

test('legacy engine names appear nowhere in the app except the import aliases', () => {
  const allowed = new Set([path.join(ROOT, 'src', 'main', 'importParser.js')]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (LEGACY.test(entry.name)) { offenders.push(full); continue; }
      if (!/\.(js|jsx|json|html|css|prisma)$/.test(entry.name) || allowed.has(full)) continue;
      if (LEGACY.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'public'));
  assert.ok(LEGACY.test(fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8')) === false, 'schema.prisma');
  assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
});
