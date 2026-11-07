'use strict';
// Global Privacy Control (1.0.22). Until 1.0.21 a profile with Do Not Track on also reported
// navigator.globalPrivacyControl = true and sent Sec-GPC: 1, whatever browser it claimed to be. Stock
// Chrome, Edge, Opera, Vivaldi and Yandex ship no GPC (MDN browser-compat-data: Chrome "false", Edge and
// Opera mirror Chrome; Chrome Platform Status lists GPC as "Proposed"), so a Chrome profile sending it was
// an inconsistency a site can read. Brave sends GPC by itself, on by default and independent of DNT
// (brave-core: Sec-GPC on every request, navigator.globalPrivacyControl on Navigator and WorkerNavigator).
// Firefox profiles run the real Firefox (firefoxEngine.js), which keeps its own opt-in GPC setting.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engine = require('../src/main/browserEngine');
const { buildBrandIdentity } = require('../src/main/fingerprintGenerator');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'browserEngine.js'), 'utf8').replace(/\r\n/g, '\n');
const FF_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'firefoxEngine.js'), 'utf8');

const NO_GPC_BRANDS = ['Chrome', 'Edge', 'Opera', 'Vivaldi', 'Yandex'];
const OPTS = { seed: 1, resW: 1920, resH: 1080, webrtcMode: 'Altered', hasProxy: false, geo: null, timezone: null };
// os left blank = the host OS, so no cross-OS branch runs.
const config = (browserBrand, doNotTrack) => engine.buildFingerprintConfig({ browserBrand, doNotTrack }, OPTS);

// ---- Which brand sends GPC ----

test('only Brave sends Global Privacy Control by itself', () => {
  assert.equal(buildBrandIdentity('Brave', 150, '150.0.0.0').gpc, true);
  for (const brand of [...NO_GPC_BRANDS, '', null, 'Firefox']) {
    assert.ok(!buildBrandIdentity(brand, 150, '150.0.0.0').gpc, `${brand} must not send GPC`);
  }
});

test('Do Not Track on: Chrome-family profiles keep DNT but get no GPC', () => {
  for (const brand of NO_GPC_BRANDS) {
    const fp = config(brand, '1');
    assert.equal(fp.dnt, '1', `${brand}: DNT still on`);
    assert.equal(fp.gpc, false, `${brand}: no GPC`);
    assert.deepEqual(engine.privacyRequestHeaders(fp), { DNT: '1' }, `${brand}: DNT header only`);
  }
});

test('Brave sends GPC whatever its Do Not Track choice, and DNT is unchanged', () => {
  for (const [dnt, want] of [['1', '1'], ['on', '1'], ['0', '0'], ['Default', null], [undefined, null]]) {
    const fp = config('Brave', dnt);
    assert.equal(fp.dnt, want, `DNT ${dnt}`);
    assert.equal(fp.gpc, true, `DNT ${dnt}: GPC on`);
  }
  assert.deepEqual(engine.privacyRequestHeaders(config('Brave', '1')), { DNT: '1', 'Sec-GPC': '1' });
  assert.deepEqual(engine.privacyRequestHeaders(config('Brave', '0')), { 'Sec-GPC': '1' });
  assert.deepEqual(engine.privacyRequestHeaders(config('Brave', 'Default')), { 'Sec-GPC': '1' });
});

test('Do Not Track off or unset: a Chrome profile sends no privacy headers at all', () => {
  assert.deepEqual(engine.privacyRequestHeaders(config('Chrome', '0')), {});
  assert.deepEqual(engine.privacyRequestHeaders(config('Chrome', 'Default')), {});
  assert.deepEqual(engine.privacyRequestHeaders({}), {});
  assert.deepEqual(engine.privacyRequestHeaders(undefined), {});
});

test('the anti-detect build (no Brave identity, no page script) never sends GPC', () => {
  const fp = { ...config('Brave', '1'), nativeEngine: true };
  assert.deepEqual(engine.privacyRequestHeaders(fp), { DNT: '1' }, 'DNT keeps working as before');
  assert.equal(engine.workerPreludeSource(fp), null);
});

// ---- The page script ----

