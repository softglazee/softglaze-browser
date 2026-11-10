'use strict';
// Profile editor options that change how a profile launches (1.0.26): one meaning for every place that
// reads or writes them (the editor, batch import, the API and both launch engines).
// src/renderer/lib/profileOptions.mjs mirrors the small parts the editor needs; test/profileOptions.test.js
// keeps the two equal.
const crypto = require('node:crypto');
const DATA = require('./profileOptionsData.json');

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();

// ---- WebRTC ----------------------------------------------------------------------------------------
// Stored words: Forward | Replace | Real | Disabled. Launch matches them exactly, as it always has, so a
// value it never special-cased keeps launching as Forward: the retired "Proxy UDP" (Chromium cannot send
// UDP through an HTTP or SOCKS proxy, so it only ever did what Forward does) and the old batch-import
// words "Block" / "Noise".
const WEBRTC_MODES = Object.freeze(['Forward', 'Replace', 'Real', 'Disabled']);
function webrtcMode(stored) {
  return WEBRTC_MODES.includes(stored) ? stored : 'Forward';
}

// An editor, API or import value as the stored word, or null when it is not understood.
function parseWebrtc(value) {
  const t = lower(value);
  if (!t) return null;
  if (t.includes('real')) return 'Real';
  if (/disable|block|off/.test(t)) return 'Disabled';
  if (/replace|noise|fake/.test(t)) return 'Replace';
  if (/forward|proxy/.test(t)) return 'Forward';
  return null;
}

// ---- Hardware acceleration ------------------------------------------------------------------------
// Default (the browser decides), On (GPU forced on, also for GPUs on Chrome's blocklist), Off (no GPU).
// Older profiles store the editor's former words: "Open" (now On) and "Close" (Off). Anything with
// disable/off/close has always meant --disable-gpu.
function hardwareAccelerationChoice(value) {
  const t = lower(value);
  if (!t) return 'Default';
  if (/disable|off|close/.test(t)) return 'Off';
  if (/^(on|open|opened|enable|enabled|force|forced|true|yes|1)$/.test(t)) return 'On';
  return 'Default';
}

function hardwareAccelerationArgs(value) {
  const choice = hardwareAccelerationChoice(value);
  if (choice === 'Off') return ['--disable-gpu'];
  if (choice === 'On') return ['--ignore-gpu-blocklist'];
  return [];
}

// ---- Chrome version ---------------------------------------------------------------------------------
// The editor's version picker stores a bare major ("157") for a version the user picked, or "Auto".
// Generated profiles carry a full version ("149.0.7827.155"): a preferred version, never a pick.
function chromeVersionPin(value) {
  const m = /^\s*(\d{2,4})\s*$/.exec(String(value == null ? '' : value));
  return m ? Number(m[1]) : null;
}

// ---- Location -----------------------------------------------------------------------------------------
// The geolocation permission a launch sets: 'denied' (Block), 'granted' (Always allow) or 'prompt'
// (Ask each time, the browser's own behaviour).
function geolocationPermission(profile = {}) {
  if (lower(profile.locationType) === 'block') return 'denied';
  if (/^always/.test(lower(profile.locationPrompt))) return 'granted';
  return 'prompt';
}

// ---- Display language -----------------------------------------------------------------------------------
function normalizeLocaleTag(value) {
  const s = String(value == null ? '' : value).trim().replace(/_/g, '-');
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(s)) return null;
  return s.split('-').map((part, i) => {
    if (i === 0) return part.toLowerCase();
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  }).join('-');
}

// The browser UI language for a launch, or null for "Real" (the browser's own: Windows, macOS or Linux
// language). "Based on Language" follows the first website language, as launches always did.
function displayLocale(profile = {}, langs = []) {
  const t = lower(profile.displayLangType);
  if (t === 'real') return null;
  if (t === 'custom') {
    const custom = normalizeLocaleTag(profile.displayLangCustom);
    if (custom) return custom;
  }
  return (Array.isArray(langs) && langs.length && langs[0]) ? String(langs[0]) : null;
}

