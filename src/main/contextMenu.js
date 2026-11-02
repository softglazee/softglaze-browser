'use strict';
// Right-click menu: Electron has none by default. Actions use Chromium's edit roles, and editFlags
// decides what is enabled, so password fields still refuse Copy and Cut.

const LABELS = Object.freeze({
  en: { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', copyLink: 'Copy link' },
  es: { undo: 'Deshacer', redo: 'Rehacer', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', selectAll: 'Seleccionar todo', copyLink: 'Copiar enlace' }
});

function labelsFor(locale) {
  return String(locale || '').toLowerCase().startsWith('es') ? LABELS.es : LABELS.en;
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
  const { app, BrowserWindow, Menu, clipboard } = require('electron');
  webContents.on('context-menu', (_event, params) => {
    const window = BrowserWindow.fromWebContents(webContents);
    if (!window) return;
    const template = buildContextTemplate(params, app.getLocale(), (text) => clipboard.writeText(text));
    Menu.buildFromTemplate(template).popup({
      window,
      // Hand the keyboard back to the page once the native menu closes.
      callback: () => { if (!webContents.isDestroyed()) webContents.focus(); }
    });
  });
}

module.exports = { buildContextTemplate, attachContextMenu };
