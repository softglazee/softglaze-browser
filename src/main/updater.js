'use strict';

const { app, dialog } = require('electron');

// Auto-update via electron-updater.
//
// This is INERT until all of the following are true:
//   1. The app is packaged (app.isPackaged) — never runs in dev.
//   2. `electron-updater` is installed (npm install picks it up).
//   3. `build.publish` is configured in package.json and a release with the
//      matching latest.yml/blockmap has been published to that provider.
//   4. Builds are code-signed (unsigned auto-updates are blocked on Windows).
//
// Until then it logs and no-ops, so it can ship safely.
function initAutoUpdater(mainWindow) {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.warn('[updater] electron-updater not installed; auto-update disabled.');
    return;
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