// ---- Media devices -----------------------------------------------------------------------------------
const MEDIA_COUNT_MAX = 4;
function parseMediaCounts(value) {
  let o = value;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  const n = (v) => {
    const x = Number.parseInt(String(v), 10);
    return Number.isFinite(x) ? Math.min(MEDIA_COUNT_MAX, Math.max(0, x)) : 1;
  };
  return { mic: n(o.mic), spk: n(o.spk), cam: n(o.cam) };
}

// { mic, spk, cam } for "Edit", or null: "Auto" shows one of each (and "Real" the real devices).
function mediaDeviceCounts(profile = {}) {
  return lower(profile.mediaDevice) === 'edit' ? parseMediaCounts(profile.mediaDeviceCounts) : null;
}

// ---- Fonts ---------------------------------------------------------------------------------------------
function fontOsKey(os) {
  const v = lower(os);
  if (v.includes('mac') || v.includes('os x')) return 'macOS';
  if (v.includes('android')) return 'Android';
  if (/linux|ubuntu|debian|fedora|arch|chromeos|chrome os/.test(v)) return 'Linux';
  return 'Windows';
}

function defaultFonts(os) {
  return DATA.fonts[fontOsKey(os)].slice();
}

const FONT_LIST_MAX = 1000;
// A family name a page can write in CSS: no quotes, commas, semicolons, brackets or control characters.
const FONT_NAME_RE = /^[^"'`\\,;{}()<>[\]\u0000-\u001f]{1,64}$/;
function parseFontList(value) {
  let items = value;
  if (typeof items === 'string') {
    const s = items.trim();
    if (s.startsWith('[')) { try { items = JSON.parse(s); } catch (e) { items = s.split(/[\r\n,]+/); } }
    else items = s.split(/[\r\n,]+/);
  }
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!name || !FONT_NAME_RE.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= FONT_LIST_MAX) break;
  }
  return out;
}

// The fonts websites may see, or null when the profile does not restrict them ("Default" and "Real").
// An empty custom list means the OS's standard set.
function allowedFonts(profile = {}) {
  if (lower(profile.fontsType) !== 'custom') return null;
  const list = parseFontList(profile.fontsList);
  return list.length ? list : defaultFonts(profile.os);
}

// The families to hide: every family SoftGlaze knows of (each OS's standard set, the families
// fingerprinting scripts probe, and the ones installed on this computer) that is not allowed. Generic
// families (serif, monospace, system-ui...) are never hidden.
function hiddenFonts(allowed, installed = []) {
  const allow = new Set((allowed || []).map((f) => String(f).toLowerCase()));
  const generic = new Set(DATA.genericFamilies.map((f) => f.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const name of [...Object.values(DATA.fonts).flat(), ...DATA.fontProbe, ...(installed || [])]) {
    const n = String(name == null ? '' : name).trim();
    const key = n.toLowerCase();
    if (!n || seen.has(key) || allow.has(key) || generic.has(key) || !FONT_NAME_RE.test(n)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

// "Arial Bold (TrueType)" or "Cambria & Cambria Math (TrueType)" (a Windows Fonts registry value name)
// -> the families it names, with and without a trailing style word.
const STYLE_WORDS = /\s+(bold|italic|oblique|regular|light|semilight|semibold|demibold|black|medium|thin|extralight|extrabold|heavy|condensed|narrow)$/i;
function familiesFromRegistryName(name) {
  const base = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const out = [];
  for (const part of base.split(/\s*&\s*/)) {
    let p = part.trim();
    if (!p) continue;
    out.push(p);
    let guard = 0;
    while (STYLE_WORDS.test(p) && guard < 4) { p = p.replace(STYLE_WORDS, '').trim(); guard += 1; }
    if (p && p !== part.trim()) out.push(p);
  }
  return out;
}

function runQuiet(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      require('node:child_process').execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? '' : String(stdout || ''));
      });
    } catch (e) { resolve(''); }
  });
}

