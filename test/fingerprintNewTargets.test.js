'use strict';
// Live test 7 Nov 2026 (one default profile, no proxy, system Chrome, CreepJS / sannysoft /
// BrowserScan) found that only the first tab carried the whole fingerprint:
//   1. Tabs opened later (start links, popups, "+") got the UA override but not the in-page script:
//      the auto-attach session registered Page.addScriptToEvaluateOnNewDocument without Page.enable,
//      and Chrome only runs those scripts for an enabled Page agent. applyToPage then skipped the
//      blank tab and re-applied after its first document had loaded.
//   2. navigator.languages contained "en;q=0.9": Chrome splits the acceptLanguage override on commas
//      for navigator.languages and adds the header q-values itself.
//   3. The CSS screen (device-width/height) was the real monitor while window.screen was the profile's.
//   4. Workers reported the real deviceMemory (32) while the page reported the profile's (8).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engine = require('../src/main/browserEngine');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'browserEngine.js'), 'utf8').replace(/\r\n/g, '\n');

const between = (s, a, b) => {
  const i = s.indexOf(a);
  assert.ok(i >= 0, `marker not found: ${a}`);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j > i, `end marker not found: ${b}`);
  return s.slice(i, j);
};
const LAUNCH = between(SRC, 'async function launchProfileSessionNow(', '\n// Navigate a running session');

// ---- Chrome's own handling of the acceptLanguage override (from Chromium source) ----
// Blink NavigatorLanguage ParseAndSanitize: split on commas, trim, "_" -> "-" at index 2. No q-value removal.
const blinkLanguages = (override) => override.split(',').map((t) => t.trim()).filter(Boolean)
  .map((t) => (t.length >= 3 && t[2] === '_' ? `${t.slice(0, 2)}-${t.slice(3)}` : t));
// net::HttpUtil::GenerateAcceptLanguageHeader: append ";q=0.9", ";q=0.8"... to every entry after the first.
const chromeHeader = (override) => {
  let q = 10;
  let out = '';
  for (const lang of override.split(',')) {
    if (!lang) continue;
    out = q === 10 ? lang : `${out},${lang};q=0.${q}`;
    if (q > 1) q -= 1;
  }
  return out;
};

const UA = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  navPlatform: 'Win32',
  userAgentMetadata: { brands: [{ brand: 'Google Chrome', version: '150' }], platform: 'Windows', mobile: false }
};

// ---- 2. Accept-Language / navigator.languages ----

test('the acceptLanguage override is the plain language list, never with q-values', () => {
  assert.equal(engine.acceptLanguageOverride(['en-US', 'en']), 'en-US,en');
  assert.equal(engine.acceptLanguageOverride(['de-DE', 'de', 'en']), 'de-DE,de,en');
  assert.equal(engine.acceptLanguageOverride(['en-US', 'en;q=0.9', ' fr ; q=0.5']), 'en-US,en,fr');
  assert.equal(engine.acceptLanguageOverride('en-GB,en;q=0.9'), 'en-GB,en');
  assert.equal(engine.acceptLanguageOverride(['en-US', 'en-US', '', null]), 'en-US', 'duplicates and empties go');
  assert.equal(engine.acceptLanguageOverride([]), 'en-US');
  assert.equal(engine.acceptLanguageOverride(undefined), 'en-US');
});

test('Chrome turns the override into clean navigator.languages and a proper Accept-Language header', () => {
  for (const langs of [['en-US', 'en'], ['de-DE', 'de', 'en'], ['ja-JP', 'ja', 'en']]) {
    const override = engine.acceptLanguageOverride(langs);
    assert.deepEqual(blinkLanguages(override), langs, 'navigator.languages must be exactly the profile list');
    assert.ok(blinkLanguages(override).every((l) => !l.includes(';')), 'no q-value inside navigator.languages');
  }
  assert.equal(chromeHeader(engine.acceptLanguageOverride(['en-US', 'en'])), 'en-US,en;q=0.9');
  assert.equal(chromeHeader(engine.acceptLanguageOverride(['de-DE', 'de', 'en'])), 'de-DE,de;q=0.9,en;q=0.8');
  // What the old "en-US,en;q=0.9" override did: a q-value in navigator.languages and a doubled one on the wire.
  assert.deepEqual(blinkLanguages('en-US,en;q=0.9'), ['en-US', 'en;q=0.9']);
  assert.equal(chromeHeader('en-US,en;q=0.9'), 'en-US,en;q=0.9;q=0.9');
});

