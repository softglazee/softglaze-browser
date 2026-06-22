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

// ---------------------------------------------------------------------------
// Media-device label pools, per OS. enumerateDevices() consistency is a real
// detection surface: a profile that reports 0 devices — or labels that don't fit
// the spoofed OS — gets flagged. These are plausible, real-world endpoint names
// (Realtek/Intel audio + common laptop webcams on Windows, the Built-in family on
// macOS, ALSA/UVC names on Linux). The concrete deviceId/groupId HASHES are
// derived per-profile in the launch engine from the profile seed, so they stay
// stable across launches; here we only choose the human-readable labels.
// ---------------------------------------------------------------------------
const MEDIA_LABELS = {
  Windows: {
    audioinput: ['Microphone (Realtek(R) Audio)', 'Microphone Array (Realtek(R) Audio)', 'Microphone (2- High Definition Audio Device)', 'Headset Microphone (3- USB Audio Device)'],
    audiooutput: ['Speakers (Realtek(R) Audio)', 'Speakers (2- High Definition Audio Device)', 'Headphones (Realtek(R) Audio)', 'Realtek Digital Output (Realtek(R) Audio)'],
    videoinput: ['HP Wide Vision HD Camera', 'Integrated Webcam', 'USB2.0 HD UVC WebCam', 'Lenovo EasyCamera', 'HD User Facing']
  },
  macOS: {
    audioinput: ['MacBook Pro Microphone', 'MacBook Air Microphone', 'iMac Microphone', 'External Microphone'],
    audiooutput: ['MacBook Pro Speakers', 'MacBook Air Speakers', 'iMac Speakers', 'External Headphones'],
    videoinput: ['FaceTime HD Camera', 'FaceTime HD Camera (Built-in)']
  },
  Linux: {
    audioinput: ['Built-in Audio Analog Stereo', 'HD-Audio Generic Analog Stereo', 'sof-hda-dsp Headset'],
    audiooutput: ['Built-in Audio Analog Stereo', 'HD-Audio Generic Analog Stereo', 'sof-hda-dsp Speaker'],
    videoinput: ['Integrated Camera: Integrated C', 'UVC Camera (046d:0825)', 'USB Video Device']
  }
};

// ---------------------------------------------------------------------------
// Chromium-family brand identities. Edge / Brave / Opera / Vivaldi / Yandex all
// run the SAME Blink engine as Chrome, so Softglaze launches the real Chrome
// binary and only swaps the *identity layer*: the UA token, the Sec-CH-UA brand
// list, navigator.vendor and a couple of vendor JS globals. The underlying
// Chromium MAJOR (and therefore TLS / JA4 / HTTP2 and the "Chromium" + "Chrome/M"
// tokens) ALWAYS comes from the real launched binary, so nothing the vendor token
// adds contradicts the wire fingerprint — exactly how the real vendor browsers
// look. The vendor DISPLAY versions are approximate maps off the Chromium major
// (the only cosmetic value here); keep them centralized for easy bumping.
// ---------------------------------------------------------------------------
const CHROMIUM_BRANDS = [
  { id: 'Chrome', label: 'Google Chrome', accent: '#4285F4' },
  { id: 'Edge', label: 'Microsoft Edge', accent: '#0F8AE0' },
  { id: 'Brave', label: 'Brave', accent: '#FB542B' },
  { id: 'Opera', label: 'Opera', accent: '#FF1B2D' },
  { id: 'Vivaldi', label: 'Vivaldi', accent: '#EF3939' },
  { id: 'Yandex', label: 'Yandex Browser', accent: '#FF0000' }
];
const CHROMIUM_BRAND_IDS = CHROMIUM_BRANDS.map((b) => b.id);

function normalizeBrand(brand) {
  const t = String(brand || '').toLowerCase();
  if (t.includes('edge') || t === 'edg') return 'Edge';
  if (t.includes('brave')) return 'Brave';
  if (t.includes('opera') || t === 'opr') return 'Opera';
  if (t.includes('vivaldi')) return 'Vivaldi';
  if (t.includes('yandex') || t.includes('yabrowser')) return 'Yandex';
  return 'Chrome';
}

const NOT_A_BRAND = { brand: 'Not_A Brand', version: '24', full: '24.0.0.0' };

