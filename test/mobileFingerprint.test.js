'use strict';
// Phase 7: mobile/Android fingerprint generation + device↔GPU coherence rule.
// fingerprintGenerator.js is pure (node:crypto/os only), so node:test drives it.
const test = require('node:test');
const assert = require('node:assert/strict');

const { generateFingerprint, generateMobileFingerprint, deviceGpuCoherence } = require('../src/main/fingerprintGenerator');

test('mobile generator produces a coherent Android (Pixel 7) fingerprint', () => {
  const fp = generateFingerprint({ deviceClass: 'mobile' });
  assert.equal(fp.os, 'Android');
  assert.equal(fp.osVersion, '13');
  assert.equal(fp.deviceClass, 'mobile');
  assert.match(fp.webglRenderer, /Mali/i, 'mobile GPU renderer');
  assert.equal(fp.resolutionW, '412');
  assert.equal(fp.resolutionH, '915');
  assert.equal(fp.cpuCores, '8');
  // The GPU must be coherent with the device class per the leak-check rule.
  assert.equal(deviceGpuCoherence(fp).status, 'pass');
});

test('generateMobileFingerprint matches the routed mobile generator', () => {
  const a = generateMobileFingerprint();
  assert.equal(a.deviceClass, 'mobile');
  assert.equal(a.os, 'Android');
});

test('desktop generator stays desktop and never emits a mobile GPU', () => {
  for (let i = 0; i < 30; i += 1) {
    const fp = generateFingerprint();
    assert.equal(fp.deviceClass, 'desktop');
    assert.ok(['Windows', 'macOS', 'Linux'].includes(fp.os));
    assert.doesNotMatch(String(fp.webglRenderer), /mali|adreno|powervr/i);
    assert.equal(deviceGpuCoherence(fp).status, 'pass');
  }
});

test('deviceGpuCoherence flags a mobile profile with a desktop GPU', () => {
  const r = deviceGpuCoherence({
    deviceClass: 'mobile',
    os: 'Android',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'
  });
  assert.equal(r.status, 'fail');
});

test('deviceGpuCoherence flags a desktop profile with a mobile GPU', () => {
  const r = deviceGpuCoherence({
    deviceClass: 'desktop',
    os: 'Windows',
    webglRenderer: 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)'
  });
  assert.equal(r.status, 'fail');
});

test('deviceGpuCoherence treats an Android os string as mobile even without deviceClass', () => {
  assert.equal(deviceGpuCoherence({ os: 'Android', webglRenderer: 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)' }).status, 'pass');
  assert.equal(deviceGpuCoherence({ os: 'Android', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11)' }).status, 'fail');
});

test('deviceGpuCoherence warns (does not crash) when no renderer is set', () => {
  assert.equal(deviceGpuCoherence({ deviceClass: 'mobile' }).status, 'warn');
  assert.equal(deviceGpuCoherence({}).status, 'warn');
});

test('a desktop Apple-Silicon renderer is coherent for a desktop profile', () => {
  assert.equal(deviceGpuCoherence({
    deviceClass: 'desktop', os: 'macOS',
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'
  }).status, 'pass');
});