test('the launch builds Accept-Language from the full profile language list', () => {
  assert.match(LAUNCH, /const acceptLanguage = acceptLanguageOverride\(fpConfig\.langs\);/);
  assert.doesNotMatch(SRC, /localeToAcceptLanguage/);
  assert.doesNotMatch(SRC.replace(/\/\/.*$/gm, ''), /;q=0\.\d/, 'no hand-written q-values in the engine code');
});

// ---- 3. Screen ----

test('desktop screen override: only the screen changes, the window, viewport and DPR stay real', () => {
  assert.deepEqual(engine.deviceMetricsOverride({ screenW: 2256, screenH: 1504 }),
    { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: 2256, screenHeight: 1504 });
  assert.deepEqual(engine.deviceMetricsOverride({ screenW: '1920', screenH: '1080' }),
    { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: 1920, screenHeight: 1080 });
});

test('no screen means no override; Android gets the phone viewport; the anti-detect build only the screen', () => {
  assert.equal(engine.deviceMetricsOverride({}), null);
  assert.equal(engine.deviceMetricsOverride({ screenW: null, screenH: null }), null);
  assert.equal(engine.deviceMetricsOverride({ screenW: 0, screenH: 1080 }), null);
  const m = { width: 412, height: 915, deviceScaleFactor: 2.625, maxTouchPoints: 5 };
  assert.deepEqual(engine.deviceMetricsOverride({ screenW: 412, screenH: 915, mobileMetrics: m }),
    { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 });
  assert.deepEqual(engine.deviceMetricsOverride({ screenW: 412, screenH: 915, mobileMetrics: m, nativeEngine: true }),
    { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: 412, screenHeight: 915 });
});

test('a "Real" resolution overrides nothing; a blank one keeps the 1920x1080 default', () => {
  assert.equal(engine.profileScreenSize({ resolutionType: 'Real', resolutionW: '2256', resolutionH: '1504' }), null);
  assert.equal(engine.profileScreenSize({ resolutionType: 'real' }), null);
  assert.deepEqual(engine.profileScreenSize({}), { width: 1920, height: 1080 });
  assert.deepEqual(engine.profileScreenSize({ resolutionType: 'Custom', resolutionW: '2256', resolutionH: '1504' }), { width: 2256, height: 1504 });
  assert.deepEqual(engine.profileScreenSize({ resolutionType: 'Random', resolutionW: 'x', resolutionH: '' }), { width: 1920, height: 1080 });
  assert.match(LAUNCH, /const screenSize = profileScreenSize\(profile\);/);
});