function runPage(fp) {
  const NavProto = {};
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => Object.defineProperty(NavProto, n, { get() { return null; }, configurable: true, enumerable: true }));
  function SharedWorker(url) { this.url = url; }
  const sb = { navigator: Object.create(NavProto), console, SharedWorker, URL, Blob };
  sb.window = sb;
  sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(`(${engine.fingerprintScript.toString()})(${JSON.stringify(fp)});`, sb);
  return sb;
}
// The brand, DNT and GPC values come from the real config; the rest is the minimal page the other
// fingerprint tests use (the sandbox has no screen, DOM or media objects).
const pageFp = (brand, dnt, guard) => {
  const cfg = config(brand, dnt);
  return {
    seed: 1, guard, langs: ['en-US', 'en'], cores: 6, mem: 8, navPlatform: 'Win32',
    noise: { canvas: false, webgl: false, audio: false }, dedicatedWorkersViaCdp: true,
    brandVendor: cfg.brandVendor, brandInject: cfg.brandInject, dnt: cfg.dnt, gpc: cfg.gpc
  };
};

test('page script: a Chrome-family profile with DNT on reports DNT and has no globalPrivacyControl', () => {
  NO_GPC_BRANDS.forEach((brand, i) => {
    const sb = runPage(pageFp(brand, '1', `gGpcNo${i}`));
    assert.equal(vm.runInContext('navigator.doNotTrack', sb), '1', `${brand}: DNT still on`);
    assert.equal(vm.runInContext("'globalPrivacyControl' in navigator", sb), false, `${brand}: no GPC property`);
  });
});

test('page script: Brave reports globalPrivacyControl true like a native IDL attribute', () => {
  for (const [dnt, guard] of [['1', 'gGpcB1'], ['Default', 'gGpcB2']]) {
    const sb = runPage(pageFp('Brave', dnt, guard));
    assert.equal(vm.runInContext('navigator.globalPrivacyControl', sb), true, `DNT ${dnt}`);
    const probe = JSON.parse(vm.runInContext(`JSON.stringify((function () {
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'globalPrivacyControl');
      return { own: Object.prototype.hasOwnProperty.call(navigator, 'globalPrivacyControl'), enumerable: d.enumerable,
        name: d.get.name, src: Function.prototype.toString.call(d.get), proto: 'prototype' in d.get,
        listed: Object.keys(navigator).indexOf('globalPrivacyControl') >= 0 };
    })())`, sb));
    assert.equal(probe.own, false, 'on the prototype, not an own property');
    assert.equal(probe.listed, false);
    assert.equal(probe.enumerable, true);
    assert.equal(probe.name, 'get globalPrivacyControl');
    assert.match(probe.src, /\[native code\]/);
    assert.equal(probe.proto, false, 'an accessor getter is not constructible');
  }
});

// ---- Workers: the same answer as the page ----

function workerSandbox() {
  const NavProto = {};
  const def = (n, v) => Object.defineProperty(NavProto, n, { get() { return v; }, configurable: true, enumerable: true });
  def('deviceMemory', 8);
  def('hardwareConcurrency', 6);
  def('platform', 'Win32');
  def('languages', ['en-US', 'en']);
  def('language', 'en-US');
  const sb = { navigator: Object.create(NavProto) };
  sb.self = sb;
  vm.createContext(sb);
  vm.runInContext('this.__origToString = Function.prototype.toString;', sb);
  return sb;
}
// Values matching the sandbox, so GPC is the only thing a worker prelude could change.
const workerFp = (brand, dnt) => ({ ...config(brand, dnt), guard: undefined, cores: 6, mem: 8, navPlatform: 'Win32', langs: ['en-US', 'en'], timezone: undefined });

test('CDP worker prelude: Brave workers report globalPrivacyControl true, on the prototype, looking native', () => {
  const sb = workerSandbox();
  vm.runInContext(engine.workerPreludeSource(workerFp('Brave', 'Default')), sb);
  assert.equal(vm.runInContext('navigator.globalPrivacyControl', sb), true);
  const probe = JSON.parse(vm.runInContext(`JSON.stringify((function () {
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'globalPrivacyControl');
    return { own: Object.prototype.hasOwnProperty.call(navigator, 'globalPrivacyControl'), enumerable: d.enumerable,
      name: d.get.name, src: Function.prototype.toString.call(d.get), proto: 'prototype' in d.get };
  })())`, sb));
  assert.deepEqual(probe, { own: false, enumerable: true, name: 'get globalPrivacyControl', src: 'function get globalPrivacyControl() { [native code] }', proto: false });
});

