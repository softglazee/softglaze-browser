'use strict';
// 1.0.26: profile-editor options that were saved but changed nothing at launch now work end to end
// (editor -> saved field -> applied at launch), and the dead ones are gone. One block per option:
// WebRTC Replace / Proxy UDP, Fonts Custom, Location permission, Display Language, Media Device Edit,
// WebGPU Based on WebGL, Hardware Acceleration, the Local and HTTPS proxy types, a picked User-Agent,
// the Environment Overview gear, the Chrome version picker, and Device Name / MAC Address.
// The page scripts run in a vm realm against small fakes of the browser APIs they touch; the rest is
// pure. src/main/profileOptions.js holds the shared meanings, src/renderer/lib/profileOptions.mjs mirrors
// the editor's part.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const opts = require('../src/main/profileOptions');
const engine = require('../src/main/browserEngine');
const ff = require('../src/main/firefoxEngine');
const { generateMediaDevices } = require('../src/main/fingerprintGenerator');
const DATA = require('../src/main/profileOptionsData.json');
const IPC = read('src', 'main', 'ipcHandlers.js');
const ENGINE = read('src', 'main', 'browserEngine.js');
const PAGE = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
const ENV_MODAL = read('src', 'renderer', 'components', 'EnvironmentOverviewModal.jsx');
const loadRenderer = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'profileOptions.mjs')).href);
const locale = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`).replace(/^\uFEFF/, ''));

const BASE = { seed: 7, resW: 1920, resH: 1080, webrtcMode: 'Forward', hasProxy: false, geo: null, timezone: null };
const config = (profile, o = {}) => engine.buildFingerprintConfig({ os: 'Windows', ...profile }, { ...BASE, ...o });

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function loadMain(names, deps) {
  const src = names.map((n) => extractFunction(IPC, n)).join('\n');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

const prefsOf = (userJs) => Object.fromEntries([...userJs.matchAll(/user_pref\("([^"]+)", (.*)\);/g)].map((m) => [m[1], JSON.parse(m[2])]));

// ---- the editor's helpers say the same as main's ----------------------------------------------

test('the editor helpers mirror main for every option', async () => {
  const r = await loadRenderer();
  const samples = {
    webrtcMode: ['Forward', 'Replace', 'Real', 'Disabled', 'Proxy UDP', 'Block', 'Noise', '', null, 'disabled'],
    hardwareAccelerationChoice: ['Default', 'Open', 'Close', 'On', 'Off', 'enable', 'disabled', 'true', '', null, 'weird'],
    chromeVersionPin: ['Auto', '157', ' 150 ', '149.0.7827.155', '', null, 'Chromium', '1'],
    normalizeLocaleTag: ['en-us', 'pt_br', 'zh-hant-tw', 'de', 'x', 'en US', '', null],
    parseMediaCounts: [null, '', '{"mic":2,"spk":0,"cam":9}', { mic: -1, spk: '3', cam: 'x' }, '[1]'],
    parseFontList: ['Arial\nCalibri\n\narial\n"Bad"', ['Segoe UI', ' Segoe  UI ', 'A,B'], '["Arial","Tahoma"]', null],
    fontOsKey: ['Windows', 'macOS', 'Ubuntu', 'Android', '', 'ChromeOS'],
    normalizeMac: ['3c-a9-f4-12-34-56', '3ca9.f412.3456', '3C:A9:F4:12:34:5', 'zz:zz:zz:zz:zz:zz', ''],
    macAddressError: ['3C:A9:F4:12:34:56', '01:00:5E:00:00:01', '00:00:00:00:00:00', 'nope'],
    uaFamily: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', ''
    ],
    uaChromeMajor: ['Chrome/150.0.0.0', 'Firefox/140.0', '']
  };
  for (const [fn, inputs] of Object.entries(samples)) {
    for (const v of inputs) assert.deepEqual(r[fn](v), opts[fn](v), `${fn}(${JSON.stringify(v)})`);
  }
  for (const [name, osName] of [['DESKTOP-ABC1234', 'Windows'], ['DESKTOP-ABCDEFGHIJ', 'Windows'], ['Alexs-MacBook-Pro', 'macOS'], ["Alex's Pixel 7", 'Android'], ['bad name!', 'Linux'], ['', 'Windows']]) {
    assert.equal(r.deviceNameError(name, osName), opts.deviceNameError(name, osName), `deviceNameError(${name})`);
  }
  for (const p of [{ locationType: 'Block' }, { locationPrompt: 'Always allow' }, { locationPrompt: 'Ask each time' }, {}]) {
    assert.equal(r.geolocationPermission(p), opts.geolocationPermission(p));
  }
  for (const [v, rr] of [['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'], ['Apple Inc.', 'Apple M2'], ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'], ['Google Inc. (ARM)', 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)'], ['', '']]) {
    assert.deepEqual(r.webgpuInfoFromWebgl(v, rr), opts.webgpuInfoFromWebgl(v, rr));
  }
  assert.equal(r.MEDIA_COUNT_MAX, opts.MEDIA_COUNT_MAX);
});

// ---- 1-2. WebRTC: Replace works, Proxy UDP is gone -------------------------------------------------

test('WebRTC: "Proxy UDP" is gone from the editor and every stored value launches as it always did', async () => {
  assert.match(PAGE, /options=\{\['Forward', 'Replace', 'Real', 'Disabled'\]\}/);
  assert.doesNotMatch(PAGE, /'Proxy UDP'\]/);
  // Stored values the engine never special-cased keep launching as Forward.
  for (const v of ['Proxy UDP', 'Block', 'Noise', '', undefined]) assert.equal(opts.webrtcMode(v), 'Forward');
  assert.equal(opts.parseWebrtc('Proxy UDP'), 'Forward', 'an API or import "Proxy UDP" is saved as what it does');
  const { normalizeWebrtc } = (() => { const ctx = {}; vm.createContext(ctx); vm.runInContext(`${extractFunction(read('src', 'main', 'importParser.js'), 'normalizeHeader')}\n${extractFunction(read('src', 'main', 'importParser.js'), 'cellText')}\n${extractFunction(read('src', 'main', 'importParser.js'), 'normalizeWebrtc')}\nthis.normalizeWebrtc = normalizeWebrtc;`, ctx); return ctx; })();
  assert.equal(normalizeWebrtc('disabled'), 'Disabled', 'import stores the editor word, not "Block"');
  assert.equal(normalizeWebrtc('replace'), 'Replace');
});

test('WebRTC Replace: the exit IP is passed to the page only with a proxy and a known exit IP', () => {
  const geo = { query: '203.0.113.7', countryCode: 'US' };
  const replace = config({ webrtc: 'Replace' }, { webrtcMode: 'Replace', hasProxy: true, geo });
  assert.equal(replace.webrtcReplaceIp, '203.0.113.7');
  assert.equal(replace.webrtcProtect, true, 'Forward protection stays underneath');
  assert.equal(config({}, { webrtcMode: 'Replace', hasProxy: true, geo: null, webrtcIp: '198.51.100.2' }).webrtcReplaceIp, '198.51.100.2', 'the separate lookup when geo matching was skipped');
  assert.equal(config({}, { webrtcMode: 'Replace', hasProxy: false, geo }).webrtcReplaceIp, null, 'no proxy: works as Forward');
  assert.equal(config({}, { webrtcMode: 'Replace', hasProxy: true, geo: null }).webrtcReplaceIp, null, 'no exit IP: works as Forward');
  assert.equal(config({}, { webrtcMode: 'Proxy UDP', hasProxy: true, geo }).webrtcReplaceIp, null);
  assert.equal(config({}, { webrtcMode: 'Proxy UDP', hasProxy: true, geo }).webrtcProtect, true, 'Proxy UDP = Forward');
  // The launch looks the exit IP up when the geo lookup was skipped, and never sets the timezone from it.
  const launch = extractFunction(ENGINE, 'launchProfileSessionNow');
  assert.match(launch, /if \(webrtcMode === 'Replace' && resolvedProxy && !\(geo && geo\.query\)\)/);
  assert.match(launch, /buildFingerprintConfig\(profile, \{ seed, resW, resH, webrtcMode, hasProxy: Boolean\(resolvedProxy\), geo, timezone: timezoneId, webrtcIp, installedFonts \}\)/);
});

test('WebRTC: UDP that would bypass the proxy is blocked through the profile setting (Chrome 157 dropped the switch)', async () => {
  assert.equal(engine.webrtcPolicyFor(true, 'Forward'), 'disable_non_proxied_udp');
  assert.equal(engine.webrtcPolicyFor(true, 'Replace'), 'disable_non_proxied_udp');
  assert.equal(engine.webrtcPolicyFor(true, 'Disabled'), 'disable_non_proxied_udp');
  assert.equal(engine.webrtcPolicyFor(true, 'Real'), null);
  assert.equal(engine.webrtcPolicyFor(false, 'Forward'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-webrtc-'));
  try {
    const prefs = path.join(dir, 'Default', 'Preferences');
    await engine.ensureWebrtcPolicyPref(dir, 'disable_non_proxied_udp');
    assert.equal(JSON.parse(fs.readFileSync(prefs, 'utf8')).webrtc.ip_handling_policy, 'disable_non_proxied_udp');
    fs.writeFileSync(prefs, JSON.stringify({ keep: 1, webrtc: { ip_handling_policy: 'disable_non_proxied_udp', other: true } }));
    await engine.ensureWebrtcPolicyPref(dir, null);
    assert.deepEqual(JSON.parse(fs.readFileSync(prefs, 'utf8')), { keep: 1, webrtc: { other: true } }, 'Real / no proxy: only our value goes');
    fs.writeFileSync(prefs, JSON.stringify({ webrtc: { ip_handling_policy: 'default_public_interface_only' } }));
    await engine.ensureWebrtcPolicyPref(dir, null);
    assert.equal(JSON.parse(fs.readFileSync(prefs, 'utf8')).webrtc.ip_handling_policy, 'default_public_interface_only', 'a value SoftGlaze did not write is left alone');
    fs.writeFileSync(prefs, '{broken');
    await engine.ensureWebrtcPolicyPref(dir, 'disable_non_proxied_udp');
    assert.equal(fs.readFileSync(prefs, 'utf8'), '{broken', 'an unreadable Preferences file is never replaced');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(extractFunction(ENGINE, 'launchProfileSessionNow'), /await ensureWebrtcPolicyPref\(userDataDir, webrtcPolicyFor\(Boolean\(resolvedProxy\), webrtcMode\)\);/);
});

function rtcRealm() {
  const sb = { console, EventTarget, Event, Promise, Math, String, Object, Array, WeakMap, WeakSet, RegExp };
  sb.window = sb;
  vm.createContext(sb);
  // Globals as properties of the global object, as in a browser (a top-level class declaration would be
  // a lexical binding that the page script's replacement could not shadow).
  vm.runInContext(`
    this.RTCIceCandidate = class RTCIceCandidate { constructor(init) { Object.assign(this, init); } };
    this.RTCSessionDescription = class RTCSessionDescription { constructor(init) { Object.assign(this, init); } };
    this.RTCPeerConnectionIceEvent = class RTCPeerConnectionIceEvent extends Event { constructor(type, init) { super(type); this.candidate = init.candidate; } };
    this.RTCPeerConnection = class RTCPeerConnection extends EventTarget {
      constructor(cfg) { super(); this._cfg = cfg || {}; this._h = null; }
      getConfiguration() { return this._cfg; }
      get localDescription() { return { type: 'offer', sdp: 'v=0\\r\\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\\r\\nc=IN IP4 0.0.0.0\\r\\na=ice-ufrag:abcd\\r\\na=mid:0\\r\\n' }; }
      get currentLocalDescription() { return null; }
      get pendingLocalDescription() { return null; }
      set onicecandidate(h) { if (this._h) this.removeEventListener('icecandidate', this._h); this._h = h; if (h) this.addEventListener('icecandidate', h); }
      get onicecandidate() { return this._h; }
      endGathering() { const e = new Event('icecandidate'); e.candidate = null; this.dispatchEvent(e); }
    };
  `, sb);
  return sb;
}

test('WebRTC Replace in the page: one srflx candidate with the exit IP before the end of gathering, only with a STUN/TURN server', () => {
  const sb = rtcRealm();
  // markNative as the page scripts pass it: it names the function.
  vm.runInContext(`(${engine.profileExtrasScript.toString()})(${JSON.stringify({ webrtcReplaceIp: '203.0.113.7' })}, { markNative: function (f, n) { try { Object.defineProperty(f, 'name', { value: n }); } catch (e) {} return f; } });`, sb);
  const seen = JSON.parse(vm.runInContext(`(function () {
    var out = { withStun: [], noStun: [] };
    var pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.example.com:3478'] }] });
    pc.onicecandidate = function (e) { out.withStun.push(e.candidate ? e.candidate.candidate : null); };
    pc.endGathering();
    out.sdp = pc.localDescription.sdp;
    out.name = RTCPeerConnection.name;
    var bare = new RTCPeerConnection({});
    bare.addEventListener('icecandidate', function (e) { out.noStun.push(e.candidate ? 'cand' : null); });
    bare.endGathering();
    return JSON.stringify(out);
  })()`, sb));
  assert.equal(seen.withStun.length, 2);
  assert.match(seen.withStun[0], /^candidate:\d+ 1 udp 1677729535 203\.0\.113\.7 \d+ typ srflx raddr 0\.0\.0\.0 rport 0 generation 0 ufrag abcd network-cost 999$/);
  assert.equal(seen.withStun[1], null, 'then the end of gathering');
  assert.match(seen.sdp, /m=application \d{5} UDP/, 'the section takes the candidate\'s port');
  assert.match(seen.sdp, /c=IN IP4 203\.0\.113\.7/);
  assert.match(seen.sdp, /a=candidate:\d+ 1 udp 1677729535 203\.0\.113\.7 \d+ typ srflx raddr 0\.0\.0\.0 rport 0 generation 0 network-cost 999/);
  assert.deepEqual(seen.noStun, [null], 'without a STUN or TURN server a real browser shows no public address either');
  assert.equal(seen.name, 'RTCPeerConnection');
});

// ---- 3. Fonts > Custom ---------------------------------------------------------------------------

test('Fonts: Custom hides every known family that is not allowed; Default and Real hide nothing', () => {
  assert.equal(opts.allowedFonts({ fontsType: 'Default' }), null);
  assert.equal(opts.allowedFonts({ fontsType: 'Real' }), null);
  assert.deepEqual(opts.allowedFonts({ fontsType: 'Custom', os: 'macOS' }), DATA.fonts.macOS, 'an empty list is the OS standard set');
  assert.deepEqual(opts.allowedFonts({ fontsType: 'Custom', fontsList: '["Arial","Calibri"]' }), ['Arial', 'Calibri']);
  const hidden = opts.hiddenFonts(['Arial', 'calibri'], ['My Installed Font']);
  assert.ok(!hidden.some((f) => /^(arial|calibri)$/i.test(f)), 'allowed fonts stay visible');
  assert.ok(hidden.includes('Tahoma') && hidden.includes('Helvetica Neue') && hidden.includes('My Installed Font'));
  for (const g of ['serif', 'sans-serif', 'monospace', 'system-ui']) assert.ok(!hidden.includes(g), `${g} is never hidden`);
  assert.deepEqual(opts.familiesFromRegistryName('Cambria & Cambria Math (TrueType)'), ['Cambria', 'Cambria Math']);
  assert.deepEqual(opts.familiesFromRegistryName('Arial Bold Italic (TrueType)'), ['Arial Bold Italic', 'Arial']);
  const fp = config({ fontsType: 'Custom', fontsList: ['Arial'] }, { installedFonts: ['Zeta Sans'] });
  assert.ok(fp.fontsHidden.includes('Zeta Sans') && !fp.fontsHidden.includes('Arial'));
  assert.deepEqual(fp.fontsAllowed, ['Arial']);
  assert.ok(fp.fontsMissingLocal && !DATA.fonts.Windows.includes(fp.fontsMissingLocal));
  assert.equal(config({ fontsType: 'Default' }).fontsHidden, null);
  assert.equal(config({ fontsType: 'Default' }).fontsNoise, true, 'Default keeps the measureText noise');
});

function fontRealm() {
  const sb = { console, Promise, Symbol, Object, Array, Set, WeakSet, Reflect, String, RegExp, TypeError };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(`
    var INSTALLED = ['arial', 'calibri', 'tahoma', 'arial narrow'];
    function FontFace(family, source, descriptors) {
      if (!new.target) throw new TypeError("Failed to construct 'FontFace': Please use the 'new' operator");
      this.family = family; this.source = source; this.descriptors = descriptors || {};
    }
    FontFace.prototype.load = function () {
      var m = /local\\("([^"]+)"\\)/.exec(this.source);
      return INSTALLED.indexOf(m ? m[1].toLowerCase() : '') !== -1 ? Promise.resolve(this) : Promise.reject(new Error('NetworkError'));
    };
    class FontFaceSet {
      constructor() { this._s = new Set(); }
      add(f) { this._s.add(f); return this; }
      delete(f) { return this._s.delete(f); }
      has(f) { return this._s.has(f); }
      clear() { this._s.clear(); }
      forEach(cb, t) { this._s.forEach((v) => cb.call(t, v, v, this)); }
      get size() { return this._s.size; }
      values() { return this._s.values(); }
      entries() { return this._s.entries(); }
    }
    FontFaceSet.prototype.keys = FontFaceSet.prototype.values;
    FontFaceSet.prototype[Symbol.iterator] = FontFaceSet.prototype.values;
    this.FontFace = FontFace;
    this.document = { fonts: new FontFaceSet() };
  `, sb);
  return sb;
}

test('Fonts in the page: placeholders shadow hidden families, stay out of document.fonts, and local() of a hidden font fails', async () => {
  const sb = fontRealm();
  const fp = { fontsHidden: ['Calibri', 'Tahoma', 'Arial Narrow'], fontsAllowed: ['Arial'], fontsShadowSources: ['Arial', 'Helvetica'], fontsMissingLocal: 'Fmissing123' };
  vm.runInContext(`(${engine.profileExtrasScript.toString()})(${JSON.stringify(fp)}, { markNative: function (f, n) { try { Object.defineProperty(f, 'name', { value: n }); } catch (e) {} return f; } });`, sb);
  const r = JSON.parse(vm.runInContext(`(function () {
    var set = document.fonts;
    var placeholders = set._s.size;
    // The fake keeps a real Set, whose iterator is the one the script adjusts: read it with forEach.
    var first = null; set._s.forEach(function (f) { if (!first) first = f; });
    var out = { placeholders: placeholders, range: first.descriptors.unicodeRange, src: first.source,
      size: set.size, spread: Array.from(set).length, forEach: 0, entries: Array.from(set.entries()).length };
    set.forEach(function () { out.forEach += 1; });
    var site = new FontFace('Site Font', 'url(x.woff2)');
    set.add(site);
    out.siteVisible = set.size === 1 && Array.from(set)[0] === site;
    set.clear();
    out.afterClear = set._s.size;
    out.calibri = new FontFace('p', 'local("Calibri")').source;
    out.calibriBold = new FontFace('p', "local('Calibri Bold'), local(Arial)").source;
    out.arial = new FontFace('p', 'local("Arial")').source;
    out.arialNarrow = new FontFace('p', 'local("Arial Narrow")').source;
    out.instance = new FontFace('p', 'local("Arial")') instanceof FontFace;
    out.name = FontFace.name; out.length = FontFace.length;
    try { FontFace('x', 'y'); out.noNew = 'no throw'; } catch (e) { out.noNew = e.name; }
    return JSON.stringify(out);
  })()`, sb));
  assert.equal(r.placeholders, 3);
  assert.equal(r.range, 'U+10FFFF', 'covers no character text uses');
  assert.equal(r.src, 'local("Arial"), local("Helvetica")', 'loads from a font the computer has');
  assert.equal(r.size, 0); assert.equal(r.spread, 0); assert.equal(r.forEach, 0); assert.equal(r.entries, 0);
  assert.equal(r.siteVisible, true, 'a site\'s own faces are listed as usual');
  assert.equal(r.afterClear, 3, 'clear() keeps the placeholders');
  assert.equal(r.calibri, 'local("Fmissing123")');
  assert.equal(r.calibriBold, 'local("Fmissing123"), local(Arial)');
  assert.equal(r.arial, 'local("Arial")', 'allowed fonts load as usual');
  assert.equal(r.arialNarrow, 'local("Fmissing123")', 'the longest family wins (Arial Narrow is hidden, Arial is not)');
  assert.equal(r.instance, true); assert.equal(r.name, 'FontFace'); assert.equal(r.length, 2); assert.equal(r.noNew, 'TypeError');
});

test('Fonts on Firefox use its own allowlist (font.system.whitelist); Default lifts it', () => {
  assert.equal(prefsOf(ff.buildUserJs({ fontsAllowed: ['Arial', 'Segoe UI'] }))['font.system.whitelist'], 'Arial, Segoe UI');
  assert.equal(prefsOf(ff.buildUserJs({ fontsAllowed: null }))['font.system.whitelist'], '');
  assert.equal(prefsOf(ff.buildUserJs({}))['font.system.whitelist'], undefined, 'older callers write nothing');
});

test('Fonts: the editor edits the list, starts from the OS standard set, and the overview counts it', () => {
  assert.match(PAGE, /onChange=\{e => updatePd\('fontsList', e\.target\.value\)\}/);
  assert.match(PAGE, /nextState\.fontsList = \(fontDefaults\[fontOsKey\(prev\.os\)\] \|\| \[\]\)\.slice\(\);/);
  assert.match(extractFunction(PAGE, 'handleSaveProfile'), /fontsList: parseFontList\(pd\.fontsList\)/);
  assert.match(IPC, /fontsList: input\.fontsList === undefined \? undefined/);
  assert.match(ENV_MODAL, /t\('envOverview\.fontsCustom'/);
});

// ---- 4. Location permission ------------------------------------------------------------------------

test('Location: Block denies, Always allow grants, Ask each time leaves the prompt; the real location is never granted silently', () => {
  const fp = {};
  const late = { geoLat: 52.37, geoLng: 4.9, geoAcc: 10 };
  const methods = (perm, l = late) => engine.targetFingerprintCommands('page', fp, { ...l, geoPermission: perm }).map((c) => c.method + (c.params && c.params.setting ? ':' + c.params.setting : ''));
  assert.deepEqual(methods('denied'), ['Browser.setPermission:denied']);
  assert.deepEqual(methods('granted'), ['Browser.grantPermissions', 'Emulation.setGeolocationOverride']);
  assert.deepEqual(methods('prompt'), ['Emulation.setGeolocationOverride'], 'the browser asks; if allowed, the profile location is used');
  assert.deepEqual(methods('granted', {}), [], 'no coordinates: nothing granted');
  assert.deepEqual(engine.targetFingerprintCommands('page', fp, late).map((c) => c.method), ['Browser.grantPermissions', 'Emulation.setGeolocationOverride'], 'older callers keep the old behaviour');
  assert.equal(opts.geolocationPermission({ locationType: 'Block', locationPrompt: 'Always allow' }), 'denied');
  assert.equal(opts.geolocationPermission({ locationType: 'Based on IP', locationPrompt: 'Always allow' }), 'granted');
  assert.equal(opts.geolocationPermission({ locationType: 'Custom', locationPrompt: 'Ask each time' }), 'prompt');
  assert.match(extractFunction(ENGINE, 'launchProfileSessionNow'), /fpLate\.geoPermission = profileOptions\.geolocationPermission\(profile\);/);
});

test('Location on Firefox: coordinates through a data: provider, the permission as Firefox\'s default, Block turns it off', () => {
  const p = prefsOf(ff.buildUserJs({ location: { permission: 'granted', lat: 52.37, lng: 4.9, accuracy: 25 } }));
  assert.equal(p['geo.enabled'], true);
  assert.deepEqual(JSON.parse(p['geo.provider.network.url'].replace(/^data:application\/json,/, '')), { location: { lat: 52.37, lng: 4.9 }, accuracy: 25 });
  assert.equal(p['permissions.default.geo'], 1);
  assert.equal(p['geo.provider.ms-windows-location'], false);
  assert.equal(prefsOf(ff.buildUserJs({ location: { permission: 'prompt', lat: 1, lng: 2 } }))['permissions.default.geo'], 0);
  assert.equal(prefsOf(ff.buildUserJs({ location: { permission: 'denied', lat: 1, lng: 2 } }))['geo.enabled'], false);
  assert.equal(prefsOf(ff.buildUserJs({ location: { permission: 'granted', lat: NaN, lng: NaN } }))['geo.enabled'], false, 'no coordinates: off, as before');
  assert.equal(prefsOf(ff.buildUserJs({}))['geo.enabled'], false);
});

// ---- 5. Display language --------------------------------------------------------------------------

test('Display Language sets the browser UI language, apart from the websites\' languages', () => {
  const langs = ['de-DE', 'de', 'en'];
  assert.equal(opts.displayLocale({ displayLangType: 'Based on Language' }, langs), 'de-DE', 'as before');
  assert.equal(opts.displayLocale({}, langs), 'de-DE');
  assert.equal(opts.displayLocale({ displayLangType: 'Custom', displayLangCustom: 'fr_fr' }, langs), 'fr-FR');
  assert.equal(opts.displayLocale({ displayLangType: 'Custom', displayLangCustom: 'not a tag' }, langs), 'de-DE', 'an unusable custom value falls back');
  assert.equal(opts.displayLocale({ displayLangType: 'Real' }, langs), null, 'Real: no --lang, the computer\'s own');
  const fp = config({ displayLangType: 'Custom', displayLangCustom: 'ja', languageType: 'Custom', languageCustom: 'en-US,en' });
  assert.equal(fp.uiLocale, 'ja');
  assert.deepEqual(fp.langs, ['en-US', 'en'], 'websites still get the Language setting');
  const launch = extractFunction(ENGINE, 'launchProfileSessionNow');
  assert.match(launch, /const uiLocale = fpConfig\.uiLocale \|\| null;\s*if \(uiLocale\) args\.push\(`--lang=\$\{uiLocale\}`\);/);
  assert.doesNotMatch(launch, /--lang=\$\{primaryLocale\}/);
  assert.match(extractFunction(ENGINE, 'buildAntidetectFlags'), /if \(uiLocale\) flags\.push\(`--lang=\$\{uiLocale\}`\);/);
  assert.equal(prefsOf(ff.buildUserJs({ acceptLanguages: 'en-US,en', uiLocale: 'de-DE' }))['intl.locale.requested'], 'de-DE');
  assert.equal(prefsOf(ff.buildUserJs({ acceptLanguages: 'en-US,en', uiLocale: '' }))['intl.locale.requested'], '', 'Real on Firefox: the OS language');
  assert.equal(prefsOf(ff.buildUserJs({ acceptLanguages: 'en-US,en' }))['intl.locale.requested'], 'en-US', 'older callers as before');
});

// ---- 6. Media devices --------------------------------------------------------------------------------

test('Media Device Edit: the counts reach the page; Auto keeps one of each with the same labels as before', async () => {
  const auto = generateMediaDevices('Windows', 7);
  assert.deepEqual([auto.mics.length, auto.spks.length, auto.cams.length], [1, 1, 1]);
  assert.equal(auto.mics[0], auto.mic, 'the first device keeps the label it always had');
  const edit = generateMediaDevices('Windows', 7, { mic: 2, spk: 0, cam: 6 });
  assert.deepEqual([edit.mics.length, edit.spks.length, edit.cams.length], [2, 0, 6]);
  assert.equal(new Set(edit.cams).size, 6, 'labels never repeat (numbered once the pool is used up)');
  assert.deepEqual(config({ mediaDevice: 'Edit', mediaDeviceCounts: '{"mic":0,"spk":3,"cam":1}' }).mediaSet.spks.length, 3);
  assert.equal(config({ mediaDevice: 'Auto', mediaDeviceCounts: '{"mic":0}' }).mediaSet.mics.length, 1, 'counts apply only with Edit');

  const run = (fp) => {
    const sb = { console, Promise, DOMException, Object, Array, String, Math, WeakSet };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(`
      function MediaDevices() {}
      MediaDevices.prototype.enumerateDevices = function () { return Promise.resolve([]); };
      MediaDevices.prototype.getUserMedia = function () { return Promise.resolve({}); };
      this.navigator = { mediaDevices: new MediaDevices() };
    `, sb);
    vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify(fp)});`, sb);
    return vm.runInContext(`(async function () {
      var pre = (await navigator.mediaDevices.enumerateDevices()).map(function (d) { return d.kind; });
      var audio = await navigator.mediaDevices.getUserMedia({ audio: true }).then(function () { return 'ok'; }, function (e) { return e.name; });
      var video = await navigator.mediaDevices.getUserMedia({ video: true }).then(function () { return 'ok'; }, function (e) { return e.name; });
      var post = (await navigator.mediaDevices.enumerateDevices()).map(function (d) { return d.kind + '|' + d.deviceId; });
      return JSON.stringify({ pre: pre, audio: audio, video: video, post: post });
    })()`, sb).then(JSON.parse);
  };
  const base = { seed: 7, guard: 'gMedia1', mediaDevices: true, noise: { canvas: false, webgl: false, audio: false, clientRects: false } };
  const r = await run({ ...base, mediaSet: generateMediaDevices('Windows', 7, { mic: 2, spk: 0, cam: 1 }) });
  assert.deepEqual(r.pre, ['audioinput', 'videoinput'], 'no speaker: no audiooutput entry before a grant');
  assert.equal(r.audio, 'ok');
  assert.equal(r.post.filter((x) => x.startsWith('audioinput|')).length, 4, 'Default + Communications + two microphones');
  assert.equal(new Set(r.post.map((x) => x.split('|')[1])).size, r.post.length - 2 + 2, 'distinct ids (default/communications are their own)');
  assert.equal(r.post.filter((x) => x.startsWith('audiooutput|')).length, 0);
  const none = await run({ ...base, mediaSet: generateMediaDevices('Windows', 7, { mic: 0, spk: 1, cam: 0 }) });
  assert.deepEqual(none.pre, ['audiooutput']);
  assert.equal(none.audio, 'NotFoundError', 'a kind the profile has none of is not found');
  assert.equal(none.video, 'NotFoundError');
});