test('window.screen from the page script and the CDP screen (CSS device-width/height) are the same size', () => {
  const fp = { seed: 1, guard: 'gScreen1', langs: ['en-US', 'en'], navPlatform: 'Win32', screenW: 2256, screenH: 1504, noise: { canvas: false, webgl: false, audio: false } };
  const NavProto = {};
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => Object.defineProperty(NavProto, n, { get() { return null; }, configurable: true, enumerable: true }));
  const sb = { navigator: Object.create(NavProto), console, screen: {} };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify(fp)});`, sb);
  const cdp = engine.deviceMetricsOverride({ screenW: fp.screenW, screenH: fp.screenH });
  assert.equal(sb.screen.width, cdp.screenWidth);
  assert.equal(sb.screen.height, cdp.screenHeight);
  assert.equal(cdp.deviceScaleFactor, 0, 'devicePixelRatio and the resolution media feature stay the real, matching value');
});

test('only top-level pages get the screen override (Chrome rejects it on frames; workers have no screen)', () => {
  const late = { deviceMetrics: engine.deviceMetricsOverride({ screenW: 2256, screenH: 1504 }) };
  const has = (kind) => engine.targetFingerprintCommands(kind, {}, late).some((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.equal(has('page'), true);
  assert.equal(has('iframe'), false);
  assert.equal(has('worker'), false);
  assert.equal(has('service_worker'), false);
  const anti = engine.targetFingerprintCommands('page', { nativeEngine: true }, late);
  assert.ok(anti.some((c) => c.method === 'Emulation.setDeviceMetricsOverride'), 'the anti-detect build still needs the screen');
});

// ---- 1. Every new target gets the fingerprint before it runs ----

function fakeCdp({ hang = new Set(), failOnce = new Map(), failAlways = new Map() } = {}) {
  const sessions = new Map();
  const log = [];
  const make = (id) => {
    const listeners = {};
    const s = {
      id,
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); log.push([id, `on:${evt}`]); },
      emit(evt, data) { return Promise.all((listeners[evt] || []).map((fn) => fn(data))); },
      send(method, params) {
        log.push([id, method, params]);
        if (hang.has(method)) return new Promise(() => {});
        if (failAlways.has(method)) return Promise.reject(new Error(failAlways.get(method)));
        const left = failOnce.get(method) || 0;
        if (left > 0) { failOnce.set(method, left - 1); return Promise.reject(new Error('cdp call timed out')); }
        return Promise.resolve({});
      }
    };
    sessions.set(id, s);
    return s;
  };
  const conn = { session: (id) => sessions.get(id) || null };
  const methodsOf = (id) => log.filter((e) => e[0] === id && !e[1].startsWith('on:')).map((e) => e[1]);
  const paramsOf = (id, method) => (log.find((e) => e[0] === id && e[1] === method) || [])[2];
  return { conn, make, log, methodsOf, paramsOf };
}

// Attach one target: Chrome creates the flat session, then reports it on the parent.
function attach(cdp, parent, id, type, url = '') {
  cdp.make(id);
  return parent.emit('Target.attachedToTarget', { sessionId: id, targetInfo: { type, targetId: `T-${id}`, url }, waitingForDebugger: true });
}

const FP = { seed: 1, guard: 'gAttach1', cores: 6, mem: 8, langs: ['en-US', 'en'], navPlatform: 'Win32', screenW: 2256, screenH: 1504, noise: { canvas: false, webgl: false, audio: false } };
function lateFor(fp = FP) {
  return {
    ua: UA,
    acceptLanguage: engine.acceptLanguageOverride(fp.langs),
    timezoneId: 'America/New_York',
    deviceMetrics: engine.deviceMetricsOverride({ screenW: fp.screenW, screenH: fp.screenH }),
    workerSource: engine.workerPreludeSource(fp)
  };
}

test('a new tab: Page.enable and the script are registered first, the target is resumed last', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT' });
  await attach(cdp, root, 'tab1', 'page');
  const m = cdp.methodsOf('tab1');
  assert.deepEqual(m, [
    'Page.enable',
    'Page.addScriptToEvaluateOnNewDocument',
    'Emulation.setUserAgentOverride',
    'Emulation.setHardwareConcurrencyOverride',
    'Emulation.setTimezoneOverride',
    'Emulation.setDeviceMetricsOverride',
    'Target.setAutoAttach',
    'Runtime.runIfWaitingForDebugger'
  ]);
  assert.equal(cdp.paramsOf('tab1', 'Page.addScriptToEvaluateOnNewDocument').source, 'SCRIPT');
  assert.equal(cdp.paramsOf('tab1', 'Emulation.setUserAgentOverride').acceptLanguage, 'en-US,en');
  assert.deepEqual(cdp.paramsOf('tab1', 'Emulation.setDeviceMetricsOverride'),
    { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: 2256, screenHeight: 1504 });
  assert.deepEqual(cdp.paramsOf('tab1', 'Target.setAutoAttach'), { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
});

test('the tab session listens for its own frames and workers before it asks to auto-attach them', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT' });
  await attach(cdp, root, 'tab1', 'page');
  const tabEntries = cdp.log.filter((e) => e[0] === 'tab1').map((e) => e[1]);
  assert.ok(tabEntries.indexOf('on:Target.attachedToTarget') < tabEntries.indexOf('Target.setAutoAttach'));
});

test('popups, out-of-process frames and dedicated workers under a tab get the same treatment', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT' });
  await attach(cdp, root, 'tab1', 'page');
  const tab = cdp.conn.session('tab1');

  await attach(cdp, root, 'popup', 'page', 'about:blank');
  assert.deepEqual(cdp.methodsOf('popup').slice(0, 2), ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument']);
  assert.equal(cdp.methodsOf('popup').at(-1), 'Runtime.runIfWaitingForDebugger');

  await attach(cdp, tab, 'frame1', 'iframe');
  const f = cdp.methodsOf('frame1');
  assert.deepEqual(f.slice(0, 2), ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument']);
  assert.ok(f.includes('Emulation.setUserAgentOverride'));
  assert.ok(!f.includes('Emulation.setDeviceMetricsOverride'), 'frames take the screen from their tab');
  assert.ok(f.includes('Target.setAutoAttach'), 'a frame watches for its own workers');
  assert.equal(f.at(-1), 'Runtime.runIfWaitingForDebugger');

  await attach(cdp, tab, 'dw1', 'worker');
  assert.deepEqual(cdp.methodsOf('dw1'), [
    'Emulation.setUserAgentOverride',
    'Emulation.setHardwareConcurrencyOverride',
    'Runtime.evaluate',
    'Target.setAutoAttach',
    'Runtime.runIfWaitingForDebugger'
  ]);
});

test('values filled in after launch (UA, time zone) reach tabs opened after that', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  const fpLate = { deviceMetrics: engine.deviceMetricsOverride({ screenW: 1920, screenH: 1080 }) };
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate, injectSource: 'SCRIPT' });
  await attach(cdp, root, 'early', 'page');
  assert.ok(!cdp.methodsOf('early').includes('Emulation.setUserAgentOverride'));
  fpLate.ua = UA;
  fpLate.acceptLanguage = 'en-US,en';
  fpLate.timezoneId = 'Europe/Berlin';
  await attach(cdp, root, 'later', 'page');
  assert.ok(cdp.methodsOf('later').includes('Emulation.setUserAgentOverride'));
  assert.equal(cdp.paramsOf('later', 'Emulation.setTimezoneOverride').timezoneId, 'Europe/Berlin');
});

test('a transient failure on a tab is retried before the tab is resumed', async () => {
  const cdp = fakeCdp({ failOnce: new Map([['Page.addScriptToEvaluateOnNewDocument', 1]]) });
  const root = cdp.make('root');
  const reported = [];
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT', onInjectFailed: (i, m) => reported.push(m) });
  await attach(cdp, root, 'tab1', 'page');
  const m = cdp.methodsOf('tab1');
  assert.equal(m.filter((x) => x === 'Page.addScriptToEvaluateOnNewDocument').length, 2);
  assert.ok(m.lastIndexOf('Page.addScriptToEvaluateOnNewDocument') < m.indexOf('Runtime.runIfWaitingForDebugger'));
  assert.equal(m.filter((x) => x === 'Emulation.setUserAgentOverride').length, 1, 'steps that worked are not repeated');
  assert.equal(m.at(-1), 'Runtime.runIfWaitingForDebugger');
  assert.deepEqual(reported, [], 'the retry worked, nothing to report');
});

test('a worker is resumed right after its setup is sent, without waiting for replies', async () => {
  // A new service worker gets no replies until it starts (Chrome holds the session's messages), so
  // waiting for them first would stall it. The setup still reaches it first: one session, one order.
  const cdp = fakeCdp({ hang: new Set(['Emulation.setUserAgentOverride', 'Runtime.evaluate']) });
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT', callTimeoutMs: 40 });
  const started = Date.now();
  await attach(cdp, root, 'sw1', 'service_worker');
  assert.deepEqual(cdp.methodsOf('sw1'), ['Emulation.setUserAgentOverride', 'Emulation.setHardwareConcurrencyOverride', 'Runtime.evaluate', 'Runtime.runIfWaitingForDebugger']);
  assert.ok(Date.now() - started < 1000, 'no guard-timer wait');
});

test('a command this Chrome does not have is not retried, and the worker still starts', async () => {
  const cdp = fakeCdp({ failAlways: new Map([['Emulation.setUserAgentOverride', "'Emulation.setUserAgentOverride' wasn't found"]]) });
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT' });
  await attach(cdp, root, 'sw1', 'service_worker');
  const m = cdp.methodsOf('sw1');
  assert.equal(m.filter((x) => x === 'Emulation.setUserAgentOverride').length, 1);
  assert.ok(m.includes('Runtime.evaluate'));
  assert.equal(m.at(-1), 'Runtime.runIfWaitingForDebugger');
});

test('a failed script registration is reported, and the tab is resumed anyway', async () => {
  const cdp = fakeCdp({ failAlways: new Map([['Page.addScriptToEvaluateOnNewDocument', 'Invalid parameters']]) });
  const root = cdp.make('root');
  const reported = [];
  engine.attachFingerprintToNewTargets(root, cdp.conn, {
    fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT',
    onInjectFailed: (info, methods) => reported.push([info.type, methods])
  });
  await attach(cdp, root, 'tab1', 'page');
  assert.deepEqual(reported, [['page', ['Page.addScriptToEvaluateOnNewDocument']]]);
  assert.equal(cdp.methodsOf('tab1').at(-1), 'Runtime.runIfWaitingForDebugger');
});

test('a stalled command never leaves the tab paused', async () => {
  const cdp = fakeCdp({ hang: new Set(['Emulation.setTimezoneOverride']) });
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, {
    fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT', callTimeoutMs: 20, resumeAfterMs: 60
  });
  await attach(cdp, root, 'tab1', 'page');
  const m = cdp.methodsOf('tab1');
  assert.equal(m.filter((x) => x === 'Runtime.runIfWaitingForDebugger').length, 1, 'resumed exactly once');
  assert.ok(m.indexOf('Page.addScriptToEvaluateOnNewDocument') < m.indexOf('Runtime.runIfWaitingForDebugger'));
});

test('a target that only exists as a legacy session is still resumed', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT' });
  // No flat session created for it.
  await root.emit('Target.attachedToTarget', { sessionId: 'ghost', targetInfo: { type: 'page' }, waitingForDebugger: true });
  const msg = cdp.paramsOf('root', 'Target.sendMessageToTarget');
  assert.equal(msg.sessionId, 'ghost');
  assert.match(msg.message, /Runtime\.runIfWaitingForDebugger/);
});

test('the anti-detect build gets the script, screen and child auto-attach, but no CDP identity', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  const fp = { ...FP, nativeEngine: true };
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: fp, fpLate: { ...lateFor(), workerSource: engine.workerPreludeSource(fp) }, injectSource: 'SCRIPT' });
  await attach(cdp, root, 'tab1', 'page');
  assert.deepEqual(cdp.methodsOf('tab1'), [
    'Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Emulation.setDeviceMetricsOverride',
    'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger'
  ]);
  await attach(cdp, root, 'sw1', 'service_worker');
  assert.deepEqual(cdp.methodsOf('sw1'), ['Runtime.runIfWaitingForDebugger']);
});

test('the launch wires the shared handler to a browser-level auto-attach', () => {
  const block = between(LAUNCH, '// ---- Cross-channel fingerprint injection ----', '// Track PID');
  assert.match(block, /attachFingerprintToNewTargets\(rootCdp, rootCdp\.connection\(\), \{/);
  assert.ok(block.indexOf('attachFingerprintToNewTargets(') < block.indexOf("rootCdp.send('Target.setAutoAttach'"),
    'the handler is listening before auto-attach reports the existing tab');
  assert.ok(block.indexOf('fpConfig.dedicatedWorkersViaCdp = !fpConfig.nativeEngine;') < block.indexOf('const fpInjectSource = '));
  assert.match(block, /catch \(e\) \{[^}]*fpConfig\.dedicatedWorkersViaCdp = false;/);
});

test('start-link tabs get the whole fingerprint before they navigate', () => {
  const open = between(LAUNCH, 'const hOpenTab = async (url) => {', '\n  };');
  const apply = open.indexOf('await applyToPage(np, true, { ownTab: true })');
  assert.ok(apply > 0, 'hOpenTab applies the fingerprint to its own tab');
  assert.ok(apply < open.indexOf('np.goto('), 'before the first navigation');
});

test('a blank new tab gets the script before applyToPage defers the rest', () => {
  const fn = between(LAUNCH, 'const applyToPage = async (targetPage, isNewTab = false, opts = {}) => {', '\n  await applyToPage(page);');
  const reg = fn.indexOf('if (isNewTab && isBlank && !isInternal) await registerFingerprintScript(targetPage);');
  const early = fn.indexOf('if (isNewTab && (isInternal || isBlank)) return;');
  assert.ok(reg > 0 && early > reg);
  assert.match(fn, /const isBlank = !opts\.ownTab && \(pageUrl === '' \|\| pageUrl === 'about:blank'\);/);
  // The first tab and later tabs share one command list with the auto-attach.
  assert.match(fn, /for \(const c of targetFingerprintCommands\('page', fpConfig, fpLate\)\)/);
});

// ---- 4. Workers ----

test('workers get the same UA, Client Hints, languages, cores and platform values as the page', () => {
  const late = lateFor();
  const page = engine.targetFingerprintCommands('page', FP, late);
  const pageUa = page.find((c) => c.method === 'Emulation.setUserAgentOverride').params;
  const pageCores = page.find((c) => c.method === 'Emulation.setHardwareConcurrencyOverride').params;
  for (const kind of ['worker', 'shared_worker', 'service_worker']) {
    const cmds = engine.targetFingerprintCommands(kind, FP, late);
    assert.deepEqual(cmds[0].params, pageUa, `${kind}: same UA / metadata / Accept-Language / platform`);
    assert.deepEqual(cmds[1].params, pageCores, `${kind}: same core count`);
    if (kind === 'shared_worker') {
      // Chrome does not hold shared workers for this session; the page's SharedWorker wrapper covers them.
      assert.deepEqual(cmds.map((c) => c.method), ['Emulation.setUserAgentOverride', 'Emulation.setHardwareConcurrencyOverride'], kind);
    } else {
      assert.deepEqual(cmds.map((c) => c.method), ['Emulation.setUserAgentOverride', 'Emulation.setHardwareConcurrencyOverride', 'Runtime.evaluate'], kind);
      assert.equal(cmds[2].params.expression, late.workerSource);
    }
  }
});

test('the late targetcreated worker pass is only the fallback when the auto-attach is missing', () => {
  const tc = between(LAUNCH, "browser.on('targetcreated', async (target) => {", "if (targetType !== 'page') return;");
  assert.match(tc, /if \(cdpAutoAttach\) return;/);
  assert.match(tc, /targetFingerprintCommands\(targetType, fpConfig, fpLate\)/);
});

function workerSandbox({ deviceMemory = 32, hardwareConcurrency = 6, platform = 'Win32', languages = ['en-US', 'en'], secure = true } = {}) {
  const NavProto = {};
  const def = (n, v) => Object.defineProperty(NavProto, n, { get() { return v; }, configurable: true, enumerable: true });
  if (secure) def('deviceMemory', deviceMemory);
  def('hardwareConcurrency', hardwareConcurrency);
  def('platform', platform);
  def('languages', languages);
  def('language', languages[0]);
  const sb = { navigator: Object.create(NavProto) };
  sb.self = sb;
  vm.createContext(sb);
  vm.runInContext('this.__origToString = Function.prototype.toString;', sb);
  return sb;
}
const run = (sb, fp) => vm.runInContext(engine.workerPreludeSource(fp), sb);

test('worker prelude: deviceMemory matches the page, on the prototype, looking native', () => {
  const sb = workerSandbox({ deviceMemory: 32 });
  run(sb, FP);
  assert.equal(vm.runInContext('navigator.deviceMemory', sb), 8);
  const probe = JSON.parse(vm.runInContext(`JSON.stringify((function () {
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'deviceMemory');
    return { own: Object.prototype.hasOwnProperty.call(navigator, 'deviceMemory'), src: d.get.toString(),
      name: d.get.name, proto: 'prototype' in d.get, tsName: Function.prototype.toString.name };
  })())`, sb));
  assert.equal(probe.own, false);
  assert.match(probe.src, /\[native code\]/);
  assert.equal(probe.name, 'get deviceMemory');
  assert.equal(probe.proto, false);
  assert.equal(probe.tsName, 'toString');
});

test('worker prelude: values CDP already set (cores, languages, same-OS platform) are left alone', () => {
  const sb = workerSandbox({ deviceMemory: 32 });
  const before = vm.runInContext(`['hardwareConcurrency','platform','languages','language'].map(function (n) {
    return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), n).get; })`, sb);
  run(sb, FP);
  const after = vm.runInContext(`['hardwareConcurrency','platform','languages','language'].map(function (n) {
    return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), n).get; })`, sb);
  for (let i = 0; i < before.length; i += 1) assert.equal(after[i], before[i]);
});

test('worker prelude: a worker that already matches the profile is not touched at all', () => {
  const sb = workerSandbox({ deviceMemory: 8 });
  run(sb, FP);
  assert.equal(vm.runInContext('Function.prototype.toString === this.__origToString', sb), true);
});

test('worker prelude: the UA string follows the profile (service/shared workers keep the real one under CDP)', () => {
  const real = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
  const edge = `${real} Edg/156.0.0.0`;
  const mk = (ua) => {
    const sb = workerSandbox({ deviceMemory: 8 });
    Object.defineProperty(Object.getPrototypeOf(sb.navigator), 'userAgent', { get() { return ua; }, configurable: true, enumerable: true });
    Object.defineProperty(Object.getPrototypeOf(sb.navigator), 'appVersion', { get() { return ua.slice(8); }, configurable: true, enumerable: true });
    return sb;
  };
  const sb = mk(real);
  vm.runInContext(engine.workerPreludeSource(FP, { userAgent: edge }), sb);
  assert.equal(vm.runInContext('navigator.userAgent', sb), edge);
  assert.equal(vm.runInContext('navigator.appVersion', sb), edge.slice('Mozilla/'.length));

  const same = mk(real);
  vm.runInContext(engine.workerPreludeSource(FP, { userAgent: real }), same);
  assert.equal(vm.runInContext('Function.prototype.toString === this.__origToString', same), true, 'same UA: untouched');
});

test('page script: the SharedWorker prelude carries the page UA and sets it only when the worker differs', async () => {
  const { resolveObjectURL } = require('node:buffer');
  const NavProto = {};
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => Object.defineProperty(NavProto, n, { get() { return null; }, configurable: true, enumerable: true }));
  const pageUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0';
  Object.defineProperty(NavProto, 'userAgent', { get() { return pageUa; }, configurable: true, enumerable: true });
  function SharedWorker(url) { this.url = url; }
  const page = { navigator: Object.create(NavProto), console, SharedWorker, URL, Blob };
  page.window = page;
  vm.createContext(page);
  const fp = { seed: 1, guard: 'gSw1', langs: ['en-US', 'en'], cores: 6, mem: 8, navPlatform: 'Win32', noise: { canvas: false, webgl: false, audio: false }, dedicatedWorkersViaCdp: true };
  vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify(fp)});`, page);
  const boot = await resolveObjectURL(new page.SharedWorker('https://example.com/s.js').url).text();
  const prelude = boot.split('\n')[0];

  const realUa = pageUa.replace(' Edg/156.0.0.0', '');
  const worker = workerSandbox({ deviceMemory: 32 });
  Object.defineProperty(Object.getPrototypeOf(worker.navigator), 'userAgent', { get() { return realUa; }, configurable: true, enumerable: true });
  vm.runInContext(prelude, worker);
  assert.equal(vm.runInContext('navigator.userAgent', worker), pageUa);
  assert.equal(vm.runInContext('navigator.deviceMemory', worker), 8);
});

