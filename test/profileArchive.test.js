'use strict';
// .sgz encrypted-archive round-trip + tamper resistance (src/main/profileArchive.js).
// Pure node:crypto + node:fs — no Electron, runs under `node --test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportProfileArchive, decryptArchive } = require('../src/main/profileArchive.js');

function makeWorkspace() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sgz-test-'));
  const userDataDir = path.join(work, 'profile');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'hello.txt'), 'cookie-cache-contents');
  return { work, userDataDir };
}

test('export then decryptArchive round-trips to a ZIP buffer', async () => {
  const { work, userDataDir } = makeWorkspace();
  const outPath = path.join(work, 'archive.sgz');
  try {
    await exportProfileArchive({ userDataDir, config: { title: 'Test' }, password: 'secret123', outPath });
    assert.ok(fs.existsSync(outPath), 'the .sgz file should be written');

    const zip = await decryptArchive(outPath, 'secret123');
    assert.ok(Buffer.isBuffer(zip), 'decryptArchive returns a Buffer');
    // ZIP local-file-header magic: "PK\x03\x04".
    assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'decrypted payload is a ZIP');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('decryptArchive rejects a wrong password (GCM tag mismatch)', async () => {
  const { work, userDataDir } = makeWorkspace();
  const outPath = path.join(work, 'archive.sgz');
  try {
    await exportProfileArchive({ userDataDir, config: {}, password: 'rightpass', outPath });
    await assert.rejects(() => decryptArchive(outPath, 'wrongpass'), /wrong password|corrupted/i);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('exportProfileArchive enforces a minimum password length', async () => {
  const { work, userDataDir } = makeWorkspace();
  const outPath = path.join(work, 'archive.sgz');
  try {
    await assert.rejects(
      () => exportProfileArchive({ userDataDir, config: {}, password: '123', outPath }),
      /password/i
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
