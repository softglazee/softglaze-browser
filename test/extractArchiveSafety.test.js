'use strict';
// Engine downloads and the Proxy-Seller geo zip unzip through extract-zip, which writes
// symlink entries as-is and does not stop names escaping the target folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { assertSafeZipEntry } = require('../src/main/extractArchive');

const dir = path.join(os.tmpdir(), 'sg-zip-test');

test('ordinary entries pass', () => {
  assert.doesNotThrow(() => assertSafeZipEntry({ fileName: 'chrome-win/chrome.exe', externalFileAttributes: 0 }, dir));
  assert.doesNotThrow(() => assertSafeZipEntry({ fileName: 'geo/list.json', externalFileAttributes: (0o100644 << 16) >>> 0 }, dir));
});

test('entries escaping the folder are refused', () => {
  for (const fileName of ['../evil.exe', '..\\evil.exe', 'a/../../evil.exe', '/etc/passwd', '']) {
    assert.throws(() => assertSafeZipEntry({ fileName, externalFileAttributes: 0 }, dir), /escapes|Refusing/, fileName);
  }
});

test('symlink entries are refused', () => {
  assert.throws(() => assertSafeZipEntry({ fileName: 'link', externalFileAttributes: (0o120777 << 16) >>> 0 }, dir), /symlink/);
});

test('both extract-zip call sites pass the entry guard', () => {
  const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', rel), 'utf8');
  assert.match(src('extractArchive.js'), /onEntry: \(entry\) => assertSafeZipEntry\(entry, dir\)/);
  assert.match(src('ipcHandlers.js'), /onEntry: \(entry\) => require\('\.\/extractArchive'\)\.assertSafeZipEntry\(entry, outDir\)/);
});
