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

// Map a free-form OS request to a desktop OS key, or null for "let it be random".
function normalizeDesktopOs(os) {
  const s = String(os || '').toLowerCase();
  if (!s || s === 'random' || s === 'auto') return null;
  if (s.includes('mac') || s.includes('osx') || s.includes('os x')) return 'macOS';
  if (s.includes('linux') || s.includes('ubuntu') || s.includes('debian') || s.includes('fedora')) return 'Linux';
  if (s.includes('win')) return 'Windows';
  return null;
}

// Resolve the reported Chrome version: honor an explicit pin (full version or a bare
// major like "142"), otherwise pick one at random from the recent-stable pool.
function pickChromeVersion(pinned) {
  const p = String(pinned || '').trim();
  if (p && p.toLowerCase() !== 'auto') {
    // Full version already? use as-is. Bare major? expand against the pool (or X.0.0.0).
    if (/^\d+\.\d+\.\d+\.\d+$/.test(p)) return p;
    const major = p.replace(/[^\d]/g, '');
    if (major) {
      const match = CHROME_VERSIONS.find((v) => v.split('.')[0] === major);
      return match || `${major}.0.0.0`;
    }
  }
  return choice(CHROME_VERSIONS);
}

const WIN_RES = [
  '1920x1080', '1366x768', '1536x864', '2560x1440', '1600x900', '1440x900',
  '1280x720', '1680x1050', '1920x1200', '3840x2160', '2560x1080', '1360x768',
  '1280x1024', '3440x1440', '1280x800', '2256x1504'
];
const MAC_RES = [
  '2560x1440', '1680x1050', '1440x900', '1920x1080', '3024x1964', '2880x1800',
  '1512x982', '1728x1117', '2056x1329', '1470x956', '1280x800', '2560x1600'
];
const LINUX_RES = [
  '1920x1080', '1366x768', '2560x1440', '1600x900', '1680x1050', '1280x1024',
  '3840x2160', '1920x1200', '1440x900'
];

const WIN_GPU = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)']
];
const MAC_GPU = [
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)'],
  ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)']
];
const LINUX_GPU = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3070/PCIe/SSE2, OpenGL 4.5)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4060/PCIe/SSE2, OpenGL 4.5)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1650/PCIe/SSE2, OpenGL 4.5)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL 4.6)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 (RADV NAVI23), OpenGL 4.6)']
];

// Recent Chrome stable full versions. Distributed across a batch so each profile's
// reported User-Agent major differs (UA reduction freezes minor/build/patch to .0.0.0
// in the UA string, so the MAJOR is what makes a UA unique; full versions feed the
// Sec-CH-UA-Full-Version-List client hint). The launch engine reads profile.browserVersion
// and reports THIS version instead of the binary's, so two profiles never share a UA.
const CHROME_VERSIONS = [
  '140.0.7339.208', '141.0.7390.108', '142.0.7444.176', '143.0.7499.96',
  '144.0.7559.133', '145.0.7612.88', '146.0.7673.55', '147.0.7728.144',
  '148.0.7780.102', '149.0.7827.155'
];

// Mobile (Android, CDP-emulated). The UA + Client-Hints layer in browserEngine.js
// reports a Pixel 7 / Android 13, so the generated GPU + screen MUST match that
// exact device or the WebGL renderer would contradict the UA (an easy mismatch to
// score). Everything here is therefore a real Pixel 7 (Tensor G2 / Mali-G710,
// 8 cores, 8 GB, 412x915 CSS @ DPR 2.625). The launch engine derives the DPR and
// touch points from deviceClass='mobile'. Add more devices later by parametrizing
// osTokens()/userAgentMetadata.model alongside a matching pool entry here.
const ANDROID_GPU = ['Google Inc. (ARM)', 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)'];
const ANDROID_RES = '412x915'; // CSS logical viewport of a Pixel 7 (physical 1080x2400)

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

