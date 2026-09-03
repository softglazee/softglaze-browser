'use strict';
// Regression tests for OS <-> fingerprint coherence.
//
// Two ways a profile used to advertise the wrong machine:
//
//   1. A macOS or Linux profile on a Windows host reported the REAL Windows GPU
//      (`ANGLE (NVIDIA ... Direct3D11 ...)`) alongside navigator.platform 'MacIntel'.
//      Direct3D is Windows-only, so that single string outs the host OS — and the
//      built-in Leak Check reported "pass" for it, because the old coherence check
//      only compared mobile-vs-desktop.
//
//   2. Selecting iOS produced a WINDOWS DESKTOP fingerprint. osTokens had no iOS
//      branch, so it fell through to the Windows default and the user believed they
//      had an iPhone profile while every scanner saw Windows.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { deviceGpuCoherence } = require('../src/main/fingerprintGenerator');

const D3D = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const METAL = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
const MESA = 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)';
const MALI = 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)';

// --- 1) the coherence checker must catch OS/graphics-API contradictions ---

test('a macOS profile reporting a Direct3D GPU fails coherence', () => {
  const r = deviceGpuCoherence({ os: 'macOS', deviceClass: 'desktop', webglRenderer: D3D });
  assert.equal(r.status, 'fail',
    'Direct3D is Windows-only — this is the exact case the Leak Check used to pass');
  assert.match(r.detail, /Direct3D/);
});

test('a Linux profile reporting a Direct3D GPU fails coherence', () => {
  assert.equal(deviceGpuCoherence({ os: 'Linux', deviceClass: 'desktop', webglRenderer: D3D }).status, 'fail');
});

test('a Windows profile reporting a Metal or Mesa GPU fails coherence', () => {
  assert.equal(deviceGpuCoherence({ os: 'Windows', deviceClass: 'desktop', webglRenderer: METAL }).status, 'fail');
  assert.equal(deviceGpuCoherence({ os: 'Windows', deviceClass: 'desktop', webglRenderer: MESA }).status, 'fail');
});

test('coherent OS + GPU pairings still pass', () => {
  assert.equal(deviceGpuCoherence({ os: 'macOS', deviceClass: 'desktop', webglRenderer: METAL }).status, 'pass');
  assert.equal(deviceGpuCoherence({ os: 'Linux', deviceClass: 'desktop', webglRenderer: MESA }).status, 'pass');
  assert.equal(deviceGpuCoherence({ os: 'Windows', deviceClass: 'desktop', webglRenderer: D3D }).status, 'pass');
  assert.equal(deviceGpuCoherence({ os: 'Android', deviceClass: 'mobile', webglRenderer: MALI }).status, 'pass');
});

test('a mobile profile reporting a desktop Direct3D GPU fails coherence', () => {
  assert.equal(deviceGpuCoherence({ os: 'Android', deviceClass: 'mobile', webglRenderer: D3D }).status, 'fail');
});

// --- 2) osTokens must never silently turn a mobile OS into Windows desktop ---

function loadOsTokens() {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/browserEngine.js'), 'utf8');
  const start = src.indexOf('function osTokens(');
  assert.notEqual(start, -1, 'could not find osTokens');
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const ctx = { module: {}, console: { warn() {}, log() {} } };
  vm.createContext(ctx);
  vm.runInContext(`${src.slice(start, end + 1)}; module.exports = osTokens;`, ctx);
  return ctx.module.exports;
}

test('an iOS profile does not silently become a Windows desktop', () => {
  const osTokens = loadOsTokens();
  for (const v of ['iOS', 'ios', 'iPhone', 'iPad', 'All iOS']) {
    const t = osTokens(v);
    assert.notEqual(t.navPlatform, 'Win32', `"${v}" must not fall through to Windows`);
    assert.notEqual(t.chPlatform, 'Windows', `"${v}" must not fall through to Windows`);
    // Android is the mobile identity a Blink engine can carry coherently.
    assert.equal(t.chPlatform, 'Android');
  }
});

test('the other OS values still map as before', () => {
  const osTokens = loadOsTokens();
  assert.equal(osTokens('macOS').navPlatform, 'MacIntel');
  assert.equal(osTokens('Linux').navPlatform, 'Linux x86_64');
  assert.equal(osTokens('Android').chPlatform, 'Android');
  assert.equal(osTokens('Windows').navPlatform, 'Win32');
  assert.equal(osTokens('').navPlatform, 'Win32', 'blank still defaults to Windows');
});

// --- 3) the editor must not offer an OS the engine cannot deliver ---

test('iOS is not offered in the profile editor', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/ProfilesPage.jsx'), 'utf8');
  const start = page.indexOf('const OS_PLATFORMS = [');
  const end = page.indexOf('];', start);
  const block = page.slice(start, end);
  assert.equal(/id:\s*'iOS'/.test(block), false,
    'iOS is not deliverable on a Blink engine (real iOS browsers are WebKit); ' +
    'offering it produced a Windows fingerprint while the user believed otherwise');
  assert.ok(/id:\s*'Android'/.test(block), 'Android is still offered');
});

// --- 4) a cross-OS profile must not report the host GPU ---

test('the launch path forces a coherent GPU for a cross-OS profile', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'src/main/browserEngine.js'), 'utf8');
  assert.ok(/const crossOs = claimedOs !== HOST_OS_NAME/.test(engine),
    'browserEngine must compare the claimed OS against the host');
  assert.ok(/if \(crossOs && !webglVendor\)/.test(engine),
    'a cross-OS profile must get a spoofed GPU even when WebGL Metadata is "Real", ' +
    'or it reports the host GPU and the real OS leaks through');
});
