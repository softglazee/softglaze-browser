'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'tools', 'i18n', 'check-locale.mjs')).href);

const EN = {
  title: 'Profiles',
  nested: { save: 'Save {{name}}', link: 'Read <0>the guide</0> now', ref: '$t(common:ok) done' },
  files_one: '{{count}} file',
  files_other: '{{count}} files',
  long: 'This sentence is long enough to be flagged when it is not translated.',
};

function fixture(code, data, { raw } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-i18n-'));
  fs.mkdirSync(path.join(root, 'en'));
  fs.writeFileSync(path.join(root, 'en', 'a.json'), JSON.stringify(EN, null, 2));
  fs.mkdirSync(path.join(root, code));
  fs.writeFileSync(path.join(root, code, 'a.json'), raw !== undefined ? raw : JSON.stringify(data, null, 2));
  return root;
}

const msgs = (r) => r.errors.map((e) => e.msg).join('\n');

test('a correct translation with the language plural forms passes', async () => {
  const { checkLocale } = await load();
  const root = fixture('ru', {
    title: 'Профили',
    nested: { save: 'Сохранить {{name}}', link: 'Прочитайте <0>руководство</0>', ref: '$t(common:ok) готово' },
    files_one: '{{count}} файл', files_few: '{{count}} файла', files_many: '{{count}} файлов', files_other: '{{count}} файла',
    long: 'Это предложение достаточно длинное.',
  });
  const r = checkLocale('ru', { root });
  assert.deepEqual(r.errors, []);
});

test('missing, extra and reordered keys are errors', async () => {
  const { checkLocale } = await load();
  const root = fixture('de', {
    nested: { link: 'Lesen Sie <0>die Anleitung</0>', save: 'Speichern {{name}}', ref: '$t(common:ok) fertig', extra: 'x' },
    title: 'Profile',
    files_one: '{{count}} Datei', files_other: '{{count}} Dateien',
  });
  const out = msgs(checkLocale('de', { root }));
  assert.match(out, /long: missing key/);
  assert.match(out, /nested\.extra: extra key/);
  assert.match(out, /key order differs/);
});

test('plural forms: missing required form is an error, foreign forms are rejected', async () => {
  const { checkLocale } = await load();
  const base = { title: 'Profile', nested: { save: 'x {{name}}', link: '<0>a</0>', ref: '$t(common:ok)' } };
  const long = { long: 'Ein langer Satz hier.' };
  const ru = checkLocale('ru', { root: fixture('ru', { title: 'П', nested: base.nested, files_one: '{{count}} файл', files_other: '{{count}} файла', long: 'Длинное предложение.' }) });
  assert.match(msgs(ru), /missing plural form "few"/);
  assert.match(msgs(ru), /missing plural form "many"/);
  const de = checkLocale('de', { root: fixture('de', { ...base, files_one: '{{count}} Datei', files_few: 'x {{count}}', files_other: '{{count}} Dateien', ...long }) });
  assert.match(msgs(de), /plural form "few" is not used by de/);
  const ja = checkLocale('ja', { root: fixture('ja', { ...base, files_other: '{{count}} 件', ...long }) });
  assert.deepEqual(ja.errors, []);
});

test('placeholders must match exactly', async () => {
  const { checkLocale } = await load();
  const root = fixture('fr', {
    title: 'Profils',
    nested: { save: 'Enregistrer {{nom}}', link: 'Lisez le guide', ref: 'terminé' },
    files_one: '{{count}} fichier', files_many: '{{count}} fichiers', files_other: '{{count}} fichiers',
    long: 'Une phrase.',
  });
  const out = msgs(checkLocale('fr', { root }));
  assert.match(out, /nested\.save: missing placeholder\(s\) \{\{name\}\}/);
  assert.match(out, /nested\.save: unknown placeholder\(s\) \{\{nom\}\}/);
  assert.match(out, /nested\.link: missing placeholder\(s\) <\/0> <0>/);
  assert.match(out, /nested\.ref: missing placeholder\(s\) \$t\(common:ok\)/);
});

test('banned words, empty strings, BOM and broken JSON are errors; untranslated long text warns', async () => {
  const { checkLocale, bannedHits } = await load();
  const root = fixture('es', {
    title: '',
    nested: { save: 'Guardar {{name}} en modo sigiloso', link: '<0>a</0>', ref: '$t(common:ok) navegador antidetect' },
    files_one: '{{count}} archivo', files_many: '{{count}} archivos', files_other: '{{count}} archivos',
    long: EN.long,
  });
  const r = checkLocale('es', { root });
  const out = msgs(r);
  assert.match(out, /title: empty string/);
  assert.match(out, /nested\.save: banned word stealth/);
  assert.match(out, /nested\.ref: banned word antidetect/);
  assert.ok(r.warnings.some((w) => /long: identical to English/.test(w.msg)));

  assert.ok(bannedHits('Ein Anti-Detect-Browser').length);
  assert.ok(bannedHits('Антидетект браузер').length);
  assert.ok(bannedHits('匿名代理').length);
  assert.deepEqual(bannedHits('Banner settings for Bangladesh'), []);
  assert.deepEqual(bannedHits('Unbekannte Bandbreite'), []);

  const bom = checkLocale('es', { root: fixture('es', null, { raw: '﻿{}' }) });
  assert.match(msgs(bom), /BOM/);
  const bad = checkLocale('es', { root: fixture('es', null, { raw: '{"title": ' }) });
  assert.match(msgs(bad), /invalid JSON/);
});

test('missing language files are errors, or warnings with partial', async () => {
  const { checkLocale } = await load();
  const root = fixture('pl', {});
  fs.rmSync(path.join(root, 'pl', 'a.json'));
  assert.match(msgs(checkLocale('pl', { root })), /file missing/);
  assert.deepEqual(checkLocale('pl', { root, partial: true }).errors, []);
});

test('the shipped English and Spanish locales are structurally valid', async () => {
  const { checkLocale } = await load();
  const en = checkLocale('en');
  assert.deepEqual(en.errors, []);
  const es = checkLocale('es');
  assert.deepEqual(es.errors, []);
});