// ---- 7. WebGPU -----------------------------------------------------------------------------------

test('WebGPU Based on WebGL: adapter info names the WebGL GPU\'s maker and family; Real and Disabled do not', () => {
  assert.deepEqual(opts.webgpuInfoFromWebgl('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), { vendor: 'nvidia', architecture: 'lovelace' });
  assert.deepEqual(opts.webgpuInfoFromWebgl('Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)'), { vendor: 'amd', architecture: 'rdna-2' });
  assert.deepEqual(opts.webgpuInfoFromWebgl('Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), { vendor: 'intel', architecture: 'gen-12lp' });
  assert.deepEqual(opts.webgpuInfoFromWebgl('Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'), { vendor: 'apple', architecture: 'metal-3' });
  assert.deepEqual(opts.webgpuInfoFromWebgl('Google Inc. (ARM)', 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)'), { vendor: 'arm', architecture: 'valhall' });
  const custom = { webglMetadata: 'Custom', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' };
  assert.deepEqual(config({ ...custom, webgpu: 'Based on WebGL' }).webgpuInfo, { vendor: 'nvidia', architecture: 'ampere' });
  assert.deepEqual(config({ ...custom }).webgpuInfo, { vendor: 'nvidia', architecture: 'ampere' }, 'the editor default');
  assert.equal(config({ ...custom, webgpu: 'Real' }).webgpuInfo, null);
  assert.equal(config({ ...custom, webgpu: 'Disabled' }).webgpuInfo, null);
  assert.equal(config({ ...custom, webgpu: 'Disabled' }).webgpuDisabled, true);
  if (process.platform === 'win32') assert.equal(config({ webgpu: 'Based on WebGL', webglMetadata: 'Real' }).webgpuInfo, null, 'WebGL real: WebGPU already matches');
  assert.match(engine.workerPreludeSource(config({ ...custom })), /"gpuInfo":\{"vendor":"nvidia","architecture":"ampere"\}/, 'workers get it too');
  assert.match(extractFunction(ENGINE, 'launchProfileSessionNow'), /if \(usingAntidetect\) fpConfig\.webgpuInfo = null;/, 'fingerprint-chromium seeds its own WebGL GPU, so WebGPU is left to it');

  const sb = { console, Object, TypeError };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(`
    class GPUAdapterInfo {
      get vendor() { if (!(this instanceof GPUAdapterInfo)) throw new TypeError('Illegal invocation'); return 'intel'; }
      get architecture() { if (!(this instanceof GPUAdapterInfo)) throw new TypeError('Illegal invocation'); return 'gen-9'; }
      get device() { if (!(this instanceof GPUAdapterInfo)) throw new TypeError('Illegal invocation'); return ''; }
      get description() { if (!(this instanceof GPUAdapterInfo)) throw new TypeError('Illegal invocation'); return ''; }
    }
    this.GPUAdapterInfo = GPUAdapterInfo;
  `, sb);
  vm.runInContext(`(${engine.profileExtrasScript.toString()})(${JSON.stringify({ webgpuInfo: { vendor: 'nvidia', architecture: 'ampere' } })}, { markNative: (f) => f });`, sb);
  const r = JSON.parse(vm.runInContext(`(function () { var i = new GPUAdapterInfo(); var illegal;
    try { Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype, 'vendor').get.call({}); illegal = 'no throw'; } catch (e) { illegal = e.name; }
    return JSON.stringify({ vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, illegal: illegal }); })()`, sb));
  assert.deepEqual(r, { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', illegal: 'TypeError' });
});

// ---- 8. Hardware acceleration -----------------------------------------------------------------------

test('Hardware Acceleration: Default adds nothing, On forces the GPU, Off disables it; Open/Close are On/Off', () => {
  assert.deepEqual(opts.hardwareAccelerationArgs('Default'), []);
  assert.deepEqual(opts.hardwareAccelerationArgs(undefined), []);
  assert.deepEqual(opts.hardwareAccelerationArgs('On'), ['--ignore-gpu-blocklist']);
  assert.deepEqual(opts.hardwareAccelerationArgs('Open'), ['--ignore-gpu-blocklist']);
  assert.deepEqual(opts.hardwareAccelerationArgs('Off'), ['--disable-gpu']);
  assert.deepEqual(opts.hardwareAccelerationArgs('Close'), ['--disable-gpu'], 'as before');
  assert.match(PAGE, /options=\{\['Default', 'On', 'Off'\]\}/);
  assert.match(extractFunction(ENGINE, 'launchProfileSessionNow'), /args\.push\(\.\.\.profileOptions\.hardwareAccelerationArgs\(profile\.hardwareAcceleration\)\);/);
  const on = prefsOf(ff.buildUserJs({ hardwareAcceleration: 'On' }));
  assert.equal(on['layers.acceleration.force-enabled'], true);
  assert.equal(on['layers.acceleration.disabled'], false);
  const off = prefsOf(ff.buildUserJs({ hardwareAcceleration: 'Off' }));
  assert.equal(off['layers.acceleration.disabled'], true);
  assert.equal(off['gfx.webrender.software'], true);
  assert.equal(prefsOf(ff.buildUserJs({ hardwareAcceleration: 'Default' }))['layers.acceleration.force-enabled'], false);
});

// ---- 9. Local and HTTPS proxies ------------------------------------------------------------------

test('"Local" is a proxy program on this PC, saved and checked as the protocol picked for it', () => {
  assert.match(PAGE, /<option value="Local">\{t\('proxy\.typeLocal'\)\}<\/option>/);
  assert.match(PAGE, /if \(v === 'Local' && !pd\.proxyHost\) updatePd\('proxyHost', '127\.0\.0\.1'\);/);
  assert.match(extractFunction(PAGE, 'handleSaveProfile'), /proxyType: pd\.proxyType === 'Local' \? pd\.localProxyProtocol : pd\.proxyType,/);
  assert.match(extractFunction(PAGE, 'handleCheckProxy'), /type: pd\.proxyType === 'Local' \? pd\.localProxyProtocol : pd\.proxyType/);
});

test('HTTPS proxies stay HTTPS: parsed, saved, checked over TLS and launched as https://', () => {
  assert.equal(engine.parseProxyInput('https://u:p@proxy.example:443').type, 'HTTPS');
  assert.equal(engine.buildProxyServerArgument({ type: 'HTTPS', host: 'proxy.example', port: 443 }), 'https://proxy.example:443');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction(IPC, 'proxyAgentScheme')}\nthis.scheme = proxyAgentScheme;`, ctx);
  assert.equal(ctx.scheme('HTTPS'), 'https');
  assert.equal(ctx.scheme('HTTP'), 'http');
  assert.match(read('prisma', 'schema.prisma'), /enum ProxyType \{\s*HTTP\s*HTTPS\s*SOCKS5\s*SOCKS4\s*\}/);
  const relay = read('src', 'main', 'httpRelay.js');
  assert.match(relay, /tls\.connect\(\{ host: upstreamHost, port: upstreamPort, servername \}\)/);
  assert.match(read('src', 'main', 'firefoxEngine.js'), /proxyIsHttps \? await startHttpAuthRelay\(proxy\)/, 'Firefox reaches an HTTPS proxy through the TLS relay');
  assert.match(read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx'), /<option value="HTTPS">HTTPS<\/option>/);
});

test('the HTTP relay sends Proxy-Authorization only when there are credentials', async () => {
  const { startHttpAuthRelay } = require('../src/main/httpRelay');
  const seen = [];
  const upstream = net.createServer((s) => { s.once('data', (d) => { seen.push(String(d)); s.end('HTTP/1.1 200 OK\r\n\r\n'); }); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const port = upstream.address().port;
  const connectThrough = async (relayOpts) => {
    const relay = await startHttpAuthRelay({ host: '127.0.0.1', port, ...relayOpts });
    await new Promise((resolve) => {
      const c = net.connect(relay.port, '127.0.0.1', () => c.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'));
      c.on('data', () => { c.destroy(); resolve(); });
      c.on('error', resolve);
      setTimeout(resolve, 2000);
    });
    relay.close();
  };
  try {
    await connectThrough({ type: 'HTTP' });
    await connectThrough({ type: 'HTTP', username: 'u', password: 'p' });
  } finally { upstream.close(); }
  assert.doesNotMatch(seen[0], /Proxy-Authorization/i);
  assert.match(seen[1], /Proxy-Authorization: Basic dTpw/);
});

// ---- 10. A picked User-Agent -------------------------------------------------------------------------

test('User-Agent: a picked UA is applied with matching Client Hints; Auto (and older profiles) keep the browser\'s own', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
  assert.equal(opts.customUserAgent({ userAgent: chrome }), null, 'no mode (before 1.0.26): Auto');
  assert.equal(opts.customUserAgent({ userAgent: chrome, userAgentMode: 'Auto' }), null);
  assert.equal(opts.customUserAgent({ userAgent: chrome, userAgentMode: 'Custom' }), chrome);
  const b = opts.customUserAgentBundle(chrome, { osVersion: '11' }, {}, { major: 150, fullVersion: '150.0.7871.46' });
  assert.equal(b.userAgent, chrome);
  assert.equal(b.navPlatform, 'Win32');
  assert.deepEqual(b.userAgentMetadata.brands.map((x) => x.brand), ['Chromium', 'Google Chrome', 'Not_A Brand']);
  assert.equal(b.userAgentMetadata.fullVersionList[0].version, '150.0.7871.46');
  assert.equal(b.userAgentMetadata.platform, 'Windows');
  assert.equal(b.userAgentMetadata.platformVersion, '15.0.0');
  const edge = opts.customUserAgentBundle('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0', { osVersion: '14' }, {}, { major: 157 });
  assert.ok(edge.userAgentMetadata.brands.some((x) => x.brand === 'Microsoft Edge' && x.version === '149'));
  assert.equal(edge.userAgentMetadata.platform, 'macOS');
  assert.equal(edge.navPlatform, 'MacIntel');
  const android = opts.customUserAgentBundle('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36', {}, {}, {});
  assert.equal(android.userAgentMetadata.model, 'SM-S918B');
  assert.equal(android.userAgentMetadata.mobile, true);
  const firefox = opts.customUserAgentBundle('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', {}, { navPlatform: 'Win32' }, {});
  assert.equal(firefox.userAgentMetadata, undefined, 'no Client Hints, so navigator.userAgentData is absent as in Firefox');
  const fpFirefox = config({ userAgentMode: 'Custom', userAgent: firefox.userAgent });
  assert.equal(fpFirefox.brandVendor, '', 'Firefox has an empty navigator.vendor');
  assert.deepEqual(fpFirefox.brandInject, []);
  assert.equal(config({ userAgentMode: 'Custom', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }).navPlatform, 'MacIntel');
  // Applied on both engines when picked; the anti-detect engine keeps its own on Auto.
  const ua = { ...b, custom: true };
  assert.ok(engine.targetFingerprintCommands('page', { nativeEngine: true }, { ua }).some((c) => c.method === 'Emulation.setUserAgentOverride'));
  assert.ok(!engine.targetFingerprintCommands('page', { nativeEngine: true }, { ua: { ...b, custom: false } }).some((c) => c.method === 'Emulation.setUserAgentOverride'));
  assert.match(extractFunction(ENGINE, 'launchProfileSessionNow'), /const ua = pickedUa\s*\?\s*profileOptions\.customUserAgentBundle\(pickedUa, profile, autoUa, \{ major: realMajor, fullVersion: realFullVersion \}\)\s*:\s*autoUa;/);
});

test('User-Agent: the editor records the pick, keeps an Auto profile\'s UA, and warns when the UA does not fit the browser', async () => {
  const r = await loadRenderer();
  const chrome150 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
  assert.equal(r.userAgentWarning('Auto', 'Chromium', 157), null);
  assert.deepEqual(r.userAgentWarning(chrome150, 'Chromium', 157), { kind: 'version', uaMajor: 150, launchMajor: 157 });
  assert.equal(r.userAgentWarning(chrome150, 'Chromium', 150), null);
  assert.deepEqual(r.userAgentWarning('Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0', 'Chromium', 157), { kind: 'engine', family: 'firefox' });
  assert.deepEqual(r.userAgentWarning('Googlebot/2.1', 'Chromium', 157), { kind: 'engine', family: 'bot' });
  assert.deepEqual(r.userAgentWarning(chrome150, 'Firefox', null), { kind: 'firefoxIgnored', family: 'chromium' });
  assert.match(PAGE, /if \(k === 'userAgent'\) nextState\.userAgentMode = v === 'Auto' \? 'Auto' : 'Custom';/);
  const save = extractFunction(PAGE, 'handleSaveProfile');
  assert.match(save, /userAgentMode: pd\.userAgent === 'Auto' \? 'Auto' : 'Custom',/);
  assert.match(save, /\(pd\.autoUserAgent \|\| generateAutoUserAgent\(/, 'an Auto profile keeps its stored UA');
  const edit = extractFunction(PAGE, 'openEdit');
  assert.match(edit, /userAgent: profile\.userAgentMode === 'Custom' \? \(profile\.userAgent \|\| 'Auto'\) : 'Auto',/);
  assert.match(PAGE, /\{uaWarning && \(/);
});

// ---- 11. The Environment Overview gear ------------------------------------------------------------

test('the Environment Overview side panel has no dead Settings gear', () => {
  assert.doesNotMatch(PAGE, /t\('env\.settings'\)/);
  for (const lang of ['en', 'es']) assert.equal(locale(lang, 'profiles').env.settings, undefined);
});

// ---- 12. Chrome version picker -------------------------------------------------------------------

test('Chrome version: Auto = installed Google Chrome, else the newest download; a picked version opens that version', () => {
  const real = { exePath: 'chrome.exe', major: 157, version: '157.0.8103.39', isReal: true };
  const downloads = [{ major: 159, version: '159.0.1', exePath: 'cft159' }, { major: 150, version: '150.0.1', exePath: 'cft150' }];
  const resolve = (want) => { const m = Number((String(want || '').match(/\d+/) || [])[0]); return downloads.find((d) => d.major === m) || downloads[0]; };
  const deps = (hasReal = true) => ({ findRealChrome: () => (hasReal ? real : null), listAvailableBrowsers: () => downloads, resolveBrowserExecutable: resolve });
  const pick = (browserVersion, o = {}, hasReal = true) => engine.chooseBrowserBinary({ browserVersion }, o, deps(hasReal));
  assert.equal(pick('Auto').exePath, 'chrome.exe');
  assert.equal(pick('Auto', {}, false).exePath, 'cft159', 'no Chrome: the newest download');
  assert.equal(pick('150').exePath, 'cft150', 'a picked version opens that download');
  assert.equal(pick('150').pinned, true);
  assert.equal(pick('157').exePath, 'chrome.exe', 'Google Chrome when it is that version');
  assert.equal(pick('148').exePath, 'chrome.exe', 'not downloaded: Auto');
  assert.equal(pick('148', {}, false).exePath, 'cft159');
  assert.equal(pick('150.0.7871.46').exePath, 'chrome.exe', 'a generated full version is no pick: Auto, as before');
  assert.equal(pick('150.0.7871.46', {}, false).exePath, 'cft150', 'without Chrome it prefers the matching download, as before');
  assert.equal(pick('Auto', { preferCftForExtensions: true }).exePath, 'cft159', 'extensions still use a downloaded build');
  assert.equal(pick('150', { preferCftForExtensions: true }).exePath, 'cft150');
  for (const lang of ['en', 'es']) {
    const g = locale(lang, 'profiles').general;
    assert.equal(g.installedBuilds_one, undefined, `${lang}: the old "launches the matching binary" text is gone`);
    assert.ok(g.versionRule && g.launchesAutoReal && g.launchesPinnedMissing);
  }
  assert.match(PAGE, /t\('general\.versionRule'\)/);
  assert.match(IPC, /realChrome = \{ major: r\.major \|\| null, version: r\.version \|\| '' \}/, 'the editor learns which Chrome Auto opens');
});

// ---- 13. Device name and MAC address -------------------------------------------------------------

test('Device name and MAC: realistic for the OS, from registered network-adapter prefixes, validated', () => {
  let n = 0;
  const rnd = (max) => (n++ * 7) % max;
  assert.match(opts.generateDeviceName('Windows', rnd), /^DESKTOP-[A-Z0-9]{7}$/);
  assert.match(opts.generateDeviceName('macOS'), /^[A-Z][a-z]+s-(MacBook-Pro|MacBook-Air|iMac|Mac-mini|Mac-Studio)$/);
  assert.match(opts.generateDeviceName('Ubuntu'), /^[a-z]+-[A-Za-z0-9-]+$/);
  assert.match(opts.generateDeviceName('Android'), /^[A-Z][a-z]+'s Pixel 7$/);
  for (let i = 0; i < 50; i += 1) {
    const w = opts.generateMacAddress('Windows');
    assert.ok(DATA.oui.pc.includes(w.slice(0, 8)), `${w} has a PC adapter prefix`);
    assert.equal(opts.macAddressError(w), null);
    assert.ok(DATA.oui.apple.includes(opts.generateMacAddress('macOS').slice(0, 8)));
    const a = opts.generateMacAddress('Android');
    assert.equal(Number.parseInt(a.slice(0, 2), 16) & 0x03, 0x02, 'Android: a randomised (locally administered, unicast) address');
    for (const osName of ['Windows', 'macOS', 'Linux', 'Android']) assert.equal(opts.deviceNameError(opts.generateDeviceName(osName), osName), null);
  }
  assert.equal(opts.deviceNameError('WORKSTATION-1A2B3C4D', 'Windows'), 'length', 'over 15 characters is not a Windows name');
  assert.equal(opts.deviceNameError('DESK TOP', 'Windows'), 'characters');
  assert.equal(opts.macAddressError('01:00:5E:00:00:01'), 'multicast');
  assert.equal(opts.normalizeMac('3c-a9-f4-12-34-56'), '3C:A9:F4:12:34:56');
  const taken = { names: new Set(['desktop-aaaaaaa']), macs: new Set() };
  const same = () => 0; // always the first pick: a collision
  const id = opts.uniqueDeviceIdentity('macOS', { names: new Set([opts.generateDeviceName('macOS', same).toLowerCase()]), macs: new Set() }, same);
  assert.match(id.deviceName, /-2$/, 'a used name is numbered rather than repeated');
  assert.ok(!taken.names.has(opts.uniqueDeviceIdentity('Windows', taken).deviceName.toLowerCase()));
});

test('Device name and MAC: unique in the workspace on create, clone, template, import; a typed duplicate is refused', async () => {
  const rows = [{ id: 1, deviceName: 'DESKTOP-AAAAAAA', macAddress: '3C:A9:F4:00:00:01' }];
  const db = { profile: { findMany: async () => rows } };
  const fns = loadMain(['takenDeviceIdentities', 'assertDeviceIdentity', 'fillDeviceIdentity', 'settleDeviceIdentity', 'claimDeviceIdentity'], { profileOptions: opts, DEVICE_NAME_RULE: { Windows: 'w', other: 'o' } });
  await assert.rejects(fns.settleDeviceIdentity(db, { os: 'Windows', deviceName: 'desktop-aaaaaaa' }, { deviceName: 'desktop-aaaaaaa' }), /Another profile already uses the device name/);
  await assert.rejects(fns.settleDeviceIdentity(db, { os: 'Windows', macAddress: '3c-a9-f4-00-00-01' }, { macAddress: '3c-a9-f4-00-00-01' }), /Another profile already uses the MAC address/);
  await assert.rejects(fns.settleDeviceIdentity(db, { os: 'Windows', deviceName: 'A VERY LONG NAME HERE' }, { deviceName: 'x' }), /cannot be used/);
  await assert.rejects(fns.settleDeviceIdentity(db, { os: 'Windows', macAddress: '01:00:5E:00:00:01' }, { macAddress: 'x' }), /group address/);
  // A duplicate the random fingerprint made (not typed) is replaced, not refused.
  const generated = { os: 'Windows', deviceName: 'DESKTOP-AAAAAAA', macAddress: '3C:A9:F4:00:00:01' };
  await fns.settleDeviceIdentity(db, generated, {});
  assert.notEqual(generated.deviceName, 'DESKTOP-AAAAAAA');
  assert.notEqual(generated.macAddress, '3C:A9:F4:00:00:01');
  const kept = { os: 'Windows', deviceName: 'DESKTOP-BBBBBBB', macAddress: '3c-a9-f4-00-00-02' };
  await fns.settleDeviceIdentity(db, kept, { deviceName: 'DESKTOP-BBBBBBB', macAddress: 'x' });
  assert.deepEqual([kept.deviceName, kept.macAddress], ['DESKTOP-BBBBBBB', '3C:A9:F4:00:00:02'], 'usable typed values are kept (MAC normalized)');
  const real = { os: 'Windows', deviceNameType: 'Real', macAddressType: 'Real', deviceName: null, macAddress: null };
  await fns.settleDeviceIdentity(db, real, {});
  assert.deepEqual([real.deviceName, real.macAddress], [null, null], '"Real" is left alone');
  // A batch never repeats itself.
  const state = {};
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const d = await fns.claimDeviceIdentity(db, state, { os: 'macOS', deviceName: null, macAddress: null }, 'macOS');
    assert.ok(!seen.has(d.deviceName.toLowerCase()) && !seen.has(d.macAddress));
    seen.add(d.deviceName.toLowerCase()); seen.add(d.macAddress);
  }
  // Every create path goes through it; clone and template always get a new pair.
  assert.match(extractFunction(IPC, 'createProfile'), /await settleDeviceIdentity\(db, fingerprintFields, input\);/);
  for (const fn of ['cloneProfile', 'createProfileFromTemplate']) {
    assert.match(extractFunction(IPC, fn), /data\.deviceName = null;\s*data\.macAddress = null;\s*await claimDeviceIdentity\(db, \{\}, data,/, fn);
  }
  assert.match(extractFunction(IPC, 'commitProfileImport'), /await claimDeviceIdentity\(db, importIdentities,/);
  assert.match(extractFunction(IPC, 'migrateProfiles'), /await claimDeviceIdentity\(tx, migrateIdentities,/);
  assert.match(extractFunction(IPC, 'launchProfileNow'), /const profile = await ensureProfileDeviceIdentity\(db, found\);/, 'an older profile gets its pair on first launch');
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_GENERATE_IDENTITY, generateProfileIdentity\);/, 'the editor\'s "Generate new"');
});

test('Device name is applied where a browser has a channel (Firefox account name, Firefox NTLM); the MAC nowhere, and the help says so', () => {
  const p = prefsOf(ff.buildUserJs({ deviceName: 'DESKTOP-ABC1234' }));
  assert.equal(p['identity.fxaccounts.account.device.name'], 'Firefox on DESKTOP-ABC1234');
  assert.equal(p['network.auth.force-generic-ntlm'], true);
  assert.equal(p['network.generic-ntlm-auth.workstation'], 'DESKTOP-ABC1234');
  const real = prefsOf(ff.buildUserJs({ deviceName: '' }));
  assert.equal(real['identity.fxaccounts.account.device.name'], '', 'Real: Firefox\'s own name');
  assert.equal(real['network.auth.force-generic-ntlm'], false, 'Real: Windows\' own sign-in');
  assert.equal(prefsOf(ff.buildUserJs({}))['network.auth.force-generic-ntlm'], undefined);
  assert.doesNotMatch(ENGINE, /\bdeviceName\b|\bmacAddress\b/, 'Chromium has no setting for either');
  for (const lang of ['en', 'es']) {
    const fp = locale(lang, 'profiles').fp;
    assert.match(fp.deviceNameDesc, /NTLM/);
    assert.match(fp.deviceNameDesc, /Chrome/);
    assert.match(fp.macAddressDesc, /MAC/);
    assert.doesNotMatch(fp.macAddressDesc, /isolat|aisla/i, 'no claim it hides or isolates anything');
  }
});

test('Device name and MAC go through export, import, Compare and the overviews', () => {
  const block = /const EXPORT_COLUMNS = \[([\s\S]*?)\n\];/.exec(IPC)[1];
  assert.match(block, /\['Device Name', /);
  assert.match(block, /\['MAC Address', /);
  const { parseWorkbookFile } = require('../src/main/importParser');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-identity-'));
  try {
    const a = path.join(dir, 'a.csv');
    fs.writeFileSync(a, 'Profile Title,Device Name,MAC Address\nOne,DESKTOP-ABC1234,3C:A9:F4:12:34:56\nThree,DESKTOP-DEF5678,3C:A9:F4:12:34:57\nFive,DESKTOP-GHI9012,3C:A9:F4:12:34:58\n');
    const item = parseWorkbookFile(a).items[0];
    assert.deepEqual([item.deviceName, item.macAddress], ['DESKTOP-ABC1234', '3C:A9:F4:12:34:56']);
    const b = path.join(dir, 'b.csv');
    fs.writeFileSync(b, 'Name,Proxy Host\nTwo,1.2.3.4\nFour,5.6.7.8\nSix,9.9.9.9\n');
    const other = parseWorkbookFile(b).items[0];
    assert.equal(other.deviceName, '', '"Name" or "Host" are never read as the device name');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(read('src', 'renderer', 'components', 'CompareProfilesModal.jsx'), /t\('compare\.rowDeviceName'\)/);
  assert.match(read('src', 'renderer', 'components', 'CompareProfilesModal.jsx'), /p\.cpuCores/, 'the CPU row reads the real field');
  assert.match(ENV_MODAL, /t\('envOverview\.rowMacAddress'\)/);
});

// ---- the editor's IPC ------------------------------------------------------------------------------

test('the editor gets the OS font lists and unique device identities from main', () => {
  const preload = read('src', 'preload', 'preload.js');
  assert.match(preload, /editorOptions: \(\) => invoke\(CHANNELS\.PROFILE_EDITOR_OPTIONS\)/);
  assert.match(preload, /generateIdentity: \(os, excludeId = null\) => invoke\(CHANNELS\.PROFILE_GENERATE_IDENTITY, \{ os, excludeId \}\)/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_EDITOR_OPTIONS, profileEditorOptions\);/);
  for (const key of ['userAgentMode', 'fontsList', 'mediaDeviceCounts']) assert.match(read('prisma', 'schema.prisma'), new RegExp(`\\b${key}\\s+String\\?`));
  const sql = read('prisma', 'migrations', '20261111000200_profile_editor_options', 'migration.sql');
  for (const key of ['userAgentMode', 'fontsList', 'mediaDeviceCounts']) assert.match(sql, new RegExp(`ALTER TABLE "Profile" ADD COLUMN "${key}" TEXT;`));
});
