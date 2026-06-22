'use strict';
// On-demand Chrome-for-Testing download manager. Lets the app
// ship WITHOUT bundling every Chrome build — the user downloads the version they
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
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CFT_ENDPOINT = 'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json';
const CHROME_ROOT = path.resolve(__dirname, '../../chrome');
const STATE_FILE = path.join(CHROME_ROOT, '.download-state.json');

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
// offer Resume. Nothing is auto-resumed — the user decides.
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

function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'SoftGlaze' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsGet(res.headers.location, redirects + 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
  });
}

async function fetchJson(url) {
  const res = await httpsGet(url);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} fetching version list`);
  let data = '';
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

function chromeTargetDir(version) {
  return path.join(CHROME_ROOT, `win64-${version}`);
}

function isInstalled(version) {
  try { return fs.existsSync(path.join(chromeTargetDir(version), 'chrome-win64', 'chrome.exe')); }
  catch (e) { return false; }
}

// Latest Chrome-for-Testing build per major version available for win64.
async function listDownloadableVersions() {
  const now = Date.now();
  if (cachedVersions && now - cachedAt < 10 * 60 * 1000) return cachedVersions;
  const json = await fetchJson(CFT_ENDPOINT);
  const byMajor = new Map();
  for (const v of json.versions || []) {
    const win = ((v.downloads && v.downloads.chrome) || []).find((d) => d.platform === 'win64');
    if (!win) continue;
    const major = parseInt(v.version, 10);
    if (!Number.isFinite(major)) continue;
    const prev = byMajor.get(major);
    if (!prev || cmpVersion(v.version, prev.version) > 0) byMajor.set(major, { version: v.version, major, url: win.url });
  }
  cachedVersions = Array.from(byMajor.values()).sort((a, b) => b.major - a.major);
  cachedAt = now;
  return cachedVersions;
}

// GET that carries custom headers (Range) AND follows redirects preserving them.
// Resolves with the FINAL { res, req } so the caller can abort the live request.
function rawGet(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': 'SoftGlaze' }, headers) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return rawGet(res.headers.location, headers, redirects + 1).then(resolve, reject);
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
async function downloadToFile(url, dest, onProgress, registerAbort) {
  let startByte = 0;
  try { startByte = (await fsp.stat(dest)).size; } catch (e) { startByte = 0; }

  const headers = {};
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;

  const { res, req } = await rawGet(url, headers);
  if (registerAbort) registerAbort(() => { try { req.destroy(new Error('aborted')); } catch (e) {} });

  let received = startByte;
  let total = 0;
  let append = false;

  if (res.statusCode === 206) {
    append = true; // server honored Range — append to the partial file
    const cr = res.headers['content-range'] || '';
    const m = /\/(\d+)\s*$/.exec(cr);
    total = m ? parseInt(m[1], 10) : startByte + parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 200) {
    append = false; // server ignored Range (or fresh start) — overwrite from zero
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

// Extract a .zip on Windows via PowerShell Expand-Archive (no npm dependency).
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const cmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Extract failed: ' + (err.slice(0, 300) || `exit ${code}`)))));
  });
}

// Kick off (or RESUME) a background download+install. Returns the progress entry.
function startDownload(versionOrMajor) {
  const key = String(versionOrMajor);
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
    try {
      const list = await listDownloadableVersions();
      const found = list.find((x) => x.version === entry.version || String(x.major) === entry.version);
      if (!found) throw Object.assign(new Error(`No downloadable win64 build for "${entry.version}".`), { fatal: true });
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
      // truncated zip — surface it as resumable.
      if (total && received < total) {
        throw Object.assign(new Error('Connection interrupted before completion.'), { interrupted: true });
      }

      entry.state = 'extracting';
      entry.percent = 92;
      persistState(true);
      await extractZip(zip, dir);
      await fsp.unlink(zip).catch(() => {});

      if (!isInstalled(found.version)) throw Object.assign(new Error('Extracted but chrome.exe not found.'), { fatal: true });
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
      try { if (entry.version && !isInstalled(entry.version)) await fsp.rm(chromeTargetDir(entry.version), { recursive: true, force: true }); } catch (_) {}
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
    // half-finished download — delete it rather than fail to extract every launch.
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

module.exports = {
  listDownloadableVersions,
  startDownload,
  pauseDownload,
  resumeDownload,
  getDownloadStatus,
  isInstalled,
  reconcileStrayZips,
  initResumableState,
  CHROME_ROOT
};
