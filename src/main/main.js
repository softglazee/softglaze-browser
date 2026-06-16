'use strict';

const path = require('node:path');
const { app, BrowserWindow, shell, session } = require('electron');
const { configureDatabaseEnv, bootstrapDatabase } = require('./database');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

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