// Font families installed on this computer, best effort: the Windows Fonts registry keys, or
// fontconfig on Linux. Read once per app run.
let installedFontsPromise = null;
function installedFontFamilies() {
  if (!installedFontsPromise) {
    installedFontsPromise = (async () => {
      const names = [];
      if (process.platform === 'win32') {
        for (const hive of ['HKLM', 'HKCU']) {
          const out = await runQuiet('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts`], 5000);
          for (const line of out.split(/\r?\n/)) {
            const m = /^\s{2,}(.+?)\s{2,}REG_(?:SZ|EXPAND_SZ)\s/.exec(line);
            if (m) names.push(...familiesFromRegistryName(m[1]));
          }
        }
      } else if (process.platform === 'linux') {
        const out = await runQuiet('fc-list', [':', 'family'], 5000);
        for (const line of out.split(/\r?\n/)) for (const f of line.split(',')) if (f.trim()) names.push(f.trim());
      }
      return Array.from(new Set(names));
    })().catch(() => []);
  }
  return installedFontsPromise;
}

// ---- Device name and MAC address ------------------------------------------------------------------------
function identityOsKey(os) {
  return fontOsKey(os);
}

const pickWith = (arr, rnd) => arr[rnd(arr.length)];

// A realistic, random device name in the style of the OS: Windows "DESKTOP-" + 7 letters/digits (the
// name Windows setup gives a PC), macOS "Alexs-MacBook-Pro", Linux "alex-ThinkPad-T14", Android
// "Alex's Pixel 7".
function generateDeviceName(os, rnd = crypto.randomInt) {
  const key = identityOsKey(os);
  const n = DATA.names;
  if (key === 'macOS') return `${pickWith(n.first, rnd)}s-${pickWith(n.macModels, rnd)}`;
  if (key === 'Linux') return `${pickWith(n.first, rnd).toLowerCase()}-${pickWith(n.linuxModels, rnd)}`;
  if (key === 'Android') return `${pickWith(n.first, rnd)}'s ${n.androidModel}`;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = 'DESKTOP-';
  for (let i = 0; i < 7; i += 1) s += chars[rnd(36)];
  return s;
}

const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');

// A MAC address with the registered prefix of a common network adapter for the OS (Intel, Realtek,
// Killer, Dell, HP, ASUS... for a PC; Apple for a Mac). Android phones show a randomised, locally
// administered address per Wi-Fi network (Android 10 and later), so an Android profile gets one of those.
function generateMacAddress(os, rnd = crypto.randomInt) {
  const key = identityOsKey(os);
  if (key === 'Android') {
    const first = (rnd(64) << 2) | 0x02; // unicast, locally administered
    return [first, rnd(256), rnd(256), rnd(256), rnd(256), rnd(256)].map(hex2).join(':');
  }
  const pool = key === 'macOS' ? DATA.oui.apple : DATA.oui.pc;
  return `${pickWith(pool, rnd)}:${hex2(rnd(256))}:${hex2(rnd(256))}:${hex2(rnd(256))}`;
}

// "aa-bb-cc-dd-ee-ff", "aabb.ccdd.eeff" or "AA:BB:CC:DD:EE:FF" -> "AA:BB:CC:DD:EE:FF", or null.
function normalizeMac(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^[0-9a-f:.\-\s]+$/i.test(s)) return null;
  const h = s.replace(/[:.\-\s]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(h)) return null;
  return h.toUpperCase().match(/../g).join(':');
}

// null when usable, else why not: 'format', 'multicast' (a group address, never a network card's) or 'zero'.
function macAddressError(value) {
  const m = normalizeMac(value);
  if (!m) return 'format';
  if (m === '00:00:00:00:00:00' || m === 'FF:FF:FF:FF:FF:FF') return 'zero';
  if (Number.parseInt(m.slice(0, 2), 16) & 1) return 'multicast';
  return null;
}

// null when usable, else 'empty', 'length' or 'characters'. A Windows computer name is at most 15
// letters, digits and hyphens and not only digits; other systems allow a longer friendly name.
function deviceNameError(value, os) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return 'empty';
  if (identityOsKey(os) === 'Windows') {
    if (s.length > 15) return 'length';
    if (!/^[A-Za-z0-9-]+$/.test(s) || /^\d+$/.test(s)) return 'characters';
    return null;
  }
  if (s.length > 63) return 'length';
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/.test(s)) return 'characters';
  return null;
}

