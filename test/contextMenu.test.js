'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildContextTemplate } = require('../src/main/contextMenu.js');

const item = (t, role) => t.find((i) => i.role === role);
const ALL = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

test('an input field offers undo, redo, cut, copy, paste and select all', () => {
  const t = buildContextTemplate({ isEditable: true, editFlags: ALL });
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.equal(item(t, role).enabled, true, role);
  }
});

test('plain page text can be copied but not cut or pasted', () => {
  const t = buildContextTemplate({ isEditable: false, selectionText: 'abc', editFlags: { canCopy: true, canCut: true, canPaste: true } });
  assert.equal(item(t, 'copy').enabled, true);
  assert.equal(item(t, 'cut').enabled, false);
  assert.equal(item(t, 'paste').enabled, false);
  assert.equal(item(t, 'undo'), undefined);
});

test('a password field keeps Copy and Cut disabled, because Chromium reports them off', () => {
  const t = buildContextTemplate({ isEditable: true, editFlags: { ...ALL, canCopy: false, canCut: false } });
  assert.equal(item(t, 'copy').enabled, false);
  assert.equal(item(t, 'cut').enabled, false);
  assert.equal(item(t, 'paste').enabled, true);
});

test('only web links get a Copy link item, and it copies that link', () => {
  let copied = '';
  const t = buildContextTemplate({ linkURL: 'https://softglaze.com/', editFlags: {} }, 'en', (x) => { copied = x; });
  t.find((i) => i.label === 'Copy link').click();
  assert.equal(copied, 'https://softglaze.com/');
  const internal = buildContextTemplate({ linkURL: 'javascript:alert(1)', editFlags: {} });
  assert.equal(internal.some((i) => i.label === 'Copy link'), false);
});

test('labels follow the language', () => {
  assert.equal(item(buildContextTemplate({ editFlags: {} }, 'es-ES'), 'paste').label, 'Pegar');
  assert.equal(item(buildContextTemplate({ editFlags: {} }, 'de'), 'paste').label, 'Paste');
});

test('the main window uses the menu', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /attachContextMenu\(mainWindow\.webContents\)/);
});
