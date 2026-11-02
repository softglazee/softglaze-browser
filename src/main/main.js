'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, shell, session, protocol, ipcMain } = require('electron');
const { attachContextMenu } = require('./contextMenu');
const { killTrackedOrphans } = require('./orphanCleanup');

// Dev/test only: an unpackaged build may use a separate data folder (Electron on Windows ignores
// APPDATA). Must run before anything reads userData. The app:// scheme below must be registered
// before 'ready' because Chromium will not load module scripts over file://.
if (!app.isPackaged && process.env.SG_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.SG_USER_DATA_DIR));
}

const APP_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// dotenv's default cwd/.env does not exist beside a packaged executable, so try the exe folder,
// then userData, then the project root.
(() => {
  const candidates = [
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getPath('userData'), '.env'),
    path.join(__dirname, '../../.env') // dev (project root)
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { require('dotenv').config({ path: p }); break; } }
    catch { /* ignore and continue */ }
  }
})();

const { configureDatabaseEnv, bootstrapDatabase, isDbEncryptionEnabled, relockEncryptedDb } = require('./database');

// A packaged build never honours NODE_ENV=development: an .env beside the exe could set it and
// open DevTools or load the renderer from localhost.
const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';
let mainWindow = null;
// Guards the graceful-shutdown handshake in `before-quit` (see below) so the
// async cleanup runs exactly once and the real quit is allowed through after.
let isCleaningUp = false;

// Without these, any unhandled rejection or stray exception tears down Electron, and the launched
// puppeteer browsers die with it. Log and keep running instead.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  try {
    if (!isDev) {
      const logPath = path.join(app.getPath('userData'), 'crash-reports.log');
      const time = new Date().toISOString();
      const msg = reason instanceof Error ? reason.stack : String(reason);
      fs.appendFileSync(logPath, `[${time}] [Unhandled Rejection] ${msg}\n`);
    }
  } catch (e) { /* ignore log failure */ }
});
// Circuit breaker: a one-off CDP/puppeteer rejection must not kill the app, but a process throwing
// repeatedly is broken, so after a burst quit cleanly (closing sessions) instead of limping on.
let uncaughtCount = 0;
let uncaughtWindowStart = 0;
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  if (isCleaningUp) return; // teardown legitimately throws - don't trip the breaker
  const now = Date.now();
  if (now - uncaughtWindowStart > 10000) { uncaughtWindowStart = now; uncaughtCount = 0; }
  uncaughtCount += 1;
  if (uncaughtCount >= 8) {
    console.error('[uncaughtException] repeated exceptions in <10s - the main process appears corrupted; quitting cleanly.');
    try { app.quit(); } catch (e) { try { process.exit(1); } catch (e2) {} }
  }
});

// When the app is killed, launched Chrome windows survive but drop out of the PID file, so startup
// also scans command lines for any Chrome whose --user-data-dir is under our profile root. Only
// SoftGlaze profiles match, and it runs before this instance launches any profile.
async function killOrphanedBrowsers() {
  // Each tracked PID is verified first (a browser executable whose command line points at that
  // profile's folder; see orphanCleanup.js), because Windows reuses PIDs after a crash.
  try {
    await killTrackedOrphans();
  } catch (e) {
    console.error('[Startup] Tracked-PID cleanup failed:', e && e.message);
  }
  await killOrphanedBrowsersByCommandLine();
}

function killOrphanedBrowsersByCommandLine() {
  if (process.platform !== 'win32') return Promise.resolve();
  
  return new Promise((resolve) => {
    const { execFile } = require('node:child_process');
    const ps = "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | "
      + "Where-Object { $_.CommandLine -match 'softglaze_profiles' } | "
      + "Select-Object -ExpandProperty ProcessId";
    
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 12000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve();
      
      const pids = [...new Set(stdout.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0))];
      if (!pids.length) return resolve();
      
      console.log(`[Startup] Found ${pids.length} stale Softglaze profile process(es) by command line. Cleaning up...`);
      const args = [];
      pids.forEach((pid) => { args.push('/PID', String(pid)); });
      args.push('/T', '/F');
      
      execFile('taskkill', args, { timeout: 15000, windowsHide: true }, () => resolve());
    });
  });
}

