'use strict';
// Device traits (OS, GPU, screen, CPU/RAM) are random but paired so they agree with each other.
// The browser version is left to the engine so UA/Client Hints match the binary's TLS/JA4 fingerprint.
// Timezone, language and geolocation stay "Based on IP" so launch binds them to the proxy exit IP.

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

// Preferred version only: honors a pin (full or bare major), else picks from the pool. At launch,
// buildUserAgentBundle reports the real binary's version when it differs, so the wire identity
// matches TLS/JA4; the pin is used verbatim only when it matches or the binary version is unreadable.
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
// Logical (CSS-point) sizes: a Retina Mac reports points at DPR 2, not the panel size, so a physical
// size as screen.width is a tell. The engine pairs these with DPR 2.
const MAC_RES = [
  '1440x900', '1470x956', '1512x982', '1680x1050', '1728x1117', '1280x800', '2056x1329', '1512x945'
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

// Recent stable versions, one per major, used as a profile's preferred version. The launch engine
// reports the real binary's version when they differ, so a stale pool only affects the displayed
// version and the Chrome-for-Testing fallback target. Bump periodically.
const CHROME_VERSIONS = [
  '140.0.7339.208', '141.0.7390.108', '142.0.7444.176', '143.0.7499.96',
  '144.0.7559.133', '145.0.7612.88', '146.0.7673.55', '147.0.7728.144',
  '148.0.7780.102', '149.0.7827.155'
];

// browserEngine reports a Pixel 7 / Android 13, so GPU and screen must match that exact device or
// WebGL contradicts the UA. DPR and touch points come from deviceClass='mobile'.
const ANDROID_GPU = ['Google Inc. (ARM)', 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)'];
const ANDROID_RES = '412x915'; // CSS logical viewport of a Pixel 7 (physical 1080x2400)

// enumerateDevices() is a detection surface: zero devices or labels that do not fit the OS get flagged.
// Only labels are picked here; the launch engine derives stable deviceId/groupId from the profile seed.
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

// Edge/Brave/Opera/Vivaldi/Yandex run the real Chrome binary with only the identity layer swapped
// (UA token, Sec-CH-UA brands, navigator.vendor, vendor globals). The Chromium major always comes from
// the binary so TLS/JA4 match; vendor display versions are approximate maps off that major.
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

// uaInfix goes before " Safari/537.36" (Yandex), uaSuffix after it (Edge/Opera); `inject` lists
// vendor globals for the page script. vendor/inject ignore the major, so JS-only callers may pass 0.
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
      // Vivaldi presents a stock Chrome identity: its UA token is off by default and it is not in Sec-CH-UA.
      return {
        id, vendor: 'Google Inc.', uaInfix: '', uaSuffix: '',
        brands: [chromiumBrand, chromeBrand, NOT_A_BRAND],
        inject: ['vivaldi']
      };
    }
    case 'Yandex': {
      // YaBrowser versions are year-based, so pin a recent train; the Chromium major drives the rest.
      // Its tokens sit before the Safari token in the real UA.
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

// With a numeric `seed` the pick is deterministic (same hardware every launch); otherwise random.
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

// screen.width/height are CSS pixels; at launch the engine applies DPR 2.625 and touch (deviceClass).
function generateMobileFingerprint() {
  const [resW, resH] = ANDROID_RES.split('x');
  return {
    browserCore: 'Chromium',
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

    // Bound to the proxy at launch - intentionally not hardcoded here.
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
    portScanProtection: 'Close',
    hardwareAcceleration: 'Default',
    disableTls: 'Close'
  };
}

function generateFingerprint(opts = {}) {
  // Mobile has its own generator so desktop GPU/screen pools never leak into it.
  if (opts && opts.deviceClass === 'mobile') return generateMobileFingerprint();

  // An explicit OS is honored; "Random"/"Mixed"/"Cross" or allowCrossOs gives a weighted cross-OS mix.
  // Blank/Auto uses the real host OS, since host fonts, canvas and WebGL betray a string-only OS spoof.
  const HOST_OS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || 'Windows';
  const rawOs = String((opts && opts.os) || '').trim().toLowerCase();
  const wantsCrossOs = (opts && opts.allowCrossOs === true)
    || rawOs === 'random' || rawOs === 'mixed' || rawOs === 'cross';
  const os = normalizeDesktopOs(opts && opts.os)
    || (wantsCrossOs ? weighted([['Windows', 65], ['macOS', 25], ['Linux', 10]]) : HOST_OS);

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
    browserCore: 'Chromium',
    browserBrand: 'Chrome',
    browserVersion,
    os,
    osVersion,
    deviceClass: 'desktop',
    userAgent: 'Auto',

    resolutionType: 'Custom',
    resolutionW: resW,
    resolutionH: resH,

    // "Real" reports the true host GPU in the page and all workers. A fake string only swaps two
    // getParameter() values while render output and MAX_* params still expose the host GPU.
    // webglVendor and webglRenderer are for display and the coherence check; injected only for Custom.
    webglMetadata: 'Real',
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

    // Bound to the proxy at launch - intentionally not hardcoded here.
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
    portScanProtection: 'Close',
    hardwareAcceleration: 'Default',
    disableTls: 'Close'
  };
}