// A device name and MAC no other profile in `taken` uses (sets of lower-case names and normalized MACs).
function uniqueDeviceIdentity(os, taken = {}, rnd = crypto.randomInt) {
  const names = taken.names || new Set();
  const macs = taken.macs || new Set();
  let deviceName = generateDeviceName(os, rnd);
  for (let i = 0; i < 50 && names.has(deviceName.toLowerCase()); i += 1) deviceName = generateDeviceName(os, rnd);
  if (names.has(deviceName.toLowerCase())) {
    // A small name pool (macOS, Linux, Android) ran out: number it, as a network does with a second "Alexs-iMac".
    const key = identityOsKey(os);
    const base = deviceName;
    for (let k = 2; k < 10000; k += 1) {
      const candidate = key === 'Android' ? `${base} ${k}` : `${base}-${k}`;
      if (!names.has(candidate.toLowerCase()) && !deviceNameError(candidate, os)) { deviceName = candidate; break; }
    }
  }
  let macAddress = generateMacAddress(os, rnd);
  for (let i = 0; i < 1000 && macs.has(macAddress); i += 1) macAddress = generateMacAddress(os, rnd);
  return { deviceName, macAddress };
}

// ---- User-Agent -------------------------------------------------------------------------------------------
// The UA a profile picked explicitly (userAgentMode "Custom"), or null for Auto. Older profiles have no
// mode: their stored UA was generated for display and the engine has always used the browser's own, so
// they stay on Auto.
function customUserAgent(profile = {}) {
  if (profile.userAgentMode !== 'Custom') return null;
  const ua = String(profile.userAgent || '').trim();
  return ua && !/^auto$/i.test(ua) ? ua : null;
}

