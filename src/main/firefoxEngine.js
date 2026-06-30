'use strict';
// Real Firefox launch engine. Firefox is a different engine from Chrome (no CDP /
// MV3), so instead of the extension-based injection we configure a dedicated
// profile via user.js prefs: proxy, User-Agent, locale, timezone (TZ env) and
// WebRTC-off (so the real IP can't leak). Authenticated HTTP proxies are handled
// by a tiny local relay (Firefox can't store proxy creds in prefs).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseProxyInput } = require('./browserEngine');
// `app` is a string path (not the API object) when required outside Electron, so
// `app && app.isPackaged` is a safe runtime guard.
const { app } = require('electron');

// Must be a writable, real directory. In a packaged build `__dirname` lives inside
// app.asar (a FILE), so `../../firefox` → `…/app.asar/firefox` and any write throws
// ENOTDIR. Use userData when packaged; keep the project-root path in dev.
const FIREFOX_ROOT = (app && app.isPackaged)
  ? path.join(app.getPath('userData'), 'firefox')
  : path.resolve(__dirname, '../../firefox');

const FIREFOX_CANDIDATES = [
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Mozilla Firefox', 'firefox.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Mozilla Firefox', 'firefox.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Mozilla Firefox', 'firefox.exe'),
  path.join(FIREFOX_ROOT, 'firefox.exe') // optional downloaded copy
].filter(Boolean);

