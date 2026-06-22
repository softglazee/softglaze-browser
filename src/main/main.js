'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, shell, session } = require('electron');

// Load .env from the locations that actually exist in a packaged build.
// dotenv's default (cwd/.env) does NOT exist next to a packaged executable,
// so SMTP and other env vars would silently be undefined in production.
// We try, in order: an .env beside the executable, and one in userData.
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

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
// Guards the graceful-shutdown handshake in `before-quit` (see below) so the
// async cleanup runs exactly once and the real quit is allowed through after.
let isCleaningUp = false;

// CRITICAL safety net: without these, ANY unhandled promise rejection or stray
// exception in the main process tears down Electron — and because the launched
// profile browsers are puppeteer child processes, they die with it ("the browser
// closes by itself" when opening a new tab). Log and keep running instead.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// --- ORPHANED PROCESS CLEANUP ---
// Stale profile windows are a real trap: when the app is killed (e.g. Ctrl+C in
// dev) the launched Chrome windows survive, but puppeteer's 'disconnected' handler
// removes their PIDs from the tracking file during teardown — so they become
// UNTRACKED orphans that the PID-file cleanup can never find. They keep running the
// OLD fingerprint injection, and re-testing one looks like "the fix didn't work".
// We therefore clean up in TWO ways on startup: the PID file (fast path) AND a
// command-line scan that finds any Chrome whose --user-data-dir is under our profile
// root, regardless of whether it was ever tracked. The scan only matches Softglaze
// profile processes, so the user's personal Chrome is never touched, and it runs
// before any profile of THIS instance launches, so it can't kill a live session.
function killOrphanedBrowsers() {
  const PID_FILE = path.join(os.tmpdir(), 'softglaze_active_pids.json');
  if (fs.existsSync(PID_FILE)) {
    try {
      const pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
      if (pids.length) {
        console.log(`[Startup] Found ${pids.length} tracked browser process(es). Cleaning up...`);
        pids.forEach(pid => { try { process.kill(pid, 9); } catch (e) { /* already gone */ } });
      }
      fs.unlinkSync(PID_FILE); // Clear the file after cleanup
    } catch (e) {
      console.error('[Startup] Failed to cleanup tracked processes', e);
    }
  }
  killOrphanedBrowsersByCommandLine();
}

// Force-kill any Chrome whose command line references our per-profile data dir
// (the path always contains "softglaze_profiles"). Catches the untracked orphans
// the PID file misses. Windows-only; a no-op (and harmless) elsewhere.
function killOrphanedBrowsersByCommandLine() {
  if (process.platform !== 'win32') return;
  try {
    const { execFileSync } = require('node:child_process');
    const ps = "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | "
      + "Where-Object { $_.CommandLine -match 'softglaze_profiles' } | "
      + "Select-Object -ExpandProperty ProcessId";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: 12000, windowsHide: true });
    const pids = [...new Set(out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0))];
    if (!pids.length) return;
    console.log(`[Startup] Found ${pids.length} stale Softglaze profile process(es) by command line. Cleaning up...`);
    const args = [];
    pids.forEach((pid) => { args.push('/PID', String(pid)); });
    args.push('/T', '/F');
    try { execFileSync('taskkill', args, { timeout: 15000, windowsHide: true, stdio: 'ignore' }); } catch (e) { /* some PIDs may already be gone */ }
  } catch (e) {
    console.error('[Startup] Command-line orphan scan failed', e);
  }
}
// --------------------------------

function getPreloadPath() {
  return path.join(__dirname, '../preload/preload.js');
}

function getProductionIndexPath() {
  return path.join(__dirname, '../../dist/index.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: 'SoftGlaze Browser',
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

  // Keep the SPA penned inside its own origin: same-origin navigations (in-app
  // routing + Vite HMR) pass through; anything else is blocked and handed to the
  // system browser. Validation + preventDefault are fully synchronous, and the
  // only async call (openExternal) is caught so newer Electron can't raise an
  // unhandled promise rejection here.
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      event.preventDefault(); // malformed target — never navigate the shell to it
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
    mainWindow.loadFile(getProductionIndexPath());
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setDevicePermissionHandler(() => false);
}

app.whenReady().then(async () => {
  // Always clean up orphaned processes before starting
  killOrphanedBrowsers();

  configureDatabaseEnv();
  // When at-rest encryption is on, the DB file is ciphertext and cannot be opened
  // until the user unlocks it. Defer bootstrap to the `db:unlock` handler (driven
  // by the pre-Gate "Unlock Database" screen). With encryption off this is the
  // unchanged boot path.
  if (!isDbEncryptionEnabled()) {
    await bootstrapDatabase();
  } else {
    console.log('[Startup] Database is encrypted — deferring open until unlocked.');
  }
  configureSessionSecurity();

  const { registerIpcHandlers } = require('./ipcHandlers');
  registerIpcHandlers();

  createMainWindow();

  // One-time, best-effort: auto-install the recommended team extensions
  // (download + unzip) in the background so the window opens immediately.
  require('./extensionManager').seedRecommendedExtensions().catch((e) => {
    console.warn('[ext-seed] recommended extension seeding failed:', e && e.message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Graceful shutdown handshake. Electron does NOT await async `before-quit`
// listeners — the app would exit mid-flush, risking a corrupt SQLite file. So on
// the first pass we cancel the quit, run cleanup to completion, then re-issue the
// quit (the `isCleaningUp` guard lets the second pass straight through).
app.on('before-quit', async (event) => {
  if (isCleaningUp) return; // second pass — allow the real quit
  event.preventDefault();
  isCleaningUp = true;

  try {
    const { shutdownIpcHandlers } = require('./ipcHandlers');
    await shutdownIpcHandlers(); // stops schedulers/API/sessions and disconnects Prisma
  } catch (err) {
    console.error('[before-quit] IPC shutdown failed', err);
  }

  try {
    // Belt-and-suspenders: guarantee the DB handle is closed even if the step
    // above bailed before reaching its own disconnect. disconnectPrisma is
    // idempotent (no-ops once the client is null), so a double call is safe.
    const { disconnectPrisma } = require('./database');
    await disconnectPrisma();
  } catch (err) {
    console.error('[before-quit] Prisma disconnect failed', err);
  }

  try {
    // If at-rest encryption is on and the DB was unlocked this session, fold the
    // working file back into ciphertext and shred the plaintext, so nothing
    // readable is left on disk once the app exits. No-op when encryption is off or
    // the DB was never unlocked.
    await relockEncryptedDb();
  } catch (err) {
    console.error('[before-quit] DB re-encryption failed', err);
  }

  app.quit();
});