// Pixel 7 / Android 13 fingerprint, coherent with the Android UA + Client-Hints
// produced in browserEngine.js. screen.width/height are reported in CSS pixels
// (the engine applies deviceScaleFactor 2.625 + touch at launch from deviceClass).
function generateMobileFingerprint() {
  const [resW, resH] = ANDROID_RES.split('x');
  return {
    browserCore: 'Chrome',
    browserBrand: 'Chrome',
    browserVersion: '',
    os: 'Android',
    osVersion: '13',
    deviceClass: 'mobile',
    userAgent: 'Auto',

    resolutionType: 'Custom',
    resolutionW: resW,
    resolutionH: resH,

    webglMetadata: 'Custom',
    webglVendor: ANDROID_GPU[0],
    webglRenderer: ANDROID_GPU[1],
    webgpu: 'Based on WebGL',

    cpuType: 'Custom',
    cpuCores: '8', // Tensor G2 is octa-core
    ramType: 'Custom',
    ramGb: '8',

    deviceNameType: 'Custom',
    deviceName: 'Pixel 7',
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

function generateFingerprint(opts = {}) {
  // Mobile is a distinct device class (Android), not just another OS — route it to
  // its own coherent generator so desktop GPU/screen pools never leak into it.
  if (opts && opts.deviceClass === 'mobile') return generateMobileFingerprint();

  // OS can be forced by the caller (batch with a chosen OS); otherwise weighted-random.
  const os = normalizeDesktopOs(opts && opts.os) || weighted([['Windows', 65], ['macOS', 25], ['Linux', 10]]);

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
  const corePool = ['4', '6', '8', '10', '12', '16', '20', '24'].filter((c) => Number(c) !== hostCores);
  const cores = choice(corePool.length ? corePool : ['4', '6', '8']);
  const nCores = Number(cores);
  const ramGb = nCores >= 16 ? choice(['32', '64'])
    : nCores >= 12 ? choice(['16', '32'])
    : nCores >= 8 ? choice(['8', '16', '32'])
    : choice(['8', '16']);

  // Per-profile reported Chrome version (caller may pin one for even batch distribution).
  const browserVersion = pickChromeVersion(opts && opts.browserVersion);

  return {
    browserCore: 'Chrome',
    browserBrand: 'Chrome',
    browserVersion,
    os,
    osVersion,
    deviceClass: 'desktop',
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

// Device ↔ GPU coherence rule used by the leak/trust check. A mobile (Android)
// profile MUST report a mobile GPU (Mali / Adreno / PowerVR / Apple GPU); a
// desktop profile must NOT. A mobile UA paired with a desktop GPU (or vice versa)
// is one of the easiest mismatches for a detector to score, so we flag it as a
// hard fail. Pure + dependency-free so it can be unit-tested directly.
// Returns { status: 'pass'|'warn'|'fail', detail }.
function deviceGpuCoherence({ deviceClass, os, webglRenderer } = {}) {
  const renderer = String(webglRenderer || '');
  const isMobile = String(deviceClass || '').toLowerCase() === 'mobile'
    || /android/i.test(String(os || ''));
  if (!renderer) return { status: 'warn', detail: 'No WebGL renderer set — GPU coherence not verified.' };
  const mobileGpu = /mali|adreno|powervr|apple gpu/i.test(renderer);
  const desktopGpu = /direct3d|d3d11|geforce|nvidia|radeon|\bamd\b|intel|metal renderer|apple m\d|opengl 4/i.test(renderer);
  if (isMobile) {
    return mobileGpu
      ? { status: 'pass', detail: 'Mobile profile reports a mobile GPU.' }
      : { status: 'fail', detail: 'Mobile (Android) profile reports a desktop GPU — an obvious mismatch.' };
  }
  return (mobileGpu && !desktopGpu)
    ? { status: 'fail', detail: 'Desktop profile reports a mobile GPU — an obvious mismatch.' }
    : { status: 'pass', detail: 'Desktop profile reports a desktop GPU.' };
}

// Stable signature of the user-visible hardware/identity combo. The batch generator
// uses it to guarantee no two profiles in a run share the same GPU + screen + CPU +
// RAM + reported UA-major tuple (deviceName / MAC / canvas seed are random-unique on
// their own, so they're intentionally excluded — this keeps the VISIBLE traits distinct).
function fingerprintSignature(fp) {
  if (!fp) return '';
  const major = String(fp.browserVersion || '').split('.')[0] || '';
  return [
    fp.os || '', fp.osVersion || '',
    `${fp.resolutionW || ''}x${fp.resolutionH || ''}`,
    fp.webglRenderer || '',
    fp.cpuCores || '', fp.ramGb || '',
    major
  ].join('|');
}

module.exports = {
  generateFingerprint,
  generateMobileFingerprint,
  generateMediaDevices,
  deviceGpuCoherence,
  fingerprintSignature,
  pickChromeVersion,
  CHROME_VERSIONS,
  CHROMIUM_BRANDS,
  CHROMIUM_BRAND_IDS,
  normalizeBrand,
  buildBrandIdentity
};