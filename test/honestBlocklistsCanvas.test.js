'use strict';
// Two claims the app made that were not true (7 Nov 2026):
//
// 1. The proxy check listed SORBS among the DNS blocklists it queries. Proofpoint shut SORBS down
//    on 5 June 2024 and dnsbl.sorbs.net answers NXDOMAIN, so it only cost a lookup, and a
//    re-registered domain with a wildcard answer would have marked every proxy as listed.
// 2. The profile's "Canvas Noise" switch reads as if it changes canvas results. On the standard
//    engine it does not touch 2D canvas (browserEngine.js leaves that block empty on purpose);
//    only the optional fingerprint-chromium engine changes canvas, from the seed. The switch now
//    says so, and so do the two environment summaries. Fingerprint behaviour is unchanged.
//
// These read the real source rather than duplicating it. Nothing here opens a socket or launches
// a browser; the DNS module is a stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

const IPC = read('src', 'main', 'ipcHandlers.js');
const ENGINE = read('src', 'main', 'browserEngine.js');
const PROFILES_PAGE = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
const ENV_MODAL = read('src', 'renderer', 'components', 'EnvironmentOverviewModal.jsx');

// Source of `function name(...) { ... }` (async or not), by brace matching.
function extractFunction(source, name) {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(m, `could not find function ${name} in source`);
  let i = source.indexOf('{', m.index);
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(m.index, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Source of a top-level `const NAME = [ ... ];`.
function extractArrayConst(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `could not find const ${name} in source`);
  const end = source.indexOf('\n];', start);
  assert.ok(end > start, `could not find the end of ${name}`);
  return source.slice(start, end + 3);
}

// ---- 1) DNS blocklists ---------------------------------------------------------------------

function loadBlacklist(resolve4) {
  const fakeDns = { promises: { resolve4 } };
  const ctx = {
    module: {},
    require: (id) => (id === 'node:dns' ? fakeDns : require(id)),
    dnsbl: require('../src/main/dnsbl'), // the module-level require in ipcHandlers.js
    setTimeout, clearTimeout, Promise
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractArrayConst(IPC, 'DNSBL_ZONES'),
    extractFunction(IPC, 'expandIpv6'),
    extractFunction(IPC, 'withTimeout'),
    extractFunction(IPC, 'checkBlacklist'),
    'module.exports = { DNSBL_ZONES, checkBlacklist };'
  ].join('\n'), ctx);
  return ctx.module.exports;
}

test('the proxy check queries Spamhaus, SpamCop and Barracuda, and not the shut-down SORBS', () => {
  // Spread first: arrays made inside the vm context have another realm's prototype.
  const zones = [...loadBlacklist(async () => []).DNSBL_ZONES];
  assert.deepEqual(zones.map((z) => z.name), ['Spamhaus', 'SpamCop', 'Barracuda']);
  assert.deepEqual(zones.map((z) => z.zone), ['zen.spamhaus.org', 'bl.spamcop.net', 'b.barracudacentral.org']);
  for (const z of zones) assert.doesNotMatch(`${z.zone} ${z.name}`, /sorbs/i, 'SORBS was shut down in June 2024');
  assert.doesNotMatch(IPC, /zone:\s*'[^']*sorbs/i, 'no SORBS zone anywhere in the main process');
});

test('a listing is reported only by the lists that are still queried', async () => {
  const asked = [];
  // Worst case for a dead list: every name answers "listed".
  const { checkBlacklist } = loadBlacklist(async (name) => { asked.push(name); return ['127.0.0.2']; });
  const v4 = await checkBlacklist('203.0.113.7');
  assert.equal(v4.checked, true);
  assert.equal(v4.listed, true);
  assert.deepEqual([...v4.sources].sort(), ['Barracuda', 'SpamCop', 'Spamhaus']);
  assert.deepEqual([...asked].sort(), [
    '7.113.0.203.b.barracudacentral.org', '7.113.0.203.bl.spamcop.net', '7.113.0.203.zen.spamhaus.org'
  ]);
  assert.ok(asked.every((n) => !/sorbs/i.test(n)), 'nothing is sent to sorbs.net');
});

test('IPv6 exits are checked on Spamhaus only (the other two lists do not answer IPv6)', async () => {
  const asked = [];
  const { checkBlacklist } = loadBlacklist(async (name) => { asked.push(name); return ['127.0.0.4']; });
  const r = await checkBlacklist('2001:db8::1');
  assert.deepEqual([...r.sources], ['Spamhaus']);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /\.zen\.spamhaus\.org$/);
});