function findFirefoxBinary() {
  for (const p of FIREFOX_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return null;
}

// --- Versioned Firefox installs (downloaded on demand into /firefox/<version>) ---

function firefoxInstallDir(version) { return path.join(FIREFOX_ROOT, String(version)); }

function isFirefoxVersionInstalled(version) {
  try { return fs.existsSync(path.join(firefoxInstallDir(version), 'firefox.exe')); }
  catch (e) { return false; }
}

// Resolve the binary for a profile's selected version: prefer a downloaded
// versioned install, then fall back to whatever Firefox is on the machine.
function resolveFirefoxBinary(version) {
  if (version && String(version) !== 'Auto') {
    const p = path.join(firefoxInstallDir(version), 'firefox.exe');
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return findFirefoxBinary();
}

const ffSessions = new Map(); // sessionId -> { proc, relay, userDataDir, title, proxyLabel, createdAt }

// Local HTTP proxy that injects Proxy-Authorization to an authenticated upstream,
// so Firefox connects auth-free to 127.0.0.1:<port>. Supports GET + CONNECT.
function startAuthRelay(proxy) {
  return new Promise((resolve, reject) => {
    const authHeader = 'Basic ' + Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
    const upstreamHost = proxy.host;
    const upstreamPort = Number(proxy.port);

    const server = http.createServer((req, res) => {
      const opts = { host: upstreamHost, port: upstreamPort, method: req.method, path: req.url,
        headers: { ...req.headers, 'Proxy-Authorization': authHeader } };
      const fwd = http.request(opts, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
      fwd.on('error', () => { try { res.writeHead(502); res.end(); } catch (e) {} });
      req.pipe(fwd);
    });
    server.on('connect', (req, clientSocket, head) => {
      // Tunnel HTTPS through the upstream proxy with auth.
      const upstream = net.connect(upstreamPort, upstreamHost, () => {
        upstream.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${authHeader}\r\n\r\n`);
        upstream.once('data', (chunk) => {
          // Pass the upstream's CONNECT response straight back, then splice.
          clientSocket.write(chunk);
          if (head && head.length) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => { try { server.close(); } catch (e) {} } }));
  });
}

function buildUserJs(opts) {
  const lines = [];
  const pref = (k, v) => lines.push(`user_pref(${JSON.stringify(k)}, ${typeof v === 'string' ? JSON.stringify(v) : v});`);

  // First-run / telemetry / noise suppression.
  pref('browser.shell.checkDefaultBrowser', false);
  pref('browser.startup.homepage_override.mstone', 'ignore');
  pref('startup.homepage_welcome_url', '');
  pref('startup.homepage_welcome_url.additional', '');
  pref('browser.aboutwelcome.enabled', false);
  pref('datareporting.policy.dataSubmissionEnabled', false);
  pref('datareporting.healthreport.uploadEnabled', false);
  pref('toolkit.telemetry.enabled', false);
  pref('app.shield.optoutstudies.enabled', false);
  pref('browser.newtabpage.enabled', false);
  pref('browser.newtab.url', 'about:blank');

  // Anti-leak: turn OFF WebRTC and geolocation so the real IP/location can't escape.
  pref('media.peerconnection.enabled', false);
  pref('media.navigator.enabled', false);
  pref('geo.enabled', false);
  pref('dom.webnotifications.enabled', false);

  // User-Agent override (kept consistent with the profile).
  if (opts.userAgent) pref('general.useragent.override', opts.userAgent);

  // Locale.
  if (opts.acceptLanguages) {
    pref('intl.accept_languages', opts.acceptLanguages);
    pref('intl.locale.requested', opts.acceptLanguages.split(',')[0]);
  }

  // Proxy. type 1 = manual. For auth HTTP proxies we point at the local relay.
  if (opts.proxy) {
    const p = opts.proxy;
    const isSocks = /socks/i.test(p.type);
    pref('network.proxy.type', 1);
    pref('network.proxy.no_proxies_on', '');
    if (isSocks) {
      pref('network.proxy.socks', p.host);
      pref('network.proxy.socks_port', Number(p.port));
      pref('network.proxy.socks_version', /4/.test(p.type) ? 4 : 5);
      pref('network.proxy.socks_remote_dns', true);
    } else {
      const host = opts.relayPort ? '127.0.0.1' : p.host;
      const port = opts.relayPort ? opts.relayPort : Number(p.port);
      pref('network.proxy.http', host);
      pref('network.proxy.http_port', port);
      pref('network.proxy.ssl', host);
      pref('network.proxy.ssl_port', port);
      pref('network.proxy.share_proxy_settings', true);
    }
  }

  return lines.join('\n') + '\n';
}

async function launchFirefoxProfile(options = {}) {
  const {
    profileId, title, dataDirName, profileRoot, profile = {}, startUrl = 'about:blank'
  } = options;

  const wantVersion = profile.browserVersion || options.browserVersion || 'Auto';
  const ff = resolveFirefoxBinary(wantVersion);
  if (!ff) throw new Error('Firefox is not installed. Download a FlowerBrowser version from the browser selector (or install Firefox on this machine) to launch this profile.');

  const root = path.resolve(profileRoot || path.resolve(process.cwd(), 'softglaze_profiles'));
  const safe = String(dataDirName || title || `ff-${profileId || crypto.randomUUID()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const userDataDir = path.join(root, 'firefox', safe);
  await fsp.mkdir(userDataDir, { recursive: true });

  const proxy = parseProxyInput(options.proxy || options.proxyInfoString);
  const proxyLabel = proxy ? `${proxy.type} ${proxy.host}:${proxy.port}` : 'Direct (No Proxy)';

  // Auth HTTP proxy -> local relay so Firefox connects without a credential prompt.
  let relay = null;
  if (proxy && (proxy.username || proxy.password) && !/socks/i.test(proxy.type)) {
    relay = await startAuthRelay(proxy).catch(() => null);
  }

  const acceptLanguages = profile.languageCustom && profile.languageType === 'Custom'
    ? String(profile.languageCustom).split(';')[0].trim()
    : null;
  const timezoneId = profile.timezoneType === 'Custom' && profile.timezoneCustom
    ? String(profile.timezoneCustom).trim() : null;

  const userJs = buildUserJs({
    proxy,
    relayPort: relay ? relay.port : null,
    userAgent: profile.userAgent && profile.userAgent !== 'Auto' ? profile.userAgent : null,
    acceptLanguages
  });
  await fsp.writeFile(path.join(userDataDir, 'user.js'), userJs);

  const env = { ...process.env };
  if (timezoneId) env.TZ = timezoneId; // Firefox honors TZ for Date/Intl on all platforms

  const args = ['-profile', userDataDir, '-no-remote', '-new-instance', '--no-first-run'];
  if (startUrl && startUrl !== 'about:blank') args.push('-url', startUrl);

  const proc = spawn(ff, args, { env, detached: false, windowsHide: false });
  const sessionId = String(profileId || crypto.randomUUID());
  const session = { proc, relay, userDataDir, title: title || `Profile ${sessionId}`, proxyLabel, createdAt: new Date(), engine: 'firefox' };
  ffSessions.set(sessionId, session);

  proc.on('exit', () => {
    if (session.relay) session.relay.close();
    ffSessions.delete(sessionId);
  });
  proc.on('error', () => {
    if (session.relay) session.relay.close();
    ffSessions.delete(sessionId);
  });

  return { sessionId, userDataDir, engine: 'firefox' };
}

async function closeFirefoxSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = ffSessions.get(id);
  if (!session) return { closed: false };
  try { session.proc.kill(); } catch (e) { /* ignore */ }
  if (session.relay) session.relay.close();
  ffSessions.delete(id);
  return { closed: true };
}

function isFirefoxSession(sessionId) {
  return ffSessions.has(String(sessionId || '').trim());
}

function listFirefoxSessions() {
  const fmt = (d) => {
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  return Array.from(ffSessions.entries()).map(([sessionId, s]) => ({
    id: sessionId, sessionId, profileName: s.title, ip: s.proxyLabel,
    uptime: fmt(s.createdAt), userDataDir: s.userDataDir, engine: 'firefox',
    createdAt: s.createdAt.toISOString()
  }));
}

async function closeAllFirefoxSessions() {
  for (const id of Array.from(ffSessions.keys())) await closeFirefoxSession(id);
}

// --- On-demand Firefox download + silent install -------------------------------
// We pull the FULL offline installer from Mozilla's release archive and run it
// silently (`/S /D=<dir>`) into /firefox/<version>, so the launcher can resolve a
// version-matched binary. Pure Node + the OS installer — no new npm dependency.

const FF_HISTORY = 'https://product-details.mozilla.org/1.0/firefox_history_major_releases.json';
const FF_STATE_FILE = path.join(FIREFOX_ROOT, '.download-state.json');
const ffDownloads = new Map(); // major -> { version, major, percent, state, error, receivedBytes, totalBytes, url, dest }
const ffAborters = new Map(); // major -> abort fn while downloading
const ffPaused = new Set(); // majors the user explicitly paused
let ffCatalog = null;
let ffCatalogAt = 0;
let ffLastPersist = 0;

// Stable partial-download path (NOT keyed by PID, so it survives an app restart
// and can be resumed). NSIS doesn't care about the extension, so we run the
// installer straight from the .part file.
function ffPartialPath(major) { return path.join(FIREFOX_ROOT, `_download-ff-${major}.part`); }

function ffPersistState(force) {
  const now = Date.now();
  if (!force && now - ffLastPersist < 1000) return;
  ffLastPersist = now;
  const resumable = [];
  for (const e of ffDownloads.values()) {
    if (e.state === 'downloading' || e.state === 'paused' || e.state === 'interrupted' || e.state === 'installing') {
      resumable.push({ version: e.version, major: e.major, url: e.url || '', dest: e.dest || '', receivedBytes: e.receivedBytes || 0, totalBytes: e.totalBytes || 0, state: e.state, updatedAt: now });
    }
  }
  try {
    fs.mkdirSync(FIREFOX_ROOT, { recursive: true });
    fs.writeFileSync(FF_STATE_FILE, JSON.stringify(resumable));
  } catch (e) { /* best-effort */ }
}

// Re-surface any Firefox download that was mid-flight when the app died.
async function initFirefoxResumableState() {
  let raw;
  try { raw = await fsp.readFile(FF_STATE_FILE, 'utf8'); } catch (e) { return; }
  let list;
  try { list = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(list)) return;
  for (const s of list) {
    if (!s || s.major == null) continue;
    if (isFirefoxVersionInstalled(s.major)) continue;
    let partial = 0;
    if (s.dest) { try { partial = (await fsp.stat(s.dest)).size; } catch (e) { partial = 0; } }
    if (partial <= 0) continue;
    const total = s.totalBytes || 0;
    ffDownloads.set(String(s.major), {
      version: s.version || `${s.major}.0`,
      major: s.major,
      percent: total ? Math.min(85, Math.round((partial / total) * 85)) : 0,
      state: 'interrupted',
      error: null,
      receivedBytes: partial,
      totalBytes: total,
      url: s.url || '',
      dest: s.dest || ''
    });
  }
}

function ffHttpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'SoftGlaze' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return ffHttpsGet(res.headers.location, redirects + 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
  });
}

async function ffFetchJson(url) {
  const res = await ffHttpsGet(url);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} fetching Firefox version list`);
  let data = '';
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

function ffMajor(v) { return parseInt(String(v), 10); }
// "140" -> "140.0"; "140.0.1" stays as-is. Install dirs are keyed by major so the
// profile's stored version (a major, like Chrome) resolves directly to a binary.
function ffFullVersion(v) { const s = String(v); return /^\d+\.\d/.test(s) ? s : `${ffMajor(v)}.0`; }

function ffInstallerUrl(version) {
  const full = ffFullVersion(version);
  return `https://ftp.mozilla.org/pub/firefox/releases/${full}/win64/en-US/Firefox%20Setup%20${full}.exe`;
}

// Recent major Firefox releases available for win64, newest first, with install status.
async function listFirefoxDownloadable() {
  const now = Date.now();
  let majors = [];
  try {
    if (!ffCatalog || now - ffCatalogAt > 10 * 60 * 1000) {
      ffCatalog = await ffFetchJson(FF_HISTORY);
      ffCatalogAt = now;
    }
    majors = Object.keys(ffCatalog).filter((v) => /^\d+\.0$/.test(v)).map((v) => ffMajor(v));
  } catch (e) {
    // Offline / blocked — fall back to a constructed recent-major list.
    majors = Array.from({ length: 25 }, (_, i) => 140 - i);
  }
  majors = Array.from(new Set(majors)).sort((a, b) => b - a).slice(0, 30);

  const statusByMajor = new Map(getFirefoxDownloadStatus().map((s) => [s.major, s]));
  const sys = findFirefoxBinary();
  return {
    system: sys ? { path: sys } : null,
    items: majors.map((major) => ({
      version: `${major}.0`,
      major,
      installed: isFirefoxVersionInstalled(major),
      download: statusByMajor.get(major) || null
    }))
  };
}

// GET carrying custom headers (Range) AND following redirects preserving them.
// Resolves with the FINAL { res, req } so the caller can abort the live request.
function ffRawGet(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': 'SoftGlaze' }, headers) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return ffRawGet(res.headers.location, headers, redirects + 1).then(resolve, reject);
      }
      resolve({ res, req });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out')));
  });
}

// Resumable streaming download (Range continue / clean restart on 200 / done on
// 416). `registerAbort` receives an abort fn for pause. Resolves { received, total }.
async function ffDownloadToFile(url, dest, onProgress, registerAbort) {
  let startByte = 0;
  try { startByte = (await fsp.stat(dest)).size; } catch (e) { startByte = 0; }

  const headers = {};
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;

  const { res, req } = await ffRawGet(url, headers);
  if (registerAbort) registerAbort(() => { try { req.destroy(new Error('aborted')); } catch (e) {} });

  let received = startByte;
  let total = 0;
  let append = false;

  if (res.statusCode === 206) {
    append = true;
    const cr = res.headers['content-range'] || '';
    const m = /\/(\d+)\s*$/.exec(cr);
    total = m ? parseInt(m[1], 10) : startByte + parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 200) {
    append = false;
    received = 0;
    total = parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 416) {
    res.resume();
    onProgress(startByte, startByte);
    return { received: startByte, total: startByte };
  } else {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} downloading Firefox`);
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

// Firefox's NSIS installer: /S = silent, /D=<dir> must be the LAST arg, unquoted.
function runFirefoxInstaller(exe, dir) {
  return new Promise((resolve, reject) => {
    const ps = spawn(exe, ['/S', `/D=${dir}`], { windowsHide: true });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Firefox installer exited ' + code))));
  });
}

function startFirefoxDownload(version) {
  const major = ffMajor(version);
  const key = String(major);
  const active = ffDownloads.get(key);
  if (active && (active.state === 'downloading' || active.state === 'installing')) return active;

  // Resume an interrupted/paused/errored entry in place so its byte offset + dest
  // survive; otherwise start fresh.
  const entry = (active && (active.state === 'interrupted' || active.state === 'paused' || active.state === 'error'))
    ? active
    : { version: `${major}.0`, major, percent: 0, state: 'queued', error: null, receivedBytes: 0, totalBytes: 0, url: '', dest: '' };
  entry.state = 'queued';
  entry.error = null;
  ffPaused.delete(major);
  ffDownloads.set(key, entry);

  (async () => {
    try {
      if (isFirefoxVersionInstalled(major)) { entry.state = 'done'; entry.percent = 100; ffPersistState(true); return; }
      await fsp.mkdir(FIREFOX_ROOT, { recursive: true });
      const part = ffPartialPath(major);
      entry.url = ffInstallerUrl(major);
      entry.dest = part;

      entry.state = 'downloading';
      ffPersistState(true);
      const { received, total } = await ffDownloadToFile(entry.url, part, (rec, tot) => {
        entry.receivedBytes = rec;
        entry.totalBytes = tot || entry.totalBytes;
        entry.percent = tot ? Math.min(85, Math.round((rec / tot) * 85)) : entry.percent;
        ffPersistState(false);
      }, (abortFn) => { ffAborters.set(major, abortFn); });
      ffAborters.delete(major);

      if (total && received < total) {
        throw Object.assign(new Error('Connection interrupted before completion.'), { interrupted: true });
      }

      entry.state = 'installing';
      entry.percent = 88;
      ffPersistState(true);
      // Ensure the version dir exists before the NSIS installer writes into it
      // (mirrors the Chrome path; harmless if /D= would create it anyway).
      await fsp.mkdir(firefoxInstallDir(major), { recursive: true });
      await runFirefoxInstaller(part, firefoxInstallDir(major));
      await fsp.unlink(part).catch(() => {});

      if (!isFirefoxVersionInstalled(major)) throw Object.assign(new Error('Installed but firefox.exe was not found.'), { fatal: true });
      entry.percent = 100;
      entry.state = 'done';
      ffAborters.delete(major);
      ffPersistState(true);
    } catch (e) {
      ffAborters.delete(major);
      const wasPaused = ffPaused.has(major);
      const isInterrupted = wasPaused || (e && (e.aborted || e.interrupted));
      if (isInterrupted && !(e && e.fatal)) {
        entry.state = wasPaused ? 'paused' : 'interrupted';
        entry.error = wasPaused ? null : (e instanceof Error ? e.message : String(e));
        try { entry.receivedBytes = (await fsp.stat(entry.dest)).size; } catch (_) {}
        entry.percent = entry.totalBytes ? Math.min(85, Math.round((entry.receivedBytes / entry.totalBytes) * 85)) : entry.percent;
        ffPersistState(true);
        return;
      }
      entry.state = 'error';
      entry.error = e instanceof Error ? e.message : String(e);
      try { if (!isFirefoxVersionInstalled(major)) await fsp.rm(firefoxInstallDir(major), { recursive: true, force: true }); } catch (_) {}
      ffPersistState(true);
    }
  })();

  return entry;
}

// Pause an in-flight Firefox download: abort the socket, KEEP the partial file.
function pauseFirefoxDownload(version) {
  const major = ffMajor(version);
  const entry = ffDownloads.get(String(major));
  if (!entry) return { ok: false, error: 'No such download.' };
  if (entry.state !== 'downloading' && entry.state !== 'queued') return { ok: false, error: `Cannot pause a ${entry.state} download.` };
  ffPaused.add(major);
  const abort = ffAborters.get(major);
  if (abort) abort();
  entry.state = 'paused';
  ffPersistState(true);
  return { ok: true, version: entry.version, state: entry.state };
}

function resumeFirefoxDownload(version) {
  return startFirefoxDownload(version);
}

function getFirefoxDownloadStatus() {
  return Array.from(ffDownloads.values());
}

module.exports = {
  findFirefoxBinary,
  resolveFirefoxBinary,
  isFirefoxVersionInstalled,
  listFirefoxDownloadable,
  startFirefoxDownload,
  pauseFirefoxDownload,
  resumeFirefoxDownload,
  initFirefoxResumableState,
  getFirefoxDownloadStatus,
  launchFirefoxProfile,
  closeFirefoxSession,
  isFirefoxSession,
  listFirefoxSessions,
  closeAllFirefoxSessions,
  FIREFOX_ROOT
};