// Given the REAL Chromium major (M) + full version, produce the identity bundle
// for `brand`. uaInfix is inserted before " Safari/537.36" (Yandex), uaSuffix is
// appended after it (Edge/Opera); brands feed Sec-CH-UA brands + fullVersionList;
// `inject` lists which vendor globals the in-page script should add; `vendor` is
// navigator.vendor (Google Inc. for every Chromium browser). vendor/inject do NOT
// depend on the Chromium major, so callers that only need the JS-layer bits can
// pass major 0.
function buildBrandIdentity(brand, chromiumMajor, chromiumFull) {
  const M = Number(chromiumMajor) || 0;
  const full = chromiumFull && /^\d+\.\d/.test(chromiumFull) ? chromiumFull : `${M}.0.0.0`;
  const id = normalizeBrand(brand);
  const chromiumBrand = { brand: 'Chromium', version: String(M), full };
  const chromeBrand = { brand: 'Google Chrome', version: String(M), full };

  switch (id) {
    case 'Edge': {
      // Edge tracks the Chromium major 1:1 (Edge 131 = Chromium 131).
      return {
        id, vendor: 'Google Inc.', uaInfix: '', uaSuffix: ` Edg/${M}.0.0.0`,
        brands: [chromiumBrand, { brand: 'Microsoft Edge', version: String(M), full: `${M}.0.0.0` }, NOT_A_BRAND],
        inject: []
      };
    }
    case 'Brave': {
      // Brave deliberately mirrors Chrome's UA + client hints to shed entropy; the
      // only honest signal is navigator.brave.isBrave().
      return {
        id, vendor: 'Google Inc.', uaInfix: '', uaSuffix: '',
        brands: [chromiumBrand, chromeBrand, NOT_A_BRAND],
        inject: ['brave']
      };
    }
    case 'Opera': {
      // Opera major ≈ Chromium major − 14 (Chromium 120 ⇒ Opera 106).
      const opr = Math.max(1, M - 14);
      return {
        id, vendor: 'Google Inc.', uaInfix: '', uaSuffix: ` OPR/${opr}.0.0.0`,
        brands: [chromiumBrand, { brand: 'Opera', version: String(opr), full: `${opr}.0.0.0` }, NOT_A_BRAND],
        inject: ['opr']
      };
    }
    case 'Vivaldi': {
      // Modern Vivaldi presents an otherwise-stock Chrome identity (its UA token is
      // off by default) and does NOT add itself to Sec-CH-UA — so it looks like
      // Chrome on the wire, which is exactly what we reproduce.
      return {
        id, vendor: 'Google Inc.', uaInfix: '', uaSuffix: '',
        brands: [chromiumBrand, chromeBrand, NOT_A_BRAND],
        inject: ['vivaldi']
      };
    }
    case 'Yandex': {
      // YaBrowser version is year-based and doesn't derive cleanly from the Chromium
      // major; pin a recent train. The Chromium major still drives everything else.
      // YaBrowser/Yowser tokens sit BEFORE the Safari token in the real UA.
      const ya = '24.12.0.0';
      return {
        id, vendor: 'Google Inc.', uaInfix: ` YaBrowser/${ya} Yowser/2.5`, uaSuffix: '',
        brands: [chromiumBrand, { brand: 'YaBrowser', version: '24.12', full: ya }, { brand: 'Yandex', version: '24.12', full: ya }, NOT_A_BRAND],
        inject: []
      };
    }
    default:
      return {
        id: 'Chrome', vendor: 'Google Inc.', uaInfix: '', uaSuffix: '',
        brands: [chromiumBrand, chromeBrand, NOT_A_BRAND],
        inject: []
      };
  }
}

function mediaOsKey(os) {
  const value = String(os || '').toLowerCase();
  if (value.includes('mac')) return 'macOS';
  if (value.includes('linux')) return 'Linux';
  return 'Windows';
}

// Pick a realistic, OS-appropriate microphone / speaker / camera label triple.
// When a numeric `seed` is supplied the choice is DETERMINISTIC (same profile →
// same hardware on every launch); otherwise it's freshly randomized (profile
// creation). Returns a serializable descriptor consumed by the launch engine.
function generateMediaDevices(os, seed) {
  const key = mediaOsKey(os);
  const pool = MEDIA_LABELS[key];
  const at = (arr, shift) => {
    if (!arr || !arr.length) return '';
    const idx = (seed === undefined || seed === null)
      ? crypto.randomInt(arr.length)
      : ((seed >>> 0) >>> shift) % arr.length;
    return arr[idx];
  };
  return {
    os: key,
    isWindows: key === 'Windows',
    mic: at(pool.audioinput, 0),
    spk: at(pool.audiooutput, 5),
    cam: at(pool.videoinput, 10),
    hasCamera: true
  };
}

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
  // Exclude the real host core count so a generated profile never reports the exact
  // hardwareConcurrency of the machine it was made on (which would read as a leak).
  let hostCores = 0;
  try { hostCores = (require('node:os').cpus() || []).length; } catch (e) { hostCores = 0; }
  const corePool = ['4', '6', '8', '12', '16'].filter((c) => Number(c) !== hostCores);
  const cores = choice(corePool.length ? corePool : ['4', '6', '8']);
  const ramGb = Number(cores) >= 12 ? choice(['16', '32']) : choice(['8', '16']);

  return {
    browserCore: 'Chrome',
    browserBrand: 'Chrome',
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

module.exports = {
  generateFingerprint,
  generateMediaDevices,
  CHROMIUM_BRANDS,
  CHROMIUM_BRAND_IDS,
  normalizeBrand,
  buildBrandIdentity
};