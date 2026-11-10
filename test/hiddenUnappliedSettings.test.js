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

test('Profile editor: Data Sync and the unread browser switches are gated', () => {
  assert.match(PROFILES, /import \{ SHOW_UNAPPLIED_SETTINGS \} from '@\/lib\/unappliedSettings\.mjs';/);
  const gates = gateRanges(PROFILES);
  const needles = [
    "updatePd('advancedSync'", "updateNestedPd('syncItems'",
    "updatePd('advancedBrowser'",
    // Advanced: Extension (advancedExt) is never read; Random Fingerprint is overridden by the
    // editor's own fields. Proxy tab: the IP checker choice is not even saved.
    "updatePd('advancedExt'", "updatePd('randomFingerprint'", "updatePd('ipChecker'",
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

// 1.0.26: Device Name and MAC Address are real per-profile options again (unique per profile, applied
// where a browser has a channel for them: test/profileOptions.test.js), so they are on screen ungated.
test('Device Name and MAC Address are shown, ungated, in the editor, its side panel and the overview', () => {
  const pageGates = gateRanges(PROFILES);
  for (const n of ["updatePd('deviceNameType'", "updatePd('deviceName'", "updatePd('macAddressType'", "updatePd('macAddress'", "t('env.deviceName')", "t('env.mac')"]) {
    const hits = indexesOf(PROFILES, n);
    assert.ok(hits.length > 0, `${n} is on the page`);
    assert.ok(hits.every((at) => !pageGates.some(([a, b]) => at > a && at < b)), `${n} is not behind SHOW_UNAPPLIED_SETTINGS`);
  }
  assert.doesNotMatch(ENV_MODAL, /SHOW_UNAPPLIED_SETTINGS/, 'nothing in the overview is gated any more');
  assert.match(ENV_MODAL, /t\('envOverview\.rowDeviceName'\)/);
  assert.match(ENV_MODAL, /t\('envOverview\.rowMacAddress'\)/);
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

test('main applies no per-profile switch but loadExtensions (and no MAC address: no browser has a channel for it)', () => {
  for (const f of ['browserEngine.js', 'firefoxEngine.js', 'launchCheck.js']) {
    const src = read('src', 'main', f);
    assert.doesNotMatch(src, /\b(macAddress|syncItems|advancedSync|advancedBrowser|browserSettingsJson)\b/, `${f} now applies one`);
  }
  // The device name has one channel, in Firefox (Firefox account device name, NTLM workstation name).
  assert.doesNotMatch(read('src', 'main', 'browserEngine.js'), /\bdeviceName\b/, 'Chromium has no setting for the device name');
  assert.match(read('src', 'main', 'firefoxEngine.js'), /network\.generic-ntlm-auth\.workstation/);
  const reads = [...IPC.matchAll(/perProfileBrowser\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(reads)], ['loadExtensions'], 'launch reads only loadExtensions from the per-profile switches');
});

test('main never reads advancedExt and never saves the editor IP checker', () => {
  const mainDir = path.join(ROOT, 'src', 'main');
  for (const f of fs.readdirSync(mainDir).filter((x) => x.endsWith('.js'))) {
    let src = fs.readFileSync(path.join(mainDir, f), 'utf8');
    if (f === 'ipcHandlers.js') {
      // The one place it is written: extractFingerprintData copies it into the profile row.
      assert.match(src, /advancedExt: input\.advancedExt,/);
      src = src.replace('advancedExt: input.advancedExt,', '');
    }
    assert.doesNotMatch(src, /\badvancedExt\b/, `${f} now reads advancedExt: show the Extension choice again`);
  }
  const start = IPC.indexOf('function extractFingerprintData(');
  assert.ok(start > 0, 'extractFingerprintData must exist');
  const body = IPC.slice(start, IPC.indexOf('\n}', start));
  assert.doesNotMatch(body, /ipChecker/, 'the profile IP checker is saved now: show it again');
});

test('Random Fingerprint has no effect from the editor: it sends every field the generator sets', () => {
  // createProfile lets explicit fields override the generated base (buildFingerprintFields). The
  // editor's initial data carries every key generateFingerprint returns, so nothing generated survives.
  const gen = require(path.join(ROOT, 'src', 'main', 'fingerprintGenerator.js'));
  const generated = Object.keys(gen.generateFingerprint({ deviceClass: 'desktop' }));
  assert.ok(generated.length > 10, 'generator output');
  const i = PROFILES.indexOf('const initialProfileData = {');
  assert.ok(i > 0, 'initialProfileData must exist');
  const block = PROFILES.slice(i, PROFILES.indexOf('\n};', i));
  const missing = generated.filter((k) => !new RegExp(`\\n\\s+${k}:`).test(block));
  assert.deepEqual(missing, [], 'the editor no longer sends these, so Random Fingerprint may randomise them: show it again');
  assert.match(IPC, /function buildFingerprintFields\(input\) \{[\s\S]*?if \(value !== undefined\) merged\[key\] = value;/, 'explicit fields still win');
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
    assert.doesNotMatch(src, /blockAccess: \{[^}]*\blist\s*:/, `${path.relative(ROOT, file)} writes the block list: show the switch again`);
  }
});

// ---- wording -----------------------------------------------------------------------------------

test('Synchronize is not labelled Premium, and Random Fingerprint says when it really applies', () => {
  for (const lang of ['en', 'es']) {
    const prof = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'profiles.json').trim()); // trim() also drops a BOM
    assert.doesNotMatch(prof.bulk.synchronizeTitle, /premium/i, `${lang}: no plan restricts Synchronize`);
    assert.equal(prof.platform.premium, undefined, `${lang}: the 2FA Secret "Premium" badge label is gone`);
    assert.doesNotMatch(prof.advanced.randomFingerprintDesc, /each startup|on each launch|cada inicio/i, `${lang}: it is generated on save, not at launch`);
    // The hardware heading names what is under it: Device Name and MAC Address are shown again (1.0.26).
    assert.match(prof.fp.hardwareConfigSub, /MAC/, `${lang}: hardware heading`);
    assert.doesNotMatch(prof.advanced.coreSettingsSub, /sync|sincroniz/i, `${lang}: core settings heading`);
  }
  assert.doesNotMatch(read('src', 'main', 'tierPolicy.js'), /synchron/i, 'if a plan ever restricts Synchronize, the label can return');
  assert.doesNotMatch(read('src', 'main', 'tierPolicy.js'), /2fa|twoFactor|totp/i, 'if a plan ever restricts the 2FA vault, the badge can return');
  assert.doesNotMatch(PROFILES, /t\('platform\.premium'\)/, 'no Premium badge on the 2FA Secret field');
});