function getPreloadPath() {
  return path.join(__dirname, '../preload/preload.js');
}

// The packaged .exe embeds the icon (build.win.icon); setting it here also covers dev runs.
// Vite copies public/ into dist/, so the packaged path is dist/logos/app.ico.
function getAppIconPath() {
  const candidates = [
    path.join(__dirname, '../../public/logos/app.ico'), // dev (project source)
    path.join(__dirname, '../../dist/logos/app.ico')     // packaged (vite-copied)
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return undefined;
}

// Serve dist/ over app:// with an explicit MIME per extension, because Chromium rejects a module
// script served with the wrong type. Paths that escape dist/ are refused.
const APP_MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.map': 'application/json'
};
function registerAppProtocol() {
  const distDir = path.normalize(path.join(__dirname, '../../dist'));
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const { pathname } = new URL(request.url);
      let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      const full = path.normalize(path.join(distDir, rel));
      if (full !== distDir && !full.startsWith(distDir + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      const data = await fs.promises.readFile(full);
      const ext = path.extname(full).toLowerCase();
      return new Response(data, { headers: { 'content-type': APP_MIME[ext] || 'application/octet-stream' } });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: 'SoftGlaze Browser',
    icon: getAppIconPath(),
    backgroundColor: '#020617',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev
    }
  });

  attachContextMenu(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (['https:', 'http:', 'mailto:'].includes(parsedUrl.protocol)) {
        // openExternal returns a promise; an un-awaited rejection (bad handler,
        // missing app) would surface as an unhandledRejection. Swallow it here.
        shell.openExternal(url).catch((err) => console.error('[window-open] openExternal failed', err));
      }
    } catch {
      // Ignore malformed external URLs.
    }
    return { action: 'deny' };
  });

  // Keep the SPA inside its own origin: same-origin navigations (routing, Vite HMR) pass; anything
  // else is blocked and handed to the system browser. preventDefault must stay synchronous, and the
  // openExternal promise is caught so Electron cannot raise an unhandled rejection.
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      event.preventDefault(); // malformed target - never navigate the shell to it
      return;
    }
    let current = null;
    try { current = new URL(mainWindow.webContents.getURL()); } catch { current = null; }
    if (current && current.origin === target.origin) return; // allow in-app nav

    event.preventDefault();
    if (['http:', 'https:', 'mailto:'].includes(target.protocol)) {
      shell.openExternal(targetUrl).catch((err) => console.error('[will-navigate] openExternal failed', err));
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
  } else {
    // Served via the app:// handler from whenReady, not file://, which cannot load ES-module scripts.
    // Vite's base:'./' resolves assets to app://local/assets/... off this URL.
    mainWindow.loadURL(`${APP_SCHEME}://local/index.html`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setDevicePermissionHandler(() => false);
  // Synchronous permission checks (getUserMedia gating, persistent storage) use a separate hook;
  // the app shell needs none, so deny them like the handlers above.
  session.defaultSession.setPermissionCheckHandler(() => false);
}

// Only one instance may own the workspace: the startup orphan scan kills every Chrome referencing
// softglaze_profiles, so a second instance would kill the first one's live sessions. Without the
// lock, quit before whenReady runs any cleanup; with it, a second launch focuses this one.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // Recreate the window if the app was running in the background with no open windows
    createMainWindow(); 
  }
});
}

