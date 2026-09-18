'use strict';
// On-demand Chrome-for-Testing download manager. Lets the app
// ship WITHOUT bundling every Chrome build - the user downloads the version they
// want and it auto-installs into /chrome/win64-<version>/chrome-win64/chrome.exe,
// which the launcher already resolves. Pure Node + PowerShell Expand-Archive, no
// new npm dependency.
//
// RESILIENCE: downloads stream to a partial _download.zip and the live byte
// offset is persisted to /chrome/.download-state.json. If the network drops or
// the PC shuts down mid-download, the partial file + state survive; on the next
// launch the entry is surfaced as "interrupted" and a Range: bytes=<offset>-
// request resumes the stream from the exact byte it stopped at (no restart from
// 0%). Pause/Resume use the same machinery.
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { assertAllowedDownloadUrl, resolveRedirect, HOSTS } = require('./downloadGuard');
const platform = require('./platform');
const { extractZipCrossPlatform, extractFpChromium, ensureExecutable } = require('./extractArchive');
// `app` is a string path (not the API object) when required outside Electron
// (e.g. unit tests), so `app && app.isPackaged` is a safe runtime guard.
const { app } = require('electron');

const CFT_ENDPOINT = 'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json';
// Downloads MUST land in a writable, real directory. In a packaged build
// `__dirname` is inside app.asar (a FILE), so `../../chrome` resolves to
// `…/app.asar/chrome` and every mkdir/write throws ENOTDIR. Use userData when
// packaged; keep the project-root path in dev so the existing dev cache is reused.
const CHROME_ROOT = (app && app.isPackaged)
  ? path.join(app.getPath('userData'), 'chrome')
  : path.resolve(__dirname, '../../chrome');
const STATE_FILE = path.join(CHROME_ROOT, '.download-state.json');
// The Chrome-for-Testing platform key + on-disk layout for THIS machine
// (win64 | mac-x64 | mac-arm64 | linux64). Everything below resolves through it.
const CFT_PLATFORM = platform.cftPlatform();

// version -> { version, major, percent, state, error, receivedBytes, totalBytes, url, dest }
// state: queued | downloading | extracting | done | error | paused | interrupted
const downloads = new Map();
// version -> function that aborts the in-flight request (set while downloading).
const aborters = new Map();
// versions the user explicitly paused (so an aborted stream isn't treated as error).
const paused = new Set();
let cachedVersions = null;
let cachedAt = 0;
let lastPersist = 0;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Persistent download state (survives crashes / power loss).
// ---------------------------------------------------------------------------
function persistState(force) {
  const now = Date.now();
  if (!force && now - lastPersist < 1000) return; // throttle progress writes
  lastPersist = now;
  const resumable = [];
  for (const e of downloads.values()) {
    // Only persist things worth resuming. 'done'/'error'/'queued' don't need it.
    if (e.state === 'downloading' || e.state === 'paused' || e.state === 'interrupted' || e.state === 'extracting') {
      resumable.push({ version: e.version, major: e.major, url: e.url || '', dest: e.dest || '', receivedBytes: e.receivedBytes || 0, totalBytes: e.totalBytes || 0, state: e.state, updatedAt: now });
    }
  }
  try {
    fs.mkdirSync(CHROME_ROOT, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(resumable));
  } catch (e) { /* best-effort */ }
}

// Called once at boot: any download that was mid-flight when the app died is
// re-surfaced as "interrupted" (its partial zip is still on disk) so the UI can
// offer Resume. Nothing is auto-resumed - the user decides.
async function initResumableState() {
  let raw;
  try { raw = await fsp.readFile(STATE_FILE, 'utf8'); } catch (e) { return; }
  let list;
  try { list = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(list)) return;
  for (const s of list) {
    if (!s || !s.version) continue;
    if (isInstalled(s.version)) continue; // already finished since
    let partial = 0;
    if (s.dest) { try { partial = (await fsp.stat(s.dest)).size; } catch (e) { partial = 0; } }
    if (partial <= 0) continue; // nothing to resume from
    const total = s.totalBytes || 0;
    downloads.set(s.version, {
      version: s.version,
      major: s.major || parseInt(s.version, 10),
      percent: total ? Math.min(90, Math.round((partial / total) * 90)) : 0,
      state: 'interrupted',
      error: null,
      receivedBytes: partial,
      totalBytes: total,
      url: s.url || '',
      dest: s.dest || ''
    });
  }
}

