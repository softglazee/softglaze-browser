'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../src/main/platform');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-plat-')); }
function touch(f) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); }

test('cftPlatform maps every OS/arch', () => {
  assert.equal(p.cftPlatform('win32', 'x64'), 'win64');
  assert.equal(p.cftPlatform('darwin', 'x64'), 'mac-x64');
  assert.equal(p.cftPlatform('darwin', 'arm64'), 'mac-arm64');
  assert.equal(p.cftPlatform('linux', 'x64'), 'linux64');
  assert.throws(() => p.cftPlatform('sunos', 'x64'));
});

test('chrome extract dir + binary rel paths', () => {
  assert.equal(p.chromeExtractDir('win32', 'x64'), 'chrome-win64');
  assert.equal(p.chromeExtractDir('darwin', 'arm64'), 'chrome-mac-arm64');
  assert.equal(p.chromeExtractDir('linux', 'x64'), 'chrome-linux64');

  assert.equal(p.chromeBinaryRel('win32'), 'chrome.exe');
  assert.equal(p.chromeBinaryRel('darwin'), 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  assert.equal(p.chromeBinaryRel('linux'), 'chrome');

  assert.equal(p.chromeBinaryFromInstallDir('win32', 'x64'), 'chrome-win64/chrome.exe');
  assert.equal(p.chromeBinaryFromInstallDir('linux', 'x64'), 'chrome-linux64/chrome');
});

test('chrome install dir name + regex round-trip', () => {
  for (const [plat, arch, token] of [
    ['win32', 'x64', 'win64'],
    ['darwin', 'x64', 'mac-x64'],
    ['darwin', 'arm64', 'mac-arm64'],
    ['linux', 'x64', 'linux64']
  ]) {
    const name = p.chromeInstallDirName('130.0.6723.58', plat, arch);
    assert.equal(name, `${token}-130.0.6723.58`);
    const m = p.CHROME_INSTALL_DIR_RE.exec(name);
    assert.ok(m, `regex should match ${name}`);
    assert.equal(m[1], token);
    assert.equal(m[2], '130');
  }
  // old win-only spelling still matches (back-compat)
  assert.ok(p.CHROME_INSTALL_DIR_RE.exec('win64-120.0.6099.109'));
});

test('firefox urls, sha keys, artifact names per OS', () => {
  assert.equal(p.firefoxArtifactName('130.0', 'win32'), 'Firefox Setup 130.0.exe');
  assert.equal(p.firefoxArtifactName('130.0', 'darwin'), 'Firefox 130.0.dmg');
  assert.equal(p.firefoxArtifactName('130.0', 'linux'), 'firefox-130.0.tar.xz');

  assert.equal(
    p.firefoxInstallerUrl('130.0', 'win32'),
    'https://ftp.mozilla.org/pub/firefox/releases/130.0/win64/en-US/Firefox%20Setup%20130.0.exe'
  );
  assert.equal(
    p.firefoxInstallerUrl('130.0', 'darwin'),
    'https://ftp.mozilla.org/pub/firefox/releases/130.0/mac/en-US/Firefox%20130.0.dmg'
  );
  assert.equal(
    p.firefoxInstallerUrl('130.0', 'linux'),
    'https://ftp.mozilla.org/pub/firefox/releases/130.0/linux-x86_64/en-US/firefox-130.0.tar.xz'
  );

  assert.equal(p.firefoxSha256Key('130.0', 'win32'), 'win64/en-US/Firefox Setup 130.0.exe');
  assert.equal(p.firefoxSha256Key('130.0', 'darwin'), 'mac/en-US/Firefox 130.0.dmg');
  assert.equal(p.firefoxSha256Key('130.0', 'linux'), 'linux-x86_64/en-US/firefox-130.0.tar.xz');
});

test('firefox binary rel path per OS', () => {
  assert.equal(p.firefoxBinaryRel('win32'), 'firefox.exe');
  assert.equal(p.firefoxBinaryRel('darwin'), 'Firefox.app/Contents/MacOS/firefox');
  assert.equal(p.firefoxBinaryRel('linux'), 'firefox/firefox');
});

test('findFpChromiumBinary — windows (chrome.exe at root and one level deep)', () => {
  const root = tmp();
  assert.equal(p.findFpChromiumBinary(root, 'win32'), null);
  const nested = path.join(root, 'ungoogled_win64', 'chrome.exe');
  touch(nested);
  assert.equal(p.findFpChromiumBinary(root, 'win32'), nested);
});

test('findFpChromiumBinary — macOS (*.app/Contents/MacOS/<exe>)', () => {
  const root = tmp();
  const exe = path.join(root, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
  touch(exe);
  assert.equal(p.findFpChromiumBinary(root, 'darwin'), exe);
  // also when the .app is one level down
  const root2 = tmp();
  const exe2 = path.join(root2, 'sub', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
  touch(exe2);
  assert.equal(p.findFpChromiumBinary(root2, 'darwin'), exe2);
});

test('findFpChromiumBinary — linux (chrome/chromium in the tree)', () => {
  const root = tmp();
  const bin = path.join(root, 'ungoogled-linux', 'chrome');
  touch(bin);
  assert.equal(p.findFpChromiumBinary(root, 'linux'), bin);
});

test('system candidate lists are non-empty per OS', () => {
  for (const plat of ['win32', 'darwin', 'linux']) {
    assert.ok(p.realChromeCandidates(plat).length > 0, `chrome candidates for ${plat}`);
    assert.ok(p.firefoxSystemCandidates(plat).length > 0, `firefox candidates for ${plat}`);
  }
  assert.ok(p.realChromeCandidates('darwin').every((c) => c.includes('.app/Contents/MacOS/')));
  assert.ok(p.firefoxSystemCandidates('linux').includes('/usr/bin/firefox'));
});
