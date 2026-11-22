'use strict';
// The English-only leftovers of the 18-language pack: leak check rows, AI tool and prompt titles, the
// update banner, Start Page Links, the error page and the crash toasts now go through i18n, and Urdu
// can use the bundled Nastaliq font.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const LOCALES = path.join(ROOT, 'src', 'renderer', 'i18n', 'locales');
const locale = (code, ns) => JSON.parse(fs.readFileSync(path.join(LOCALES, code, `${ns}.json`), 'utf8'));
const CODES = ['en', 'es', 'ar', 'de', 'fr', 'id', 'pt-BR', 'ru', 'tr', 'ur', 'vi', 'zh-Hans', 'zh-Hant', 'ja', 'th', 'uk', 'hi', 'pl'];

const { deviceGpuCoherence } = require('../src/main/fingerprintGenerator');

test('every leak check detail key main can send has English text, in every language', () => {
  const ipc = read('src', 'main', 'ipcHandlers.js');
  const start = ipc.indexOf('async function analyzeProfileLeaks(');
  const live = ipc.indexOf('async function liveProfileLeak(');
  const body = ipc.slice(start, ipc.indexOf('// ---- Cookie import/export ----')) + ipc.slice(live, ipc.indexOf('// ---- CAPTCHA score ----'));
  const keys = new Set();
  for (const m of body.matchAll(/detailKey: ([^\n]+)/g)) for (const q of m[1].matchAll(/'([A-Za-z.]+)'/g)) keys.add(q[1]);
  assert.ok(keys.size >= 30, `found ${keys.size} detail keys`);
  // GPU coherence codes reach the UI as device.<code>.
  const gpu = read('src', 'main', 'fingerprintGenerator.js');
  for (const m of gpu.matchAll(/code: (?:api\.metal \? )?'(\w+)'(?: : '(\w+)')?/g)) { keys.add(`device.${m[1]}`); if (m[2]) keys.add(`device.${m[2]}`); }
  assert.ok(keys.has('device.windowsMesa') && keys.has('device.desktopOk'));
  for (const code of CODES) {
    const details = locale(code, 'cmpModalsA').leakCheck.details;
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o ? o[p] : undefined), details);
      assert.equal(typeof v, 'string', `${code}: leakCheck.details.${k}`);
    }
  }
});

