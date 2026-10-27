'use strict';
// Keyboard focus after native dialogs.
//
// On Windows, Electron can leave a window without keyboard focus once a native
// alert()/confirm()/prompt() closes (electron/electron#41603, #41602, #31917).
// Clicks still land, but typing goes nowhere until the window is re-focused from
// the OS (Alt+Tab away and back). The app confirms every delete with
// window.confirm(), so after one of those (OK or Cancel) every input in the app
// looked stuck. Blurring and re-focusing the window, then its page, hands the
// keyboard back. The renderer asks for this right after each dialog returns.

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
