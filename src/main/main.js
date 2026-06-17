'use strict';
require('dotenv').config(); // <--- ADD THIS LINE to load your .env file
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, shell, session } = require('electron');
const { configureDatabaseEnv, bootstrapDatabase } = require('./database');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

// --- ORPHANED PROCESS CLEANUP ---
function killOrphanedBrowsers() {
  const PID_FILE = path.join(os.tmpdir(), 'softglaze_active_pids.json');
  if (fs.existsSync(PID_FILE)) {
    try {
      const pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
      console.log(`[Startup] Found ${pids.length} potentially orphaned browser processes. Cleaning up...`);
      
      pids.forEach(pid => {
        try {
          process.kill(pid, 9); // Force kill
        } catch (e) {
          // If process doesn't exist, process.kill throws. We can safely ignore it.
        }
      });
      fs.unlinkSync(PID_FILE); // Clear the file after cleanup
    } catch (e) {
      console.error('[Startup] Failed to cleanup orphaned processes', e);
    }
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
      if (['https:', 'http:', 'mailto:'].includes(parsedUrl.protocol)) shell.openExternal(url);
    } catch {
      // Ignore malformed external URLs.
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = mainWindow.webContents.getURL();
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      if (current.origin !== target.origin) {
        event.preventDefault();
        shell.openExternal(targetUrl);
      }
    } catch {
      event.preventDefault();
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
  await bootstrapDatabase();
  configureSessionSecurity();

  const { registerIpcHandlers } = require('./ipcHandlers');
  registerIpcHandlers();

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try {
    const { shutdownIpcHandlers } = require('./ipcHandlers');
    await shutdownIpcHandlers();
  } catch {
    // App shutdown should not be blocked by cleanup failures.
  }
});