'use strict';
// Earlier builds downloaded a third-party vendor's own assistant extension on first
// launch. It is no longer seeded, and removeRetiredExtensions() deletes the copy
// (DB row + files) from existing installs exactly once.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  RECOMMENDED_EXTENSIONS,
  RETIRED_EXTENSION_IDS,
  removeRetiredExtensions
} = require('../src/main/extensionManager');

const RETIRED = 'gcaiimgaiohlnlflkjjmcohobkpbbnfi';

// Minimal in-memory stand-in for the two Prisma models the cleanup touches.
function fakeDb({ extensions = [], settings = {} } = {}) {
  const ext = new Map(extensions.map((e) => [e.chromeId, { ...e }]));
  const set = new Map(Object.entries(settings));
  return {
    ext,
    set,
    extension: {
      findUnique: async ({ where }) => ext.get(where.chromeId) || null,
      delete: async ({ where }) => { ext.delete(where.chromeId); }
    },
    setting: {
      findUnique: async ({ where }) => (set.has(where.key) ? { key: where.key, value: set.get(where.key) } : null),
      upsert: async ({ where, create }) => { set.set(where.key, create.value); }
    }
  };
}

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ext-'));
}

test('the retired extension is no longer part of the recommended seed', () => {
  assert.ok(RETIRED_EXTENSION_IDS.includes(RETIRED));
  assert.equal(RECOMMENDED_EXTENSIONS.some((r) => r.chromeId === RETIRED), false);
  for (const id of RETIRED_EXTENSION_IDS) {
    assert.equal(RECOMMENDED_EXTENSIONS.some((r) => r.chromeId === id), false, id);
  }
});

test('removes the row, the unzipped folder and a leftover zip, then locks', async () => {
  const root = makeRoot();
  const dir = path.join(root, RETIRED);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(root, `${RETIRED}.download.zip`), 'zip');
  const keep = path.join(root, 'hlkenndednhfkekhgcdicdfddnkalmdm');
  fs.mkdirSync(keep);

  const db = fakeDb({ extensions: [{ chromeId: RETIRED, localPath: dir }, { chromeId: 'hlkenndednhfkekhgcdicdfddnkalmdm', localPath: keep }] });
  const res = await removeRetiredExtensions({ db, root });

  assert.equal(res.removed, 1);
  assert.equal(db.ext.has(RETIRED), false);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(path.join(root, `${RETIRED}.download.zip`)), false);
  assert.equal(db.ext.has('hlkenndednhfkekhgcdicdfddnkalmdm'), true, 'other extensions are untouched');
  assert.equal(fs.existsSync(keep), true);
  assert.equal(db.set.get('retiredExtensionsRemoved_v1'), 'true');

  assert.deepEqual(await removeRetiredExtensions({ db, root }), { skipped: true }, 'runs only once');
  fs.rmSync(root, { recursive: true, force: true });
});

test('never deletes outside the extensions root, even if the DB row points there', async () => {
  const root = makeRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-outside-'));
  const db = fakeDb({ extensions: [{ chromeId: RETIRED, localPath: outside }] });

  const res = await removeRetiredExtensions({ db, root });

  assert.equal(res.removed, 1);
  assert.equal(fs.existsSync(outside), true);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('a DB failure leaves the flag unset so the cleanup retries next launch', async () => {
  const root = makeRoot();
  const db = fakeDb({ extensions: [{ chromeId: RETIRED, localPath: path.join(root, RETIRED) }] });
  db.extension.delete = async () => { throw new Error('database is locked'); };

  const res = await removeRetiredExtensions({ db, root });

  assert.equal(res.failed, true);
  assert.equal(db.set.has('retiredExtensionsRemoved_v1'), false);
  fs.rmSync(root, { recursive: true, force: true });
});
