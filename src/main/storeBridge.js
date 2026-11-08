'use strict';
// Loads the Microsoft Store addon (resources/store-native/softglaze_store.node, built from
// native/store-addon by scripts/build-store-native.js) and calls it. Only the Store package ships the
// addon, and it is loaded only when process.windowsStore is true: Electron sets that when the app runs
// as an MSIX/AppX package ("If the app is running as an MSIX package (including AppX for Windows
// Store), this property is true, otherwise it is undefined", electronjs.org/docs/latest/api/process).
// Website and base builds never load it, so they behave exactly as before.
//
// call(cmd, opts) always resolves with an object: the addon's JSON, or { ok: false, error } when the
// addon is missing, times out or fails. It never throws.
const fs = require('node:fs');
const path = require('node:path');

// A purchase waits for the customer in Microsoft's dialog; everything else is quick.
const TIMEOUT_MS = Object.freeze({ ping: 5000, license: 30000, products: 30000, keys: 30000, purchase: 15 * 60000 });

let addon; // undefined = not tried yet, null = unavailable
let loadError = null;
let override = null; // tests

function isStoreInstall() {
  if (override && typeof override.isStoreInstall === 'boolean') return override.isStoreInstall;
  return process.platform === 'win32' && process.windowsStore === true;
}

function addonPath() {
  if (process.env.SG_STORE_ADDON) return process.env.SG_STORE_ADDON;
  return process.resourcesPath ? path.join(process.resourcesPath, 'store-native', 'softglaze_store.node') : null;
}

function load() {
  if (override && 'addon' in override) return override.addon;
  if (addon !== undefined) return addon;
  addon = null;
  if (!isStoreInstall()) return addon;
  const p = addonPath();
  try {
    if (p && fs.existsSync(p)) addon = require(p);
    else loadError = 'The Microsoft Store purchase component is missing from this package.';
  } catch (e) {
    loadError = String((e && e.message) || e).slice(0, 300);
    addon = null;
  }
  return addon;
}

function available() { return isStoreInstall() && Boolean(load()); }

async function call(cmd, opts = {}) {
  if (!isStoreInstall()) return { ok: false, error: 'not_store_build', message: 'Microsoft Store purchases are only in the Microsoft Store version of the app.' };
  const a = load();
  if (!a || typeof a.call !== 'function') return { ok: false, error: 'addon_unavailable', message: loadError || 'The Microsoft Store purchase component is not available.' };
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), TIMEOUT_MS[cmd] || 30000); });
    const text = await Promise.race([a.call(String(cmd), opts && typeof opts === 'object' ? opts : {}), timeout]);
    const json = JSON.parse(String(text));
    return json && typeof json === 'object' ? json : { ok: false, error: 'bad_reply' };
  } catch (e) {
    if (e && e.timeout) return { ok: false, error: 'timeout', message: 'The Microsoft Store did not answer in time.' };
    return { ok: false, error: 'bridge_error', message: String((e && e.message) || e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

// The HWND of a BrowserWindow as a decimal string, for IInitializeWithWindow. getNativeWindowHandle()
// "Returns Buffer ... HWND on Windows" (electronjs.org/docs/latest/api/browser-window).
function windowHandle(win) {
  try {
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return '';
    const buf = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(buf)) return '';
    if (buf.length >= 8) return buf.readBigUInt64LE(0).toString();
    if (buf.length >= 4) return String(buf.readUInt32LE(0));
  } catch (_) { /* no window */ }
  return '';
}

// Test seam: { isStoreInstall?: boolean, addon?: { call(cmd, opts) -> Promise<string> } | null }; null resets.
function _setForTests(o) { override = o || null; addon = undefined; loadError = null; }

module.exports = { isStoreInstall, available, call, windowHandle, TIMEOUT_MS, _setForTests };