function httpsGet(url, allowedHosts = HOSTS.chrome, label = 'Chrome download', redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    // audit: https-only + vendor-host allowlist on the URL and every redirect.
    let target;
    try { target = assertAllowedDownloadUrl(url, allowedHosts, label); }
    catch (e) { return reject(e); }
    const req = https.get(target, { headers: { 'User-Agent': 'SoftGlaze' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = resolveRedirect(res.headers.location, target, allowedHosts, label); }
        catch (e) { return reject(e); }
        return httpsGet(next, allowedHosts, label, redirects + 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
  });
}

async function fetchJson(url, allowedHosts = HOSTS.chrome, label = 'Chrome download') {
  const res = await httpsGet(url, allowedHosts, label);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} fetching ${label} metadata`);
  let data = '';
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

// A download key must be a plain Chrome version (major, or dotted up to 4 parts).
// It is later interpolated into a filesystem path that gets recursively removed on
// a fatal error, so anything containing '/' or '..' must never get that far.
function isValidVersionKey(key) {
  return /^\d+(\.\d+){0,3}$/.test(String(key));
}

function chromeTargetDir(version) {
  return path.join(CHROME_ROOT, platform.chromeInstallDirName(version));
}

// Absolute path of the launchable Chrome binary inside an install dir, for THIS OS.
function chromeBinaryPath(version) {
  return path.join(chromeTargetDir(version), platform.chromeBinaryFromInstallDir());
}

function isInstalled(version) {
  try { return fs.existsSync(chromeBinaryPath(version)); }
  catch (e) { return false; }
}

// Latest Chrome-for-Testing build per major version available for THIS platform.
async function listDownloadableVersions() {
  const now = Date.now();
  if (cachedVersions && now - cachedAt < 10 * 60 * 1000) return cachedVersions;
  const json = await fetchJson(CFT_ENDPOINT);
  const byMajor = new Map();
  for (const v of json.versions || []) {
    const dl = ((v.downloads && v.downloads.chrome) || []).find((d) => d.platform === CFT_PLATFORM);
    if (!dl) continue;
    const major = parseInt(v.version, 10);
    if (!Number.isFinite(major)) continue;
    const prev = byMajor.get(major);
    if (!prev || cmpVersion(v.version, prev.version) > 0) byMajor.set(major, { version: v.version, major, url: dl.url });
  }
  cachedVersions = Array.from(byMajor.values()).sort((a, b) => b.major - a.major);
  cachedAt = now;
  return cachedVersions;
}

// GET that carries custom headers (Range) AND follows redirects preserving them.
// Resolves with the FINAL { res, req } so the caller can abort the live request.
function rawGet(url, headers, allowedHosts = HOSTS.chrome, label = 'Chrome download', redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    // audit: https-only + vendor-host allowlist on the URL and every redirect.
    let target;
    try { target = assertAllowedDownloadUrl(url, allowedHosts, label); }
    catch (e) { return reject(e); }
    const req = https.get(target, { headers: Object.assign({ 'User-Agent': 'SoftGlaze' }, headers) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = resolveRedirect(res.headers.location, target, allowedHosts, label); }
        catch (e) { return reject(e); }
        return rawGet(next, headers, allowedHosts, label, redirects + 1).then(resolve, reject);
      }
      resolve({ res, req });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out')));
  });
}

// Resumable streaming download. If `dest` already holds bytes, asks the server to
// continue from that offset (Range). Falls back to a clean restart if the server
// ignores Range (responds 200). `registerAbort` receives an abort fn for pause.
// Resolves with { received, total }.
async function downloadToFile(url, dest, onProgress, registerAbort, allowedHosts = HOSTS.chrome, label = 'Chrome download') {
  let startByte = 0;
  try { startByte = (await fsp.stat(dest)).size; } catch (e) { startByte = 0; }

  const headers = {};
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;

  const { res, req } = await rawGet(url, headers, allowedHosts, label);
  if (registerAbort) registerAbort(() => { try { req.destroy(new Error('aborted')); } catch (e) {} });

  let received = startByte;
  let total = 0;
  let append = false;

  if (res.statusCode === 206) {
    append = true; // server honored Range - append to the partial file
    const cr = res.headers['content-range'] || '';
    const m = /\/(\d+)\s*$/.exec(cr);
    total = m ? parseInt(m[1], 10) : startByte + parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 200) {
    append = false; // server ignored Range (or fresh start) - overwrite from zero
    received = 0;
    total = parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 416) {
    // Range not satisfiable: the partial file is already >= the resource. Treat as
    // complete and let the caller verify/extract.
    res.resume();
    onProgress(startByte, startByte);
    return { received: startByte, total: startByte };
  } else {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} downloading browser`);
  }

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    res.on('data', (c) => { received += c.length; onProgress(received, total); });
    res.on('error', (e) => finish(reject, e));
    res.on('aborted', () => finish(reject, Object.assign(new Error('Download aborted'), { aborted: true })));
    ws.on('error', (e) => finish(reject, e));
    ws.on('finish', () => finish(resolve));
    res.pipe(ws);
  });

  return { received, total };
}

