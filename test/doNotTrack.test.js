'use strict';
// Do Not Track (1.0.22). Two problems fixed:
//   1. The profile editor saves "Open" / "Close" / "Default", but the launch only understood on/1/true
//      and off/0/false, so a choice made in the editor never reached the browser.
//   2. DNT off reported navigator.doNotTrack "0" and added window.doNotTrack. Chromium reports "1" or
//      null, never "0" (LocalFrameClientImpl::DoNotTrackValue), and has no window.doNotTrack.
// DNT is now the browser's own setting, written before launch: Chromium's enable_do_not_track pref and
// Firefox's privacy.donottrackheader.enabled. The browser itself then sends DNT: 1 (navigations,
// subresources, every kind of worker) and reports navigator.doNotTrack. Workers have no doNotTrack
// property in any browser (it is on Navigator only), so the worker preludes add none.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const dnt = require('../src/main/doNotTrack');
const engine = require('../src/main/browserEngine');
const ff = require('../src/main/firefoxEngine');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const ENGINE = read('src', 'main', 'browserEngine.js');
const FF_SRC = read('src', 'main', 'firefoxEngine.js');
const IPC = read('src', 'main', 'ipcHandlers.js');
const PROFILES_PAGE = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
const ENV_MODAL = read('src', 'renderer', 'components', 'EnvironmentOverviewModal.jsx');

const OPTS = { seed: 1, resW: 1920, resH: 1080, webrtcMode: 'Altered', hasProxy: false, geo: null, timezone: null };
const config = (doNotTrack, browserBrand = 'Chrome') => engine.buildFingerprintConfig({ browserBrand, doNotTrack }, OPTS);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-dnt-'));

// Every value the app can meet: the editor's words, import/API aliases, phrases, and junk.
const TABLE = [
  ['Open', 'Open'], ['open', 'Open'], [' OPEN ', 'Open'], ['on', 'Open'], ['1', 'Open'], [1, 'Open'], [true, 'Open'],
  ['true', 'Open'], ['yes', 'Open'], ['enable', 'Open'], ['Enabled', 'Open'], ['DNT enabled', 'Open'], ['Turn on', 'Open'],
  ['Close', 'Close'], ['close', 'Close'], ['Closed', 'Close'], ['off', 'Close'], ['0', 'Close'], [0, 'Close'], [false, 'Close'],
  ['false', 'Close'], ['no', 'Close'], ['disable', 'Close'], ['Disabled', 'Close'], ['tracking_disabled', 'Close'],
  ['Default', 'Default'], ['default', 'Default'], ['Auto', 'Default'], ['browser default', 'Default'],
  ['', null], ['   ', null], [null, null], [undefined, null], ['none', null], ['on/off', null], ['maybe', null]
];

// ---- 1. One meaning for every value ----

test('parseDoNotTrack: editor words, import and API aliases, phrases; never a substring guess', () => {
  for (const [input, want] of TABLE) assert.equal(dnt.parseDoNotTrack(input), want, JSON.stringify(input));
});

test('the stored choice and the launch flag', () => {
  for (const [input, want] of TABLE) {
    assert.equal(dnt.doNotTrackChoice(input), want || 'Default', JSON.stringify(input));
    assert.equal(dnt.doNotTrackFlag(input), want === 'Open' ? '1' : (want === 'Close' ? '0' : null), JSON.stringify(input));
  }
});

test('the renderer helper gives the same choice as main for every value', async () => {
  const { doNotTrackChoice } = await import('../src/renderer/lib/doNotTrack.mjs');
  for (const [input] of TABLE) assert.equal(doNotTrackChoice(input), dnt.doNotTrackChoice(input), JSON.stringify(input));
});

test('the editor\'s choice now reaches the launch: Open on, Close off, Default leaves the browser alone', () => {
  for (const brand of ['Chrome', 'Edge', 'Brave', 'Opera', 'Vivaldi', 'Yandex']) {
    assert.equal(config('Open', brand).dnt, '1', brand);
    assert.equal(config('Close', brand).dnt, '0', brand);
    assert.equal(config('Default', brand).dnt, null, brand);
  }
  // Values stored before 1.0.22 (imports, API) keep working.
  assert.equal(config('1').dnt, '1');
  assert.equal(config('on').dnt, '1');
  assert.equal(config('0').dnt, '0');
  assert.equal(config('off').dnt, '0');
  assert.equal(config(null).dnt, null);
});

