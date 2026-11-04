'use strict';

const { app } = require('electron');
const { tenantConfig } = require('./tenantConfig');

// Inert unless an update feed is configured: tenant builds use their baked updateFeedUrl, the
// seller's build opts in with SG_ENABLE_GITHUB_UPDATES=1. On Windows electron-updater checks the
// installer's Authenticode signature, so updates are only safe on code-signed builds.

let autoUpdaterRef = null;
let eventSink = null;
// status: idle | checking | available | not-available | downloading | downloaded | error
let lastState = { status: 'idle', version: null, percent: 0, error: null, releaseNotes: null, checkedAt: null };

// ipcHandlers owns the broadcast to every window; the updater only pushes state into its sink.
function setEventSink(fn) { eventSink = typeof fn === 'function' ? fn : null; }

function sendEvent(patch) {
  lastState = { ...lastState, ...patch };
  try { if (eventSink) eventSink(lastState); } catch (e) { /* sink gone */ }
}

// electron-updater's releaseNotes is a string (generic feed) or [{version,note}]
// (GitHub). Flatten to plain text, strip HTML, cap length for the in-app display.
function normalizeNotes(info) {
  const rn = info && info.releaseNotes;
  if (!rn) return null;
  const strip = (s) => String(s).replace(/<[^>]+>/g, '').trim();
  if (typeof rn === 'string') return strip(rn).slice(0, 2000) || null;
  if (Array.isArray(rn)) return (rn.map((r) => (r && r.note) ? strip(r.note) : '').filter(Boolean).join('\n\n').slice(0, 2000)) || null;
  return null;
}

function resolveFeed() {
  const url = tenantConfig().updateFeedUrl; // already https-validated by tenantConfig
  if (url) {
    // Defense in depth: an http feed can be MITM'd to serve a malicious installer.
    if (!/^https:\/\//i.test(url)) { console.error('[updater] refusing non-https update feed - auto-update disabled.'); return null; }
    return { kind: 'generic', url };
  }
  if (process.env.SG_ENABLE_GITHUB_UPDATES === '1') return { kind: 'baked' };
  return null;
}

// electron-updater can only verify an installer when the installed app is itself Authenticode-signed.
// On an unsigned build auto-update would be an unverified RCE path, so the updater stays disabled.
let _signedCache = null;
// Async because it shells out to PowerShell; runs once in the background so startup never blocks.
function isSignedBuild() {
  if (_signedCache !== null) return Promise.resolve(_signedCache);
  if (process.platform !== 'win32') { _signedCache = false; return Promise.resolve(false); }
  return new Promise((resolve) => {
    const exe = process.execPath.replace(/'/g, "''");
    const psCmd = `(Get-AuthenticodeSignature -FilePath '${exe}').Status`;
    require('node:child_process').execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { encoding: 'utf8', timeout: 10000, windowsHide: true },
      (err, out) => {
        if (err) console.warn('[updater] signature check failed; treating build as unsigned:', err && err.message);
        _signedCache = !err && String(out || '').trim() === 'Valid';
        resolve(_signedCache);
      }
    );
  });
}

// Records why auto-update is off so the banner can say it plainly.
function disable(reason, message) {
  sendEvent({ status: 'disabled', disabledReason: reason, error: null, message });
}

// Called from main.js once the window exists; goes live only on a packaged, signed build with a feed.
async function initAutoUpdater(mainWindow) {
  if (autoUpdaterRef) return; // once per run
  if (!app.isPackaged) { disable('dev', 'Automatic updates only run in the installed app.'); return; }
  // Store packages are signed by Microsoft (so the check below would pass) but must be updated by the Store.
  if (process.windowsStore) { disable('store', 'Updates for this version come from the Microsoft Store.'); return; }

  if (!(await isSignedBuild())) {
    console.warn('[updater] build is not code-signed - auto-update disabled (an unsigned auto-update cannot be verified and would be an RCE vector).');
    disable('unsigned', 'Automatic updates are off because this build is not code-signed. Download new versions from the website.');
    return;
  }

  const feed = resolveFeed();
  if (!feed) {
    console.log('[updater] no update feed configured - auto-update disabled.');
    disable('no-feed', 'Automatic updates are not set up for this build. Download new versions from the website.');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.warn('[updater] electron-updater not installed; auto-update disabled.');
    return;
  }
  autoUpdaterRef = autoUpdater;

  if (feed.kind === 'generic') {
    try { autoUpdater.setFeedURL({ provider: 'generic', url: feed.url }); }
    catch (e) { console.error('[updater] invalid update feed URL; auto-update disabled:', e && e.message); return; }
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', (err && err.message) || err);
    sendEvent({ status: 'error', error: (err && err.message) || String(err) });
  });
  autoUpdater.on('checking-for-update', () => sendEvent({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info && info.version);
    sendEvent({ status: 'available', version: (info && info.version) || null, releaseNotes: normalizeNotes(info), checkedAt: Date.now(), error: null });
  });
  autoUpdater.on('update-not-available', () => sendEvent({ status: 'not-available', checkedAt: Date.now(), error: null }));
  autoUpdater.on('download-progress', (p) => sendEvent({ status: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info && info.version);
    sendEvent({ status: 'downloaded', version: (info && info.version) || null, releaseNotes: normalizeNotes(info), percent: 100, error: null });
  });

  autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e && e.message));
}

// Lets the banner render correctly when the Dashboard mounts after the event fired.
function getState() { return { ...lastState, active: Boolean(autoUpdaterRef) }; }

// Driven by the banner's Install button.
function installDownloadedUpdate() {
  if (!autoUpdaterRef) return { ok: false, error: 'Auto-update is not active in this build.' };
  if (lastState.status !== 'downloaded') return { ok: false, error: 'No update has finished downloading yet.' };
  try { autoUpdaterRef.quitAndInstall(); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

function checkForUpdatesNow() {
  if (!autoUpdaterRef) return { ok: false, active: false, error: lastState.message || 'Automatic updates are not enabled in this build.' };
  autoUpdaterRef.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e && e.message));
  return { ok: true, active: true };
}

module.exports = { initAutoUpdater, setEventSink, getState, installDownloadedUpdate, checkForUpdatesNow };