test('an NXDOMAIN answer still means "not listed"', async () => {
  const { checkBlacklist } = loadBlacklist(async () => { const e = new Error('queryA ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; });
  const r = await checkBlacklist('198.51.100.9');
  assert.equal(r.checked, true);
  assert.equal(r.listed, false);
  assert.deepEqual([...r.sources], []);
});

// ---- 2) Canvas Noise -----------------------------------------------------------------------

const LOCALES = ['en', 'es'];

test('the Canvas Noise switch says what it does on each engine, in English and Spanish', () => {
  for (const lng of LOCALES) {
    const profiles = json('src', 'renderer', 'i18n', 'locales', lng, 'profiles.json');
    const modals = json('src', 'renderer', 'i18n', 'locales', lng, 'cmpModalsB.json');
    for (const [where, text] of [
      ['fp.canvasNoiseDesc', profiles.fp && profiles.fp.canvasNoiseDesc],
      ['env.canvasEngineNote', profiles.env && profiles.env.canvasEngineNote],
      ['envOverview.canvasEngineNote', modals.envOverview && modals.envOverview.canvasEngineNote]
    ]) {
      assert.equal(typeof text, 'string', `${lng} ${where} must exist`);
      assert.match(text, /2D/, `${lng} ${where} names 2D canvas`);
      assert.match(text, /fingerprint-chromium/, `${lng} ${where} names the engine that does change canvas`);
    }
  }
  // The switch keeps its name, so the website and old screenshots still match.
  assert.equal(json('src', 'renderer', 'i18n', 'locales', 'en', 'profiles.json').fp.canvasNoise, 'Canvas Noise');
});

test('the editor shows the help under the switch and ties it to the switch for screen readers', () => {
  assert.ok(PROFILES_PAGE.includes("{t('fp.canvasNoiseDesc')}"), 'help text rendered under the switch');
  assert.ok(PROFILES_PAGE.includes('id="fp-canvas-noise-help"'));
  assert.ok(PROFILES_PAGE.includes('describedBy="fp-canvas-noise-help"'), 'switch is described by the help text');
  assert.ok(PROFILES_PAGE.includes('labelledBy="fp-canvas-noise-label"'), 'switch is labelled by "Canvas Noise"');
  assert.match(PROFILES_PAGE, /aria-describedby=\{describedBy\}/);
  assert.match(PROFILES_PAGE, /onChange=\{v => updatePd\('canvasNoise', v\)\}/, 'the switch still saves canvasNoise');
  // The side summary carries the same note right under its Canvas row.
  assert.match(PROFILES_PAGE, /<EnvRow k=\{t\('env\.canvas'\)\}[^\n]*\n\s*<p [^>]*>\{t\('env\.canvasEngineNote'\)\}<\/p>/);
});

test('the environment overview no longer paints Canvas green, and explains the engine', () => {
  const row = ENV_MODAL.split('\n').find((l) => l.includes("t('envOverview.rowCanvas')"));
  assert.ok(row, 'Canvas row exists');
  assert.ok(row.includes("note={t('envOverview.canvasEngineNote')}"), 'Canvas row carries the engine note');
  assert.doesNotMatch(row, /emerald|amber/, 'on the standard engine 2D canvas is the same either way');
  assert.match(ENV_MODAL, /function Row\(\{ label, value, mono, accent, note \}\)/);
});

// The help text is only true while the engine behaves like this. If canvas noise is ever implemented
// on the standard engine, or fingerprint-chromium starts honouring the switch, these fail: update the
// strings above together with the code.
test('the help text matches the engine: standard engine leaves 2D canvas alone, fingerprint-chromium ignores the switch', () => {
  const block = /if \(fp\.noise\.canvas\) \{([\s\S]*?)\n\s*\}/.exec(ENGINE);
  assert.ok(block, 'the canvas branch of the injected fingerprint script still exists');
  const body = block[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  assert.deepEqual(body, [], 'the standard engine does not patch canvas (only comments in the block)');
  assert.doesNotMatch(extractFunction(ENGINE, 'buildAntidetectFlags'), /canvas/i,
    'fingerprint-chromium flags do not read the Canvas Noise switch');
  assert.match(ENGINE, /if \(profile\.canvasNoise !== false \|\| profile\.webglImageNoise !== false\) \{/,
    'the ANGLE pin still follows the two switches, unchanged');
});

test('stored values stay compatible: create, batch import column "Canvas" and export', () => {
  assert.match(IPC, /canvasNoise: input\.canvasNoise !== false,/, 'new profiles still default to on');

  // Export: the "Canvas" column still writes Noise / Real from canvasNoise.
  const ctx = { module: {} };
  vm.createContext(ctx);
  vm.runInContext(`${extractArrayConst(IPC, 'EXPORT_COLUMNS')}\nmodule.exports = EXPORT_COLUMNS;`, ctx);
  const canvasCol = ctx.module.exports.find(([h]) => h === 'Canvas');
  assert.ok(canvasCol, 'export keeps the Canvas column');
  assert.equal(canvasCol[1]({ canvasNoise: true }), 'Noise');
  assert.equal(canvasCol[1]({ canvasNoise: false }), 'Real');

  // Import: a real workbook with a "Canvas" column still maps onto canvasNoise.
  const XLSX = require('xlsx');
  const { parseWorkbookFile } = require('../src/main/importParser');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-canvas-import-'));
  const file = path.join(dir, 'profiles.xlsx');
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Profile Title', 'Canvas'],
      ['Shop 1', 'Real'],
      ['Shop 2', 'Noise'],
      ['Shop 3', '']
    ]), 'Profiles');
    XLSX.writeFile(wb, file);
    const parsed = parseWorkbookFile(file);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.items.map((i) => [i.title, i.canvasNoise]), [
      ['Shop 1', false], ['Shop 2', true], ['Shop 3', undefined]
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the AI guide does not claim canvas noise on the standard engine', () => {
  const { HOW_SOFTGLAZE_WORKS } = require('../src/main/ai/memories');
  assert.doesNotMatch(HOW_SOFTGLAZE_WORKS, /canvas\/WebGL\/audio noise/);
  assert.match(HOW_SOFTGLAZE_WORKS, /Canvas Noise setting does not change 2D canvas on the standard engine/);
});