test('worker prelude: falls back to JS for cores, languages and a cross-OS platform when CDP could not', () => {
  const sb = workerSandbox({ deviceMemory: 8, hardwareConcurrency: 16, platform: 'Win32', languages: ['en-US', 'en;q=0.9'] });
  run(sb, { ...FP, navPlatform: 'MacIntel' });
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', sb), 6);
  assert.equal(vm.runInContext('navigator.platform', sb), 'MacIntel');
  assert.deepEqual([...vm.runInContext('navigator.languages', sb)], ['en-US', 'en']);
});

test('worker prelude: runs once per worker, adds no property a secure-context check would miss', () => {
  const sb = workerSandbox({ deviceMemory: 32 });
  run(sb, FP);
  const ts = vm.runInContext('Function.prototype.toString', sb);
  run(sb, FP); // the root and the tab session can both attach the same service worker
  assert.equal(vm.runInContext('Function.prototype.toString', sb), ts, 'no second patch');
  assert.deepEqual(vm.runInContext('Object.keys(self).filter(function (k) { return k.indexOf("gAttach1") >= 0; })', sb).length, 0, 'guard is not enumerable');

  const insecure = workerSandbox({ secure: false });
  run(insecure, FP);
  assert.equal(vm.runInContext("'deviceMemory' in navigator", insecure), false, 'deviceMemory stays absent outside secure contexts');
});

