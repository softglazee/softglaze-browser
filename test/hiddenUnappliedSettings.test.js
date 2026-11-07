'use strict';
// Pre-launch cleanup (1 Dec 2026): settings the app shows and saves but never acts on stay hidden,
// so no one switches something that has no effect. Each sits behind SHOW_UNAPPLIED_SETTINGS
// (src/renderer/lib/unappliedSettings.mjs); the stored data, main's defaults and the components stay.
// This fails if one comes back on screen ungated, and also if main starts reading one: then it does
// something, so take it out of its gate and out of this list.
// Page wiring is asserted on the source: there is no renderer test harness in this repo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SETTINGS = read('src', 'renderer', 'pages', 'SettingsPage.jsx');
const PROFILES = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
const ENV_MODAL = read('src', 'renderer', 'components', 'EnvironmentOverviewModal.jsx');
const IPC = read('src', 'main', 'ipcHandlers.js');
const loadLib = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'unappliedSettings.mjs')).href);

const GATE = '{SHOW_UNAPPLIED_SETTINGS && ';

// [start, end] of every `{SHOW_UNAPPLIED_SETTINGS && ...}` JSX block, by brace matching.
function gateRanges(src) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const start = src.indexOf(GATE, from);
    if (start < 0) return ranges;
    let depth = 0;
    let i = start;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    assert.ok(depth === 0, 'every gate must close');
    ranges.push([start, i]);
    from = start + GATE.length;
  }
}

