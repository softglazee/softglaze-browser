'use strict';
// Regression tests for the in-page anti-detect script (browserEngine.fingerprintScript).
//
// These guard the CONFIRMED fingerprint-integrity leaks that made every spoofed page
// look automated to bot-detection JS (reCAPTCHA/CreepJS/FingerprintJS) regardless of
// proxy — the "CAPTCHA on every proxy incl. local" symptom:
//   1. Function.prototype.toString.name must be "toString" (was the helper's name).
//   2. Every overridden native must report "[native code]" from .toString() and carry
//      its real .name (timezone layer, getVoices, measureText, fetch/XHR/WebSocket).
//   3. Spoofed navigator props must live on Navigator.prototype (hasOwnProperty === false),
//      with getters that themselves report "[native code]" — not "() => value".
//
// The real fingerprintScript is executed in a fresh vm realm against a minimal fake
// browser global, then invariants are asserted from the test realm.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { fingerprintScript } = require('../src/main/browserEngine');

// Build a minimal browser-like global object and run the real script against it.
function runScriptInSandbox(fp) {
  // A fake navigator whose spoofable attributes live on its PROTOTYPE, exactly like a
  // real Navigator — so the script's prototype-vs-instance logic is exercised for real.
  const NavProto = {};
  const proto = (name, val) =>
    Object.defineProperty(NavProto, name, { get() { return val; }, configurable: true, enumerable: true });
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => proto(n, null));
  const navigator = Object.create(NavProto);

  const sandbox = { navigator, console };
  sandbox.window = sandbox;          // window === globalThis, as in a browser
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = `(${fingerprintScript.toString()})(${JSON.stringify(fp)});`;
  vm.runInContext(src, sandbox);
  // Expose the realm's (now-patched) intrinsics so the test realm can inspect them.
  vm.runInContext('this.Function = Function; this.Date = Date; this.Intl = Intl;', sandbox);
  return sandbox;
}

const FP = {
  seed: 12345,
  langs: ['en-US', 'en'],
  cores: 8,
  mem: 8,
  navPlatform: 'Win32',
  timezone: 'America/New_York',
  // Real launches always pass a noise object; the canvas/webgl/audio blocks need DOM
  // globals we don't stub, so leave them off and exercise the navigator/timezone/
  // toString paths (which is what these tests assert).
  noise: { canvas: false, webgl: false, audio: false },
};

test('Function.prototype.toString.name is "toString" (not the internal helper name)', () => {
  const s = runScriptInSandbox(FP);
  assert.equal(s.Function.prototype.toString.name, 'toString');
  // And its own source reports native, without leaking the helper name.
  const selfSrc = s.Function.prototype.toString.toString();
  assert.match(selfSrc, /\[native code\]/);
  assert.doesNotMatch(selfSrc, /_fnToString/);
});

test('navigator.webdriver is false and lives on the prototype (not an own instance prop)', () => {
  const s = runScriptInSandbox(FP);
  assert.equal(s.navigator.webdriver, false);
  assert.equal(Object.prototype.hasOwnProperty.call(s.navigator, 'webdriver'), false,
    'webdriver must not be an own property of the navigator instance');
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s.navigator), 'webdriver');
  assert.ok(desc && typeof desc.get === 'function', 'webdriver must be an accessor on the prototype');
  // The getter itself must look native and be named "get webdriver".
  assert.match(desc.get.toString(), /\[native code\]/);
  assert.doesNotMatch(desc.get.toString(), /=>/);
  assert.equal(desc.get.name, 'get webdriver');
});

test('spoofed navigator values are applied and remain non-own', () => {
  const s = runScriptInSandbox(FP);
  assert.equal(s.navigator.hardwareConcurrency, 8);
  assert.equal(s.navigator.deviceMemory, 8);
  assert.equal(s.navigator.platform, 'Win32');
  assert.deepEqual([...s.navigator.languages], ['en-US', 'en']);
  assert.equal(s.navigator.language, 'en-US');
  for (const p of ['hardwareConcurrency', 'deviceMemory', 'platform', 'languages', 'language']) {
    assert.equal(Object.prototype.hasOwnProperty.call(s.navigator, p), false, `${p} must not be an own prop`);
  }
});

test('timezone-layer overrides report [native code] with correct names', () => {
  const s = runScriptInSandbox(FP);
  const nativeRe = /\[native code\]/;
  assert.match(s.Date.prototype.getTimezoneOffset.toString(), nativeRe);
  assert.equal(s.Date.prototype.getTimezoneOffset.name, 'getTimezoneOffset');
  assert.match(s.Date.prototype.toString.toString(), nativeRe);
  assert.match(s.Intl.DateTimeFormat.toString(), nativeRe);
  assert.equal(s.Intl.DateTimeFormat.name, 'DateTimeFormat');
  assert.match(s.Intl.DateTimeFormat.prototype.resolvedOptions.toString(), nativeRe);
  // And the timezone spoof actually works: New York in January is UTC-5 (offset +300 min).
  const jan = new s.Date('2026-01-15T12:00:00Z');
  assert.equal(jan.getTimezoneOffset(), 300);
  assert.equal(new s.Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/New_York');
});

test('the script is idempotent (running twice does not double-wrap or throw)', () => {
  const s = runScriptInSandbox(FP);
  // Re-run in the same context; the __sgz guard must make it a no-op.
  const src = `(${fingerprintScript.toString()})(${JSON.stringify(FP)});`;
  assert.doesNotThrow(() => vm.runInContext(src, s));
  assert.equal(s.Function.prototype.toString.name, 'toString');
});
