'use strict';
// A new profile must start clean. Before this, a permanent delete could leave the folder behind,
// and the next profile with the same title moved into it: old cookies, logins and fingerprint seed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { firefoxDirName, profileDataPaths, uniqueDataDirName, wipeProfileData } = require('../src/main/profileData.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const IPC = read('src/main/ipcHandlers.js');
const fnBody = (src, name) => {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  const next = src.indexOf('\nasync function ', start + 10);
  return src.slice(start, next);
};

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-clean-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const noRows = async () => false;

test('a new profile never gets the old folder, even when the old one is still on disk', async (t) => {
  const root = tempRoot(t);
  const old = path.join(root, 'Profile-001', 'Default', 'Network');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'Cookies'), 'old-session');
  const name = await uniqueDataDirName({ root, base: 'Profile-001', isTaken: noRows });
  assert.notEqual(name, 'Profile-001');
  assert.match(name, /^Profile-001-[0-9a-f]{6}$/);
  assert.equal(fs.existsSync(path.join(root, name)), false, 'the new folder starts empty');
});

test('the same title twice gets two different folders, so two different fingerprint seeds', async (t) => {
  const root = tempRoot(t);
  const a = await uniqueDataDirName({ root, base: 'Profile-001', isTaken: noRows });
  const b = await uniqueDataDirName({ root, base: 'Profile-001', isTaken: noRows });
  assert.notEqual(a, b);
});

test('a name is skipped when the database has it or either engine has its folder', async (t) => {
  const root = tempRoot(t);
  const seen = [];
  const name = await uniqueDataDirName({ root, base: 'P', isTaken: async (c) => { seen.push(c); return seen.length < 3; } });
  assert.equal(seen.length, 3);
  assert.equal(name, seen[2]);
});

test('wiping removes the Chrome and the Firefox folder', async (t) => {
  const root = tempRoot(t);
  const name = 'Profile-001-abc123';
  for (const p of profileDataPaths(root, name)) {
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'data'), 'x');
  }
  const res = await wipeProfileData(root, name);
  assert.deepEqual(res, { clean: true, leftover: [] });
  for (const p of profileDataPaths(root, name)) assert.equal(fs.existsSync(p), false, p);
  assert.equal(fs.existsSync(path.join(root, 'firefox')), true, 'other Firefox profiles are not touched');
});

test('wiping only removes that one profile', async (t) => {
  const root = tempRoot(t);
  const other = path.join(root, 'Profile-002-def456');
  fs.mkdirSync(other);
  fs.mkdirSync(path.join(root, 'Profile-001-abc123'));
  await wipeProfileData(root, 'Profile-001-abc123');
  assert.equal(fs.existsSync(other), true);
});

test('a folder that cannot be removed is reported, not hidden', async (t) => {
  const root = tempRoot(t);
  const name = 'Locked-abc123';
  fs.mkdirSync(path.join(root, name));
  const res = await wipeProfileData(root, name, { rm: async () => { throw new Error('EBUSY'); } });
  assert.equal(res.clean, false);
  assert.deepEqual(res.leftover, [path.join(root, name)]);
});

test('the Firefox engine uses the same folder rule', () => {
  assert.equal(firefoxDirName('A b/c'), 'A_b_c');
  assert.match(read('src/main/firefoxEngine.js'), /firefoxDirName\(dataDirName \|\| title/);
});

test('every way of creating a profile goes through the unique name', () => {
  assert.match(fnBody(IPC, 'ensureUniqueDataDirName'), /profileData\.uniqueDataDirName\(/);
  assert.equal((IPC.match(/await ensureUniqueDataDirName\(/g) || []).length, 5);
  assert.doesNotMatch(IPC, /data:\s*\{[^}]*dataDirName:\s*(title|input\.)/);
});

test('a permanent delete always erases the data, with no option to keep it', () => {
  for (const name of ['purgeProfile', 'bulkPurgeProfiles']) {
    const body = fnBody(IPC, name);
    assert.match(body, /wipeProfileFolders\(/, name);
    assert.doesNotMatch(body, /removeLocalData/, name);
    assert.ok(body.indexOf('wipeProfileFolders(') < body.indexOf('db.profile.delete('), `${name}: erase before the row goes`);
  }
  const trash = read('src/renderer/pages/TrashPage.jsx');
  assert.doesNotMatch(trash, /removeLocalData/);
  assert.match(trash, /purgeWithData/);
});

test('data that could not be erased is retried at the next start', () => {
  assert.match(fnBody(IPC, 'wipeProfileFolders'), /PENDING_WIPES_KEY/);
  assert.match(fnBody(IPC, 'retryPendingProfileWipes'), /dataDirName/, 'never wipes a folder a live profile owns');
  assert.match(fnBody(IPC, 'afterDbReady'), /retryPendingProfileWipes\(\)/);
});