test('worker prelude: never reads self.location (reading it in a worker paused at start crashes Chrome 156)', () => {
  const sb = workerSandbox({ deviceMemory: 32 });
  let touched = false;
  Object.defineProperty(sb, 'location', { get() { touched = true; throw new Error('location read'); }, configurable: true });
  run(sb, FP);
  assert.equal(touched, false);
  assert.equal(vm.runInContext('navigator.deviceMemory', sb), 8);
  assert.doesNotMatch(engine.workerPreludeScript.toString().replace(/\/\/.*$/gm, ''), /location/);
});

test('browser-internal workers (extension service workers) are resumed untouched; the anti-detect build gets no prelude', async () => {
  const cdp = fakeCdp();
  const root = cdp.make('root');
  engine.attachFingerprintToNewTargets(root, cdp.conn, { fpConfig: FP, fpLate: lateFor(), injectSource: 'SCRIPT' });
  await attach(cdp, root, 'ext', 'service_worker', 'chrome-extension://abcdefgh/background.js');
  assert.deepEqual(cdp.methodsOf('ext'), ['Runtime.runIfWaitingForDebugger']);
  await attach(cdp, root, 'web', 'service_worker', 'https://example.com/sw.js');
  assert.ok(cdp.methodsOf('web').includes('Runtime.evaluate'));
  // A tab starting on the new tab page still gets everything: it goes on to websites.
  await attach(cdp, root, 'ntp', 'page', 'chrome://newtab/');
  assert.deepEqual(cdp.methodsOf('ntp').slice(0, 2), ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument']);
  // A DevTools window is a page target but never a website.
  await attach(cdp, root, 'dt', 'page', 'devtools://devtools/bundled/devtools_app.html');
  assert.deepEqual(cdp.methodsOf('dt'), ['Runtime.runIfWaitingForDebugger']);
  assert.equal(engine.workerPreludeSource({ ...FP, nativeEngine: true }), null);
});

test('worker prelude: the time zone is set only when the worker differs from the profile', () => {
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = host === 'Pacific/Kiritimati' ? 'Pacific/Chatham' : 'Pacific/Kiritimati';
  const sb = workerSandbox({ deviceMemory: 8 });
  run(sb, { ...FP, timezone: tz });
  assert.equal(vm.runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', sb), tz);
  assert.equal(vm.runInContext("new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone", sb), 'UTC');

  const same = workerSandbox({ deviceMemory: 8 });
  run(same, { ...FP, timezone: host });
  assert.equal(vm.runInContext('Function.prototype.toString === this.__origToString', same), true);
});

test('page script: Worker stays native when CDP covers dedicated workers; SharedWorker keeps its wrapper', () => {
  const runPage = (fp) => {
    const NavProto = {};
    ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
      .forEach((n) => Object.defineProperty(NavProto, n, { get() { return null; }, configurable: true, enumerable: true }));
    function Worker(url) { this.url = url; }
    function SharedWorker(url) { this.url = url; }
    const sb = { navigator: Object.create(NavProto), console, Worker, SharedWorker, URL, Blob };
    sb.window = sb;
    sb.self = sb;
    vm.createContext(sb);
    vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify(fp)});`, sb);
    return { sb, Worker, SharedWorker };
  };
  const base = { seed: 1, langs: ['en-US', 'en'], cores: 6, mem: 8, navPlatform: 'Win32', noise: { canvas: false, webgl: false, audio: false } };

  const viaCdp = runPage({ ...base, guard: 'gPage1', dedicatedWorkersViaCdp: true });
  assert.equal(viaCdp.sb.Worker, viaCdp.Worker);
  assert.notEqual(viaCdp.sb.SharedWorker, viaCdp.SharedWorker, 'Chrome does not hold shared workers for the auto-attach');
  assert.match(new viaCdp.sb.SharedWorker('https://example.com/s.js').url, /^blob:/);

  const fallback = runPage({ ...base, guard: 'gPage2' });
  assert.notEqual(fallback.sb.Worker, fallback.Worker, 'without the CDP path the wrapper is the fallback');
  assert.match(new fallback.sb.Worker('https://example.com/w.js').url, /^blob:/);
});

test('page script: Chrome pages (new tab page, settings, DevTools, extensions) are left alone', () => {
  for (const protocol of ['chrome:', 'chrome-extension:', 'devtools:', 'chrome-search:']) {
    const NavProto = {};
    Object.defineProperty(NavProto, 'hardwareConcurrency', { get() { return 16; }, configurable: true, enumerable: true });
    const sb = { navigator: Object.create(NavProto), console, location: { protocol } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify({ ...FP, guard: 'gInt1' })});`, sb);
    assert.equal(sb.navigator.hardwareConcurrency, 16, protocol);
  }
});
