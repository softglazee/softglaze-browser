'use strict';
// Cross-platform engine layer helpers.
//
// The browser-engine code (browserDownloader.js, browserEngine.js, firefoxEngine.js)
// was originally hard-wired to Windows: it filtered Chrome-for-Testing to the `win64`
// token, launched `chrome.exe`/`firefox.exe`, and built win64 Mozilla URLs. This module
// centralizes every one of those OS-specific decisions so those files ask here instead
// of hardcoding, which is what makes a macOS / Linux build actually launch browsers.
//
// Every function takes optional (platform, arch) so it is pure and unit-testable for all
// three OSes from any host; they default to the running machine. Paths are returned with
// forward slashes (Node accepts them on Windows too, and at runtime platform === host).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const P = { WIN: 'win32', MAC: 'darwin', LINUX: 'linux' };

function isWindows(platform = process.platform) { return platform === P.WIN; }
function isMac(platform = process.platform) { return platform === P.MAC; }
function isLinux(platform = process.platform) { return platform === P.LINUX; }

// ---------------------------------------------------------------------------
// Chrome for Testing (browserDownloader.js + browserEngine.js)
// ---------------------------------------------------------------------------

// The platform key used in Google's known-good-versions-with-downloads.json.
function cftPlatform(platform = process.platform, arch = process.arch) {
  if (platform === P.WIN) return 'win64';
  if (platform === P.MAC) return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (platform === P.LINUX) return 'linux64';
  throw new Error(`Unsupported platform for Chrome for Testing: ${platform}`);
}

// Top-level folder a CfT zip extracts into, e.g. 'chrome-win64', 'chrome-mac-arm64'.
function chromeExtractDir(platform = process.platform, arch = process.arch) {
  return `chrome-${cftPlatform(platform, arch)}`;
}

// Launchable Chrome binary path RELATIVE to chromeExtractDir().
function chromeBinaryRel(platform = process.platform) {
  if (platform === P.WIN) return 'chrome.exe';
  if (platform === P.MAC) return 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  return 'chrome'; // linux
}

// Full binary path RELATIVE to a CfT install dir (subdir + binary),
// e.g. 'chrome-win64/chrome.exe'. Used for install-completeness checks.
function chromeBinaryFromInstallDir(platform = process.platform, arch = process.arch) {
  return `${chromeExtractDir(platform, arch)}/${chromeBinaryRel(platform)}`;
}

// The bare on-disk name of an anti-detect / CfT Chrome binary (no path),
// used when scanning a folder for a loose binary.
function chromeExeName(platform = process.platform) {
  return platform === P.WIN ? 'chrome.exe' : 'chrome';
}

// Naming for our managed CfT install dirs: '<cftPlatform>-<version>'. Existing
// Windows installs use 'win64-<version>', so that spelling is preserved.
function chromeInstallDirName(version, platform = process.platform, arch = process.arch) {
  return `${cftPlatform(platform, arch)}-${version}`;
}

// Matches any managed CfT install dir name across platforms, capturing
// [full, cftToken, major, rest]. Replaces the old /^win64-(\d+)\.([\d.]+)$/.
const CHROME_INSTALL_DIR_RE = /^(win64|mac-x64|mac-arm64|linux64)-(\d+)\.([\d.]+)$/;

// System-installed Chrome/Chromium locations to probe as a fallback engine.
function realChromeCandidates(platform = process.platform) {
  if (platform === P.MAC) {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    ];
  }
  if (platform === P.LINUX) {
    return [
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'
    ];
  }
  // win32
  const pf = process.env['ProgramFiles'] || 'C:/Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  return [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pfx86, 'Google/Chrome/Application/chrome.exe'),
    local ? path.join(local, 'Google/Chrome/Application/chrome.exe') : null
  ].filter(Boolean);
}