test('CDP worker prelude: Chrome-family workers get no globalPrivacyControl, even with DNT on', () => {
  for (const brand of NO_GPC_BRANDS) {
    const sb = workerSandbox();
    vm.runInContext(engine.workerPreludeSource(workerFp(brand, '1')), sb);
    assert.equal(vm.runInContext("'globalPrivacyControl' in navigator", sb), false, brand);
    assert.equal(vm.runInContext('Function.prototype.toString === this.__origToString', sb), true, `${brand}: worker untouched`);
  }
});

test('CDP worker prelude: a worker that already reports GPC is left alone', () => {
  const sb = workerSandbox();
  Object.defineProperty(Object.getPrototypeOf(sb.navigator), 'globalPrivacyControl', { get() { return true; }, configurable: true, enumerable: true });
  vm.runInContext(engine.workerPreludeSource(workerFp('Brave', '1')), sb);
  assert.equal(vm.runInContext('Function.prototype.toString === this.__origToString', sb), true);
});

test('shared-worker prelude from the page script: GPC in Brave workers only', async () => {
  const { resolveObjectURL } = require('node:buffer');
  const preludeFor = async (brand, guard) => {
    const page = runPage(pageFp(brand, '1', guard));
    const boot = await resolveObjectURL(new page.SharedWorker('https://example.com/s.js').url).text();
    return boot.split('\n')[0];
  };
  const brave = workerSandbox();
  vm.runInContext(await preludeFor('Brave', 'gGpcSw1'), brave);
  assert.equal(vm.runInContext('navigator.globalPrivacyControl', brave), true);
  const d = vm.runInContext("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'globalPrivacyControl')", brave);
  assert.equal(d.enumerable, true);
  assert.equal(vm.runInContext("Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'globalPrivacyControl').get)", brave),
    'function get globalPrivacyControl() { [native code] }');
  assert.equal('prototype' in d.get, false);

  const chrome = workerSandbox();
  vm.runInContext(await preludeFor('Chrome', 'gGpcSw2'), chrome);
  assert.equal(vm.runInContext("'globalPrivacyControl' in navigator", chrome), false);
});

test('new tabs and workers get the GPC choice through the same auto-attach as the first tab', () => {
  const brave = { ...config('Brave', '1'), guard: 'gGpcT1' };
  const late = { workerSource: engine.workerPreludeSource(brave) };
  const cmd = engine.targetFingerprintCommands('worker', brave, late).find((c) => c.method === 'Runtime.evaluate');
  assert.ok(cmd && /"gpc":true/.test(cmd.params.expression), 'the worker prelude carries GPC for Brave');
  const chrome = { ...config('Chrome', '1'), guard: 'gGpcT2' };
  assert.doesNotMatch(engine.workerPreludeSource(chrome), /"gpc"/, 'nothing for Chrome');
});

// ---- Launch wiring ----

test('every tab sends the brand-aware privacy headers; GPC is never tied to DNT any more', () => {
  const launch = SRC.slice(SRC.indexOf('async function launchProfileSessionNow('), SRC.indexOf('\n// Navigate a running session'));
  assert.match(launch, /const privacyHeaders = privacyRequestHeaders\(fpConfig\);/);
  assert.match(launch, /if \(Object\.keys\(privacyHeaders\)\.length\) await targetPage\.setExtraHTTPHeaders\(privacyHeaders\)/);
  assert.doesNotMatch(SRC, /DNT: '1', 'Sec-GPC': '1'/);
  assert.doesNotMatch(SRC, /define\(navigator, 'globalPrivacyControl'/);
  // The header list is built after the engine is chosen, so the anti-detect flag is already set.
  assert.ok(SRC.indexOf('if (usingAntidetect) fpConfig.nativeEngine = true;') < SRC.indexOf('const privacyHeaders = privacyRequestHeaders(fpConfig);'));
});

test('Firefox profiles keep real Firefox behaviour: the engine sets no GPC', () => {
  assert.doesNotMatch(FF_SRC, /globalprivacycontrol|globalPrivacyControl|Sec-GPC/i);
});