// Cross-platform .zip extraction (Chrome for Testing + fingerprint-chromium).
// Windows used to shell out to PowerShell Expand-Archive; extractZipCrossPlatform
// (extract-zip) works identically on win/mac/linux and preserves the unix exec bit.
function extractZip(zipPath, destDir) {
  return extractZipCrossPlatform(zipPath, destDir);
}

// Kick off (or RESUME) a background download+install. Returns the progress entry.
function startDownload(versionOrMajor) {
  const key = String(versionOrMajor);
  // DL-1: reject a non-version key before any fs/network work, so a crafted value
  // like '../../..' can never reach chromeTargetDir() / fsp.rm().
  if (!isValidVersionKey(key)) {
    return { version: key, major: parseInt(key, 10) || 0, percent: 0, state: 'error', error: 'Invalid Chrome version.', receivedBytes: 0, totalBytes: 0, url: '', dest: '' };
  }
  const active = downloads.get(key);
  if (active && (active.state === 'downloading' || active.state === 'extracting')) return active;

  // Reuse the existing entry when resuming an interrupted/paused download so its
  // receivedBytes / dest survive; otherwise start a fresh one.
  const entry = (active && (active.state === 'interrupted' || active.state === 'paused' || active.state === 'error'))
    ? active
    : { version: key, major: parseInt(key, 10), percent: 0, state: 'queued', error: null, receivedBytes: 0, totalBytes: 0, url: '', dest: '' };
  entry.state = 'queued';
  entry.error = null;
  paused.delete(entry.version);
  downloads.set(entry.version, entry);

  (async () => {
    let reachedExtraction = false;
    try {
      const list = await listDownloadableVersions();
      const found = list.find((x) => x.version === entry.version || String(x.major) === entry.version);
      if (!found) throw Object.assign(new Error(`No downloadable ${CFT_PLATFORM} build for "${entry.version}".`), { fatal: true });
      // Re-key the entry to the exact resolved version.
      if (entry.version !== found.version) {
        downloads.delete(entry.version);
        entry.version = found.version;
        entry.major = found.major;
        downloads.set(found.version, entry);
      }
      entry.url = found.url;

      if (isInstalled(found.version)) { entry.state = 'done'; entry.percent = 100; persistState(true); return; }

      const dir = chromeTargetDir(found.version);
      await fsp.mkdir(dir, { recursive: true });
      const zip = path.join(dir, '_download.zip');
      entry.dest = zip;

      entry.state = 'downloading';
      persistState(true);
      const { received, total } = await downloadToFile(found.url, zip, (rec, tot) => {
        entry.receivedBytes = rec;
        entry.totalBytes = tot || entry.totalBytes;
        entry.percent = tot ? Math.min(90, Math.round((rec / tot) * 90)) : entry.percent;
        persistState(false);
      }, (abortFn) => { aborters.set(found.version, abortFn); });
      aborters.delete(found.version);

      // Integrity gate: if we know the expected size and fell short, the stream was
      // cut (e.g. a silent socket close that still flushed 'finish'). Don't extract a
      // truncated zip - surface it as resumable.
      if (total && received < total) {
        throw Object.assign(new Error('Connection interrupted before completion.'), { interrupted: true });
      }

      reachedExtraction = true;
      entry.state = 'extracting';
      entry.percent = 92;
      persistState(true);
      await extractZip(zip, dir);
      await fsp.unlink(zip).catch(() => {});
      ensureExecutable(chromeBinaryPath(found.version)); // no-op on Windows

      if (!isInstalled(found.version)) throw Object.assign(new Error('Extracted but the Chrome binary was not found.'), { fatal: true });
      entry.percent = 100;
      entry.state = 'done';
      aborters.delete(found.version);
      persistState(true);
    } catch (e) {
      aborters.delete(entry.version);
      const wasPaused = paused.has(entry.version);
      const isInterrupted = wasPaused || (e && (e.aborted || e.interrupted));
      if (isInterrupted && !(e && e.fatal)) {
        // Keep the partial file + state so the user can resume from the exact byte.
        entry.state = wasPaused ? 'paused' : 'interrupted';
        entry.error = wasPaused ? null : (e instanceof Error ? e.message : String(e));
        try { entry.receivedBytes = (await fsp.stat(entry.dest)).size; } catch (_) {}
        entry.percent = entry.totalBytes ? Math.min(90, Math.round((entry.receivedBytes / entry.totalBytes) * 90)) : entry.percent;
        persistState(true);
        return;
      }
      // Fatal / corrupt: clear the half-install so it can't shadow a real one.
      entry.state = 'error';
      entry.error = e instanceof Error ? e.message : String(e);
      // Only clear a half-extracted install; never delete a resumable partial that
      // failed at the catalogue/download stage (that is what resume exists for).
      try { if (reachedExtraction && entry.version && !isInstalled(entry.version)) await fsp.rm(chromeTargetDir(entry.version), { recursive: true, force: true }); } catch (_) {}
      persistState(true);
    }
  })();

  return entry;
}