test('request headers: DNT: 1 only when DNT is on', () => {
  assert.deepEqual(engine.privacyRequestHeaders(config('Open')), { DNT: '1' });
  assert.deepEqual(engine.privacyRequestHeaders(config('Close')), {});
  assert.deepEqual(engine.privacyRequestHeaders(config('Default')), {});
});

// ---- 2. Chromium: the browser's own setting ----

const prefsOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));

test('Chromium: DNT on / off is written to the profile\'s own enable_do_not_track pref, other prefs kept', async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'Default'));
    fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ profile: { cookie_controls_mode: 2 }, homepage: 'x' }));
    await engine.ensureDoNotTrackPref(dir, '1');
    assert.deepEqual(prefsOf(dir), { profile: { cookie_controls_mode: 2 }, homepage: 'x', enable_do_not_track: true });
    await engine.ensureDoNotTrackPref(dir, '0');
    assert.equal(prefsOf(dir).enable_do_not_track, false);
    await engine.ensureDoNotTrackPref(dir, null);
    assert.equal(prefsOf(dir).enable_do_not_track, false, 'null writes nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Chromium: a new profile gets a Preferences file; Default writes none; a broken file is never overwritten', async () => {
  const fresh = tmp();
  const untouched = tmp();
  const broken = tmp();
  try {
    await engine.ensureDoNotTrackPref(fresh, '1');
    assert.deepEqual(prefsOf(fresh), { enable_do_not_track: true });
    await engine.ensureDoNotTrackPref(untouched, null);
    assert.equal(fs.existsSync(path.join(untouched, 'Default', 'Preferences')), false);
    fs.mkdirSync(path.join(broken, 'Default'));
    fs.writeFileSync(path.join(broken, 'Default', 'Preferences'), '{"half": ');
    await engine.ensureDoNotTrackPref(broken, '1');
    assert.equal(fs.readFileSync(path.join(broken, 'Default', 'Preferences'), 'utf8'), '{"half": ');
  } finally { for (const d of [fresh, untouched, broken]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('Default after Open turns the setting back off; a setting made inside the browser is left alone', async () => {
  const dir = tmp();
  try {
    assert.equal(await dnt.dntPrefToWrite(dir, null), null, 'never set by SoftGlaze: nothing to write');
    assert.equal(await dnt.dntPrefToWrite(dir, '1'), '1');
    assert.equal(fs.readFileSync(path.join(dir, dnt.DNT_MARKER), 'utf8'), '1');
    assert.equal(await dnt.dntPrefToWrite(dir, null), '0', 'Open -> Default: back to the browser default (off)');
    assert.equal(fs.existsSync(path.join(dir, dnt.DNT_MARKER)), false);
    assert.equal(await dnt.dntPrefToWrite(dir, null), null, 'then left alone');
    assert.equal(await dnt.dntPrefToWrite(dir, '0'), '0');
    assert.equal(await dnt.dntPrefToWrite(dir, null), null, 'Close -> Default: already the browser default');
    assert.equal(await dnt.dntPrefToWrite('', '1'), '1', 'no folder: the value still applies');
    assert.equal(await dnt.dntPrefToWrite('', null), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every Chromium launch writes the setting before the browser starts (not only the anti-detect build)', () => {
  const launch = ENGINE.slice(ENGINE.indexOf('async function launchProfileSessionNow('), ENGINE.indexOf('\n// Navigate a running session'));
  const call = '  await ensureDoNotTrackPref(userDataDir, await dntPrefToWrite(userDataDir, fpConfig.dnt));';
  assert.ok(launch.includes(call), 'unconditional call');
  assert.doesNotMatch(launch, /if \(usingAntidetect\) await ensureDoNotTrackPref/);
  assert.doesNotMatch(ENGINE, /ensureNativeProfilePrefs/);
  assert.ok(launch.indexOf('browser = await engine.launch(launchOptions)') > 0, 'launch call found');
  assert.ok(launch.indexOf(call) < launch.indexOf('browser = await engine.launch(launchOptions)'), 'before the browser starts');
});

// ---- 3. The page and its workers ----

function runPage(fp, nativeDnt) {
  const NavProto = {};
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => Object.defineProperty(NavProto, n, { get() { return null; }, configurable: true, enumerable: true }));
  // Chromium's own getter: "1" when its setting is on, null otherwise.
  const nativeGetter = function () { return nativeDnt; };
  Object.defineProperty(NavProto, 'doNotTrack', { get: nativeGetter, configurable: true, enumerable: true });
  function SharedWorker(url) { this.url = url; }
  const sb = { navigator: Object.create(NavProto), console, SharedWorker, URL, Blob };
  sb.window = sb;
  sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify(fp)});`, sb);
  return { sb, NavProto, nativeGetter };
}
const pageFp = (choice, guard) => ({
  seed: 1, guard, langs: ['en-US', 'en'], cores: 6, mem: 8, navPlatform: 'Win32',
  noise: { canvas: false, webgl: false, audio: false }, dedicatedWorkersViaCdp: true, dnt: config(choice).dnt
});

test('page: Close and Default leave Chromium\'s own value (null); no "0" and no window.doNotTrack', () => {
  for (const [choice, guard] of [['Close', 'gDnt1'], ['Default', 'gDnt2']]) {
    const { sb, NavProto, nativeGetter } = runPage(pageFp(choice, guard), null);
    assert.equal(vm.runInContext('navigator.doNotTrack', sb), null, choice);
    assert.equal(Object.getOwnPropertyDescriptor(NavProto, 'doNotTrack').get, nativeGetter, `${choice}: native getter kept`);
    assert.equal(vm.runInContext("'doNotTrack' in window", sb), false, `${choice}: no window.doNotTrack`);
  }
});

test('page: with the setting on, Chromium\'s own "1" is left native', () => {
  const { sb, NavProto, nativeGetter } = runPage(pageFp('Open', 'gDnt3'), '1');
  assert.equal(vm.runInContext('navigator.doNotTrack', sb), '1');
  assert.equal(Object.getOwnPropertyDescriptor(NavProto, 'doNotTrack').get, nativeGetter, 'not patched');
  assert.equal(vm.runInContext("'doNotTrack' in window", sb), false);
});

test('page: if the setting could not be written, DNT on still reports "1" (native-looking, on the prototype)', () => {
  const { sb } = runPage(pageFp('Open', 'gDnt4'), null);
  assert.equal(vm.runInContext('navigator.doNotTrack', sb), '1');
  const probe = JSON.parse(vm.runInContext(`JSON.stringify((function () {
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'doNotTrack');
    return { own: Object.prototype.hasOwnProperty.call(navigator, 'doNotTrack'), name: d.get.name,
      src: Function.prototype.toString.call(d.get) };
  })())`, sb));
  assert.deepEqual(probe, { own: false, name: 'get doNotTrack', src: 'function get doNotTrack() { [native code] }' });
  assert.equal(vm.runInContext("'doNotTrack' in window", sb), false);
});

test('workers: no doNotTrack property is added (browsers expose it on Navigator only)', async () => {
  const fp = { ...config('Open'), guard: undefined, cores: 6, mem: 8, navPlatform: 'Win32', langs: ['en-US', 'en'], timezone: undefined };
  assert.doesNotMatch(engine.workerPreludeSource(fp), /doNotTrack|"dnt"/);
  const { resolveObjectURL } = require('node:buffer');
  const { sb } = runPage(pageFp('Open', 'gDnt5'), '1');
  const boot = await resolveObjectURL(new sb.SharedWorker('https://example.com/s.js').url).text();
  assert.doesNotMatch(boot.split('\n')[0], /doNotTrack/);
});

test('the SoftGlaze start page reads the browser\'s own value: Enabled or Off', () => {
  assert.match(ENGINE, /\$\('dnt'\)\.textContent=\(navigator\.doNotTrack==='1'\?'Enabled':'Off'\);/);
});

// ---- 4. Firefox ----

test('Firefox: DNT through its own pref privacy.donottrackheader.enabled', () => {
  const line = (v) => `user_pref("privacy.donottrackheader.enabled", ${v});`;
  assert.ok(ff.buildUserJs({ doNotTrack: '1' }).includes(line(true)));
  assert.ok(ff.buildUserJs({ doNotTrack: '0' }).includes(line(false)));
  assert.doesNotMatch(ff.buildUserJs({ doNotTrack: null }), /donottrack/);
  assert.doesNotMatch(ff.buildUserJs({}), /donottrack/);
  assert.match(FF_SRC, /doNotTrack: await dntPrefToWrite\(userDataDir, doNotTrackFlag\(profile\.doNotTrack\)\)/);
});

// ---- 5. Saving, batch import and export ----

test('saving and batch create store the editor\'s word', () => {
  assert.match(IPC, /doNotTrack: input\.doNotTrack === undefined \? undefined : doNotTrackChoice\(input\.doNotTrack\),/);
  assert.match(IPC, /if \(item\.doNotTrack !== undefined && item\.doNotTrack !== null\) fp\.doNotTrack = doNotTrackChoice\(item\.doNotTrack\);/);
});

test('the editor shows and saves the right choice for older stored values', () => {
  assert.match(PROFILES_PAGE, /import \{ doNotTrackChoice \} from '@\/lib\/doNotTrack\.mjs';/);
  assert.match(PROFILES_PAGE, /doNotTrack: doNotTrackChoice\(profile\.doNotTrack\),/);
  assert.match(PROFILES_PAGE, /<ButtonTabs value=\{pd\.doNotTrack\} onChange=\{v => updatePd\('doNotTrack', v\)\} options=\{\['Default', 'Open', 'Close'\]\} \/>/);
  assert.match(ENV_MODAL, /value=\{doNotTrackChoice\(p\.doNotTrack\) === 'Default' \? t\('envOverview\.valDefault'\) : doNotTrackChoice\(p\.doNotTrack\)\}/);
});

function exportColumn() {
  const start = IPC.indexOf('const EXPORT_COLUMNS = [');
  const end = IPC.indexOf('\n];', start);
  const ctx = { module: {}, doNotTrackChoice: dnt.doNotTrackChoice };
  vm.createContext(ctx);
  vm.runInContext(`${IPC.slice(start, end + 3)}\nmodule.exports = EXPORT_COLUMNS;`, ctx);
  return ctx.module.exports.find(([h]) => h === 'Do Not Track')[1];
}

test('export -> batch import keeps every choice (and reads files exported by older versions)', () => {
  const col = exportColumn();
  const stored = ['Open', 'Close', 'Default', '1', '0', 'on', null];
  const exported = stored.map((v) => col({ doNotTrack: v }));
  assert.deepEqual(exported, ['Open', 'Close', 'Default', 'Open', 'Close', 'Open', 'Default']);

  const XLSX = require('xlsx');
  const { parseWorkbookFile } = require('../src/main/importParser');
  const dir = tmp();
  const file = path.join(dir, 'profiles.xlsx');
  try {
    const rows = [['Profile Title', 'Do Not Track']];
    exported.forEach((v, i) => rows.push([`P${i}`, v]));
    // What 1.0.21 and older exported, and a few cells from other tools.
    [['Old on', '1'], ['Old off', '0'], ['Tool on', 'Enabled'], ['Tool off', 'false'], ['Empty', ''], ['Junk', 'none']]
      .forEach((r) => rows.push(r));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Profiles');
    XLSX.writeFile(wb, file);
    const parsed = parseWorkbookFile(file);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.items.map((i) => i.doNotTrack), [
      'Open', 'Close', 'Default', 'Open', 'Close', 'Open', 'Default',
      'Open', 'Close', 'Open', 'Close', undefined, undefined
    ]);
    // Round trip: what was exported comes back as the same choice.
    parsed.items.slice(0, stored.length).forEach((item, i) => assert.equal(item.doNotTrack, exported[i]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