// [start, end) of a top-level `function name(` up to the next top-level function or section marker.
function functionRange(src, name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must still exist (the component is kept, only not rendered)`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\r?\n(function \w+\(|\/\/ ----)/);
  return [start, next < 0 ? src.length : start + 1 + next];
}

function indexesOf(src, needle) {
  const out = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) out.push(i);
  return out;
}

// Every occurrence of needle sits inside one of the ranges; at least one occurrence exists, so a
// renamed key fails here instead of silently passing.
function assertOnlyInside(src, needle, ranges, label) {
  const hits = indexesOf(src, needle);
  assert.ok(hits.length > 0, `${label}: "${needle}" not found - update this test if it was renamed`);
  for (const at of hits) {
    const inside = ranges.some(([a, b]) => at > a && at < b);
    assert.ok(inside, `${label}: "${needle}" is on screen outside SHOW_UNAPPLIED_SETTINGS (offset ${at})`);
  }
}

// ---- the switch itself ---------------------------------------------------------------------

test('unapplied settings stay hidden for the launch', async () => {
  const { SHOW_UNAPPLIED_SETTINGS, UNAPPLIED_SECTIONS, visibleSectionOrder } = await loadLib();
  assert.equal(SHOW_UNAPPLIED_SETTINGS, false);
  assert.deepEqual([...UNAPPLIED_SECTIONS].sort(), ['datasync', 'ipsetting', 'multidevice', 'platform', 'security']);
  const all = ['language', 'onstartup', 'platform', 'fingerprint', 'ipsetting', 'datasync', 'security', 'multidevice', 'audit'];
  assert.deepEqual(visibleSectionOrder(all), ['language', 'onstartup', 'fingerprint', 'audit'], 'order kept, unapplied dropped');
  assert.deepEqual(visibleSectionOrder(all, true), all, 'turning the flag on brings every section back');
  assert.deepEqual(visibleSectionOrder(undefined), []);
});

// ---- Settings page ---------------------------------------------------------------------------

const HIDDEN_SECTIONS = ['PlatformSection', 'IpSettingSection', 'DataSyncSection', 'SecuritySection', 'MultiDeviceSection'];

test('Settings: the five unapplied sections are left out of the nav, search and page', () => {
  assert.match(SETTINGS, /import \{ SHOW_UNAPPLIED_SETTINGS, visibleSectionOrder \} from '@\/lib\/unappliedSettings\.mjs';/);
  assert.match(SETTINGS, /const order = visibleSectionOrder\(\[/, 'the nav/search order goes through visibleSectionOrder');
  for (const name of HIDDEN_SECTIONS) {
    assert.equal(indexesOf(SETTINGS, `<${name} `).length, 1, `${name} is rendered once`);
    assert.ok(SETTINGS.includes(`${GATE}<${name} `), `${name} renders only behind SHOW_UNAPPLIED_SETTINGS`);
  }
});

test('Settings: unapplied rows inside kept sections are gated', () => {
  const allowed = [...gateRanges(SETTINGS), ...HIDDEN_SECTIONS.map((n) => functionRange(SETTINGS, n))];
  const needles = [
    // On Startup
    'apply({ onStartup: { onlyOpenWhenExtensionLoaded:',
    'apply({ onStartup: { blockIfCountryChanged:',
    // Fingerprint & identity
    'apply({ browser: { matchTimezoneOnIpChange:',
    'apply({ browser: { enableVirtualCamera:',
    'apply({ browser: { mobileSimulation:',
    // Website Management: Block access has no way to enter its list, FB static is never read
    'apply({ website: { blockAccess:',
    'apply({ website: { fbStaticLocal:',
    // Whole hidden sections
    'apply({ platform:',
    'apply({ ipSetting:',
    'apply({ dataSync:',
    'apply({ security:',
    'apply({ multiDevice:'
  ];
  for (const n of needles) assertOnlyInside(SETTINGS, n, allowed, 'SettingsPage');
});

test('Settings: search keywords do not point at hidden controls', () => {
  const kw = (id) => {
    const m = new RegExp(`add\\('${id}',[^\\n]*`).exec(SETTINGS);
    assert.ok(m, `${id} keywords`);
    return m[0];
  };
  assert.doesNotMatch(kw('website').replace(/unapplied\('[^']*'\)/g, ''), /block|facebook/);
  assert.doesNotMatch(kw('fingerprint').replace(/unapplied\('[^']*'\)/g, ''), /camera|mobile/);
  assert.doesNotMatch(kw('onstartup').replace(/unapplied\('[^']*'\)/g, ''), /extension|country/);
});

// ---- profile editor ----------------------------------------------------------------------------

test('Profile editor: Device Name, MAC Address, Data Sync and the unread browser switches are gated', () => {
  assert.match(PROFILES, /import \{ SHOW_UNAPPLIED_SETTINGS \} from '@\/lib\/unappliedSettings\.mjs';/);
  const gates = gateRanges(PROFILES);
  const needles = [
    "updatePd('deviceNameType'", "updatePd('deviceName'", "updatePd('macAddressType'", "updatePd('macAddress'",
    "t('env.deviceName')", "t('env.mac')",
    "updatePd('advancedSync'", "updateNestedPd('syncItems'",
    "updatePd('advancedBrowser'",
    ...['matchTimezone', 'allowChromeSignIn', 'offerTranslate', 'disableDevTools', 'disableExtInstall',
      'enableVirtualCamera', 'enableMobileSim', 'startupAction', 'onlyOpenWithProxy', 'onlyOpenExtLoaded',
      'secureAccess', 'disableVideos', 'disableImagesLimit'].map((k) => `updateNestedPd('browserSettings', '${k}'`)
  ];
  for (const n of needles) assertOnlyInside(PROFILES, n, gates, 'ProfilesPage');
});

test('Profile editor: "Load SoftGlaze extensions" stays on screen on its own', () => {
  const hits = indexesOf(PROFILES, "updateNestedPd('browserSettings', 'loadExtensions'");
  assert.equal(hits.length, 1, 'one loadExtensions control');
  const gates = gateRanges(PROFILES);
  assert.ok(!gates.some(([a, b]) => hits[0] > a && hits[0] < b), 'loadExtensions is not behind the gate');
});

test('Environment overview modal: Device name and MAC address rows are gated', () => {
  assert.match(ENV_MODAL, /import \{ SHOW_UNAPPLIED_SETTINGS \} from '@\/lib\/unappliedSettings\.mjs';/);
  const gates = gateRanges(ENV_MODAL);
  assertOnlyInside(ENV_MODAL, "t('envOverview.rowDeviceName')", gates, 'EnvironmentOverviewModal');
  assertOnlyInside(ENV_MODAL, "t('envOverview.rowMacAddress')", gates, 'EnvironmentOverviewModal');
});

// ---- main still ignores them (if this fails, the setting works now: show it again) -------------

test('main reads none of the hidden global settings', () => {
  const start = IPC.indexOf('const GLOBAL_SETTINGS_DEFAULTS = Object.freeze({');
  assert.ok(start > 0, 'GLOBAL_SETTINGS_DEFAULTS must exist');
  const end = IPC.indexOf('\n});', start);
  const defaults = IPC.slice(start, end);
  const keys = ['remoteLoginReminder', 'failedLoginAlert', 'loginIpAllowlist', 'twoStep', 'multiDevice', 'fbStaticLocal',
    'customIconEnabled', 'displayCustomNo', 'displayLast4', 'ipSetting', 'ipChecker', 'dataSync',
    'matchTimezoneOnIpChange', 'enableVirtualCamera', 'mobileSimulation', 'onlyOpenWhenExtensionLoaded', 'blockIfCountryChanged'];
  const mainDir = path.join(ROOT, 'src', 'main');
  const files = fs.readdirSync(mainDir).filter((f) => f.endsWith('.js'));
  for (const key of keys) {
    assert.match(defaults, new RegExp(`\\b${key}\\b`), `${key} keeps its stored default`);
    for (const f of files) {
      let src = fs.readFileSync(path.join(mainDir, f), 'utf8');
      if (f === 'ipcHandlers.js') src = src.slice(0, start) + src.slice(end);
      assert.doesNotMatch(src, new RegExp(`\\b${key}\\b`), `${f} now reads ${key}: it works, so show it again`);
    }
  }
});

test('main applies no Device Name, MAC Address or per-profile switch but loadExtensions', () => {
  for (const f of ['browserEngine.js', 'firefoxEngine.js', 'launchCheck.js']) {
    const src = read('src', 'main', f);
    assert.doesNotMatch(src, /\b(deviceName|macAddress|syncItems|advancedSync|advancedBrowser|browserSettingsJson)\b/, `${f} now applies one`);
  }
  const reads = [...IPC.matchAll(/perProfileBrowser\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(reads)], ['loadExtensions'], 'launch reads only loadExtensions from the per-profile switches');
});

test('Block access never filters without a list, and nothing in the app fills the list', () => {
  const engine = read('src', 'main', 'browserEngine.js');
  assert.match(engine, /accessEnabled: Boolean\(block\.enabled\) && list\.length > 0/);
  const rendererDir = path.join(ROOT, 'src', 'renderer');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'locales' ? [] : walk(p);
    return /\.(jsx?|mjs)$/.test(d.name) ? [p] : [];
  });
  for (const file of walk(rendererDir)) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /blockAccess: \{[^}]*\blist\s*:/,`${path.relative(ROOT, file)} writes the block list: show the switch again`);
  }
});

// ---- wording -----------------------------------------------------------------------------------

test('Synchronize is not labelled Premium, and Random Fingerprint says when it really applies', () => {
  for (const lang of ['en', 'es']) {
    const prof = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'profiles.json').replace(/^﻿/, ''));
    assert.doesNotMatch(prof.bulk.synchronizeTitle, /premium/i, `${lang}: no plan restricts Synchronize`);
    assert.doesNotMatch(prof.advanced.randomFingerprintDesc, /each startup|on each launch|cada inicio/i, `${lang}: it is generated on save, not at launch`);
    // Headings over the hidden fields do not promise them.
    assert.doesNotMatch(prof.fp.hardwareConfigSub, /MAC|device name|dispositivo/i, `${lang}: hardware heading`);
    assert.doesNotMatch(prof.advanced.coreSettingsSub, /sync|sincroniz/i, `${lang}: core settings heading`);
  }
  assert.doesNotMatch(read('src', 'main', 'tierPolicy.js'), /synchron/i, 'if a plan ever restricts Synchronize, the label can return');
});