app.whenReady().then(async () => {
  // A second instance that lost the lock is quitting: do no cleanup or launch work, since whenReady
  // can race app.quit() above.
  if (!hasSingleInstanceLock) return;
await killOrphanedBrowsers(); // must finish before any profile launches

  configureDatabaseEnv();
  // With at-rest encryption on, the DB file is ciphertext, so bootstrap waits for the db:unlock
  // handler (the pre-Gate "Unlock Database" screen).
  if (!isDbEncryptionEnabled()) {
    await bootstrapDatabase();
  } else {
    console.log('[Startup] Database is encrypted - deferring open until unlocked.');
  }
  configureSessionSecurity();

  const { registerIpcHandlers, attemptRememberedUnlock, whenSessionReady } = require('./ipcHandlers');
  registerIpcHandlers();
  // Hand keyboard focus back after native confirm()/alert() dialogs (see dialogFocus.js).
  require('./dialogFocus').registerDialogRefocus(ipcMain, () => mainWindow);

  // 1st: wait for the saved member session to restore before the window loads.
try {
    await whenSessionReady();
  } catch (e) {
    console.warn('[Startup] session restore wait failed:', e && e.message);
  }

  // 2nd: "Keep me signed in": replay the DPAPI-sealed credential so the DB and vault gates open
  // without a prompt. A stale credential self-clears. Runs at process start only, not on manual lock.
  try {
    await attemptRememberedUnlock();
  } catch (e) {
    console.warn('[Startup] remembered auto-login failed:', e && e.message);
  }

  // Wire the app:// file server before the window loads its URL.
  registerAppProtocol();

  createMainWindow();

  // Off unless the build is packaged, code-signed and has an update feed (see updater.js). Starts a
  // few seconds after launch so it never delays the window.
  setTimeout(() => {
    require('./updater').initAutoUpdater(mainWindow)
      .catch((e) => console.warn('[updater] init failed:', e && e.message));
  }, 8000);

  // In the background so the window opens at once: seed the recommended extensions, then reconcile
  // (re-enabling ones left off by an older `enable:false` default) once the seed has installed them.
  {
    const extMgr = require('./extensionManager');
    // Earlier builds force-installed the recorder into every Chromium on the machine
    // through a per-user registry policy. Remove any value they left (Windows only).
    require('./policyCleanup').removeLegacyExtensionForcelist({ extensionId: extMgr.SOFTGLAZE_RECORDER_ID })
      .catch((e) => console.warn('[policy-cleanup] failed:', e && e.message));
    // Independent of the seed chain so a seed failure can't skip it: delete any
    // extension earlier builds seeded but no longer should (runs once).
    extMgr.removeRetiredExtensions()
      .catch((e) => console.warn('[ext-retire] retired extension cleanup failed:', e && e.message));
    extMgr.seedRecommendedExtensions()
      .then(() => extMgr.reconcileRecommendedExtensions())
      .catch((e) => console.warn('[ext-seed] recommended extension seed/reconcile failed:', e && e.message));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Electron does not await async `before-quit` listeners, so the app could exit mid-flush and corrupt
// SQLite. Cancel the first quit, finish cleanup, then quit again (isCleaningUp lets it through).
app.on('before-quit', async (event) => {
  if (isCleaningUp) return; // second pass - allow the real quit
  event.preventDefault();
  isCleaningUp = true;

  const cleanupTasks = async () => {
    try {
      const { shutdownIpcHandlers } = require('./ipcHandlers');
      await shutdownIpcHandlers(); // stops schedulers/API/sessions and disconnects Prisma
    } catch (err) {
      console.error('[before-quit] IPC shutdown failed', err);
    }

    try {
      const { disconnectPrisma } = require('./database');
      await disconnectPrisma();
    } catch (err) {
      console.error('[before-quit] Prisma disconnect failed', err);
    }

    try {
      await relockEncryptedDb();
    } catch (err) {
      console.error('[before-quit] DB re-encryption failed', err);
    }
  };

  // If cleanup hangs, force close after 5 seconds.
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  
  await Promise.race([cleanupTasks(), timeout]);

  app.quit();
});