// Cooperatively pause an in-flight download: abort the socket but KEEP the partial
// file + state. startDownload(version) later resumes from the saved byte offset.
function pauseDownload(versionOrMajor) {
  const key = String(versionOrMajor);
  let entry = downloads.get(key);
  if (!entry) { for (const e of downloads.values()) { if (String(e.major) === key) { entry = e; break; } } }
  if (!entry) return { ok: false, error: 'No such download.' };
  if (entry.state !== 'downloading' && entry.state !== 'queued') return { ok: false, error: `Cannot pause a ${entry.state} download.` };
  paused.add(entry.version);
  const abort = aborters.get(entry.version);
  if (abort) abort();
  entry.state = 'paused';
  persistState(true);
  return { ok: true, version: entry.version, state: entry.state };
}

// Resume a paused/interrupted download (alias of startDownload, which resumes).
function resumeDownload(versionOrMajor) {
  return startDownload(versionOrMajor);
}

function getDownloadStatus() {
  return Array.from(downloads.values());
}

// Extract any leftover *.zip sitting directly in /chrome (e.g. a half-finished
// manual download) into its win64-<version> folder, then remove the zip.
async function reconcileStrayZips() {
  let entries = [];
  try { entries = await fsp.readdir(CHROME_ROOT); } catch (e) { return; }
  for (const name of entries) {
    if (!/\.zip$/i.test(name)) continue;
    const m = name.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (!m) continue;
    const version = m[1];
    const zipPath = path.join(CHROME_ROOT, name);
    if (isInstalled(version)) { await fsp.unlink(zipPath).catch(() => {}); continue; }
    // A real Chrome-for-Testing zip is ~150-200 MB; anything tiny is a corrupt or
    // half-finished download - delete it rather than fail to extract every launch.
    try {
      const st = await fsp.stat(zipPath);
      if (st.size < 30 * 1024 * 1024) { await fsp.unlink(zipPath).catch(() => {}); continue; }
    } catch (e) { continue; }
    try {
      const dir = chromeTargetDir(version);
      await fsp.mkdir(dir, { recursive: true });
      await extractZip(zipPath, dir);
      if (isInstalled(version)) await fsp.unlink(zipPath).catch(() => {});
      else await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    } catch (e) {
      await fsp.rm(chromeTargetDir(version), { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// fingerprint-chromium (native anti-detect engine) - one-shot GitHub download.
// Lands in FP_CHROMIUM_ROOT (sibling of CHROME_ROOT: userData/fp-chromium when
// packaged, <repo>/fp-chromium in dev, matching browserEngine.resolveAntidetectBinary).
// The release zip extracts to a versioned subdir (ungoogled-chromium_<v>_windows_x64/
// chrome.exe), which the launcher's resolver already looks one level deep for.
// ---------------------------------------------------------------------------
const FP_CHROMIUM_ROOT = path.join(path.dirname(CHROME_ROOT), 'fp-chromium');
const FP_CHROMIUM_REPO = 'adryfish/fingerprint-chromium';
// Pinned to the empirically-validated build (coherent platform/UA/GPU, no WebRTC leak).
// Bump deliberately after re-validating a newer release rather than tracking "latest".
const FP_CHROMIUM_VERSION = '148.0.7778.215';
// The exact release asset for that tag, pinned by name, size and SHA-256. A release
// tag on GitHub can have its assets replaced after publication, so the tag alone does
// not identify the binary. The digest is the one GitHub reports for the asset; a
// download that does not hash to it is deleted and never extracted or run.
// Bumping FP_CHROMIUM_VERSION means re-validating the build and updating all three.
// The pinned release asset PER platform, by name + size + SHA-256 (the values
// GitHub reports for adryfish/fingerprint-chromium at this tag). A release tag can
// have its assets replaced after publication, so the tag alone does not identify the
// binary; a download that does not match size+digest is deleted, never run. Bumping
// FP_CHROMIUM_VERSION means re-validating each build and updating these.
const FP_CHROMIUM_ASSETS = Object.freeze({
  'win64': { name: 'ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip', size: 189767686, sha256: '9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579' },
  'mac-x64': { name: 'ungoogled-chromium_148.0.7778.215-1.1_macos.dmg', size: 140187500, sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679' },
  'mac-arm64': { name: 'ungoogled-chromium_148.0.7778.215-1.1_macos.dmg', size: 140187500, sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679' },
  'linux64': { name: 'ungoogled-chromium-148.0.7778.215-1-x86_64_linux.tar.xz', size: 141269020, sha256: '70d239830332e5820aa34dfcb284161cac0429eee25da642830afe04bda717f4' }
});
// The asset for THIS machine. The macOS .dmg is shared by both arches (an x64 build
// runs under Rosetta on Apple Silicon if it is not universal).
const FP_CHROMIUM_ASSET = FP_CHROMIUM_ASSETS[CFT_PLATFORM] || FP_CHROMIUM_ASSETS['win64'];

// SHA-256 of a file on disk, streamed.
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Pick the pinned asset out of a GitHub release payload. Fatal when it is missing, or
// when GitHub reports a different size or digest than the pinned one (the asset was
// replaced), so nothing is downloaded at all in that case.
function pickFpChromiumAsset(release, pinned = FP_CHROMIUM_ASSET) {
  const assets = (release && release.assets) || [];
  const asset = assets.find((a) => a && a.name === pinned.name);
  if (!asset || !asset.browser_download_url) {
    throw Object.assign(new Error(`fingerprint-chromium ${FP_CHROMIUM_VERSION} no longer has the asset ${pinned.name}.`), { fatal: true });
  }
  const reported = String(asset.digest || '').toLowerCase().replace(/^sha256:/, '');
  if ((reported && reported !== pinned.sha256) || (asset.size != null && Number(asset.size) !== pinned.size)) {
    throw Object.assign(new Error(`fingerprint-chromium ${pinned.name} on GitHub does not match the pinned build (size or SHA-256 changed). Refusing to download it.`), { fatal: true });
  }
  return { version: FP_CHROMIUM_VERSION, url: asset.browser_download_url, name: asset.name };
}

// Verify a downloaded archive against the pinned size and SHA-256. Resolves true, or
// rejects with a fatal error.
async function verifyFpChromiumArchive(file, pinned = FP_CHROMIUM_ASSET) {
  const { size } = await fsp.stat(file);
  if (size !== pinned.size) {
    throw Object.assign(new Error(`fingerprint-chromium download is ${size} bytes, expected ${pinned.size}.`), { fatal: true });
  }
  const actual = await sha256File(file);
  if (actual !== pinned.sha256) {
    throw Object.assign(new Error('fingerprint-chromium download failed SHA-256 verification. Refusing to install it.'), { fatal: true });
  }
  return true;
}

// version -> chrome.exe present anywhere one level under the root (or at the root).
function fpChromiumInstalled() {
  // Scans root + one level for the chromium binary, per OS (win chrome.exe, mac
  // *.app/Contents/MacOS/*, linux chrome/chromium).
  return !!platform.findFpChromiumBinary(FP_CHROMIUM_ROOT);
}

// Resolve the pinned windows_x64 asset URL for the pinned tag via the GitHub API.
async function resolveFpChromiumAsset() {
  const api = `https://api.github.com/repos/${FP_CHROMIUM_REPO}/releases/tags/${FP_CHROMIUM_VERSION}`;
  const rel = await fetchJson(api, HOSTS.fpchromium, 'fingerprint-chromium release');
  return pickFpChromiumAsset(rel);
}

// state: idle | resolving | downloading | verifying | extracting | done | error
let fpStatus = { state: 'idle', percent: 0, error: null, receivedBytes: 0, totalBytes: 0 };
let fpInflight = null;

function getFpChromiumStatus() {
  return { ...fpStatus, installed: fpChromiumInstalled(), version: FP_CHROMIUM_VERSION };
}

// Kick off (or return the in-flight) fingerprint-chromium install. Idempotent: a no-op
// when already installed or already downloading. ~180 MB; extracts via Expand-Archive.
function startFpChromiumDownload() {
  if (fpChromiumInstalled()) { fpStatus = { state: 'done', percent: 100, error: null, receivedBytes: 0, totalBytes: 0 }; return getFpChromiumStatus(); }
  if (fpInflight) return getFpChromiumStatus();
  fpStatus = { state: 'resolving', percent: 0, error: null, receivedBytes: 0, totalBytes: 0 };
  fpInflight = (async () => {
    try {
      const { url } = await resolveFpChromiumAsset();
      await fsp.mkdir(FP_CHROMIUM_ROOT, { recursive: true });
      // Neutral extension: the artifact is a .zip (win), .dmg (mac) or .tar.xz (linux);
      // extractFpChromium dispatches by platform and each extractor content-sniffs.
      const archive = path.join(FP_CHROMIUM_ROOT, '_fp-download.part');
      fpStatus.state = 'downloading';
      const { received, total } = await downloadToFile(url, archive, (rec, tot) => {
        fpStatus.receivedBytes = rec;
        fpStatus.totalBytes = tot || fpStatus.totalBytes;
        fpStatus.percent = tot ? Math.min(90, Math.round((rec / tot) * 90)) : fpStatus.percent;
      }, null, HOSTS.fpchromium, 'fingerprint-chromium download');
      if (total && received < total) throw new Error('Connection interrupted before completion.');
      fpStatus.state = 'verifying';
      try {
        await verifyFpChromiumArchive(archive);
      } catch (verifyErr) {
        // Never keep a mismatched archive: the next attempt must start from zero,
        // not resume on top of bad bytes.
        await fsp.unlink(archive).catch(() => {});
        throw verifyErr;
      }
      fpStatus.state = 'extracting';
      fpStatus.percent = 92;
      await extractFpChromium(archive, FP_CHROMIUM_ROOT);
      await fsp.unlink(archive).catch(() => {});
      const fpBin = platform.findFpChromiumBinary(FP_CHROMIUM_ROOT);
      if (!fpBin) throw Object.assign(new Error('Extracted but the fingerprint-chromium binary was not found.'), { fatal: true });
      ensureExecutable(fpBin); // no-op on Windows
      fpStatus.state = 'done';
      fpStatus.percent = 100;
    } catch (e) {
      fpStatus.state = 'error';
      fpStatus.error = e instanceof Error ? e.message : String(e);
    } finally { fpInflight = null; }
  })();
  return getFpChromiumStatus();
}

module.exports = {
  listDownloadableVersions,
  isValidVersionKey,
  startDownload,
  pauseDownload,
  resumeDownload,
  getDownloadStatus,
  isInstalled,
  reconcileStrayZips,
  initResumableState,
  CHROME_ROOT,
  FP_CHROMIUM_ROOT,
  fpChromiumInstalled,
  startFpChromiumDownload,
  getFpChromiumStatus,
  FP_CHROMIUM_ASSET,
  pickFpChromiumAsset,
  verifyFpChromiumArchive,
  sha256File
};