// Which browser engine a UA string claims: 'chromium', 'firefox', 'webkit' (Safari and every iOS
// browser), 'bot' or 'other'.
function uaFamily(ua) {
  const s = String(ua || '');
  if (!s.trim()) return 'other';
  if (/bot\b|bot\/|crawl|spider|slurp|curl\/|wget\/|python|httpclient|okhttp|java\/|go-http|headless|phantomjs|facebookexternalhit|bingpreview|mediapartners|lighthouse/i.test(s)) return 'bot';
  if (/iPhone|iPad|iPod|CriOS\/|FxiOS\/|EdgiOS\//i.test(s)) return 'webkit';
  if (/Firefox\//i.test(s) && !/Chrom(e|ium)\//i.test(s)) return 'firefox';
  if (/Chrom(e|ium)\/\d+/i.test(s)) return 'chromium';
  if (/Version\/[\d.]+.*Safari\//i.test(s)) return 'webkit';
  return 'other';
}

function uaChromeMajor(ua) {
  const m = /Chrom(?:e|ium)\/(\d+)/i.exec(String(ua || ''));
  return m ? Number(m[1]) : null;
}

// What a picked UA says about the platform: navigator.platform and the Client Hints platform fields.
function uaPlatformInfo(ua, profile = {}) {
  const s = String(ua || '');
  if (/iPhone|iPod/i.test(s)) return { chPlatform: 'iOS', navPlatform: 'iPhone', platformVersion: '', architecture: '', bitness: '', model: '', mobile: true };
  if (/iPad/i.test(s)) return { chPlatform: 'iOS', navPlatform: 'iPad', platformVersion: '', architecture: '', bitness: '', model: '', mobile: false };
  const android = /Android\s*([\d.]*)/i.exec(s);
  if (android) {
    const model = (/Android[^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?\)/i.exec(s) || [])[1] || '';
    const major = (android[1] || '').split('.')[0];
    return { chPlatform: 'Android', navPlatform: 'Linux armv8l', platformVersion: major ? `${major}.0.0` : '', architecture: '', bitness: '', model: /^k$/i.test(model.trim()) ? '' : model.trim(), mobile: /Mobile/i.test(s) };
  }
  const win = /Windows NT ([\d.]+)/i.exec(s);
  if (win) {
    const arm = /ARM64|aarch64/i.test(s);
    const sixtyFour = /Win64|x64|WOW64|ARM64/i.test(s);
    const platformVersion = win[1] === '10.0' ? (/11/.test(String(profile.osVersion || '')) ? '15.0.0' : '10.0.0') : '0.0.0';
    return { chPlatform: 'Windows', navPlatform: 'Win32', platformVersion, architecture: arm ? 'arm' : 'x86', bitness: sixtyFour ? '64' : '32', model: '', mobile: false, wow64: /WOW64/i.test(s) };
  }
  if (/Macintosh|Mac OS X/i.test(s)) {
    const v = String(profile.osVersion || '').replace(/[^\d]/g, '') || '14';
    const appleSilicon = /apple\s*m\d/i.test(String(profile.webglRenderer || '')) || /apple/i.test(String(profile.webglVendor || ''));
    return { chPlatform: 'macOS', navPlatform: 'MacIntel', platformVersion: `${v}.0.0`, architecture: appleSilicon ? 'arm' : 'x86', bitness: '64', model: '', mobile: false };
  }
  if (/CrOS/i.test(s)) return { chPlatform: 'Chrome OS', navPlatform: 'Linux x86_64', platformVersion: '', architecture: 'x86', bitness: '64', model: '', mobile: false };
  if (/Linux|X11/i.test(s)) {
    const arm = /aarch64|arm/i.test(s);
    return { chPlatform: 'Linux', navPlatform: arm ? 'Linux aarch64' : 'Linux x86_64', platformVersion: '', architecture: arm ? 'arm' : 'x86', bitness: '64', model: '', mobile: false };
  }
  return null;
}

// The UA override for a picked UA: the string as picked, navigator.platform from it, and for a Chromium
// UA the Client Hints that belong to it (brands, versions, platform, architecture, model). A UA of another
// engine gets no Client Hints, so navigator.userAgentData is absent as in Firefox and Safari.
// fallback is the launch's own bundle (buildUserAgentBundle), used for anything the UA does not say.
function customUserAgentBundle(ua, profile = {}, fallback = {}, binary = {}) {
  const userAgent = String(ua).trim();
  const family = uaFamily(userAgent);
  const plat = uaPlatformInfo(userAgent, profile);
  const navPlatform = (plat && plat.navPlatform) || fallback.navPlatform;
  if (family !== 'chromium') return { userAgent, userAgentMetadata: undefined, navPlatform, custom: true, family };

  const { buildBrandIdentity } = require('./fingerprintGenerator');
  const major = uaChromeMajor(userAgent) || binary.major || 0;
  const full = (binary.major && binary.major === major && binary.fullVersion) ? binary.fullVersion : `${major}.0.0.0`;
  const brand = /Edg(?:e|A)?\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /YaBrowser\//.test(userAgent) ? 'Yandex' : 'Chrome';
  const ident = buildBrandIdentity(brand, major, full);
  const vendorVersion = (re) => { const m = re.exec(userAgent); return m ? m[1] : null; };
  const edge = vendorVersion(/Edg(?:e|A)?\/(\d+)/);
  const opera = vendorVersion(/OPR\/(\d+)/);
  const brands = ident.brands.map((b) => {
    if (b.brand === 'Microsoft Edge' && edge) return { ...b, version: edge, full: `${edge}.0.0.0` };
    if (b.brand === 'Opera' && opera) return { ...b, version: opera, full: `${opera}.0.0.0` };
    return b;
  });
  const fb = (fallback && fallback.userAgentMetadata) || {};
  const p = plat || {
    chPlatform: fb.platform || '', platformVersion: fb.platformVersion || '', architecture: fb.architecture || '',
    bitness: fb.bitness || '', model: fb.model || '', mobile: Boolean(fb.mobile)
  };
  const userAgentMetadata = {
    brands: brands.map((b) => ({ brand: b.brand, version: String(b.version) })),
    fullVersionList: brands.map((b) => ({
      brand: b.brand,
      version: b.brand === 'Chromium' || b.brand === 'Google Chrome' ? full : (b.full || `${b.version}.0.0.0`)
    })),
    platform: p.chPlatform,
    platformVersion: p.platformVersion,
    architecture: p.architecture,
    bitness: p.bitness,
    model: p.model,
    mobile: Boolean(p.mobile),
    wow64: Boolean(p.wow64)
  };
  return { userAgent, userAgentMetadata, navPlatform, custom: true, family, brand };
}

// ---- WebGPU ------------------------------------------------------------------------------------------------
// GPUAdapterInfo vendor and architecture for a WebGL vendor/renderer, in Chrome's own words (Dawn's
// gpu_info.json names, lower-cased with hyphens, and "metal-3" for Apple silicon). Chrome reports an
// empty device and description. null when the GPU maker is not recognised.
function webgpuInfoFromWebgl(vendor, renderer) {
  const r = `${vendor || ''} ${renderer || ''}`.toLowerCase();
  if (!r.trim()) return null;
  const arch = (rules) => { for (const [re, name] of rules) if (re.test(r)) return name; return ''; };
  if (/nvidia|geforce|quadro/.test(r)) {
    return { vendor: 'nvidia', architecture: arch([[/rtx\s*50\d\d/, 'blackwell'], [/rtx\s*40\d\d/, 'lovelace'], [/rtx\s*30\d\d|rtx\s*a\d{3,4}/, 'ampere'], [/rtx\s*20\d\d|gtx\s*16\d\d/, 'turing'], [/gtx\s*10\d\d/, 'pascal'], [/gtx\s*9\d\d/, 'maxwell']]) };
  }
  if (/apple/.test(r)) return { vendor: 'apple', architecture: 'metal-3' };
  if (/\bamd\b|radeon|\bati\b/.test(r)) {
    return { vendor: 'amd', architecture: arch([[/rx\s*9\d{3}/, 'rdna-4'], [/rx\s*7\d{3}/, 'rdna-3'], [/rx\s*6\d{3}/, 'rdna-2'], [/rx\s*5\d{3}/, 'rdna-1'], [/vega/, 'gcn-5'], [/rx\s*[45]\d\d\b/, 'gcn-4'], [/radeon\s*\(tm\)\s*graphics|radeon graphics/, 'rdna-2']]) };
  }
  if (/intel/.test(r)) {
    return { vendor: 'intel', architecture: arch([[/\barc\b/, 'gen-12hp'], [/iris(\(r\))?\s*xe|uhd graphics 7\d\d|\bxe graphics/, 'gen-12lp'], [/(uhd|hd) graphics 6\d\d|plus graphics 6\d\d/, 'gen-9'], [/iris(\(r\))?\s*plus graphics/, 'gen-11']]) };
  }
  if (/mali|\barm\b/.test(r)) {
    return { vendor: 'arm', architecture: arch([[/mali-g(57|68|77|78|310|510|610|615|710|715|720)\b/, 'valhall'], [/mali-g(31|51|52|71|72|76)\b/, 'bifrost'], [/mali-t\d/, 'midgard']]) };
  }
  if (/adreno|qualcomm/.test(r)) {
    return { vendor: 'qualcomm', architecture: arch([[/adreno[^\d]*8\d\d/, 'adreno-8xx'], [/adreno[^\d]*7\d\d/, 'adreno-7xx'], [/adreno[^\d]*6\d\d/, 'adreno-6xx'], [/adreno[^\d]*5\d\d/, 'adreno-5xx']]) };
  }
  return null;
}

module.exports = {
  DATA,
  WEBRTC_MODES,
  webrtcMode,
  parseWebrtc,
  hardwareAccelerationChoice,
  hardwareAccelerationArgs,
  chromeVersionPin,
  geolocationPermission,
  normalizeLocaleTag,
  displayLocale,
  MEDIA_COUNT_MAX,
  parseMediaCounts,
  mediaDeviceCounts,
  fontOsKey,
  defaultFonts,
  parseFontList,
  allowedFonts,
  hiddenFonts,
  familiesFromRegistryName,
  installedFontFamilies,
  identityOsKey,
  generateDeviceName,
  generateMacAddress,
  normalizeMac,
  macAddressError,
  deviceNameError,
  uniqueDeviceIdentity,
  customUserAgent,
  uaFamily,
  uaChromeMajor,
  uaPlatformInfo,
  customUserAgentBundle,
  webgpuInfoFromWebgl
};
