'use strict';
// Generates a complete, internally-consistent desktop fingerprint.
//
// Design principles:
//  - Device traits (OS, GPU, screen, CPU/RAM) are randomized but PAIRED so they
//    agree with each other (a macOS profile gets an Apple GPU + a Mac resolution).
//  - The browser VERSION is left to the engine (userAgent 'Auto', browserVersion
//    blank) so the reported UA / Client-Hints match the real Chromium binary's
//    TLS / JA4 / HTTP2 fingerprint. Faking a version the binary doesn't have is
//    exactly the kind of mismatch detectors look for.
//  - Timezone / language / geolocation are intentionally left on "Based on IP"
//    so the launch engine binds them to the proxy's exit IP at launch time.

const crypto = require('node:crypto');

function choice(arr) { return arr[crypto.randomInt(arr.length)]; }

function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = crypto.randomInt(total);
  for (const [value, w] of pairs) {
    if (r < w) return value;
    r -= w;
  }
  return pairs[0][0];
}

function randMac() {
  const hex = () => '0123456789ABCDEF'[crypto.randomInt(16)];
  return Array.from({ length: 6 }, () => `${hex()}${hex()}`).join('-');
}

function randDeviceName() {
  return `DESKTOP-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`;
}

const WIN_RES = ['1920x1080', '1366x768', '1536x864', '2560x1440', '1600x900', '1440x900'];
const MAC_RES = ['2560x1440', '1680x1050', '1440x900', '1920x1080', '3024x1964'];
const LINUX_RES = ['1920x1080', '1366x768', '2560x1440', '1600x900'];

const WIN_GPU = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)']
];
const MAC_GPU = [
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)']
];
const LINUX_GPU = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)']
];

function generateFingerprint() {
  const os = weighted([['Windows', 65], ['macOS', 25], ['Linux', 10]]);

  let osVersion;
  let res;
  let gpu;
  if (os === 'Windows') {
    osVersion = weighted([['11', 70], ['10', 30]]);
    res = choice(WIN_RES);
    gpu = choice(WIN_GPU);
  } else if (os === 'macOS') {
    osVersion = choice(['15', '14', '13']);
    res = choice(MAC_RES);
    gpu = choice(MAC_GPU);
  } else {
    osVersion = choice(['Ubuntu', 'Debian', 'Fedora']);
    res = choice(LINUX_RES);
    gpu = choice(LINUX_GPU);
  }

  const [resW, resH] = res.split('x');
  const cores = choice(['4', '6', '8', '12', '16']);
  const ramGb = Number(cores) >= 12 ? choice(['16', '32']) : choice(['8', '16']);

  return {
    browserCore: 'Chrome',
    browserVersion: '',
    os,
    osVersion,
    userAgent: 'Auto',

    resolutionType: 'Custom',
    resolutionW: resW,
    resolutionH: resH,

    webglMetadata: 'Custom',
    webglVendor: gpu[0],
    webglRenderer: gpu[1],
    webgpu: 'Based on WebGL',

    cpuType: 'Custom',
    cpuCores: cores,
    ramType: 'Custom',
    ramGb,

    deviceNameType: 'Custom',
    deviceName: randDeviceName(),
    macAddressType: 'Custom',
    macAddress: randMac(),

    // Bound to the proxy at launch — intentionally not hardcoded here.
    timezoneType: 'Based on IP',
    locationType: 'Based on IP',
    languageType: 'Based on IP',
    displayLangType: 'Based on Language',

    webrtc: 'Forward',
    fontsType: 'Default',
    mediaDevice: 'Auto',
    canvasNoise: true,
    webglImageNoise: true,
    audioContextNoise: true,
    clientRectsNoise: true,
    speechVoicesNoise: true,
    doNotTrack: 'Default',
    portScanProtection: 'Enable',
    hardwareAcceleration: 'Default',
    disableTls: 'Close'
  };
}

module.exports = { generateFingerprint };