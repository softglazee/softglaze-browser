'use strict';
// Cross-platform archive extraction for the browser-engine layer.
//
// Replaces the Windows-only extractors the engine code used to shell out to:
//   - Chrome-for-Testing / fingerprint-chromium: `powershell.exe Expand-Archive`
//   - Firefox: `%SystemRoot%\System32\tar.exe` against the NSIS `core/` layout
// so that macOS and Linux can unpack their own engine artifacts.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const extractZip = require('extract-zip');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', ...opts });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

// Cross-platform .zip extraction (Chrome for Testing, fingerprint-chromium).
// extract-zip (yauzl) honors the unix mode bits stored in the zip, so the Chrome
// binary keeps its executable bit on macOS/Linux; we chmod defensively anyway.
async function extractZipCrossPlatform(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  await extractZip(zipPath, { dir: path.resolve(destDir) });
}

// Ensure a downloaded binary is executable on POSIX (no-op on Windows).
function ensureExecutable(binPath) {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(binPath, 0o755); } catch (_) { /* best effort */ }
}

// Extract a Linux .tar.xz into destDir (its top-level dir lands inside destDir).
// GNU/BSD tar handles .xz via -J; content-sniffed, so a .part file works too.
async function extractTarXz(file, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  await run('tar', ['-xJf', file, '-C', destDir]);
}

// Mount a macOS .dmg read-only, copy every *.app at its root into destDir with
// ditto (preserves the bundle's symlinks/permissions), then detach. Works for any
// app image (Firefox.app, Chromium.app, ...). hdiutil content-sniffs the image, so
// an extension-less .part file mounts fine.
async function extractDmgApps(dmgPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-dmg-'));
  try {
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, dmgPath]);
    let apps = [];
    try { apps = fs.readdirSync(mnt).filter((n) => n.endsWith('.app')); } catch (_) { apps = []; }
    if (!apps.length) throw new Error('No .app bundle found in the mounted disk image');
    for (const app of apps) await run('ditto', [path.join(mnt, app), path.join(destDir, app)]);
  } finally {
    try { await run('hdiutil', ['detach', mnt, '-force']); } catch (_) { /* ignore */ }
    try { fs.rmSync(mnt, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

// Firefox package extraction, per OS. Leaves the Firefox tree under destDir so
// that platform.firefoxBinaryRel() resolves the launchable binary.
async function extractFirefox(artifactPath, destDir, platform = process.platform) {
  fs.mkdirSync(destDir, { recursive: true });
  if (platform === 'win32') {
    // Mozilla's win64 "Firefox Setup <v>.exe" is a 7z/NSIS SFX; its portable
    // payload is the top-level core/ dir. Windows ships bsdtar in System32.
    const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    await run(tarExe, ['-xf', artifactPath, '-C', destDir, '--strip-components=1', 'core']);
    return;
  }
  if (platform === 'linux') {
    await extractTarXz(artifactPath, destDir); // -> destDir/firefox/firefox
    ensureExecutable(path.join(destDir, 'firefox', 'firefox'));
    return;
  }
  if (platform === 'darwin') {
    await extractDmgApps(artifactPath, destDir); // -> destDir/Firefox.app
    ensureExecutable(path.join(destDir, 'Firefox.app', 'Contents', 'MacOS', 'firefox'));
    return;
  }
  throw new Error(`Unsupported platform for Firefox extraction: ${platform}`);
}

// fingerprint-chromium (ungoogled-chromium fork) package extraction, per OS:
//   Windows: windows_x64.zip  -> extract-zip
//   macOS:   macos.dmg        -> copy Chromium.app
//   Linux:   x86_64_linux.tar.xz -> unpack the chromium tree
// Callers resolve the launchable binary via platform.findFpChromiumBinary().
async function extractFpChromium(artifactPath, destDir, platform = process.platform) {
  fs.mkdirSync(destDir, { recursive: true });
  if (platform === 'win32') { await extractZipCrossPlatform(artifactPath, destDir); return; }
  if (platform === 'darwin') { await extractDmgApps(artifactPath, destDir); return; }
  if (platform === 'linux') { await extractTarXz(artifactPath, destDir); return; }
  throw new Error(`Unsupported platform for fingerprint-chromium extraction: ${platform}`);
}

module.exports = {
  run,
  extractZipCrossPlatform,
  extractTarXz,
  extractDmgApps,
  extractFirefox,
  extractFpChromium,
  ensureExecutable
};