test('GPU coherence results carry a code with the English detail', () => {
  const cases = [
    [{ os: 'macOS', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, 'macD3d'],
    [{ os: 'Windows', webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' }, 'windowsMetal'],
    [{ os: 'Windows', webglRenderer: 'Mesa Intel(R) UHD Graphics 620' }, 'windowsMesa'],
    [{ os: 'Windows', webglRenderer: '' }, 'noRenderer'],
    [{ os: 'Windows', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, 'desktopOk'],
  ];
  for (const [input, code] of cases) {
    const r = deviceGpuCoherence(input);
    assert.equal(r.code, code, JSON.stringify(input));
    assert.equal(typeof r.detail, 'string');
  }
});

test('the leak check dialog shows translated labels, details, grades and badges', () => {
  const src = read('src', 'renderer', 'components', 'LeakCheckModal.jsx');
  assert.match(src, /t\(`leakCheck\.checks\.\$\{c\.labelKey \|\| c\.key\}`/);
  assert.match(src, /t\(`leakCheck\.details\.\$\{c\.detailKey\}`/);
  assert.match(src, /t\(`leakCheck\.grades\.\$\{score\.grade\}`/);
  assert.match(src, /t\(`leakCheck\.status\.\$\{c\.status\}`/);
  assert.doesNotMatch(src, />\{c\.label\}</);
});

test('every AI tool and prompt has a UI title in every language', () => {
  const names = [];
  for (const f of ['tools.js', 'pageTools.js']) {
    for (const m of read('src', 'main', 'ai', f).matchAll(/^\s+name: '([a-z_]+)',\s*\n\s+title: '/gm)) names.push(m[1]);
  }
  assert.ok(names.length >= 40, `found ${names.length} tools`);
  const prompts = require('../src/main/ai/prompts.js').PROMPTS.map((p) => p.name);
  for (const code of CODES) {
    const ai = locale(code, 'ai');
    for (const n of names) assert.equal(typeof ai.tools[n], 'string', `${code}: tools.${n}`);
    for (const p of prompts) {
      assert.equal(typeof ai.prompts.items[p].title, 'string', `${code}: prompts.items.${p}.title`);
      assert.equal(typeof ai.prompts.items[p].description, 'string', `${code}: prompts.items.${p}.description`);
    }
  }
  assert.match(read('src', 'renderer', 'components', 'ai', 'AiActivityTab.jsx'), /toolTitle\(t, it\.tool\)/);
  assert.match(read('src', 'renderer', 'components', 'ai', 'AiApprovalDialog.jsx'), /toolTitle\(t, approval\.tool\)/);
  assert.match(read('src', 'renderer', 'components', 'ai', 'AiPromptsTab.jsx'), /prompts\.items\.\$\{p\.name\}\.title/);
});

test('no hard-coded English is left in the touched renderer files', () => {
  const checks = [
    ['pages/StartLinksPage.jsx', [/> Saved</, /} Save\b/, /> Auto-label</, /> Add all</, /Bulk add</, /placeholder="Label"/, /'Could not save\.'/, /Added \$\{/]],
    ['pages/DashboardPage.jsx', [/'Checking for updates/, /Install &amp; restart/, /"What's new"/, /aria-label="Dismiss update notice"/, /Update download failed/]],
    ['components/ErrorBoundary.jsx', [/Something went wrong/, /Try again/]],
    ['components/ResilienceToasts.jsx', [/stopped unexpectedly/, /Low memory/]],
    ['pages/SettingsPage.jsx', [/aria-label="Settings sections"/, /aria-label="Sections"/]],
    ['pages/ProfilesPage.jsx', [/title="Toggle the native fingerprint engine/]],
  ];
  for (const [file, patterns] of checks) {
    const src = read('src', 'renderer', ...file.split('/'));
    for (const re of patterns) assert.doesNotMatch(src, re, `${file}: ${re}`);
  }
});

test('Urdu Nastaliq: bundled under the OFL, lazy, and applied only to Urdu', () => {
  const dir = path.join(ROOT, 'src', 'renderer', 'assets', 'fonts', 'noto-nastaliq-urdu');
  const ofl = fs.readFileSync(path.join(dir, 'OFL.txt'), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(ofl, /The Noto Project Authors/);
  const font = fs.readFileSync(path.join(dir, 'NotoNastaliqUrdu-wght.woff2'));
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');

  const lib = read('src', 'renderer', 'lib', 'urduFont.js');
  // Only the URL is imported; the face is fetched when FontFace.load() runs for Urdu + Nastaliq.
  assert.match(lib, /NotoNastaliqUrdu-wght\.woff2\?url'/);
  assert.match(lib, /if \(lang === 'ur' && choice === 'nastaliq'\) \{\s*loadNastaliq\(doc\);/);
  assert.match(read('src', 'renderer', 'i18n', 'index.js'), /applyUrduFont\(code\);/);
  assert.doesNotMatch(read('src', 'renderer', 'main.jsx'), /nastaliq/i);

  const css = read('src', 'renderer', 'index.css');
  assert.match(css, /\[data-urdu-font="nastaliq"\]:lang\(ur\), \[data-urdu-font="nastaliq"\] :lang\(ur\) \{\s*--font-script: "SoftGlaze Nastaliq"/);
  assert.match(css, /:root\[data-urdu-font="nastaliq"\]:lang\(ur\) body \{ line-height: 2\.2; \}/);

  const settings = read('src', 'renderer', 'pages', 'SettingsPage.jsx');
  assert.match(settings, /\{lang === 'ur' && \(/);
  assert.match(settings, /setUrduFont\(e\.target\.value, lang\)/);
  for (const code of CODES) {
    const f = locale(code, 'common').settings.language.urduFont;
    for (const k of ['label', 'hint', 'default', 'nastaliq']) assert.equal(typeof f[k], 'string', `${code}: urduFont.${k}`);
  }
});

test('the NSIS installer is multi-language with English first', () => {
  const nsis = JSON.parse(read('package.json')).build.nsis;
  assert.equal(nsis.multiLanguageInstaller, true);
  assert.equal(nsis.installerLanguages[0], 'en_US');
  assert.equal(nsis.installerLanguages.length, 17);
  assert.ok(!nsis.installerLanguages.some((l) => /^ur/.test(l)), 'NSIS has no Urdu language file');
});
