'use strict';
// Coherence-first fingerprint regression tests (2026-07).
//
// A string-only OS/GPU spoof over the real binary + host machine is always betrayed by
// the host's fonts, canvas raster and WebGL render output, so generated profiles now:
//   • default to the REAL HOST OS (cross-OS is an explicit opt-in), and
//   • default to the REAL GPU (webglMetadata 'Real') so main-thread / worker / service-
//     worker all report the same true GPU (no mismatch),
//   • keep macOS resolutions as LOGICAL points (not the physical Retina panel size),
// and the in-page screen spoof reserves the OS-correct task/menu bar + pins colorDepth.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { generateFingerprint } = require('../src/main/fingerprintGenerator');
const { fingerprintScript } = require('../src/main/browserEngine');

const HOST_OS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || 'Windows';

test('generateFingerprint() defaults to the HOST OS (coherence-first)', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.equal(generateFingerprint().os, HOST_OS, 'the default OS must be the real host OS');
  }
});

test('an explicitly-chosen OS is still honored', () => {
  assert.equal(generateFingerprint({ os: 'macOS' }).os, 'macOS');
  assert.equal(generateFingerprint({ os: 'Windows' }).os, 'Windows');
  assert.equal(generateFingerprint({ os: 'Linux' }).os, 'Linux');
});

test('cross-OS variety is OPT-IN via os:"random" or allowCrossOs:true', () => {
  const seen = new Set();
  for (let i = 0; i < 90; i += 1) seen.add(generateFingerprint({ os: 'random' }).os);
  for (let i = 0; i < 90; i += 1) seen.add(generateFingerprint({ allowCrossOs: true }).os);
  assert.ok(seen.size > 1, 'random / allowCrossOs must be able to produce a non-host OS');
});

test('desktop profiles default to Real GPU metadata (report the true host GPU)', () => {
  const fp = generateFingerprint({ os: 'Windows' });
  assert.equal(fp.webglMetadata, 'Real');
  // vendor/renderer stay populated for the picker display + the device↔GPU coherence check.
  assert.ok(fp.webglVendor && fp.webglRenderer, 'webgl vendor/renderer are kept for display');
});

test('macOS resolutions are LOGICAL points, never the physical Retina panel size', () => {
  for (let i = 0; i < 40; i += 1) {
    const w = Number(generateFingerprint({ os: 'macOS' }).resolutionW);
    // A 3024/2880/2560-wide physical panel reported as screen.width at DPR 1 is the tell.
    assert.ok(w > 0 && w <= 2100, `macOS screen width ${w} looks like a physical panel, not logical points`);
  }
});

test('mobile keeps its coherent Android GPU spoof (must match the emulated Pixel 7 UA)', () => {
  const fp = generateFingerprint({ deviceClass: 'mobile' });
  assert.equal(fp.webglMetadata, 'Custom', 'mobile emulation MUST spoof the GPU to match the Android UA');
  assert.match(String(fp.webglRenderer), /Mali/);
});

// ---- in-page screen coherence (fingerprintScript) -----------------------------
function runScreen(fp) {
  const NavProto = {};
  const proto = (name, val) =>
    Object.defineProperty(NavProto, name, { get() { return val; }, configurable: true, enumerable: true });
  ['webdriver', 'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'platform', 'vendor']
    .forEach((n) => proto(n, null));
  const sandbox = { navigator: Object.create(NavProto), console, screen: {} };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${fingerprintScript.toString()})(${JSON.stringify(fp)});`, sandbox);
  return sandbox.screen;
}

test('screen availHeight/availTop follow the OS (Windows taskbar vs macOS menu bar)', () => {
  const base = { seed: 1, langs: ['en-US', 'en'], noise: { canvas: false, webgl: false, audio: false }, screenW: 1920, screenH: 1080 };

  const win = runScreen({ ...base, navPlatform: 'Win32' });
  assert.equal(win.width, 1920);
  assert.equal(win.availHeight, 1080 - 48, 'Windows reserves ~48px taskbar at the bottom');
  assert.equal(win.availTop, 0);
  assert.equal(win.colorDepth, 24);
  assert.equal(win.pixelDepth, 24);

  const mac = runScreen({ ...base, navPlatform: 'MacIntel' });
  assert.equal(mac.availHeight, 1080 - 25, 'macOS reserves ~25px menu bar at the top');
  assert.equal(mac.availTop, 25, 'macOS menu bar means availTop ≈ 25, not the Windows-style 0');
});
