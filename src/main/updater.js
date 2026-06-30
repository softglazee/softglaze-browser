'use strict';

const { app } = require('electron');
const { tenantConfig } = require('./tenantConfig');

// Auto-update via electron-updater. SAFE BY DEFAULT: it stays fully inert unless an
// update feed is explicitly configured — so a build NEVER auto-pulls from a default
// or seller-owned feed.
//
//   • Tenant (white-label) builds: a buyer-owned `updateFeedUrl` is baked into the
//     tenant config; we point electron-updater at that generic feed. Each buyer
//     controls (and hosts) their own updates.
//   • Seller's own distribution: opt in with SG_ENABLE_GITHUB_UPDATES=1 to use the
//     baked `build.publish` feed from package.json.
//   • Otherwise: no update check is ever made.
//
// On `update-available` / `download-progress` / `update-downloaded` we push an
// `updater:event` to the renderer, which shows an in-app banner on the Dashboard
// ("New update available — Click to install"). `autoInstallOnAppQuit` stays on as a
// silent fallback if the user never clicks. quitAndInstall is driven from the
// banner via the `updater:install` IPC.
//
// Note: on Windows, electron-updater verifies the downloaded installer's Authenticode
// signature, so updates are only safe on CODE-SIGNED builds (see docs/signing-and-updates.md).

let autoUpdaterRef = null;
let eventSink = null;
// status: idle | checking | available | not-available | downloading | downloaded | error
let lastState = { status: 'idle', version: null, percent: 0, error: null, releaseNotes: null, checkedAt: null };

// The renderer broadcast is owned by ipcHandlers (it holds the CHANNELS map and
// sends to every window); the updater just pushes state into the sink it registers.
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
  const url = tenantConfig().updateFeedUrl;
  if (url) return { kind: 'generic', url };
  if (process.env.SG_ENABLE_GITHUB_UPDATES === '1') return { kind: 'baked' };
  return null;
}

function initAutoUpdater(mainWindow) {
  if (!app.isPackaged) return;

  const feed = resolveFeed();
  if (!feed) { console.log('[updater] no update feed configured — auto-update disabled.'); return; }

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

// Current known updater state — so the banner can render correctly even if the
// Dashboard mounts AFTER the event already fired.
function getState() { return { ...lastState, active: Boolean(autoUpdaterRef) }; }

// Quit and install the downloaded update (driven by the banner's "Install" button).
function installDownloadedUpdate() {
  if (!autoUpdaterRef) return { ok: false, error: 'Auto-update is not active in this build.' };
  if (lastState.status !== 'downloaded') return { ok: false, error: 'No update has finished downloading yet.' };
  try { autoUpdaterRef.quitAndInstall(); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

// Manual re-check (optional; the banner can offer "Check again").
function checkForUpdatesNow() {
  if (!autoUpdaterRef) return { ok: false, active: false, error: 'Automatic updates are not enabled in this build.' };
  autoUpdaterRef.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e && e.message));
  return { ok: true, active: true };
}

module.exports = { initAutoUpdater, setEventSink, getState, installDownloadedUpdate, checkForUpdatesNow };
