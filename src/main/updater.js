'use strict';

const { app, dialog } = require('electron');
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
// Note: on Windows, electron-updater verifies the downloaded installer's Authenticode
// signature, so updates are only safe on CODE-SIGNED builds (see docs/signing-and-updates.md).
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

  if (feed.kind === 'generic') {
    try { autoUpdater.setFeedURL({ provider: 'generic', url: feed.url }); }
    catch (e) { console.error('[updater] invalid update feed URL; auto-update disabled:', e && e.message); return; }
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => console.error('[updater] error:', (err && err.message) || err));
  autoUpdater.on('update-available', (info) => console.log('[updater] update available:', info && info.version));
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date.'));
  autoUpdater.on('update-downloaded', async (info) => {
    try {
      const res = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: `SoftGlaze ${(info && info.version) || ''} has been downloaded.`,
        detail: 'Restart the app to apply the update.'
      });
      if (res.response === 0) autoUpdater.quitAndInstall();
    } catch (e) {
      console.error('[updater] prompt failed:', e.message);
    }
  });

  autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e && e.message));
}

module.exports = { initAutoUpdater };
