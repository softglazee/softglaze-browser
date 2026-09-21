'use strict';
// fingerprint-chromium is a third-party Chromium build downloaded from GitHub and then
// executed. A release tag can have its assets replaced after publication, so the
// download is pinned to an exact asset name, size and SHA-256, and a file that does
// not match is refused before extraction.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  FP_CHROMIUM_ASSET,
  pickFpChromiumAsset,
  verifyFpChromiumArchive,
  sha256File
} = require('../src/main/browserDownloader');

// A decoy asset for a DIFFERENT platform, proving the picker selects by name rather
// than taking the first entry. It must never collide with THIS platform's pinned name.
// Hardcoding the macOS dmg here made the suite fail on macOS alone, where the pinned
// asset IS that dmg: the picker matched the decoy's size 1 / digest 00 and correctly
// refused the build. It surfaced the first time the suite ran on a macOS runner.
const DECOY_ASSET_NAME = FP_CHROMIUM_ASSET.name.endsWith('_macos.dmg')
  ? 'ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip'
  : 'ungoogled-chromium_148.0.7778.215-1.1_macos.dmg';

const release = (overrides = {}) => ({
  assets: [
    { name: DECOY_ASSET_NAME, size: 1, browser_download_url: 'https://github.com/x/other', digest: 'sha256:00' },
    {
      name: FP_CHROMIUM_ASSET.name,
      size: FP_CHROMIUM_ASSET.size,
      digest: `sha256:${FP_CHROMIUM_ASSET.sha256}`,
      browser_download_url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215/win.zip',
      ...overrides
    }
  ]
});

test('the pin is a concrete asset: exact name, byte size and 64-hex SHA-256', () => {
  // The pin is per-OS now (this asserts THIS platform's pinned asset), so accept any
  // of the three fingerprint-chromium archive kinds rather than only the Windows zip.
  assert.match(FP_CHROMIUM_ASSET.name, /(_windows_x64\.zip|_macos\.dmg|x86_64_linux\.tar\.xz)$/);
  assert.ok(Number.isInteger(FP_CHROMIUM_ASSET.size) && FP_CHROMIUM_ASSET.size > 50 * 1024 * 1024);
  assert.match(FP_CHROMIUM_ASSET.sha256, /^[0-9a-f]{64}$/);
});

test('pickFpChromiumAsset returns the pinned asset when GitHub reports the same build', () => {
  const picked = pickFpChromiumAsset(release());
  assert.equal(picked.name, FP_CHROMIUM_ASSET.name);
  assert.match(picked.url, /^https:\/\/github\.com\//);
});

test('pickFpChromiumAsset refuses a replaced asset or a missing one', () => {
  assert.throws(() => pickFpChromiumAsset(release({ digest: `sha256:${'a'.repeat(64)}` })), (e) => e.fatal === true && /does not match/.test(e.message));
  assert.throws(() => pickFpChromiumAsset(release({ size: FP_CHROMIUM_ASSET.size + 1 })), (e) => e.fatal === true);
  assert.throws(() => pickFpChromiumAsset({ assets: [] }), (e) => e.fatal === true && /no longer has the asset/.test(e.message));
  // A differently named asset (e.g. a new build suffix) is not silently accepted.
  // Derived from THIS platform's pinned name so the case is real on every OS rather
  // than only on Windows.
  const renamed = FP_CHROMIUM_ASSET.name.replace('-1.1_', '-1.2_').replace('-1-x86_64', '-2-x86_64');
  assert.notEqual(renamed, FP_CHROMIUM_ASSET.name, 'the rename must actually differ');
  assert.throws(() => pickFpChromiumAsset(release({ name: renamed })), (e) => e.fatal === true);
});

test('verifyFpChromiumArchive accepts only a file with the pinned size and digest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fp-'));
  const file = path.join(dir, 'archive.zip');
  const content = Buffer.from('not really a zip, but hashable');
  fs.writeFileSync(file, content);
  const good = { name: 'x.zip', size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') };

  assert.equal(await sha256File(file), good.sha256);
  assert.equal(await verifyFpChromiumArchive(file, good), true);
  await assert.rejects(verifyFpChromiumArchive(file, { ...good, sha256: 'b'.repeat(64) }), (e) => e.fatal === true && /SHA-256/.test(e.message));
  await assert.rejects(verifyFpChromiumArchive(file, { ...good, size: content.length + 1 }), (e) => e.fatal === true && /bytes/.test(e.message));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the download flow verifies before extracting and deletes a mismatched archive', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'browserDownloader.js'), 'utf8');
  const start = src.indexOf('function startFpChromiumDownload(');
  const body = src.slice(start, src.indexOf('\nmodule.exports', start));
  const verifyAt = body.indexOf('verifyFpChromiumArchive(archive)');
  const extractAt = body.indexOf('extractFpChromium(archive');
  assert.ok(verifyAt > 0 && extractAt > verifyAt, 'verification must run before extraction');
  assert.match(body.slice(verifyAt, extractAt), /unlink\(archive\)/, 'a failed verification must delete the archive');
});
