'use strict';
// Keyboard focus after native dialogs.
//
// Reported 28 Oct: after deleting a profile or proxy, or emptying the trash, every
// input in the app stopped taking typing, even when the delete was cancelled. Every
// one of those actions asks with window.confirm(), and on Windows Electron can leave
// the window without keyboard focus once a native dialog closes
// (electron/electron#41603, #31917). The fix wraps alert/confirm/prompt in the
// renderer and has the main process blur + re-focus the window after each one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { REFOCUS_CHANNEL, refocusAfterDialog, registerDialogRefocus } = require('../src/main/dialogFocus');
const loadFix = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'dialogFocusFix.mjs')).href);

function fakeWindow({ destroyed = false } = {}) {
  const calls = [];
  const webContents = { focus: () => calls.push('page.focus'), isDestroyed: () => false };
  return {
    calls,
    webContents,
    isDestroyed: () => destroyed,
    blur: () => calls.push('blur'),
    focus: () => calls.push('focus')
  };
}

test('refocus blurs the window, focuses it, then focuses its page', () => {
  const win = fakeWindow();
  assert.equal(refocusAfterDialog(win), true);
  assert.deepEqual(win.calls, ['blur', 'focus', 'page.focus']);
});

test('refocus is a no-op for a missing or destroyed window', () => {
  assert.equal(refocusAfterDialog(null), false);
  const gone = fakeWindow({ destroyed: true });
  assert.equal(refocusAfterDialog(gone), false);
  assert.deepEqual(gone.calls, []);
});

test('only the app window itself can ask for a refocus', () => {
  const win = fakeWindow();
  let listener = null;
  const ipcMain = { on: (channel, fn) => { assert.equal(channel, REFOCUS_CHANNEL); listener = fn; } };
  registerDialogRefocus(ipcMain, () => win);
  assert.equal(typeof listener, 'function');

  listener({ sender: { id: 'some-other-page' } });
  assert.deepEqual(win.calls, [], 'a message from another sender is ignored');

  listener({ sender: win.webContents });
  assert.deepEqual(win.calls, ['blur', 'focus', 'page.focus']);
});

test('confirm still returns what the user chose, and refocus runs after it', async () => {
  const { installDialogFocusFix } = await loadFix();
  const order = [];
  let answer = false;
  const target = {
    confirm: (msg) => { order.push('confirm:' + msg); return answer; },
    alert: () => { order.push('alert'); }
  };
  assert.equal(installDialogFocusFix(target, () => order.push('refocus')), true);

  assert.equal(target.confirm('Delete?'), false, 'Cancel still cancels');
  answer = true;
  assert.equal(target.confirm('Delete?'), true, 'OK still confirms');
  target.alert('done');
  assert.deepEqual(order, ['confirm:Delete?', 'refocus', 'confirm:Delete?', 'refocus', 'alert', 'refocus']);
});

test('refocus runs even if the dialog throws, and a refocus failure never breaks the dialog', async () => {
  const { installDialogFocusFix } = await loadFix();
  let refocused = 0;
  const target = { confirm: () => { throw new Error('boom'); }, alert: () => 'ok' };
  installDialogFocusFix(target, () => { refocused += 1; throw new Error('bridge missing'); });
  assert.throws(() => target.confirm('x'), /boom/);
  assert.equal(target.alert('y'), 'ok');
  assert.equal(refocused, 2);
});

test('installing twice does not wrap the dialogs twice', async () => {
  const { installDialogFocusFix } = await loadFix();
  let refocused = 0;
  const target = { confirm: () => true };
  assert.equal(installDialogFocusFix(target, () => { refocused += 1; }), true);
  assert.equal(installDialogFocusFix(target, () => { refocused += 1; }), false);
  target.confirm('x');
  assert.equal(refocused, 1);
});

test('the preload bridge sends the refocus message on the channel main listens to', () => {
  const sent = [];
  let api = null;
  const PRELOAD = path.join(ROOT, 'src', 'preload', 'preload.js');
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_name, exposed) => { api = exposed; } },
        ipcRenderer: { invoke: () => {}, on: () => {}, removeListener: () => {}, send: (ch) => sent.push(ch) }
      };
    }
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(PRELOAD)];
    require(PRELOAD);
  } finally {
    Module._load = orig;
  }
  assert.equal(typeof api?.ui?.refocusAfterDialog, 'function');
  api.ui.refocusAfterDialog();
  assert.deepEqual(sent, [REFOCUS_CHANNEL]);
});

test('main registers the listener and the renderer installs the wrapper at startup', () => {
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSrc, /require\('\.\/dialogFocus'\)\.registerDialogRefocus\(ipcMain,\s*\(\)\s*=>\s*mainWindow\)/);
  const entry = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main.jsx'), 'utf8');
  assert.match(entry, /installDialogFocusFix\(window,/);
  assert.match(entry, /softglaze\?\.ui\?\.refocusAfterDialog/);
});
