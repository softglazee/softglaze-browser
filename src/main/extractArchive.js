'use strict';
// Cross-platform extraction for engine downloads (zip, tar.xz, dmg, Firefox NSIS installer).
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

// extract-zip (yauzl) keeps the zip's unix mode bits, so binaries stay executable; chmod is a fallback.
async function extractZipCrossPlatform(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dir = path.resolve(destDir);
  await extractZip(zipPath, { dir, onEntry: (entry) => assertSafeZipEntry(entry, dir) });
}

// extract-zip writes symlink entries as-is and does not stop names that resolve outside
// the target folder. Pass as onEntry: throwing aborts the unzip before the entry is written.
function assertSafeZipEntry(entry, destDir) {
  const raw = String((entry && entry.fileName) || '');
  // A backslash is a separator on Windows but a filename byte on POSIX; normalize it so "..\evil"
  // is refused whichever OS validates.
  const name = raw.replace(/\\/g, '/');
  const mode = ((Number(entry && entry.externalFileAttributes) || 0) >>> 16) & 0xFFFF;
  if ((mode & 0o170000) === 0o120000) throw new Error(`Refusing symlink entry "${raw}" in the archive.`);
  const root = path.resolve(destDir);
  const rel = path.relative(root, path.resolve(root, name));
  if (!name || path.isAbsolute(name) || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Refusing entry "${name}" that escapes the archive folder.`);
  }
}

function ensureExecutable(binPath) {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(binPath, 0o755); } catch (_) { /* best effort */ }
}

// The archive's top-level dir lands inside destDir. tar sniffs content, so a .part file works too.
async function extractTarXz(file, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  await run('tar', ['-xJf', file, '-C', destDir]);
}

// Mounts the .dmg read-only and copies each root *.app with ditto (keeps symlinks/permissions).
// hdiutil sniffs content, so an extension-less .part file mounts fine.
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

// Leaves the tree where platform.firefoxBinaryRel() expects the launchable binary.
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

// Callers locate the binary with platform.findFpChromiumBinary().
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
  assertSafeZipEntry,
  extractFirefox,
  extractFpChromium,
  ensureExecutable
};
