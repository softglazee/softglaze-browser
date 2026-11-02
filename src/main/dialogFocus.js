'use strict';
// On Windows, Electron can leave a window without keyboard focus after a native alert/confirm/prompt
// (electron/electron#41603): clicks land but typing does not. Blurring and re-focusing the window
// and its page restores input; the renderer asks for this after each dialog.

const REFOCUS_CHANNEL = 'window:refocus-after-dialog';

function refocusAfterDialog(win) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
  try { win.blur(); } catch (e) { /* ignore */ }
  try { win.focus(); } catch (e) { /* ignore */ }
  try {
    const wc = win.webContents;
    if (wc && !(typeof wc.isDestroyed === 'function' && wc.isDestroyed())) wc.focus();
  } catch (e) { /* ignore */ }
  return true;
}

// Only the app's own window may ask; a message from any other sender is ignored.
function registerDialogRefocus(ipcMain, getWindow) {
  ipcMain.on(REFOCUS_CHANNEL, (event) => {
    const win = getWindow();
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return;
    if (!event || event.sender !== win.webContents) return;
    refocusAfterDialog(win);
  });
}

module.exports = { REFOCUS_CHANNEL, refocusAfterDialog, registerDialogRefocus };
