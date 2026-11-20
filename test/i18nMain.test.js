'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const i18nMain = require('../src/main/i18nMain.js');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('main-process texts follow the app language and fall back to English', () => {
  assert.equal(i18nMain.t('contextMenu.paste', null, 'es'), 'Pegar');
  assert.equal(i18nMain.t('contextMenu.paste', null, 'en'), 'Paste');
  assert.equal(i18nMain.t('contextMenu.paste', null, 'xx'), 'Paste');
  assert.equal(i18nMain.t('no.such.key', null, 'es'), 'no.such.key');
  i18nMain.setLanguage('es-MX');
  assert.equal(i18nMain.getLanguage(), 'es');
  assert.equal(i18nMain.t('dialogs.backupTitle'), 'Copia de seguridad del espacio de trabajo');
  i18nMain.setLanguage('zh-TW');
  assert.equal(i18nMain.getLanguage(), 'zh-Hant');
  i18nMain.setLanguage('nonsense');
  assert.equal(i18nMain.getLanguage(), 'zh-Hant', 'an unknown code keeps the current language');
  i18nMain.setLanguage('en');
});

test('the main namespace lives with the renderer locales and is packaged', () => {
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'main.json'));
  const es = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'es', 'main.json'));
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(keys(es), keys(en));
  assert.ok(require('../package.json').build.files.includes('src/renderer/i18n/locales/*/main.json'));
});

test('the renderer reports its language; dialogs and the context menu use it', () => {
  assert.match(read('src', 'preload', 'preload.js'), /setLanguage: \(code\) => ipcRenderer\.send\(LANGUAGE_CHANNEL, String\(code \|\| ''\)\)/);
  assert.match(read('src', 'preload', 'preload.js'), new RegExp(`const LANGUAGE_CHANNEL = '${i18nMain.LANGUAGE_CHANNEL}';`));
  assert.match(read('src', 'main', 'main.js'), /require\('\.\/i18nMain'\)\.registerLanguageChannel\(ipcMain\);/);
  assert.match(read('src', 'renderer', 'i18n', 'index.js'), /window\.softglaze\?\.ui\?\.setLanguage\?\.\(code\)/);
  const ipc = read('src', 'main', 'ipcHandlers.js');
  assert.doesNotMatch(ipc, /title: '[A-Z][^']+',\s*\n\s*(defaultPath|properties)/, 'no English-only dialog titles');
  assert.equal((ipc.match(/title: i18nMain\.t\('dialogs\./g) || []).length, 8);
  assert.match(read('src', 'main', 'contextMenu.js'), /buildContextTemplate\(params, i18nMain\.getLanguage\(\)/);
});
