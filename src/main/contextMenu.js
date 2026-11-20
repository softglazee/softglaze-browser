'use strict';
// Right-click menu: Electron has none by default. Actions use Chromium's edit roles, and editFlags
// decides what is enabled, so password fields still refuse Copy and Cut.

// Labels come from locales/<lang>/main.json (contextMenu.*) in the app language.
const i18nMain = require('./i18nMain');

const KEYS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'copyLink'];

function labelsFor(locale) {
  return Object.fromEntries(KEYS.map((k) => [k, i18nMain.t(`contextMenu.${k}`, null, locale || 'en')]));
}

// Pure, so the rules can be tested without Electron. `copyText` handles the link item.
function buildContextTemplate(params = {}, locale = 'en', copyText = () => {}) {
  const l = labelsFor(locale);
  const flags = params.editFlags || {};
  const editable = Boolean(params.isEditable);
  const template = [];

  if (editable) {
    template.push(
      { label: l.undo, role: 'undo', enabled: Boolean(flags.canUndo) },
      { label: l.redo, role: 'redo', enabled: Boolean(flags.canRedo) },
      { type: 'separator' }
    );
  }
  template.push(
    { label: l.cut, role: 'cut', enabled: editable && Boolean(flags.canCut) },
    { label: l.copy, role: 'copy', enabled: Boolean(flags.canCopy) },
    { label: l.paste, role: 'paste', enabled: editable && Boolean(flags.canPaste) },
    { type: 'separator' },
    { label: l.selectAll, role: 'selectAll', enabled: flags.canSelectAll !== false }
  );

  const link = String(params.linkURL || '');
  if (/^(https?:|mailto:)/i.test(link)) {
    template.push({ type: 'separator' }, { label: l.copyLink, click: () => copyText(link) });
  }
  return template;
}

function attachContextMenu(webContents) {
  const { BrowserWindow, Menu, clipboard } = require('electron');
  webContents.on('context-menu', (_event, params) => {
    const window = BrowserWindow.fromWebContents(webContents);
    if (!window) return;
    const template = buildContextTemplate(params, i18nMain.getLanguage(), (text) => clipboard.writeText(text));
    Menu.buildFromTemplate(template).popup({
      window,
      // Hand the keyboard back to the page once the native menu closes.
      callback: () => { if (!webContents.isDestroyed()) webContents.focus(); }
    });
  });
}

module.exports = { buildContextTemplate, attachContextMenu };
