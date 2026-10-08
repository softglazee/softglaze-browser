'use strict';
// Audit E2 remainder (7 Oct): what a visited site can see in the page's MAIN world.
//  (a) The fingerprint scripts used fixed run-once guards (window.__sgz / __sgn), so a
//      single `'__sgz' in window` identified SoftGlaze. The guard name is now random
//      per launch (fpConfig.guard) and non-enumerable.
//  (b) The macro recorder and session mirroring put window.__sgBridge (plus the
//      exposeFunction wrappers __sgzRecordStep / __sgSyncDispatch and the
//      window.__sgzRecording flag) into the main world, and the widened bridge stayed
//      for the rest of the page's life. Both now run in a private CDP isolated world
//      that exists only while recording / mirroring is active.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engine = require('../src/main/browserEngine');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'browserEngine.js'), 'utf8');

function sliceFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = SRC.indexOf('\nfunction ', start + 10);
  const nextAsync = SRC.indexOf('\nasync function ', start + 10);
  const ends = [next, nextAsync].filter((i) => i > 0);
  return SRC.slice(start, ends.length ? Math.min(...ends) : undefined);
}

function sandbox() {
  const NavProto = {};
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => Object.defineProperty(NavProto, n, { get() { return null; }, configurable: true, enumerable: true }));
  const sb = { navigator: Object.create(NavProto), console };
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const FP = { seed: 7, langs: ['en-US'], cores: 8, mem: 8, navPlatform: 'Win32', timezone: 'UTC', noise: { canvas: false, webgl: false, audio: false } };

test('randomGuardName differs per launch and looks like an ordinary identifier', () => {
  const names = new Set();
  for (let i = 0; i < 50; i += 1) {
    const n = engine.randomGuardName();
    assert.match(n, /^[a-z][A-Za-z0-9]{6,11}$/);
    names.add(n);
  }
  assert.ok(names.size > 45, 'names are random');
  assert.match(SRC, /fpConfig\.guard = randomGuardName\(\);/);
});

for (const [label, fn] of [['fingerprintScript', engine.fingerprintScript], ['nativeGapScript', engine.nativeGapScript]]) {
  test(`${label}: the run-once guard is invisible to Object.keys, for-in and fixed-name probes`, () => {
    const sb = sandbox();
    const before = Object.keys(sb).slice();
    const fp = { ...FP, guard: 'kZ3pQ8wLx' };
    const src = `(${fn.toString()})(${JSON.stringify(fp)});`;
    vm.runInContext(src, sb);
    vm.runInContext(src, sb); // second injection (auto-attach + evaluateOnNewDocument)
    const probe = JSON.parse(vm.runInContext(`JSON.stringify((function () {
      var forIn = []; for (var k in window) forIn.push(k);
      return { keys: Object.keys(window), forIn: forIn,
        sgz: '__sgz' in window, sgn: '__sgn' in window,
        desc: Object.getOwnPropertyDescriptor(window, ${JSON.stringify(fp.guard)}) };
    })())`, sb));
    assert.equal(probe.sgz, false);
    assert.equal(probe.sgn, false);
    assert.ok(!probe.keys.includes(fp.guard));
    assert.ok(!probe.forIn.includes(fp.guard));
    assert.deepEqual(probe.keys.filter((k) => !before.includes(k)), [], 'no new enumerable globals');
    assert.ok(probe.desc && probe.desc.enumerable === false, 'guard is set, non-enumerable');
  });
}

test('no fixed guard names remain in the scripts', () => {
  for (const name of ['fingerprintScript', 'nativeGapScript']) {
    const body = sliceFn(name);
    assert.doesNotMatch(body.replace(/\/\/.*$/gm, ''), /'__sg[nz]'|window\.__sg[nz]\b/);
  }
});

test('macro recorder runs in an isolated world: no main-world bridge, binding or flag', () => {
  const rec = sliceFn('macroRecorderClientScript');
  const code = rec.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /__sgBridge|__sgzRecording|__sgzRecordStep/);
  const start = sliceFn('startMacroRecording').replace(/\/\/.*$/gm, '');
  assert.match(start, /attachIsolatedWorld\(page, \{ recordStep: hRecordStep \}, macroRecorderClientScript\.toString\(\)\)/);
  assert.doesNotMatch(start, /exposeFunction|attachPageBridge|evaluateOnNewDocument/);
  const stop = sliceFn('stopMacroRecording').replace(/\/\/.*$/gm, '');
  assert.match(stop, /rec\.world\.dispose\(\)/, 'the world is torn down when recording stops');
  assert.doesNotMatch(stop, /__sgzRecording/);
});

test('session mirroring runs in an isolated world that is disposed with the group', () => {
  const begin = sliceFn('beginSyncGroup').replace(/\/\/.*$/gm, '');
  assert.match(begin, /attachIsolatedWorld\(masterSession\.page, \{ syncDispatch: hSyncDispatch \}, syncCaptureClientScript\.toString\(\)\)/);
  assert.doesNotMatch(begin, /exposeFunction|attachPageBridge|__sgBridge|__sgSyncDispatch|evaluateOnNewDocument/);
  assert.match(begin, /w\.dispose\(\)/);
  assert.doesNotMatch(sliceFn('syncCaptureClientScript').replace(/\/\/.*$/gm, ''), /__sgBridge/);
});

test('the main-world __sgBridge is left only on the file:// start page', () => {
  const calls = SRC.match(/attachPageBridge\([^)]*\)[^;]*;/g) || [];
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\{ fileOnly: true \}/);
});

// Run the recorder / capture scripts against a fake DOM to prove they still work
// through the rpc they are handed, and go quiet once stopped.
function fakeWorld() {
  const listeners = {};
  const document = { addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); } };
  const sb = { document, CSS: { escape: (s) => s }, Element: function Element() {}, Promise, Array };
  sb.window = sb;
  vm.createContext(sb);
  const fire = (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev));
  return { sb, fire };
}

test('recorder script forwards steps through rpc and stops when flagged', () => {
  const { sb, fire } = fakeWorld();
  const calls = [];
  sb.rpc = (name, step) => { calls.push([name, JSON.parse(JSON.stringify(step))]); return Promise.resolve(null); };
  vm.runInContext(`(${engine.macroRecorderClientScript.toString()})(rpc)`, sb);
  fire('keydown', { key: 'Enter' });
  fire('click', { target: { closest: () => ({ href: 'https://example.com/next' }) } });
  assert.deepEqual(calls.map((c) => c[0]), ['recordStep', 'recordStep']);
  assert.deepEqual(calls[0][1], { type: 'keypress', key: 'Enter' });
  assert.deepEqual(calls[1][1], { type: 'goto', url: 'https://example.com/next' });
  sb.__recStopped = true;
  fire('keydown', { key: 'Enter' });
  assert.equal(calls.length, 2);
});

test('mirroring capture script forwards input through rpc and stops when flagged', () => {
  const { sb, fire } = fakeWorld();
  const calls = [];
  sb.rpc = (name, evt) => { calls.push([name, JSON.parse(JSON.stringify(evt))]); return Promise.resolve(null); };
  vm.runInContext(`(${engine.syncCaptureClientScript.toString()})(rpc)`, sb);
  fire('click', { clientX: 10.4, clientY: 20.6, button: 0 });
  assert.deepEqual(calls[0], ['syncDispatch', { k: 'click', x: 10, y: 21, button: 0 }]);
  sb.__syncStopped = true;
  fire('click', { clientX: 1, clientY: 1, button: 0 });
  assert.equal(calls.length, 1);
});
