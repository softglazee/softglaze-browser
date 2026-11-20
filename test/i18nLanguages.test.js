'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const LOCALES = path.join(R, 'i18n', 'locales');
const imp = (...p) => import(pathToFileURL(path.join(R, ...p)).href);
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');

const NS = fs.readdirSync(path.join(LOCALES, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const loadDir = (code) => {
  const out = {};
  const dir = path.join(LOCALES, code);
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* the checker reports it */ }
  }
  return out;
};

test('18 languages with native names; every locale folder is a supported language', async () => {
  const { SUPPORTED_LANGS, LANG_CODES } = await imp('i18n', 'langs.mjs');
  assert.deepEqual([...LANG_CODES].sort(), ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'ja', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-Hans', 'zh-Hant'].sort());
  assert.equal(LANG_CODES[0], 'en');
  const native = Object.fromEntries(SUPPORTED_LANGS.map((l) => [l.code, l.native]));
  assert.equal(native.ar, 'العربية');
  assert.equal(native.ja, '日本語');
  assert.equal(native['zh-Hant'], '繁體中文');
  assert.equal(native['pt-BR'], 'Português (Brasil)');
  for (const d of fs.readdirSync(LOCALES)) {
    if (fs.statSync(path.join(LOCALES, d)).isDirectory()) assert.ok(LANG_CODES.includes(d), `${d} is in SUPPORTED_LANGS`);
  }
});

test('first-run language comes from the OS locale, with Chinese and Portuguese mapping', async () => {
  const { detectLang, matchLang } = await imp('i18n', 'langs.mjs');
  assert.equal(detectLang(['zh-CN']), 'zh-Hans');
  assert.equal(detectLang(['zh-SG']), 'zh-Hans');
  assert.equal(detectLang(['zh']), 'zh-Hans');
  assert.equal(detectLang(['zh-TW']), 'zh-Hant');
  assert.equal(detectLang(['zh-HK']), 'zh-Hant');
  assert.equal(detectLang(['zh-Hant-HK']), 'zh-Hant');
  assert.equal(detectLang(['pt']), 'pt-BR');
  assert.equal(detectLang(['pt-PT']), 'pt-BR');
  assert.equal(detectLang(['de-AT']), 'de');
  assert.equal(detectLang(['es-419']), 'es');
  assert.equal(detectLang(['ur_PK']), 'ur');
  assert.equal(detectLang(['nl-NL', 'fr-CA']), 'fr', 'first supported entry wins');
  assert.equal(detectLang(['nl-NL', 'sv']), 'en', 'unsupported -> English');
  assert.equal(detectLang([]), 'en');
  assert.equal(matchLang('EN-us'), 'en');
});

test('the saved language wins over detection; detection is not saved', () => {
  const idx = read('i18n', 'index.js');
  assert.match(idx, /const v = localStorage\.getItem\(LANG_KEY\);\s*if \(LANG_CODES\.includes\(v\)\) return v;/);
  assert.match(idx, /return detectLang\(navigatorLanguages\(\)\);/);
  assert.doesNotMatch(idx, /localStorage\.setItem/);
  const lang = read('lib', 'lang.js');
  assert.match(lang, /localStorage\.setItem\(LANG_KEY, next\)/);
  assert.match(lang, /switchLanguage\(next\)/);
});

test('English is bundled eagerly, other languages lazily, and the app renders after the start language loads', () => {
  const idx = read('i18n', 'index.js');
  assert.match(idx, /import\.meta\.glob\('\.\/locales\/en\/\*\.json', \{ eager: true, import: 'default' \}\)/);
  assert.match(idx, /import\.meta\.glob\(\['\.\/locales\/\*\/\*\.json', '!\.\/locales\/en\/\*\.json'\], \{ import: 'default' \}\)/);
  assert.match(idx, /fallbackLng: 'en'/);
  assert.match(idx, /partialBundledLanguages: true/);
  assert.match(read('main.jsx'), /i18nReady\.then\(\(\) => \{\s*ReactDOM\.createRoot/);
  // No component bundles a non-English locale file on its own any more.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(R).filter((f) => /\.(jsx?|mjs)$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /from '@\/i18n\/locales\/(?!en\/)/, path.relative(R, f));
    // An English JSON read directly (e.g. GEO_HINTS = cmpSettingsCEn.…) keeps its import.
    for (const [, name] of src.matchAll(/\b([a-z]\w*En)\.\w/g)) {
      if (/locales\/en\//.test(src) || new RegExp(`import ${name}\\b`).test(src)) continue;
      if (!new RegExp(`(const|let|var|function)\\s+${name}\\b|\\b${name}\\s*[,)]|\\(\\s*${name}\\b`).test(src)) assert.fail(`${path.relative(R, f)} uses ${name} without importing it`);
    }
  }
});

test('every supported language with a folder loads into i18next, plurals resolve, missing keys fall back to English', async () => {
  const i18next = (await import('i18next')).default;
  const { SUPPORTED_LANGS } = await imp('i18n', 'langs.mjs');
  const en = loadDir('en');
  for (const { code } of SUPPORTED_LANGS) {
    if (code === 'en' || !fs.existsSync(path.join(LOCALES, code))) continue;
    const res = loadDir(code);
    const inst = i18next.createInstance();
    await inst.init({
      resources: { en, [code]: res }, lng: code, fallbackLng: 'en', ns: NS, defaultNS: 'common',
      partialBundledLanguages: true, load: 'currentOnly', supportedLngs: SUPPORTED_LANGS.map((l) => l.code),
      interpolation: { escapeValue: false }, returnEmptyString: false,
    });
    assert.equal(inst.language, code);
    // A key the language has resolves to its own text.
    for (const ns of Object.keys(res)) {
      const first = Object.entries(res[ns]).find(([, v]) => typeof v === 'string' && v.trim());
      if (first) assert.equal(inst.t(`${ns}:${first[0]}`), first[1], `${code} ${ns}:${first[0]}`);
    }
    // A key it lacks falls back to English.
    inst.addResourceBundle('en', 'common', { __probe: 'English probe' }, true, true);
    assert.equal(inst.t('common:__probe'), 'English probe', `${code} falls back to English`);
    // Plurals: every count resolves to a string (never the raw key).
    if (res.captcha && res.captcha.issues_other) {
      for (const n of [0, 1, 2, 3, 5, 11, 21, 100, 1000000]) {
        const s = inst.t('captcha:issues', { count: n });
        assert.ok(typeof s === 'string' && s && s !== 'issues', `${code} issues count ${n}`);
      }
    }
  }
});

test('i18next resolves the _zero/_two/_few/_many forms through Intl.PluralRules', async () => {
  const i18next = (await import('i18next')).default;
  const inst = i18next.createInstance();
  await inst.init({
    lng: 'ar', fallbackLng: 'en',
    resources: {
      ar: { translation: { n_zero: 'zero', n_one: 'one', n_two: 'two', n_few: 'few', n_many: 'many', n_other: 'other' } },
      ru: { translation: { n_one: 'one', n_few: 'few', n_many: 'many', n_other: 'other' } },
      pl: { translation: { n_one: 'one', n_few: 'few', n_many: 'many', n_other: 'other' } },
    },
  });
  assert.deepEqual([0, 1, 2, 3, 11, 100].map((count) => inst.t('n', { count })), ['zero', 'one', 'two', 'few', 'many', 'other']);
  await inst.changeLanguage('ru');
  assert.deepEqual([1, 2, 5, 21, 1.5].map((count) => inst.t('n', { count })), ['one', 'few', 'many', 'one', 'other']);
  await inst.changeLanguage('pl');
  assert.deepEqual([1, 3, 5, 22].map((count) => inst.t('n', { count })), ['one', 'few', 'many', 'few']);
});

test('Arabic and Urdu set dir="rtl" on <html>; other languages ltr', async () => {
  const { applyDocumentLang, isRtl } = await imp('i18n', 'langs.mjs');
  const attrs = {};
  const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
  applyDocumentLang('ar', doc);
  assert.deepEqual(attrs, { lang: 'ar', dir: 'rtl' });
  applyDocumentLang('ur', doc);
  assert.deepEqual(attrs, { lang: 'ur', dir: 'rtl' });
  applyDocumentLang('ja', doc);
  assert.deepEqual(attrs, { lang: 'ja', dir: 'ltr' });
  assert.ok(isRtl('ar') && isRtl('ur') && !isRtl('he') && !isRtl('en'));
  assert.match(read('i18n', 'index.js'), /i18n\.on\('languageChanged', \(code\) => \{\s*applyDocumentLang\(code\);/);
});

test('dates and numbers follow the app language', async () => {
  const intl = await imp('lib', 'intl.mjs');
  intl.setIntlLanguage('de');
  assert.equal(intl.fmtNumber(1234567.5), '1.234.567,5');
  assert.match(intl.fmtDate('2026-11-20T12:00:00Z'), /20\.11\.2026/);
  intl.setIntlLanguage('ar');
  assert.match(intl.fmtNumber(1234), /^1[,٬]234$/, 'Arabic keeps Western digits');
  intl.setIntlLanguage('th');
  assert.match(intl.fmtDate('2026-11-20T12:00:00Z'), /2026/, 'Thai uses Gregorian years');
  intl.setIntlLanguage('zh-Hant');
  assert.equal(intl.intlLocale(), 'zh-Hant-TW');
  assert.equal(intl.fmtCurrency(29, 'USD', 'en'), '$29.00');
  assert.equal(intl.fmtDate(null), '-');
  assert.equal(intl.fmtDate('not a date'), '-');
  intl.setIntlLanguage('en');
  // Raw OS-locale formatting is gone from the renderer.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(R).filter((f) => /\.(jsx?|mjs)$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\.toLocale(Date|Time)?String\(\)/, `${path.relative(R, f)} formats with the OS locale`);
    assert.doesNotMatch(src, /new Intl\.(DateTimeFormat|NumberFormat)\(undefined/, `${path.relative(R, f)} formats with the OS locale`);
  }
});

test('the language pickers list every language by native name', () => {
  const settings = read('pages', 'SettingsPage.jsx');
  assert.match(settings, /SUPPORTED_LANGS\.map\(\(l\) => \(\s*<option key=\{l\.code\} value=\{l\.code\} lang=\{l\.code\}>\{langOptionLabel\(l\)\}<\/option>/);
  const gate = read('components', 'Gate.jsx');
  assert.match(gate, /const shown = filterLangs\(query\);/);
  assert.match(gate, /max-h-72 overflow-y-auto/);
});