// Android profiles must report a mobile GPU (Mali/Adreno/PowerVR/Apple) and desktop ones must not;
// a mismatch is a hard fail. Returns { status: 'pass'|'warn'|'fail', detail }.
function deviceGpuCoherence({ deviceClass, os, webglRenderer } = {}) {
  const renderer = String(webglRenderer || '');
  const osStr = String(os || '');
  const isMobile = String(deviceClass || '').toLowerCase() === 'mobile'
    || /android|ios|iphone|ipad/i.test(osStr);
  if (!renderer) return { status: 'warn', detail: 'No WebGL renderer set - GPU coherence not verified.' };
  const mobileGpu = /mali|adreno|powervr|apple gpu|apple a\d/i.test(renderer);
  const desktopGpu = /direct3d|d3d11|geforce|nvidia|radeon|\bamd\b|intel|metal renderer|apple m\d|opengl 4/i.test(renderer);

  // Checked first because it is the loudest tell: Direct3D is Windows-only, Metal Apple-only, Mesa
  // Linux-only, so a renderer naming another OS's API gives the profile away.
  const api = {
    d3d: /direct3d|d3d11|\bd3d\b/i.test(renderer),
    metal: /metal renderer|apple m\d|apple a\d/i.test(renderer),
    mesa: /mesa/i.test(renderer)
  };
  const claims = {
    windows: /win/i.test(osStr),
    mac: /mac|os ?x/i.test(osStr),
    linux: /linux|ubuntu|debian|fedora|arch|chromeos/i.test(osStr)
  };
  if (claims.mac && api.d3d) {
    return { status: 'fail', detail: 'macOS profile reports a Direct3D (Windows-only) GPU - the host OS leaks through. Set WebGL Metadata to Custom with an Apple/Metal renderer, or use the host OS.' };
  }
  if (claims.linux && api.d3d) {
    return { status: 'fail', detail: 'Linux profile reports a Direct3D (Windows-only) GPU - the host OS leaks through. Use a Mesa/OpenGL renderer, or the host OS.' };
  }
  if (claims.windows && (api.metal || api.mesa)) {
    return { status: 'fail', detail: `Windows profile reports a ${api.metal ? 'Metal (Apple-only)' : 'Mesa (Linux-only)'} GPU - an obvious mismatch.` };
  }
  if (isMobile && api.d3d) {
    return { status: 'fail', detail: 'Mobile profile reports a Direct3D (Windows desktop) GPU - an obvious mismatch.' };
  }

  if (isMobile) {
    return mobileGpu
      ? { status: 'pass', detail: 'Mobile profile reports a mobile GPU.' }
      : { status: 'fail', detail: 'Mobile profile reports a desktop GPU - an obvious mismatch.' };
  }
  return (mobileGpu && !desktopGpu)
    ? { status: 'fail', detail: 'Desktop profile reports a mobile GPU - an obvious mismatch.' }
    : { status: 'pass', detail: 'Desktop profile reports a GPU consistent with its OS.' };
}

// Signature of the visible GPU + screen + CPU + RAM + UA-major combo; batches keep it unique per run.
// deviceName, MAC and canvas seed are already random-unique, so they are left out.
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
  CHROME_VERSIONS,
  normalizeBrand,
  buildBrandIdentity
};