// Executable names to look up on PATH (linux/mac) when nothing else resolves.
function chromePathLookupNames(platform = process.platform) {
  if (platform === P.WIN) return [];
  if (platform === P.MAC) return ['google-chrome', 'chromium'];
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

// fingerprint-chromium (ungoogled-chromium fork) extracts to different layouts
// per OS and the exact binary name varies by build, so instead of hardcoding it we
// SCAN <root> and one level of subdirs for the launchable binary. Returns its path
// or null. `plat` is injectable for tests.
function findFpChromiumBinary(root, plat = process.platform) {
  const macBinaries = (base) => {
    let apps = [];
    try { apps = fs.readdirSync(base).filter((n) => n.endsWith('.app')); } catch (_) { return []; }
    const out = [];
    for (const appName of apps) {
      const macDir = path.join(base, appName, 'Contents', 'MacOS');
      let files = [];
      try { files = fs.readdirSync(macDir); } catch (_) { continue; }
      const pick = files.find((f) => /chrom/i.test(f)) || files[0];
      if (pick) out.push(path.join(macDir, pick));
    }
    return out;
  };
  const candidatesFor = (base) => {
    if (plat === P.WIN) return [path.join(base, 'chrome.exe')];
    if (plat === P.MAC) return macBinaries(base);
    return ['chrome', 'chromium', 'chrome-wrapper', 'chromium-browser'].map((n) => path.join(base, n));
  };
  const bases = [root];
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.endsWith('.app')) bases.push(path.join(root, ent.name));
    }
  } catch (_) { return null; }
  for (const base of bases) {
    for (const c of candidatesFor(base)) {
      try { if (fs.existsSync(c)) return c; } catch (_) { /* keep scanning */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Firefox (firefoxEngine.js)
// ---------------------------------------------------------------------------

// Mozilla release sub-path segment per OS ('win64' | 'mac' | 'linux-x86_64').
function firefoxMozDir(platform = process.platform) {
  if (platform === P.WIN) return 'win64';
  if (platform === P.MAC) return 'mac';
  return 'linux-x86_64';
}

// The downloaded artifact's file name for a full version, e.g.
// 'Firefox Setup 130.0.exe' | 'Firefox 130.0.dmg' | 'firefox-130.0.tar.xz'.
function firefoxArtifactName(full, platform = process.platform) {
  if (platform === P.WIN) return `Firefox Setup ${full}.exe`;
  if (platform === P.MAC) return `Firefox ${full}.dmg`;
  return `firefox-${full}.tar.xz`;
}

// Full download URL for the offline installer/package.
function firefoxInstallerUrl(full, platform = process.platform) {
  const base = `https://ftp.mozilla.org/pub/firefox/releases/${full}/${firefoxMozDir(platform)}/en-US/`;
  return base + encodeURIComponent(firefoxArtifactName(full, platform));
}

// The lookup key inside Mozilla's per-release SHA256SUMS file (unencoded).
function firefoxSha256Key(full, platform = process.platform) {
  return `${firefoxMozDir(platform)}/en-US/${firefoxArtifactName(full, platform)}`;
}

// Firefox binary path RELATIVE to our managed install dir, after extraction.
function firefoxBinaryRel(platform = process.platform) {
  if (platform === P.WIN) return 'firefox.exe';
  if (platform === P.MAC) return 'Firefox.app/Contents/MacOS/firefox';
  return 'firefox/firefox'; // linux tarball extracts a firefox/ dir
}

// System-installed Firefox locations to probe as a fallback engine.
function firefoxSystemCandidates(platform = process.platform) {
  if (platform === P.MAC) {
    return [
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      `${os.homedir()}/Applications/Firefox.app/Contents/MacOS/firefox`
    ];
  }
  if (platform === P.LINUX) {
    return ['/usr/bin/firefox', '/usr/local/bin/firefox', '/snap/bin/firefox', '/opt/firefox/firefox'];
  }
  // win32
  const pf = process.env.ProgramFiles || 'C:/Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
    path.join(pfx86, 'Mozilla Firefox', 'firefox.exe'),
    local ? path.join(local, 'Mozilla Firefox', 'firefox.exe') : null
  ].filter(Boolean);
}

module.exports = {
  P,
  isWindows,
  isMac,
  isLinux,
  // Chrome
  cftPlatform,
  chromeExtractDir,
  chromeBinaryRel,
  chromeBinaryFromInstallDir,
  chromeExeName,
  chromeInstallDirName,
  CHROME_INSTALL_DIR_RE,
  realChromeCandidates,
  chromePathLookupNames,
  findFpChromiumBinary,
  // Firefox
  firefoxMozDir,
  firefoxArtifactName,
  firefoxInstallerUrl,
  firefoxSha256Key,
  firefoxBinaryRel,
  firefoxSystemCandidates
};
