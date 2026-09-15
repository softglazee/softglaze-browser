'use strict';
// electron-builder packages from the working tree, not from git, so a gitignored
// file still ships if a `files` glob matches it. The leftover development database
// prisma/softglaze.sqlite was being packaged into app.asar.unpacked. These tests
// evaluate the real `build.files` globs the way electron-builder does: a path is
// included when a positive pattern matches and no later negated pattern does.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pkg = require('../package.json');

let minimatch;
try {
  const mod = require('minimatch');
  minimatch = typeof mod === 'function' ? mod : mod.minimatch;
} catch (e) { /* electron-builder brings minimatch; skip glob evaluation if absent */ }

function isPackaged(file, patterns) {
  let included = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (minimatch(file, pattern.slice(1), { dot: true })) included = false;
    } else if (minimatch(file, pattern, { dot: true })) {
      included = true;
    }
  }
  return included;
}

test('the build config excludes SQLite files under prisma/', () => {
  for (const pattern of ['!prisma/**/*.sqlite', '!prisma/**/*.sqlite-journal', '!prisma/**/*.sqlite.*']) {
    assert.ok(pkg.build.files.includes(pattern), `missing ${pattern}`);
    assert.ok(pkg.build.files.indexOf(pattern) > pkg.build.files.indexOf('prisma/**/*'), `${pattern} must follow prisma/**/*`);
  }
});

test('dev databases are not packaged, but schema and migrations still are', (t) => {
  if (!minimatch) { t.skip('minimatch is not installed'); return; }
  const files = pkg.build.files;
  for (const devDb of ['prisma/softglaze.sqlite', 'prisma/softglaze.sqlite-journal', 'prisma/softglaze.sqlite.backup-20260619', 'prisma/dev/test.sqlite']) {
    assert.equal(isPackaged(devDb, files), false, devDb);
  }
  for (const needed of ['prisma/schema.prisma', 'prisma/migrations/20260915120000_browser_core_rename/migration.sql', 'prisma/migrations/migration_lock.toml']) {
    assert.equal(isPackaged(needed, files), true, needed);
  }
  assert.equal(isPackaged(path.posix.join('src', 'main', 'main.js'), files), true);
});
