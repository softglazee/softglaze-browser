'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs'); // Added for synchronous PID tracking
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { generateMediaDevices, buildBrandIdentity } = require('./fingerprintGenerator');
const { applyBrandWindowIcon } = require('./windowIcon');

// Stealth hides automation tells, but several of its evasions set the SAME
// properties we spoof ourselves (UA, WebGL vendor, hardwareConcurrency,
// languages). Running both produces the inconsistent values detectors flag
// (e.g. CreepJS seeing "Intel Iris" from stealth AND our AMD GPU). Disable the
// overlapping evasions so OUR per-profile values are the single source of truth.
const stealth = StealthPlugin();
['user-agent-override', 'navigator.hardwareConcurrency', 'navigator.languages', 'webgl.vendor'].forEach((e) => {
  try { stealth.enabledEvasions.delete(e); } catch (err) {}
});
puppeteer.use(stealth);

const DEFAULT_PROFILE_ROOT = path.resolve(process.cwd(), 'softglaze_profiles');
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 720 };
const GEO_LOOKUP_TIMEOUT_MS = 8000;
const activeSessions = new Map();

// ---------------------------------------------------------------------------
// Real Chrome binaries. Profiles launch an ACTUAL Chrome build (Chrome for
// Testing) whose version matches the profile — so UA, Client-Hints, TLS/JA4 and
// even Web Worker contexts all natively report the same real version. This is
// what makes "SunBrowser 149" genuinely present as 149 everywhere, instead of
// faking the UA on top of a different engine (which detectors catch as a
// mismatch). Layout on disk: <root>/chrome/win64-<version>/chrome-win64/chrome.exe
// ---------------------------------------------------------------------------
const CHROME_DIRS = [
  path.resolve(__dirname, '../../chrome'),                 // dev: project root
  process.env.SOFTGLAZE_CHROME_DIR || ''                   // optional override (packaged)
].filter(Boolean);

function listAvailableBrowsers() {
  const seen = new Map(); // version -> exePath (dedupe across dirs)
  for (const dir of CHROME_DIRS) {
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const m = /^win64-(\d+)\.([\d.]+)$/.exec(ent.name);
      if (!m) continue;
      const exe = path.join(dir, ent.name, 'chrome-win64', 'chrome.exe');
      if (!fsSync.existsSync(exe)) continue;
      const version = `${m[1]}.${m[2]}`;
      if (!seen.has(version)) seen.set(version, { major: Number(m[1]), version, exePath: exe });
    }
  }
  // newest first
  return Array.from(seen.values()).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

// Pick the on-disk Chrome that matches the profile's desired major version.
// Falls back to the newest available build, or null (→ bundled Chromium) when
// no real browsers are present.
function resolveBrowserExecutable(desired) {
  const all = listAvailableBrowsers();
  if (all.length === 0) return null;
  const major = Number.parseInt(String(desired || '').replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(major)) {
    const match = all.filter((b) => b.major === major); // already sorted newest-patch first
    if (match.length) return match[0];
  }
  return all[0]; // newest available
}

// Locate a REAL, system-installed Google Chrome (stable channel). Real Chrome is
// strongly preferred over Chrome-for-Testing builds: CfT ships a deliberately
// broken New Tab Page (it crashes the whole browser on "+", access violation) and
// a "Testing" branded icon. Real Chrome has neither, needs no NTP workaround, and
// presents a genuine, unremarkable Chrome identity. Returns { exePath, version,
// major, isReal:true } or null.
function findRealChrome() {
  const pf = process.env['ProgramFiles'] || 'C:/Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const lad = process.env['LOCALAPPDATA'] || '';
  const candidates = [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    lad ? path.join(lad, 'Google/Chrome/Application/chrome.exe') : null
  ].filter(Boolean);
  for (const exe of candidates) {
    try {
      if (!fsSync.existsSync(exe)) continue;
      // Best-effort version from the sibling version folder (…/Application/<ver>/).
      let version = '';
      let major = 0;
      try {
        const appDir = path.dirname(exe);
        const verDir = fsSync.readdirSync(appDir).find((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d));
        if (verDir) { version = verDir; major = parseInt(verDir, 10) || 0; }
      } catch (e) { /* version is optional */ }
      return { exePath: exe, version, major, isReal: true };
    } catch (e) { /* keep scanning */ }
  }
  return null;
}

// Choose the browser binary for a profile. REAL system Chrome is strongly
// preferred whenever it's installed: its New Tab Page is stable (Chrome-for-Testing
// crashes the whole browser on "+"), it carries no "Testing" icon, and it needs no
// fragile NTP-override workaround (which Chrome's consent bubble lets the user
// disable — re-breaking CfT). Only when no real Chrome exists do we fall back to a
// downloaded CfT build (+ NTP override) by the profile's pinned/auto version.
function chooseBrowserBinary(profile) {
  const real = findRealChrome();
  if (real) return real;
  const cft = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
  return cft ? { ...cft, isReal: false } : null;
}

// --- PID TRACKING FOR ORPHAN CLEANUP ---
const PID_FILE = path.join(os.tmpdir(), 'softglaze_active_pids.json');

function trackPid(pid) {
  try {
    let pids = [];
    if (fsSync.existsSync(PID_FILE)) {
      pids = JSON.parse(fsSync.readFileSync(PID_FILE, 'utf8'));
    }
    if (!pids.includes(pid)) pids.push(pid);
    fsSync.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) { console.error('[PID Tracker] Failed to track PID', e); }
}

function untrackPid(pid) {
  try {
    if (!fsSync.existsSync(PID_FILE)) return;
    let pids = JSON.parse(fsSync.readFileSync(PID_FILE, 'utf8'));
    pids = pids.filter(p => p !== pid);
    fsSync.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) { console.error('[PID Tracker] Failed to untrack PID', e); }
}
// ----------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sanitizeDataDirName(value) {
  const base = String(value || '').trim();
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^\.+/, '').slice(0, 96);
  return sanitized || `profile-${crypto.randomUUID()}`;
}

function resolveInside(baseDir, childSegment) {
  const safeChild = sanitizeDataDirName(childSegment);
  const resolvedBase = path.resolve(baseDir);
  const resolvedChild = path.resolve(resolvedBase, safeChild);
  if (resolvedChild !== resolvedBase && !resolvedChild.startsWith(resolvedBase + path.sep)) {
    throw new Error('Resolved profile directory escaped the profile root.');
  }
  return resolvedChild;
}

function parseProxyString(rawProxyString) {
  const raw = String(rawProxyString || '').trim();
  if (!raw) return null;
  const type = /^socks/i.test(raw) ? 'SOCKS5' : 'HTTP';
  const working = raw.replace(/^(http|https|socks5|socks):\/\//i, '');
  const parts = working.split(':');
  if (parts.length >= 4) {
    return { type, host: parts[0].trim(), port: Number.parseInt(parts[1].trim(), 10), username: parts[2].trim(), password: parts.slice(3).join(':').trim() };
  }
  if (parts.length === 3) {
    return { type, host: parts[0].trim(), port: Number.parseInt(parts[1].trim(), 10), username: parts[2].trim() || null, password: null };
  }
  if (parts.length === 2) {
    return { type, host: parts[0].trim(), port: Number.parseInt(parts[1].trim(), 10), username: null, password: null };
  }
  throw new Error('Invalid proxy connection string format.');
}

function parseProxyInput(input) {
  if (!input) return null;
  if (typeof input === 'string') return parseProxyString(input);
  if (input.host && input.port) {
    return {
      type: String(input.type || 'HTTP').toUpperCase(),
      host: input.host,
      port: Number.parseInt(String(input.port), 10),
      username: input.username || null,
      password: input.password || null
    };
  }
  return null;
}

function buildProxyServerArgument(proxy) {
  if (!proxy) return null;
  const protocol = String(proxy.type).toLowerCase() === 'socks5' ? 'socks5' : 'http';
  return `${protocol}://${proxy.host}:${proxy.port}`;
}

function seedFromString(value) {
  let hash = 0;
  const str = String(value || '');
  for (let i = 0; i < str.length; i += 1) hash = (str.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  return Math.abs(hash) >>> 0;
}

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const COUNTRY_LOCALE = {
  US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', IE: 'en-IE',
  DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES', IT: 'it-IT', NL: 'nl-NL',
  PT: 'pt-PT', BR: 'pt-BR', RU: 'ru-RU', PL: 'pl-PL', SE: 'sv-SE',
  SA: 'ar-SA', AE: 'ar-AE', EG: 'ar-EG', TR: 'tr-TR', IN: 'en-IN',
  PK: 'en-PK', JP: 'ja-JP', CN: 'zh-CN', KR: 'ko-KR', MX: 'es-MX'
};

function localeToAcceptLanguage(locale) {
  const base = locale.split('-')[0];
  const parts = [locale];
  if (base !== locale) parts.push(`${base};q=0.9`);
  if (base !== 'en') parts.push('en;q=0.8');
  return parts.join(',');
}

function osTokens(os) {
  const value = String(os || 'Windows').toLowerCase();
  if (value.includes('mac')) return { uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7', navPlatform: 'MacIntel', chPlatform: 'macOS', chVersion: '14.0.0' };
  if (value.includes('linux')) return { uaPlatform: 'X11; Linux x86_64', navPlatform: 'Linux x86_64', chPlatform: 'Linux', chVersion: '' };
  if (value.includes('android')) return { uaPlatform: 'Linux; Android 13; Pixel 7', navPlatform: 'Linux armv8l', chPlatform: 'Android', chVersion: '13.0.0' };
  return { uaPlatform: 'Windows NT 10.0; Win64; x64', navPlatform: 'Win32', chPlatform: 'Windows', chVersion: '15.0.0' };
}

function buildUserAgentBundle(profile, realMajor, realFullVersion, seed) {
  const os = osTokens(profile.os);
  // Version ALWAYS comes from the real launched binary — never faked. We pick
  // the binary by the profile's desired version, so this IS the desired version,
  // and UA / Client-Hints / TLS / workers all agree (no detectable mismatch).
  const major = realMajor;
  const fullVersion = realFullVersion && /^\d+\.\d/.test(realFullVersion) ? realFullVersion : `${major}.0.0.0`;

  // Chromium-family identity layer. Edge/Brave/Opera/Vivaldi/Yandex share Chrome's
  // engine, so we keep the REAL Chromium major everywhere (Chrome/<M>, "Chromium"
  // brand, TLS/JA4 from the binary) and only add the vendor's UA token + brand
  // entry. Plain Chrome ⇒ no token, identical to before.
  const ident = buildBrandIdentity(profile.browserBrand, major, fullVersion);
  const userAgent = `Mozilla/5.0 (${os.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0${ident.uaInfix || ''} Safari/537.36${ident.uaSuffix || ''}`;

  const brands = ident.brands.map((b) => ({ brand: b.brand, version: b.version }));

  // Client-Hint platform metadata. These MUST stay consistent with the spoofed
  // OS *and* GPU, otherwise Sec-CH-UA-Platform-Version / -Arch contradict the UA
  // string and the WebGL renderer (a classic, easily-scored mismatch). We derive
  // them from the profile rather than hardcoding x86 / a fixed version.
  const platform = String(profile.os || '').toLowerCase();
  const verDigits = (v, fallback) => {
    const d = String(v == null ? '' : v).replace(/[^\d]/g, '');
    return d || fallback;
  };
  let platformVersion = os.chVersion;
  let architecture = 'x86';
  let bitness = '64';
  let model = '';
  if (platform.includes('mac')) {
    // macOS CH platformVersion mirrors the OS major (e.g. "14.0.0").
    platformVersion = `${verDigits(profile.osVersion, '14')}.0.0`;
    // Apple-Silicon GPUs ⇒ arm; reporting x86 on an M-series Mac is a dead giveaway.
    const isAppleSilicon = /apple\s*m\d/i.test(String(profile.webglRenderer || ''))
      || /apple/i.test(String(profile.webglVendor || ''));
    architecture = isAppleSilicon ? 'arm' : 'x86';
  } else if (platform.includes('android')) {
    platformVersion = `${verDigits(profile.osVersion, '13')}.0.0`;
    architecture = ''; // CH omits architecture/bitness on mobile
    bitness = '';
    model = 'Pixel 7';
  } else if (platform.includes('linux')) {
    platformVersion = ''; // Linux reports an empty platform version
  } else {
    // Windows: CH encodes the OS in platformVersion — Win11 ⇒ "15.0.0", Win10 ⇒ "10.0.0".
    platformVersion = /11/.test(verDigits(profile.osVersion, '11')) ? '15.0.0' : '10.0.0';
  }

  const userAgentMetadata = {
    brands,
    // fullVersionList carries the per-brand full version: "Chromium" / "Google
    // Chrome" report the real binary full version; vendor brands (Edge/Opera/…)
    // report their own (already computed in the identity bundle).
    fullVersionList: ident.brands.map((b) => ({
      brand: b.brand,
      version: b.brand === 'Chromium' || b.brand === 'Google Chrome' ? fullVersion : (b.full || `${b.version}.0.0.0`)
    })),
    platform: os.chPlatform,
    platformVersion,
    architecture,
    bitness,
    model,
    mobile: os.chPlatform === 'Android',
    wow64: false
  };

  return { userAgent, userAgentMetadata, navPlatform: os.navPlatform };
}

// ---------------------------------------------------------------------------
// Fingerprint script (runs in the page BEFORE any site script). Receives a
// single serializable config object. Noise is seeded so the same profile yields
// the same fingerprint on every launch (consistency beats randomness).
// ---------------------------------------------------------------------------
function fingerprintScript(fp) {
  // Idempotency: this script can land via BOTH puppeteer's evaluateOnNewDocument
  // AND the CDP auto-attach path (which guarantees it runs before the first
  // document of new tabs/popups). Running twice would double-wrap the Worker
  // constructor, so apply exactly once per document. The marker is a
  // non-enumerable window property with an obscure name so sites can't trivially
  // enumerate it.
  try {
    if (Object.getOwnPropertyDescriptor(window, '__sgz')) return;
    Object.defineProperty(window, '__sgz', { value: 1, enumerable: false, configurable: false, writable: false });
  } catch (e) {
    if (window.__sgz) return; window.__sgz = 1;
  }
  try {
    // Real Chrome exposes navigator.webdriver === false (the property EXISTS and is
    // false). The old value here was `undefined`, which is itself an automation
    // tell because no real browser returns undefined. Match real Chrome: false.
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  const define = (obj, prop, value) => {
    try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e) {}
  };

  // Native-toString masking. Detectors (browserscan flags "Canvas Tampering") test
  // whether overridden methods still report "[native code]" from .toString(). Make
  // every function we patch — and toString itself — look native.
  const _patched = new WeakSet();
  const _origFnToString = Function.prototype.toString;
  const _fnToString = function () {
    if (_patched.has(this)) return 'function ' + (this.name || '') + '() { [native code] }';
    return _origFnToString.call(this);
  };
  try {
    Object.defineProperty(Function.prototype, 'toString', { value: _fnToString, configurable: true, writable: true });
    _patched.add(_fnToString);
  } catch (e) {}
  const markNative = (fn, name) => {
    try { if (name) Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
    try { _patched.add(fn); } catch (e) {}
    return fn;
  };

  if (fp.langs && fp.langs.length) {
    define(navigator, 'languages', Object.freeze(fp.langs.slice()));
    define(navigator, 'language', fp.langs[0]);
  }
  if (fp.navPlatform) define(navigator, 'platform', fp.navPlatform);
  if (fp.cores) define(navigator, 'hardwareConcurrency', fp.cores);
  if (fp.mem) define(navigator, 'deviceMemory', fp.mem);

  // ---- Chromium-family brand identity --------------------------------------
  // The UA string + Sec-CH-UA brands (advertising Edge/Brave/Opera/Vivaldi/Yandex)
  // are applied via CDP; here we keep the JS layer consistent. navigator.vendor
  // stays "Google Inc." for every Chromium browser, and we add the vendor's own
  // JS globals so the brand the headers claim also exists in the page (a UA that
  // says Brave/Opera with no navigator.brave / window.opr is itself a mismatch).
  try {
    if (fp.brandVendor) define(navigator, 'vendor', fp.brandVendor);
    var _inj = fp.brandInject || [];
    if (_inj.indexOf('brave') !== -1 && !('brave' in navigator)) {
      var _brave = { isBrave: markNative(function isBrave() { return Promise.resolve(true); }, 'isBrave') };
      Object.defineProperty(navigator, 'brave', { value: Object.freeze(_brave), configurable: true, enumerable: true });
    }
    if (_inj.indexOf('opr') !== -1 && !window.opr) {
      Object.defineProperty(window, 'opr', { value: { addons: { installExtension: markNative(function installExtension() {}, 'installExtension') } }, configurable: true });
    }
    // Vivaldi exposes no stable page-level global by default — its identity is the
    // UA/Client-Hints layer only, so there's nothing extra to inject here.
  } catch (e) {}

  if (fp.screenW && fp.screenH) {
    define(screen, 'width', fp.screenW);
    define(screen, 'height', fp.screenH);
    // Real Windows reserves ~48px for the taskbar, so availHeight < height. Making
    // availHeight === height (the old behavior) is itself a spoofing tell.
    define(screen, 'availWidth', fp.screenW);
    define(screen, 'availHeight', Math.max(0, fp.screenH - 48));
    try { define(screen, 'availLeft', 0); define(screen, 'availTop', 0); } catch (e) {}
  }

  // ---- Timezone spoof ------------------------------------------------------
  // Chrome on Windows ignores the TZ env var and CDP setTimezoneOverride races the
  // first document of new tabs, so the REAL OS timezone leaks in JS (e.g. proxy in
  // the US but Date/Intl reporting Asia/Karachi) — a glaring mismatch that flips
  // bot detection on. Override Date/Intl in-page; the document_start extension makes
  // this reliable in every tab. fp.timezone is the proxy's IANA zone.
  if (fp.timezone) {
    try {
      const TZ = fp.timezone;
      const OrigDTF = Intl.DateTimeFormat;
      const partFmt = new OrigDTF('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const offsetFor = (date) => {
        try {
          const p = {};
          partFmt.formatToParts(date).forEach((x) => { if (x.type !== 'literal') p[x.type] = x.value; });
          const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
          return Math.round((date.getTime() - asUTC) / 60000);
        } catch (e) { return 0; }
      };
      // getTimezoneOffset → the proxy zone's offset (minutes, UTC-relative sign).
      const origGetOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function () {
        const v = offsetFor(this);
        return Number.isFinite(v) ? v : origGetOffset.call(this);
      };
      // Intl.DateTimeFormat → default unspecified timeZone to TZ and report it.
      const WrappedDTF = function (locales, options) {
        const opts = Object.assign({}, options);
        if (!opts.timeZone) opts.timeZone = TZ;
        return new OrigDTF(locales, opts);
      };
      WrappedDTF.prototype = OrigDTF.prototype;
      WrappedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF);
      const origResolved = OrigDTF.prototype.resolvedOptions;
      OrigDTF.prototype.resolvedOptions = function () {
        const r = origResolved.apply(this, arguments);
        try { r.timeZone = TZ; } catch (e) {}
        return r;
      };
      Intl.DateTimeFormat = WrappedDTF;
      // Date string methods that embed the zone name/offset (whoer reads these).
      const localized = (date, opts) => {
        try { return new OrigDTF('en-US', Object.assign({ timeZone: TZ }, opts)).format(date); } catch (e) { return ''; }
      };
      Date.prototype.toString = function () {
        if (Number.isNaN(this.getTime())) return 'Invalid Date';
        const off = offsetFor(this);
        const sign = off <= 0 ? '+' : '-';
        const abs = Math.abs(off);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        const base = localized(this, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        return `${base} GMT${sign}${hh}${mm}`;
      };
    } catch (e) {}
  }

  // ---- Web Worker spoofing -------------------------------------------------
  // evaluateOnNewDocument only patches the MAIN document. A Worker spins up a
  // fresh JS realm where navigator.hardwareConcurrency / deviceMemory report the
  // REAL machine — and CreepJS flags the main-vs-worker MISMATCH as a tell.
  // We close it by wrapping the Worker / SharedWorker constructors so each new
  // worker boots with a prelude that re-applies the same overrides inside its
  // own scope, then loads the site's real worker code.
  try {
    var workerData = {
      hardwareConcurrency: fp.cores || undefined,
      deviceMemory: fp.mem || undefined,
      languages: (fp.langs && fp.langs.length) ? fp.langs.slice() : undefined,
      language: (fp.langs && fp.langs.length) ? fp.langs[0] : undefined,
      platform: fp.navPlatform || undefined,
      // OffscreenCanvas WebGL lives in the worker realm too — without these the
      // worker reports the REAL GPU while the main thread shows the spoofed one,
      // and CreepJS flags the main-vs-worker GPU MISMATCH.
      webglVendor: (fp.noise && fp.noise.webgl) ? (fp.webglVendor || undefined) : undefined,
      webglRenderer: (fp.noise && fp.noise.webgl) ? (fp.webglRenderer || undefined) : undefined,
      // The worker realm reads timezone from the OS too — spoof it there as well
      // so the worker's zone matches the main thread / proxy.
      timezone: fp.timezone || undefined
    };
    // Prelude executed at the TOP of every worker realm. self-contained literal.
    var prelude = '(function(){var o=' + JSON.stringify(workerData) + ';' +
      'var d=function(p,v){if(v===undefined||v===null)return;try{Object.defineProperty(navigator,p,{get:function(){return v;},configurable:true});}catch(e){}};' +
      'd("hardwareConcurrency",o.hardwareConcurrency);d("deviceMemory",o.deviceMemory);' +
      'd("languages",o.languages);d("language",o.language);d("platform",o.platform);' +
      'try{var pg=function(proto){if(!proto)return;var g=proto.getParameter;proto.getParameter=function(p){' +
      'if(o.webglVendor&&p===37445)return o.webglVendor;if(o.webglRenderer&&p===37446)return o.webglRenderer;' +
      'return g.apply(this,arguments);};};' +
      'if(typeof WebGLRenderingContext!=="undefined")pg(WebGLRenderingContext.prototype);' +
      'if(typeof WebGL2RenderingContext!=="undefined")pg(WebGL2RenderingContext.prototype);}catch(e){}' +
      'try{if(o.timezone){var TZ=o.timezone,ODTF=Intl.DateTimeFormat,' +
      'pf=new ODTF("en-US",{timeZone:TZ,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}),' +
      'ofs=function(d){try{var pp={};pf.formatToParts(d).forEach(function(x){if(x.type!=="literal")pp[x.type]=x.value;});' +
      'var u=Date.UTC(+pp.year,+pp.month-1,+pp.day,+pp.hour,+pp.minute,+pp.second);return Math.round((d.getTime()-u)/60000);}catch(e){return 0;}};' +
      'Date.prototype.getTimezoneOffset=function(){return ofs(this);};' +
      'var WD=function(l,op){op=Object.assign({},op);if(!op.timeZone)op.timeZone=TZ;return new ODTF(l,op);};' +
      'WD.prototype=ODTF.prototype;WD.supportedLocalesOf=ODTF.supportedLocalesOf.bind(ODTF);' +
      'var orz=ODTF.prototype.resolvedOptions;ODTF.prototype.resolvedOptions=function(){var r=orz.apply(this,arguments);try{r.timeZone=TZ;}catch(e){}return r;};' +
      'Intl.DateTimeFormat=WD;}}catch(e){}' +
      '})();';

    var wrapWorker = function (Native) {
      if (!Native) return Native;
      var Wrapped = function (url, options) {
        try {
          var abs = String(url);
          try { abs = new URL(url, (self.location && self.location.href) || undefined).href; } catch (e) {}
          var isModule = options && options.type === 'module';
          var loader = isModule
            ? 'import(' + JSON.stringify(abs) + ');'
            : 'importScripts(' + JSON.stringify(abs) + ');';
          var boot = prelude + '\n' + loader;
          var blobUrl = URL.createObjectURL(new Blob([boot], { type: 'text/javascript' }));
          return new Native(blobUrl, options);
        } catch (e) {
          // Any failure → fall back to the native worker so the site never breaks.
          return new Native(url, options);
        }
      };
      try {
        Wrapped.prototype = Native.prototype;
        Object.defineProperty(Wrapped, 'name', { value: Native.name, configurable: true });
        Wrapped.toString = function () { return Native.toString(); };
      } catch (e) {}
      return Wrapped;
    };

    if (typeof Worker !== 'undefined') window.Worker = wrapWorker(window.Worker);
    if (typeof SharedWorker !== 'undefined') window.SharedWorker = wrapWorker(window.SharedWorker);
  } catch (e) {}

  let s = fp.seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  if (fp.noise.canvas) {
    // DETERMINISTIC per-pixel offset from the seed. The previous implementation
    // used a running PRNG, so the canvas hash changed on EVERY read — browserscan
    // flagged that as "Canvas UNSTABLE / Tampering". A stable, seed-derived offset
    // keeps the hash constant per profile (so it reads like a real device) while
    // still being unique across profiles. Only mid-range pixels are nudged ±1 so
    // the image is visually identical.
    const cseed = (fp.seed >>> 0) || 1;
    const perturb = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // skip fully transparent
        const n = (((cseed ^ ((i + 1) * 2654435761)) >>> 0) % 3) - 1; // -1/0/1, stable
        if (data[i] > 1 && data[i] < 254) data[i] = (data[i] + n) & 0xFF;
      }
    };
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = markNative(function getImageData() {
      const img = origGetImageData.apply(this, arguments);
      perturb(img.data);
      return img;
    }, 'getImageData');
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = markNative(function toDataURL() {
      try {
        const ctx = this.getContext('2d');
        if (ctx && this.width && this.height) {
          const img = origGetImageData.call(ctx, 0, 0, this.width, this.height);
          const original = new Uint8ClampedArray(img.data); // keep a pristine copy
          perturb(img.data);
          ctx.putImageData(img, 0, 0);
          const url = origToDataURL.apply(this, arguments);
          // RESTORE the pristine pixels. Without this, every toDataURL call would
          // perturb already-perturbed pixels and the hash would drift on each read
          // (browserscan flags that as "Canvas UNSTABLE / tampering"). Restoring
          // makes repeated reads return an identical, stable hash.
          img.data.set(original);
          ctx.putImageData(img, 0, 0);
          return url;
        }
      } catch (e) {}
      return origToDataURL.apply(this, arguments);
    }, 'toDataURL');
  }

  const patchGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = markNative(function getParameter(pname) {
      if (fp.webglVendor && pname === 37445) return fp.webglVendor;
      if (fp.webglRenderer && pname === 37446) return fp.webglRenderer;
      return orig.apply(this, arguments);
    }, 'getParameter');
  };
  if (fp.noise.webgl) {
    patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

    // Deeper WebGL hardening — perturb the rendered-image READBACK (readPixels),
    // the pixel-level surface CreepJS/browserleaks actually hash. The vendor/
    // renderer strings are handled above; this covers the image hash. Deterministic
    // + seed-keyed so the value is STABLE across reads (an unstable WebGL image is a
    // tell, exactly like canvas/audio), and tiny (one low bit on a 64-pixel prefix)
    // so real 3-D output is visually unaffected. We deliberately do NOT spoof
    // arbitrary getParameter limits (MAX_TEXTURE_SIZE, precision formats, …): faking
    // values inconsistent with the reported renderer would create NEW mismatches
    // detectors hunt for — so the image-hash perturbation is the safe deepening.
    const wseed = (fp.seed >>> 0) || 1;
    const patchReadPixels = (proto) => {
      if (!proto || !proto.readPixels) return;
      const origRead = proto.readPixels;
      proto.readPixels = markNative(function readPixels(x, y, w, h, format, type, pixels) {
        const ret = origRead.apply(this, arguments);
        try {
          if (pixels && pixels.length && (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
            const limit = Math.min(pixels.length, 256);
            for (let i = 0; i < limit; i += 4) {
              pixels[i] = pixels[i] ^ (((wseed ^ ((i + 1) * 2654435761)) >>> 0) & 1);
            }
          }
        } catch (e) {}
        return ret;
      }, 'readPixels');
    };
    patchReadPixels(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patchReadPixels(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  }

  if (fp.noise.audio && window.AudioBuffer) {
    // Deterministic, seed-derived perturbation (stable across reads — an unstable
    // audio fingerprint is a tell, same as canvas).
    const aseed = (fp.seed >>> 0) || 1;
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = markNative(function getChannelData() {
      const buf = origGetChannelData.apply(this, arguments);
      const limit = Math.min(buf.length, 600);
      for (let i = 0; i < limit; i += 1) {
        const u = ((aseed ^ ((i + 1) * 40503)) >>> 0) / 4294967296;
        buf[i] = buf[i] + (u - 0.5) * 1e-7;
      }
      return buf;
    }, 'getChannelData');
  }

  // Deeper audio hardening — the AnalyserNode spectrum (getFloatFrequencyData /
  // getByteFrequencyData) is a SEPARATE audio-fingerprint surface from the
  // AudioBuffer.getChannelData path patched above (browserleaks probes both via an
  // OfflineAudioContext). Same deterministic, seed-keyed, tiny perturbation so the
  // spectrum is stable read-to-read but unique per profile.
  if (fp.noise.audio && window.AnalyserNode) {
    const a2 = (fp.seed >>> 0) || 1;
    const origFloat = AnalyserNode.prototype.getFloatFrequencyData;
    if (origFloat) {
      AnalyserNode.prototype.getFloatFrequencyData = markNative(function getFloatFrequencyData(arr) {
        origFloat.apply(this, arguments);
        try {
          const limit = Math.min(arr.length, 64);
          for (let i = 0; i < limit; i += 1) {
            const u = ((a2 ^ ((i + 1) * 374761393)) >>> 0) / 4294967296;
            arr[i] = arr[i] + (u - 0.5) * 1e-4;
          }
        } catch (e) {}
      }, 'getFloatFrequencyData');
    }
    const origByte = AnalyserNode.prototype.getByteFrequencyData;
    if (origByte) {
      AnalyserNode.prototype.getByteFrequencyData = markNative(function getByteFrequencyData(arr) {
        origByte.apply(this, arguments);
        try {
          for (let i = 0; i < Math.min(arr.length, 64); i += 8) {
            arr[i] = Math.max(0, Math.min(255, arr[i] ^ ((a2 >> (i & 7)) & 1)));
          }
        } catch (e) {}
      }, 'getByteFrequencyData');
    }
  }

  if (fp.noise.clientRects) {
    // Jitter keyed to the rect's own geometry so the SAME element yields the SAME
    // value every read (stable), but values differ per profile.
    const cr = (fp.seed >>> 0) || 1;
    const jitter = (base) => {
      const u = ((cr ^ (Math.round((base + 1) * 1000) * 2246822519)) >>> 0) / 4294967296;
      return (u - 0.5) * 0.02;
    };
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = markNative(function getBoundingClientRect() {
      const r = origRect.apply(this, arguments);
      try { return new DOMRect(r.x + jitter(r.x), r.y + jitter(r.y), r.width + jitter(r.width), r.height + jitter(r.height)); } catch (e) { return r; }
    }, 'getBoundingClientRect');
  }

  if (fp.webrtcMode === 'Disabled') {
    try {
      window.RTCPeerConnection = undefined;
      window.webkitRTCPeerConnection = undefined;
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('WebRTC disabled', 'NotAllowedError'));
      }
    } catch (e) {}
  }

  // WebRTC leak protection. The real public IP can escape via ICE candidates even
  // when all HTTP(S) traffic is proxied — a srflx/host candidate carries the raw IP
  // outside the tunnel (an HTTP proxy can't carry UDP, so Chrome gathers it on the
  // direct interface). This guard sanitizes EVERY path a page can read a candidate
  // from — onicecandidate, addEventListener('icecandidate'), createOffer/Answer SDP
  // AND the localDescription / currentLocalDescription / pendingLocalDescription
  // getters (browserleaks/CreepJS read the SDP straight off localDescription after
  // trickle-ICE, which the old guard never touched — that was the leak). When the
  // proxy exit IP is known every public IP is REWRITTEN to it (WebRTC then reports
  // the proxy IP, matching HTTP — the most natural result); when it's unknown the
  // leaking candidate is DROPPED entirely. Private/loopback/mDNS candidates pass
  // through unchanged. RTCPeerConnection stays present (less detectable than removal).
  if (fp.webrtcProtect) {
    const Native = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (Native) {
      const PROXY_IP = fp.webrtcPublicIp || null;
      const IPV4_G = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g;
      const isPrivate = (ip) => {
        const p = ip.split('.').map(Number);
        if (p[0] === 10 || p[0] === 127) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
        return ip === '0.0.0.0';
      };
      // Rewrite every PUBLIC IPv4 to the proxy IP (private/loopback untouched).
      const sanitize = (text) => {
        if (!text) return text;
        return String(text).replace(IPV4_G, (ip) => (isPrivate(ip) || !PROXY_IP) ? ip : (ip === PROXY_IP ? ip : PROXY_IP));
      };
      // true ⇒ this string exposes a public IP that isn't the proxy IP → must hide.
      const leaks = (str) => {
        const ips = String(str || '').match(IPV4_G) || [];
        for (let i = 0; i < ips.length; i++) {
          if (isPrivate(ips[i])) continue;
          if (PROXY_IP && ips[i] === PROXY_IP) continue;
          return true;
        }
        return false;
      };
      // Strip whole "a=candidate:" lines that would still leak when we have no proxy
      // IP to rewrite to; otherwise rewrite the public IP inside them to the proxy IP.
      const sanitizeSdp = (sdp) => {
        if (!sdp) return sdp;
        const out = [];
        const lines = String(sdp).split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/^a=candidate:/.test(line) && leaks(line) && !PROXY_IP) continue; // drop leaking candidate
          out.push(PROXY_IP ? sanitize(line) : line);
        }
        return out.join('\r\n');
      };
      const cleanDesc = (desc) => {
        if (!desc || !desc.sdp || !leaks(desc.sdp)) return desc;
        try { return new RTCSessionDescription({ type: desc.type, sdp: sanitizeSdp(desc.sdp) }); }
        catch (e) { try { return { type: desc.type, sdp: sanitizeSdp(desc.sdp) }; } catch (e2) { return desc; } }
      };
      // Returns the event to deliver, or null to DROP it (leak + no proxy IP).
      const processEvent = (event) => {
        if (!event || !event.candidate || !event.candidate.candidate) return event; // end-of-gathering sentinel
        if (!leaks(event.candidate.candidate)) return event; // mDNS/private/proxy-only — safe
        if (!PROXY_IP) return null; // can't make it safe → drop
        try {
          const c = event.candidate;
          const fixed = new RTCIceCandidate({ candidate: sanitize(c.candidate), sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment });
          Object.defineProperty(event, 'candidate', { value: fixed, configurable: true });
        } catch (e) {}
        return event;
      };
      try {
        const proto = Native.prototype;
        const dLocal = Object.getOwnPropertyDescriptor(proto, 'localDescription');
        const dCurrent = Object.getOwnPropertyDescriptor(proto, 'currentLocalDescription');
        const dPending = Object.getOwnPropertyDescriptor(proto, 'pendingLocalDescription');
        class ProtectedRTC extends Native {
          constructor(...args) {
            super(...args);
            let userHandler = null;
            let wrapped = null;
            Object.defineProperty(this, 'onicecandidate', {
              configurable: true,
              get() { return userHandler; },
              set(h) {
                // Wire to the NATIVE event so the handler actually fires (the old
                // setter stored it in a closure and never registered it — a no-op).
                if (wrapped) { try { proto.removeEventListener.call(this, 'icecandidate', wrapped); } catch (e) {} wrapped = null; }
                userHandler = (typeof h === 'function') ? h : null;
                if (userHandler) {
                  wrapped = (event) => { const ev = processEvent(event); if (ev === null) return; return userHandler.call(this, ev); };
                  proto.addEventListener.call(this, 'icecandidate', wrapped);
                }
              }
            });
          }
          addEventListener(type, listener, ...rest) {
            if (type === 'icecandidate' && typeof listener === 'function') {
              const w = (event) => { const ev = processEvent(event); if (ev === null) return; return listener.call(this, ev); };
              return super.addEventListener(type, w, ...rest);
            }
            return super.addEventListener(type, listener, ...rest);
          }
          get localDescription() { return cleanDesc(dLocal.get.call(this)); }
          get currentLocalDescription() { return cleanDesc(dCurrent.get.call(this)); }
          get pendingLocalDescription() { return cleanDesc(dPending.get.call(this)); }
          async createOffer(...a) { const o = await super.createOffer(...a); if (o && o.sdp) try { o.sdp = sanitizeSdp(o.sdp); } catch (e) {} return o; }
          async createAnswer(...a) { const o = await super.createAnswer(...a); if (o && o.sdp) try { o.sdp = sanitizeSdp(o.sdp); } catch (e) {} return o; }
        }
        window.RTCPeerConnection = ProtectedRTC;
        if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = ProtectedRTC;
      } catch (e) { /* leave native in place if wrapping fails */ }
    }
  }

  // Do Not Track — '1' / '0' / null (leave native untouched when not configured).
  if (fp.dnt === '1' || fp.dnt === '0') {
    define(navigator, 'doNotTrack', fp.dnt);
    try { define(window, 'doNotTrack', fp.dnt); } catch (e) {}
    if (fp.dnt === '1') { try { define(navigator, 'globalPrivacyControl', true); } catch (e) {} }
  }

  // WebGPU — when disabled, hide navigator.gpu so sites can't read the real
  // adapter (which would contradict the spoofed WebGL renderer).
  if (fp.webgpuDisabled) {
    try { define(navigator, 'gpu', undefined); } catch (e) {}
  }

  // Speech synthesis voices — return a stable, seeded list localized to the
  // profile language instead of exposing the host machine's installed voices.
  if (fp.speechVoices && window.speechSynthesis) {
    const primary = (fp.langs && fp.langs[0]) || 'en-US';
    const base = primary.split('-')[0];
    const fakeVoices = [
      { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', localService: false, default: true },
      { voiceURI: 'Google UK English Female', name: 'Google UK English Female', lang: 'en-GB', localService: false, default: false },
      { voiceURI: 'Microsoft Natural', name: 'Microsoft Natural (' + base + ')', lang: primary, localService: true, default: false }
    ];
    try {
      const proto = Object.getPrototypeOf(window.speechSynthesis) || window.speechSynthesis;
      const orig = proto.getVoices;
      proto.getVoices = function () {
        const real = (function () { try { return orig.apply(this, arguments); } catch (e) { return []; } })();
        return real && real.length ? real : fakeVoices.map((v) => Object.assign({}, v));
      };
    } catch (e) {}
  }

  // ---- Media device enumeration (Softglaze hardware-consistency layer) ------
  // Sites probe navigator.mediaDevices.enumerateDevices() for hardware sanity:
  // returning 0 devices reads as a headless/automation environment, and so does
  // exposing device LABELS with no active permission grant (real Chrome keeps
  // labels empty until getUserMedia is granted). We present a realistic,
  // OS-appropriate, per-profile-STABLE device set:
  //   • deviceId / groupId hashes are derived from the profile seed → identical
  //     on every launch (a device set that reshuffles each visit is itself a tell).
  //   • Labels + concrete deviceIds are revealed only AFTER a getUserMedia grant,
  //     exactly mirroring real Chrome; before that the count and groupIds are
  //     present so the hardware never looks empty.
  if (fp.mediaDevices && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    try {
      const set = fp.mediaSet || {};
      const isWin = !!set.isWindows;
      const micLabel = set.mic || 'Microphone';
      const spkLabel = set.spk || 'Speakers';
      const camLabel = set.cam || 'Integrated Camera';
      // 64-hex persistent id from the profile seed (stable across launches).
      const mkId = (n) => {
        let h = ((fp.seed >>> 0) ^ (n * 2654435761)) >>> 0;
        let out = '';
        for (let i = 0; i < 64; i += 1) { h = (h * 1664525 + 1013904223) >>> 0; out += (h & 15).toString(16); }
        return out;
      };
      const gMicIn = mkId(11), gSpkOut = mkId(12), gCam = mkId(13);
      const micId = mkId(1), camId = mkId(2), spkId = mkId(3);

      // Permission state: flips to true once the page is granted getUserMedia,
      // which is the moment real Chrome starts exposing labels + concrete ids.
      let granted = false;
      const md = navigator.mediaDevices;
      if (typeof md.getUserMedia === 'function') {
        const origGUM = md.getUserMedia.bind(md);
        navigator.mediaDevices.getUserMedia = markNative(function getUserMedia() {
          let p;
          try { p = origGUM.apply(md, arguments); } catch (e) { return Promise.reject(e); }
          try { return p.then((stream) => { granted = true; return stream; }); } catch (e) { return p; }
        }, 'getUserMedia');
      }

      const build = () => {
        const rows = [];
        const audioIn = (deviceId, label) => rows.push({ kind: 'audioinput', deviceId, groupId: gMicIn, label });
        const audioOut = (deviceId, label) => rows.push({ kind: 'audiooutput', deviceId, groupId: gSpkOut, label });
        if (granted) {
          // Full structured list: the Default / Communications pseudo-endpoints
          // (Communications is Windows-only) plus the real endpoints, all with
          // concrete ids + labels — the shape real Chrome returns post-grant.
          audioIn('default', 'Default - ' + micLabel);
          if (isWin) audioIn('communications', 'Communications - ' + micLabel);
          audioIn(micId, micLabel);
          rows.push({ kind: 'videoinput', deviceId: camId, groupId: gCam, label: camLabel });
          audioOut('default', 'Default - ' + spkLabel);
          if (isWin) audioOut('communications', 'Communications - ' + spkLabel);
          audioOut(spkId, spkLabel);
        } else {
          // Pre-grant: one endpoint per kind, empty deviceId + label, stable
          // groupId — precisely what real Chrome exposes before a permission grant.
          audioIn('', '');
          rows.push({ kind: 'videoinput', deviceId: '', groupId: gCam, label: '' });
          audioOut('', '');
        }
        return rows;
      };

      navigator.mediaDevices.enumerateDevices = markNative(function enumerateDevices() {
        try {
          return Promise.resolve(build().map((d) => ({
            kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: d.label,
            toJSON() { return { kind: this.kind, deviceId: this.deviceId, groupId: this.groupId, label: this.label }; }
          })));
        } catch (e) { return Promise.resolve([]); }
      }, 'enumerateDevices');
    } catch (e) { /* never break the page over device spoofing */ }
  }

  // Font fingerprint protection — seeded sub-pixel noise on canvas text
  // measurement so width-comparison font enumeration can't reliably probe the
  // installed font set. Noise is tiny (±0.01px) so real layout is unaffected.
  if (fp.fontsNoise) {
    const fontJitter = (v) => (typeof v === 'number' ? v + (rnd() - 0.5) * 0.02 : v);
    const origMeasure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function () {
      const m = origMeasure.apply(this, arguments);
      try {
        return new Proxy(m, {
          get(target, prop) {
            const val = target[prop];
            if (typeof val === 'number') return fontJitter(val);
            return typeof val === 'function' ? val.bind(target) : val;
          }
        });
      } catch (e) { return m; }
    };

    // Mirror the jitter onto OffscreenCanvas (used inside Web Workers), closing the
    // worker-thread font-probing gap the main-thread CanvasRenderingContext2D
    // override above does not cover.
    if (window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.measureText) {
      const origMeasureOff = OffscreenCanvasRenderingContext2D.prototype.measureText;
      OffscreenCanvasRenderingContext2D.prototype.measureText = function () {
        const m = origMeasureOff.apply(this, arguments);
        try {
          return new Proxy(m, {
            get(target, prop) {
              const val = target[prop];
              if (typeof val === 'number') return fontJitter(val);
              return typeof val === 'function' ? val.bind(target) : val;
            }
          });
        } catch (e) { return m; }
      };
    }
  }

  // Port-scan protection — reject page-initiated requests to localhost and
  // private network ranges so sites can't scan local services to fingerprint.
  if (fp.portScan) {
    const isPrivate = (raw) => {
      try {
        const host = new URL(raw, location.href).hostname.replace(/^\[|\]$/g, '');
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
        if (/^10\./.test(host)) return true;
        if (/^192\.168\./.test(host)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
        if (/^169\.254\./.test(host)) return true;
        if (/^fe80:/i.test(host) || /^fc00:/i.test(host) || /^fd/i.test(host)) return true;
        return false;
      } catch (e) { return false; }
    };
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input) {
        const url = typeof input === 'string' ? input : (input && input.url);
        if (url && isPrivate(url)) return Promise.reject(new TypeError('Failed to fetch'));
        return origFetch.apply(this, arguments);
      };
    }
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (url && isPrivate(url)) throw new DOMException('Network error', 'NetworkError');
      return origOpen.apply(this, arguments);
    };
    const OrigWS = window.WebSocket;
    if (OrigWS) {
      const PatchedWS = function (url, protocols) {
        if (url && isPrivate(url)) throw new DOMException('Insecure WebSocket blocked', 'SecurityError');
        return protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
      };
      PatchedWS.prototype = OrigWS.prototype;
      try {
        PatchedWS.CONNECTING = OrigWS.CONNECTING; PatchedWS.OPEN = OrigWS.OPEN;
        PatchedWS.CLOSING = OrigWS.CLOSING; PatchedWS.CLOSED = OrigWS.CLOSED;
      } catch (e) {}
      window.WebSocket = PatchedWS;
    }
  }
}

// ---------------------------------------------------------------------------
// Proxy auth extension
// ---------------------------------------------------------------------------
async function createProxyAuthExtension(userDataDir, proxy) {
  if (!proxy || !proxy.username || !proxy.password) return null;
  const extensionDir = path.join(userDataDir, 'proxy-auth-extension');
  await fs.mkdir(extensionDir, { recursive: true });

  const scheme = String(proxy.type).toLowerCase() === 'socks5' ? 'socks5' : 'http';
  const manifest = {
    version: '1.0.0',
    manifest_version: 2,
    name: 'SoftGlaze Proxy Auth',
    permissions: ['proxy', 'tabs', 'unlimitedStorage', 'storage', '<all_urls>', 'webRequest', 'webRequestBlocking'],
    background: { scripts: ['background.js'] },
    minimum_chrome_version: '22.0.0'
  };

  // Escape every value via JSON.stringify so a credential containing quotes,
  // backslashes, or newlines cannot break out of the string literal (or inject
  // arbitrary JS) into the generated extension script.
  const backgroundJs = `
    var config = {
        mode: "fixed_servers",
        rules: {
          singleProxy: { scheme: ${JSON.stringify(scheme)}, host: ${JSON.stringify(String(proxy.host))}, port: ${Number.parseInt(proxy.port, 10)} },
          bypassList: ["localhost", "127.0.0.1"]
        }
      };
    chrome.proxy.settings.set({ value: config, scope: "regular" }, function () {});
    function callbackFn(details) {
        return { authCredentials: { username: ${JSON.stringify(String(proxy.username))}, password: ${JSON.stringify(String(proxy.password))} } };
    }
    chrome.webRequest.onAuthRequired.addListener(callbackFn, { urls: ["<all_urls>"] }, ['blocking']);
  `;

  await fs.writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(extensionDir, 'background.js'), backgroundJs);
  return extensionDir;
}

// ---------------------------------------------------------------------------
// Managed policy file. Expresses the dev-tools / extension-lock settings as a
// standard Chromium managed-policy JSON written INSIDE the profile's own data
// dir. Chromium only *enforces* these from the OS managed-policy location
// (registry / /etc/.../policies/managed), which is a machine-wide admin change
// we deliberately do NOT make automatically. Writing the file here keeps it
// driven by the persisted setting and ready for an operator to activate.
// Returns the written path, or null when no lock is requested.
// ---------------------------------------------------------------------------
// A hostname pointing at the local machine / LAN. Used to block local-network
// probing (an anti-detect leak vector) when website.localNetworkAccess is off.
function isPrivateHost(host) {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (h === '::1') return true;
  if (/^(fc|fd|fe80)/.test(h)) return true; // IPv6 ULA / link-local
  return false;
}

// Resolve the website-access rules from global settings into a compact matcher.
function buildWebsiteRules(browserSettings) {
  const website = browserSettings.website || {};
  const block = website.blockAccess || {};
  const list = (Array.isArray(block.list) ? block.list : [])
    .map((s) => String(s || '').toLowerCase().trim()).filter(Boolean);
  return {
    blockLocal: website.localNetworkAccess === false,
    accessEnabled: Boolean(block.enabled) && list.length > 0,
    accessMode: block.mode === 'allowlist' ? 'allowlist' : 'blocklist',
    list,
    hostListed(host) {
      return this.list.some((rule) => host === rule || host.endsWith('.' + rule) || host.includes(rule));
    }
  };
}

async function writeManagedPolicies(userDataDir, browserSettings) {
  const policy = {};
  // 2 = DeveloperToolsDisallowed (Chromium >= 99 numeric enum).
  if (browserSettings.disableDevtools) policy.DeveloperToolsAvailability = 2;
  // Block installation of any extension the user tries to add (the launch-time
  // proxy-auth extension is loaded via --load-extension and is unaffected).
  if (browserSettings.lockExtensions) {
    policy.ExtensionInstallBlocklist = ['*'];
    policy.BlockExternalExtensions = true;
  }
  if (Object.keys(policy).length === 0) return null;
  const filePath = path.join(userDataDir, 'managed_policies.json');
  await fs.writeFile(filePath, JSON.stringify(policy, null, 2)).catch(() => {});
  return filePath;
}

// ---------------------------------------------------------------------------
// Start page
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function generateStartPage(userDataDir, profileData) {
  const startPagePath = path.join(userDataDir, 'start.html');
  const now = new Date().toLocaleString();
  const title = escapeHtml(profileData.title);
  const profileId = escapeHtml(profileData.profileId);
  const proxyLabel = escapeHtml(profileData.proxyLabel);
  // The proxy exit IP / location resolved at launch (routed THROUGH the proxy).
  // Rendering it server-side means the card never shows "unknown" even if the
  // page's own live fetch is blocked or rate-limited by the IP-lookup endpoint.
  const geo = profileData.geo || null;
  const seedIp = geo && geo.query ? escapeHtml(geo.query) : '';
  const seedLoc = geo
    ? escapeHtml([geo.country, geo.regionName, geo.city].filter(Boolean).join(' / '))
    : '';
  const seedIsp = geo && geo.isp ? escapeHtml(geo.isp) : '';
  const seedJson = JSON.stringify({ ip: seedIp, loc: seedLoc, isp: seedIsp });
  // Test links open in NEW tabs. The targetcreated handler applies the full
  // fingerprint (evaluateOnNewDocument runs FIRST, before any await) to every new
  // tab/popup, so opening checks in a fresh tab is now safe and convenient.
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoftGlaze — ${title}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
@keyframes gradShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(56,189,248,.5)}50%{box-shadow:0 0 0 8px rgba(56,189,248,0)}}
body{background:radial-gradient(1200px 600px at 20% -10%,#13233b 0%,#0b0f17 55%);min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0;padding:32px 20px;color:#e5e7eb}
.container{max-width:1040px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;font-weight:700;letter-spacing:.5px;color:#93c5fd;animation:fadeUp .5s both}
.brand .dot{width:10px;height:10px;border-radius:50%;background:#38bdf8;animation:pulse 2s infinite}
.ip-card{background:linear-gradient(120deg,#0ea5e9,#6366f1,#0ea5e9);background-size:200% 200%;animation:fadeUp .5s both,gradShift 8s ease infinite;color:#fff;padding:26px 30px;border-radius:16px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;box-shadow:0 12px 40px -12px rgba(14,165,233,.5)}
.ip-card .big{font-size:40px;font-weight:800;letter-spacing:1px;margin:0}
.ip-card .sub{font-size:15px;opacity:.92;margin-top:4px}
.ip-card .right{text-align:right;font-size:13px;opacity:.95;line-height:1.7}
.loading{background:linear-gradient(90deg,rgba(255,255,255,.06) 25%,rgba(255,255,255,.18) 37%,rgba(255,255,255,.06) 63%);background-size:800px 100%;animation:shimmer 1.4s infinite;border-radius:6px;color:transparent!important}
.nav-links{display:flex;gap:10px;margin:18px 0;flex-wrap:wrap;animation:fadeUp .5s .05s both}
.nav-links a{background:#111827;padding:9px 16px;border-radius:8px;text-decoration:none;color:#e5e7eb;font-weight:600;font-size:13px;border:1px solid #1f2937;transition:transform .15s,border-color .15s,color .15s}
.nav-links a:hover{border-color:#38bdf8;color:#fff;transform:translateY(-2px)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:#0f1623cc;backdrop-filter:blur(6px);border:1px solid #1f2937;border-radius:14px;padding:20px 22px;animation:fadeUp .5s both;transition:transform .18s,border-color .18s}
.card:nth-child(1){animation-delay:.08s}.card:nth-child(2){animation-delay:.14s}.card:nth-child(3){animation-delay:.20s}.card:nth-child(4){animation-delay:.26s}
.card:hover{transform:translateY(-3px);border-color:#2b3b54}
.card h3{margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid #1f2937;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#93c5fd}
.row{display:flex;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:13.5px}
.row:last-child{border-bottom:none}
.label{width:150px;color:#94a3b8;flex-shrink:0}
.value{flex:1;color:#f1f5f9;font-weight:500;word-break:break-all}
.value.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.ok{color:#34d399}.warn{color:#fbbf24}
.foot{margin-top:18px;text-align:center;color:#64748b;font-size:12px;animation:fadeUp .5s .3s both}
</style></head><body><div class="container">
<div class="brand"><span class="dot"></span> SOFTGLAZE BROWSER</div>
<div class="ip-card">
  <div><h1 class="big" id="ip">${seedIp || 'Checking IP…'}</h1><div class="sub" id="loc">${seedLoc || 'Connecting through proxy…'}</div></div>
  <div class="right"><div id="isp">ISP: ${seedIsp || '—'}</div><div id="proxyState">Proxy: ${proxyLabel}</div></div>
</div>
<div class="nav-links">
  <a href="https://browserscan.net/" target="_blank" rel="noopener">BrowserScan</a>
  <a href="https://browserleaks.com/" target="_blank" rel="noopener">BrowserLeaks</a>
  <a href="https://whoer.net/" target="_blank" rel="noopener">Whoer.net</a>
  <a href="https://pixelscan.net/" target="_blank" rel="noopener">Pixelscan</a>
  <a href="https://abrahamjuliot.github.io/creepjs/" target="_blank" rel="noopener">CreepJS</a>
</div>
<div class="grid">
  <div class="card"><h3>Profile</h3>
    <div class="row"><div class="label">Name</div><div class="value">${title}</div></div>
    <div class="row"><div class="label">Profile ID</div><div class="value">${profileId}</div></div>
    <div class="row"><div class="label">Proxy</div><div class="value">${proxyLabel}</div></div>
    <div class="row"><div class="label">Started</div><div class="value">${escapeHtml(now)}</div></div>
  </div>
  <div class="card"><h3>Identity</h3>
    <div class="row"><div class="label">User Agent</div><div class="value mono" id="ua">…</div></div>
    <div class="row"><div class="label">Platform</div><div class="value" id="pf">…</div></div>
    <div class="row"><div class="label">Languages</div><div class="value" id="lg">…</div></div>
    <div class="row"><div class="label">Timezone</div><div class="value" id="tz">…</div></div>
  </div>
  <div class="card"><h3>Hardware</h3>
    <div class="row"><div class="label">CPU cores</div><div class="value" id="cores">…</div></div>
    <div class="row"><div class="label">Device memory</div><div class="value" id="mem">…</div></div>
    <div class="row"><div class="label">Screen</div><div class="value" id="screen">…</div></div>
    <div class="row"><div class="label">GPU</div><div class="value mono" id="gpu">…</div></div>
  </div>
  <div class="card"><h3>Privacy checks</h3>
    <div class="row"><div class="label">WebRTC IPs</div><div class="value" id="rtc">probing…</div></div>
    <div class="row"><div class="label">Do Not Track</div><div class="value" id="dnt">…</div></div>
    <div class="row"><div class="label">Canvas</div><div class="value mono" id="canvas">…</div></div>
    <div class="row"><div class="label">WebGL vendor</div><div class="value" id="glv">…</div></div>
  </div>
</div>
<div class="foot">All values above are read live from this profile's browser — they reflect what websites see.</div>
</div>
<script>
(function(){
  var $=function(id){return document.getElementById(id);};
  $('ua').textContent=navigator.userAgent;
  $('pf').textContent=navigator.platform;
  $('lg').textContent=(navigator.languages||[]).join(', ');
  $('tz').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('cores').textContent=navigator.hardwareConcurrency+' cores';
  $('mem').textContent=(navigator.deviceMemory||'n/a')+(navigator.deviceMemory?' GB':'');
  $('screen').textContent=screen.width+'x'+screen.height+' ('+screen.availWidth+'x'+screen.availHeight+')';
  $('dnt').textContent=(navigator.doNotTrack==='1'?'Enabled':(navigator.doNotTrack==='0'?'Disabled':'Default'));
  try{
    var c=document.createElement('canvas'),x=c.getContext('webgl')||c.getContext('experimental-webgl');
    var dbg=x&&x.getExtension('WEBGL_debug_renderer_info');
    $('glv').textContent=dbg?x.getParameter(dbg.UNMASKED_VENDOR_WEBGL):'n/a';
    $('gpu').textContent=dbg?x.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'n/a';
  }catch(e){$('glv').textContent='n/a';$('gpu').textContent='n/a';}
  try{
    var cc=document.createElement('canvas');cc.width=200;cc.height=40;var cx=cc.getContext('2d');
    cx.textBaseline='top';cx.font='14px Arial';cx.fillStyle='#069';cx.fillText('SoftGlaze ✨',2,2);
    var data=cc.toDataURL(),h=0;for(var i=0;i<data.length;i++){h=(h*31+data.charCodeAt(i))>>>0;}
    $('canvas').textContent=('0000000'+h.toString(16)).slice(-8);
  }catch(e){$('canvas').textContent='n/a';}
  // WebRTC probe (should show proxy IP or none — never your real IP)
  try{
    var pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]}),ips={};
    pc.onicecandidate=function(e){if(e&&e.candidate&&e.candidate.candidate){var m=/([0-9]{1,3}(?:\\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);if(m)ips[m[1]]=1;}};
    pc.createDataChannel('x');pc.createOffer().then(function(o){return pc.setLocalDescription(o);});
    setTimeout(function(){var l=Object.keys(ips);$('rtc').textContent=l.length?l.join(', '):'none exposed';$('rtc').className='value '+(l.length?'warn':'ok');try{pc.close();}catch(e){}},2200);
  }catch(e){$('rtc').textContent='unavailable';}
  // Values already rendered server-side (resolved through the proxy at launch).
  // Refresh them live, but never blank out the seed if the live fetch fails.
  var seed=${seedJson};
  var setIfReal=function(id,v){if(v)$(id).textContent=v;};
  fetch('http://ip-api.com/json/?fields=status,country,regionName,city,isp,query',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    if(!d||d.status!=='success')throw new Error('lookup failed');
    setIfReal('ip',d.query);
    setIfReal('loc',[d.country,d.regionName,d.city].filter(Boolean).join(' / '));
    $('isp').textContent='ISP: '+(d.isp||seed.isp||'—');
  }).catch(function(){
    return fetch('https://ipwho.is/').then(function(r){return r.json();}).then(function(d){
      setIfReal('ip',d.ip);
      setIfReal('loc',[d.country,d.region,d.city].filter(Boolean).join(' / '));
      $('isp').textContent='ISP: '+((d.connection&&d.connection.isp)||seed.isp||'—');
    });
  }).catch(function(){
    // Both live lookups failed — fall back to whatever the proxy resolved at launch.
    if(seed.ip){setIfReal('ip',seed.ip);setIfReal('loc',seed.loc);}
    else{$('ip').textContent='IP load failed';$('loc').textContent='Check proxy connection';}
  });
})();
</script></body></html>`;
  await fs.writeFile(startPagePath, html);
  return `file://${startPagePath}`;
}

// ---------------------------------------------------------------------------
// Captcha auto-solving (2captcha / anti-captcha)
//
// IMPORTANT: this is NOT fingerprinting. A clean fingerprint reduces how often a
// captcha appears, but actually SOLVING one requires a paid human/AI solver
// service. The user supplies their own API key in Settings → it is billed per
// solve by that provider, not by SoftGlaze. We only cover reCAPTCHA v2 and
// hCaptcha (the token-grant types) — image/coordinate captchas are out of scope.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpJson(url, init) {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable in this runtime');
  const res = await fetch(url, init);
  return res.json();
}

// Submit a token job to 2captcha and poll until solved. Returns the token string.
async function solveWith2captcha(apiKey, job) {
  const method = job.type === 'hcaptcha' ? 'hcaptcha' : 'userrecaptcha';
  const inParams = new URLSearchParams({
    key: apiKey, json: '1', method, sitekey: job.sitekey, pageurl: job.pageurl
  });
  const submit = await httpJson('https://2captcha.com/in.php', { method: 'POST', body: inParams });
  if (String(submit.status) !== '1') throw new Error(`2captcha submit failed: ${submit.request}`);
  const id = submit.request;
  for (let i = 0; i < 30; i += 1) {
    await sleep(5000);
    const poll = await httpJson(`https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&json=1&id=${encodeURIComponent(id)}`);
    if (String(poll.status) === '1') return poll.request;
    if (poll.request && poll.request !== 'CAPCHA_NOT_READY') throw new Error(`2captcha: ${poll.request}`);
  }
  throw new Error('2captcha timed out');
}

// anti-captcha JSON task API (createTask → getTaskResult).
async function solveWithAnticaptcha(apiKey, job) {
  const taskType = job.type === 'hcaptcha' ? 'HCaptchaTaskProxyless' : 'RecaptchaV2TaskProxyless';
  const create = await httpJson('https://api.anti-captcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task: { type: taskType, websiteURL: job.pageurl, websiteKey: job.sitekey } })
  });
  if (create.errorId) throw new Error(`anti-captcha createTask: ${create.errorDescription || create.errorCode}`);
  const taskId = create.taskId;
  for (let i = 0; i < 30; i += 1) {
    await sleep(5000);
    const poll = await httpJson('https://api.anti-captcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId })
    });
    if (poll.errorId) throw new Error(`anti-captcha: ${poll.errorDescription || poll.errorCode}`);
    if (poll.status === 'ready') {
      return (poll.solution && (poll.solution.gRecaptchaResponse || poll.solution.token)) || '';
    }
  }
  throw new Error('anti-captcha timed out');
}

async function solveCaptchaJob(cfg, job) {
  if (cfg.provider === 'anticaptcha') return solveWithAnticaptcha(cfg.apiKey, job);
  return solveWith2captcha(cfg.apiKey, job);
}

// Attach the solver to one page. On every navigation it scans for supported
// captcha widgets, solves any it hasn't solved yet, and injects the token.
// Fully best-effort: a solver/network failure never blocks or breaks the page.
function attachCaptchaSolver(page, cfg) {
  if (!cfg || !cfg.enabled || !cfg.apiKey) return;
  const solvedKeys = new Set();
  const handle = async () => {
    let pageurl = '';
    try { pageurl = page.url(); } catch (e) { return; }
    if (!pageurl || pageurl.startsWith('about:') || pageurl.startsWith('file:')) return;
    let found = [];
    try {
      found = await page.evaluate(() => {
        const out = [];
        const push = (type, sitekey) => { if (sitekey) out.push({ type, sitekey }); };
        document.querySelectorAll('.g-recaptcha[data-sitekey],[data-sitekey]').forEach((el) => {
          const k = el.getAttribute('data-sitekey');
          const isH = el.classList.contains('h-captcha');
          push(isH ? 'hcaptcha' : 'recaptcha', k);
        });
        document.querySelectorAll('iframe[src*="/recaptcha/"]').forEach((f) => {
          const m = /[?&]k=([^&]+)/.exec(f.src || ''); if (m) push('recaptcha', decodeURIComponent(m[1]));
        });
        document.querySelectorAll('iframe[src*="hcaptcha.com"]').forEach((f) => {
          const m = /[?&]sitekey=([^&]+)/.exec(f.src || ''); if (m) push('hcaptcha', decodeURIComponent(m[1]));
        });
        return out;
      });
    } catch (e) { return; }
    for (const job of found) {
      if (job.type === 'recaptcha' && cfg.solveRecaptchaV2 === false) continue;
      if (job.type === 'hcaptcha' && cfg.solveHcaptcha === false) continue;
      const dedupeKey = `${job.type}:${job.sitekey}`;
      if (solvedKeys.has(dedupeKey)) continue;
      solvedKeys.add(dedupeKey);
      try {
        const token = await solveCaptchaJob(cfg, { type: job.type, sitekey: job.sitekey, pageurl });
        if (!token) continue;
        await page.evaluate((tok) => {
          const fill = (sel) => document.querySelectorAll(sel).forEach((el) => {
            el.value = tok; el.innerHTML = tok;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          fill('textarea#g-recaptcha-response');
          fill('textarea[name="g-recaptcha-response"]');
          fill('textarea[name="h-captcha-response"]');
          fill('textarea#h-captcha-response');
          // Best-effort: invoke any registered reCAPTCHA callback so the host
          // form reacts as if the user had solved it interactively.
          try {
            const cfgObj = window.___grecaptcha_cfg;
            if (cfgObj && cfgObj.clients) {
              Object.values(cfgObj.clients).forEach((client) => {
                Object.values(client || {}).forEach((maybe) => {
                  Object.values(maybe || {}).forEach((leaf) => {
                    if (leaf && typeof leaf.callback === 'function') { try { leaf.callback(tok); } catch (e) {} }
                  });
                });
              });
            }
          } catch (e) {}
        }, token).catch(() => {});
      } catch (e) {
        // Allow a retry on the next navigation if this attempt failed.
        solvedKeys.delete(dedupeKey);
      }
    }
  };
  page.on('framenavigated', (frame) => { try { if (frame === page.mainFrame()) handle(); } catch (e) {} });
  // Also run once shortly after attach for captchas already present on load.
  setTimeout(() => { handle().catch(() => {}); }, 3500);
}

// ---------------------------------------------------------------------------
// Geo lookup through the proxy in NODE, BEFORE the browser launches. This is the
// key to fixing the timezone leak: knowing the proxy's timezone up front lets us
// set the TZ env var on the Chrome process (process-wide, covers every tab AND
// workers, with no injection race), and bake the proxy exit IP + locale into the
// fingerprint extension. Only HTTP/HTTPS proxies are supported here (the raw http
// module speaks the HTTP CONNECT-less GET-via-proxy form); SOCKS falls back to the
// in-page lookup. Returns the ip-api JSON or null.
// ---------------------------------------------------------------------------
function lookupProxyGeoNode(proxy) {
  return new Promise((resolve) => {
    if (!proxy || !proxy.host || !proxy.port) return resolve(null);
    const scheme = String(proxy.type || '').toLowerCase();
    if (scheme.startsWith('socks')) return resolve(null); // http module can't do SOCKS
    const targetUrl = 'http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,lat,lon,isp,query';
    const headers = {
      Host: 'ip-api.com',
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      Connection: 'close'
    };
    if (proxy.username || proxy.password) {
      const token = Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
      headers['Proxy-Authorization'] = `Basic ${token}`;
    }
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.request(
      { host: proxy.host, port: Number(proxy.port), method: 'GET', path: targetUrl, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { const j = JSON.parse(data); done(j && j.status === 'success' ? j : null); }
          catch (e) { done(null); }
        });
      }
    );
    req.on('error', () => done(null));
    req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} done(null); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Geo lookup through the active proxy (runs inside the page so it routes via
// the proxy). Returns { countryCode, timezone, lat, lon } or null.
// ---------------------------------------------------------------------------
async function lookupProxyGeo(page) {
  const evaluation = page.evaluate(async () => {
    try {
      const res = await fetch('http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,lat,lon,isp,query', { cache: 'no-store' });
      const json = await res.json();
      return json && json.status === 'success' ? json : null;
    } catch (e) {
      return null;
    }
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), GEO_LOOKUP_TIMEOUT_MS));
  try {
    return await Promise.race([evaluation, timeout]);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fingerprint config + injection extension
//
// The JS fingerprint is delivered as a Manifest V3 content script running in the
// page's MAIN world at document_start. Chrome GUARANTEES such a script runs
// before any page script in EVERY tab, popup and iframe — which CDP / puppeteer
// injection does NOT (it races the first document of new tabs, which is what made
// opened-in-new-tab check sites leak the real cores/RAM/GPU and the real WebRTC
// IP while the first tab stayed clean). Verified on Chrome 151: a new tab reads
// the spoofed value, not the real machine.
//
// Because the extension is written and loaded at launch time, the config must be
// geo-INDEPENDENT (no proxy-exit IP / auto-language, which are only known after
// the browser is up). Timezone and geolocation are still applied per-page via CDP
// Emulation after the geo lookup; WebRTC protection runs in DROP mode (any
// candidate exposing a public IP is dropped) so the real IP is hidden without
// needing the proxy IP.
function buildFingerprintConfig(profile, opts) {
  const { seed, resW, resH, webrtcMode, hasProxy, geo, timezone } = opts;
  const osTok = osTokens(profile.os);
  const manualLang = profile.languageType === 'Custom' && profile.languageCustom
    ? String(profile.languageCustom).trim() : null;
  // Language: explicit profile language wins; otherwise derive it from the proxy
  // country (so navigator.languages matches the exit IP); otherwise en-US.
  const geoLocale = geo && geo.countryCode ? COUNTRY_LOCALE[geo.countryCode] : null;
  const langs = manualLang
    ? manualLang.split(',').map((l) => l.split(';')[0].trim()).filter(Boolean)
    : (geoLocale ? Array.from(new Set([geoLocale, geoLocale.split('-')[0], 'en'])) : ['en-US', 'en']);

  // WebGL GPU strings. Spoofing vendor/renderer on the MAIN thread but not inside a
  // service worker (a separate script we can't inject) creates the main-vs-worker
  // GPU MISMATCH that CreepJS flags (main "Intel" vs worker "AMD"). So by DEFAULT we
  // report the REAL GPU everywhere — consistent across main thread, dedicated
  // workers AND the service worker. A consistent real GPU is far less suspicious
  // than a mismatch, and per-profile uniqueness still comes from canvas/audio noise.
  // A custom vendor/renderer is only honored when the user EXPLICITLY sets one
  // (anything other than empty / Auto / Real / Default), accepting the SW caveat.
  // Honor the editor's "WebGL Metadata: Real | Custom" toggle. "Real" (the default)
  // means DON'T spoof — report the true GPU everywhere. Only "Custom" with an
  // explicit, non-Auto vendor spoofs the string (and only on the main thread +
  // dedicated workers; the service worker still shows the real GPU, hence the
  // "Real" recommendation).
  const isCustomGpu = String(profile.webglMetadata || 'Real').toLowerCase() === 'custom'
    && profile.webglVendor && !/^(real|auto|default|based)/i.test(String(profile.webglVendor));
  const webglVendor = isCustomGpu ? profile.webglVendor : null;
  const webglRenderer = isCustomGpu ? (profile.webglRenderer || null) : null;

  const dntRaw = String(profile.doNotTrack || '').toLowerCase();
  const dnt = /^(on|enable|enabled|1|true|yes)$/.test(dntRaw) ? '1'
    : (/^(off|disable|disabled|0|false|no)$/.test(dntRaw) ? '0' : null);

  // CPU cores + RAM are SPOOFED BY DEFAULT — the real machine is never leaked to a
  // page unless the user explicitly picks "Real". A blank/missing value still
  // spoofs (deterministic per-profile pick from the seed, so it's stable across
  // launches but unique per profile). navigator.deviceMemory is spec-capped at 8 in
  // real Chrome; 16/32 is impossible, so we map RAM GB down to {1,2,4,8}.
  const realCpu = /^real$/i.test(String(profile.cpuType || ''));
  const realRam = /^real$/i.test(String(profile.ramType || ''));
  const spoofCores = toInt(profile.cpuCores, pick([4, 6, 8, 8, 12, 16], seed));
  const ramGb = toInt(profile.ramGb, pick([8, 8, 16, 16], seed >> 2));
  const deviceMemory = ramGb >= 8 ? 8 : (ramGb >= 4 ? 4 : (ramGb >= 2 ? 2 : 1));

  // Chromium-family identity (JS layer). vendor/inject don't depend on the major,
  // so we resolve them here (the UA token + brands are applied separately via CDP).
  const brandIdent = buildBrandIdentity(profile.browserBrand, 0, '');

  return {
    seed,
    langs,
    brand: brandIdent.id,
    brandVendor: brandIdent.vendor,
    brandInject: brandIdent.inject,
    timezone: timezone || null,
    navPlatform: osTok.navPlatform,
    // null ⇒ no override (report the real value) — only when the user picks "Real".
    cores: realCpu ? null : spoofCores,
    mem: realRam ? null : deviceMemory,
    screenW: resW,
    screenH: resH,
    webglVendor,
    webglRenderer,
    webrtcMode,
    // On whenever a proxy is used and the mode isn't the explicit pass-through.
    // With the proxy exit IP known (pre-launch geo), WebRTC candidates are
    // REWRITTEN to it so WebRTC reports the proxy IP — matching the HTTP IP — which
    // is far more natural than a "disabled" WebRTC. If the IP is unknown, the
    // in-page guard falls back to DROP mode (real IP still hidden).
    webrtcProtect: Boolean(hasProxy) && webrtcMode !== 'Real' && webrtcMode !== 'Disabled',
    webrtcPublicIp: (geo && geo.query) ? String(geo.query) : null,
    dnt,
    webgpuDisabled: /disabled?/i.test(String(profile.webgpu || '')),
    speechVoices: profile.speechVoicesNoise !== false,
    mediaDevices: !/^real$/i.test(String(profile.mediaDevice || 'Auto')),
    // Realistic, OS-matched, per-profile-stable enumerateDevices() set. Derived
    // from the SAME seed so the reported hardware is identical on every launch.
    mediaSet: generateMediaDevices(profile.os, seed),
    fontsNoise: profile.fontsType ? !/^real$/i.test(String(profile.fontsType)) : false,
    portScan: /^enable/i.test(String(profile.portScanProtection || '')),
    noise: {
      canvas: profile.canvasNoise !== false,
      webgl: profile.webglImageNoise !== false,
      audio: profile.audioContextNoise !== false,
      clientRects: profile.clientRectsNoise !== false
    }
  };
}

// Writes the MAIN-world content-script extension into the profile dir and returns
// its path (to be passed to --load-extension).
async function writeFingerprintExtension(userDataDir, fpConfig, opts = {}) {
  const extDir = path.join(userDataDir, 'sg-fp-ext');
  await fs.mkdir(extDir, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'Core',
    version: '1.0.0',
    content_scripts: [{
      matches: ['<all_urls>'],
      js: ['fp.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      world: 'MAIN'
    }]
  };
  // Override the New Tab Page ONLY for Chrome-for-Testing. CfT's built-in
  // chrome://newtab CRASHES the whole browser (access violation 0xC0000005) when
  // opened on recent builds (151+) — its remote NTP/realbox/signin code is broken
  // in CfT — so clicking "+" killed the session. Pointing the NTP at a local page
  // sidesteps the crash. Real Chrome's NTP works fine, so we DON'T override it
  // there (the override would needlessly trip Chrome's "changed by extension"
  // consent bubble). overriding is gated on opts.ntpOverride.
  if (opts.ntpOverride) {
    manifest.chrome_url_overrides = { newtab: 'newtab.html' };
    const newtabHtml = '<!doctype html><html><head><meta charset="utf-8"><title>New Tab</title>'
      + '<style>html,body{margin:0;height:100%;background:#1f2430}</style></head><body></body></html>';
    await fs.writeFile(path.join(extDir, 'newtab.html'), newtabHtml);
  }
  await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
  // Self-contained: serialize the function and invoke it with the baked config.
  const source = `(${fingerprintScript.toString()})(${JSON.stringify(fpConfig)});`;
  await fs.writeFile(path.join(extDir, 'fp.js'), source);
  return extDir;
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------
async function launchProfileSession(options = {}) {
  const {
    profileId,
    title,
    dataDirName,
    profileRoot = DEFAULT_PROFILE_ROOT,
    headless = false,
    profile = {},
    browserSettings = {},
    captcha = null,
    globalExtensionDirs = [],
    // Geo auto-match (timezone/locale/WebRTC derived from the proxy exit) is ON by
    // default. A global Settings toggle can disable it; when off we skip the geo
    // lookup entirely so only the profile's manual values apply.
    geoMatchEnabled = true
  } = options;

  const resolvedProxy = parseProxyInput(options.proxy || options.proxyInfoString);
  const proxyLabel = resolvedProxy ? `${resolvedProxy.type} ${resolvedProxy.host}:${resolvedProxy.port}` : 'Direct (No Proxy)';

  // On-startup guard: refuse to launch a proxy-only profile when no proxy is set.
  if (browserSettings.onlyOpenWithProxy && !resolvedProxy) {
    throw new Error('This profile is set to only open with an available proxy, but no proxy is configured.');
  }

  const safeDirName = sanitizeDataDirName(dataDirName || title || `profile-${profileId || crypto.randomUUID()}`);
  const root = path.resolve(profileRoot);
  const userDataDir = resolveInside(root, safeDirName);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });

  // Materialize the dev-tools / extension-lock managed-policy file (if requested).
  await writeManagedPolicies(userDataDir, browserSettings);

  const seed = seedFromString(safeDirName);

  const resW = profile.resolutionType && profile.resolutionType !== 'Real' ? toInt(profile.resolutionW, 1920) : 1920;
  const resH = profile.resolutionType && profile.resolutionType !== 'Real' ? toInt(profile.resolutionH, 1080) : 1080;
  const winW = toInt(profile.resolutionW, DEFAULT_WINDOW_SIZE.width);
  const winH = toInt(profile.resolutionH, DEFAULT_WINDOW_SIZE.height);

  const webrtcMode = profile.webrtc || 'Forward';

  // Pre-launch geo lookup through the proxy (HTTP proxies). Resolving the proxy's
  // timezone / exit IP / country BEFORE launch is what fixes the timezone leak:
  // we can set TZ on the Chrome PROCESS (process-wide, covers every tab AND
  // workers, no injection race) and bake the proxy IP + locale into the extension.
  const manualTz = profile.timezoneType === 'Custom' && profile.timezoneCustom
    ? String(profile.timezoneCustom).trim() : null;
  let geo = geoMatchEnabled && resolvedProxy && profile.timezoneType !== 'Real' ? await lookupProxyGeoNode(resolvedProxy) : null;
  let timezoneId = manualTz || (geo && geo.timezone) || null;

  // Build the fingerprint config (geo-aware) and bake it into a MAIN-world
  // content-script extension BEFORE launch — this is the reliable injection path.
  const fpConfig = buildFingerprintConfig(profile, { seed, resW, resH, webrtcMode, hasProxy: Boolean(resolvedProxy), geo, timezone: timezoneId });
  // Decide the binary up front (real Chrome vs Chrome-for-Testing) so the
  // extension is written with the NTP override ONLY when launching CfT.
  const chosenBrowser = chooseBrowserBinary(profile);
  const usingCft = !(chosenBrowser && chosenBrowser.isReal);
  const fpExtDir = await writeFingerprintExtension(userDataDir, fpConfig, { ntpOverride: usingCft });

  // Merge the fingerprint "Core" extension with any globally-enabled team
  // extensions (installed via the Extensions page) into a single comma-separated
  // list. Chromium accepts multiple unpacked extensions this way; both
  // --disable-extensions-except and --load-extension must carry the SAME list so
  // every one of them is whitelisted AND loaded.
  const extensionDirs = [fpExtDir, ...(Array.isArray(globalExtensionDirs) ? globalExtensionDirs : [])].filter(Boolean);
  const extensionArg = extensionDirs.join(',');

  const args = [
    `--window-size=${winW},${winH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    // Kill any infobars (belt-and-suspenders with ignoreDefaultArgs below).
    '--disable-infobars',
    // Suppress Chrome's "Disable developer mode extensions" warning that otherwise
    // pops up for our --load-extension fingerprint extension (the "Core" notice the
    // user saw), plus the unsupported-flag and NTP-override consent bubbles. It is a
    // process-level switch only — NOT page-observable (navigator.webdriver stays
    // false, verified), so it doesn't weaken the in-page stealth surface.
    '--test-type',
    `--disable-extensions-except=${extensionArg}`,
    `--load-extension=${extensionArg}`
  ];

  // Force the ENTIRE locale stack (ICU default locale → Intl.DateTimeFormat /
  // NumberFormat / Collator, and Accept-Language) to match navigator.language.
  // Without this, Chrome's ICU defaults to en-US while we spoof navigator to e.g.
  // en-GB — Intl.resolvedOptions().locale = "en-US" is a classic mismatch tell
  // (CreepJS flags "American English" vs en-GB). --lang drives it natively.
  const primaryLocale = (fpConfig.langs && fpConfig.langs[0]) || null;
  if (primaryLocale) args.push(`--lang=${primaryLocale}`);

  // WebRTC IP handling. When we know the proxy exit IP, let candidates gather so
  // the in-page protection can REWRITE them to the proxy IP (WebRTC then reports
  // the proxy IP, matching HTTP — the most natural result). When we DON'T know it,
  // block non-proxied UDP so the real IP can never escape (drop mode).
  //
  // CRITICAL: we now ALWAYS block non-proxied UDP whenever a proxy is set (not just
  // when the IP is unknown). Previously, knowing the proxy IP we let host candidates
  // gather so the in-page code could rewrite them — but Chrome's mDNS host candidate
  // (xxxx.local) still leaked: CreepJS resolves the .local name to the REAL IP. Drop
  // mode prevents the real-IP host candidate from ever being gathered, so only the
  // proxied srflx (proxy IP) or nothing is exposed. The real IP can never escape.
  if (resolvedProxy && webrtcMode !== 'Real') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }

  // Chromium collapses repeated --enable-features / --disable-features switches to
  // the LAST one (it does NOT merge them), so we accumulate every feature here and
  // emit a single combined switch of each below. Adding them individually would
  // make a later flag silently wipe an earlier one (e.g. HttpsUpgrades vs the
  // Client-Hint feature) — a real, easy-to-miss bug.
  const enableFeatures = [];
  const disableFeatures = [];

  // Phase 2 — Client Hints. Guarantee the UserAgentClientHint feature is on so
  // Chrome populates navigator.userAgentData and emits the Sec-CH-UA-* request
  // headers that our CDP userAgentMetadata override (platform / platformVersion /
  // architecture / model / brands) feeds. It's on by default in modern Chrome;
  // setting it explicitly keeps older real builds consistent too.
  enableFeatures.push('UserAgentClientHint');

  // Global browser settings honored via Chromium flags.
  // Images: blink-settings fully disables image loading to save proxy traffic.
  if (browserSettings.disableImages) args.push('--blink-settings=imagesEnabled=false');
  // Secure access: auto-upgrade http→https where possible (Chrome-version dependent).
  if (browserSettings.secureAccess) enableFeatures.push('HttpsUpgrades');
  // Translate offer bar: a real flag (not the no-op policy file), so it actually
  // takes effect. Off by default keeps the locale story consistent.
  if (browserSettings.offerTranslate === false) disableFeatures.push('Translate');
  // Chrome sign-in / sync: a Google session can de-anonymize a profile, so unless
  // explicitly allowed we disable sync entirely via a launch flag.
  if (!browserSettings.allowChromeSignin) args.push('--disable-sync');

  // Per-profile hardware/network flags from the profile config.
  if (/disable|off|close/i.test(String(profile.hardwareAcceleration || ''))) args.push('--disable-gpu');
  if (/open|enable|on|true/i.test(String(profile.disableTls || ''))) args.push('--ignore-certificate-errors');
  // Custom launch args: only accept well-formed "--flag" tokens.
  if (profile.launchArgs) {
    String(profile.launchArgs)
      .split(/[\r\n\s]+/)
      .map((token) => token.trim())
      .filter((token) => /^--[a-zA-Z0-9]/.test(token))
      .forEach((token) => { if (!args.includes(token)) args.push(token); });
  }

  // Phase 3 — DNS / network leak hardening. When traffic is proxied, two UDP side
  // channels can still expose the real IP or resolve names outside the tunnel:
  //   • WebRTC UDP → already neutralized above by
  //     --force-webrtc-ip-handling-policy=disable_non_proxied_udp plus the in-page
  //     RTCPeerConnection guard.
  //   • QUIC / HTTP3 (UDP) → an HTTP or SOCKS proxy only tunnels TCP, so a QUIC
  //     connection bypasses the proxy and resolves/connects DIRECTLY — a real DNS
  //     and IP leak. Disabling QUIC forces every request back onto the proxied TCP
  //     path, where Chrome resolves hostnames PROXY-SIDE (HTTP CONNECT and SOCKS5
  //     remote DNS), keeping DNS inside the tunnel.
  //
  // NOTE: we deliberately do NOT use `--host-resolver-rules=MAP * ~NOTFOUND`.
  // That maps EVERY hostname to NOTFOUND, so the browser can no longer resolve
  // anything — a hard breakage, not a leak fix. Proxy-side resolution + killing
  // the QUIC bypass is the correct, non-destructive way to stop DNS leaks.
  //
  // Per-profile HTTP/3 (QUIC) toggle. Default (enableQuic falsy) = disabled when
  // proxied, for maximum stealth / no unproxied-UDP leak. "High-Speed Trusted
  // Mode" (enableQuic === true) OMITS --disable-quic so Chromium can natively
  // negotiate HTTP/3 over UDP — only safe on premium proxies (e.g. SOCKS5) that
  // fully tunnel/isolate UDP.
  if (resolvedProxy && profile.enableQuic !== true) {
    args.push('--disable-quic');
  }

  // Emit the accumulated feature switches as a SINGLE flag each (see the
  // accumulation note above — repeated switches clobber rather than merge).
  if (enableFeatures.length) args.push(`--enable-features=${[...new Set(enableFeatures)].join(',')}`);
  if (disableFeatures.length) args.push(`--disable-features=${[...new Set(disableFeatures)].join(',')}`);

  // Proxy via --proxy-server; credentials handled per-page with page.authenticate
  // (below). This replaces the old Manifest V2 auth extension, which newer Chrome
  // builds (≈139+) no longer load — so authenticated proxies kept working on the
  // bundled 127 but would silently fail on a real Chrome 149.
  if (resolvedProxy) {
    const proxyServer = buildProxyServerArgument(resolvedProxy);
    if (proxyServer) args.push(`--proxy-server=${proxyServer}`);
  }
  const proxyCreds = resolvedProxy && (resolvedProxy.username || resolvedProxy.password)
    ? { username: resolvedProxy.username || '', password: resolvedProxy.password || '' }
    : null;

  // Use the binary chosen up front: a pinned CfT version if installed, else real
  // system Chrome (preferred — no NTP crash, no "Testing" icon), else newest CfT,
  // else the bundled Chromium. Real Chrome reports its own genuine version, which
  // is what UA/Client-Hints derive from — fully consistent.
  const resolvedBrowser = chosenBrowser;
  // Stealth: strip puppeteer's default '--enable-automation' (it paints the
  // "Chrome is being controlled by automated test software" infobar AND sets
  // navigator.webdriver=true) and explicitly kill any infobars. We still drive the
  // browser over the DevTools endpoint, which is unaffected by removing this flag.
  const launchOptions = {
    headless,
    userDataDir,
    defaultViewport: null,
    args,
    ignoreDefaultArgs: ['--enable-automation']
  };
  if (resolvedBrowser && resolvedBrowser.exePath) launchOptions.executablePath = resolvedBrowser.exePath;
  // Set the timezone on the Chrome PROCESS via the TZ env var. Chromium honors it
  // for ICU/Date/Intl in EVERY context — main thread, dedicated workers, AND
  // service workers — natively, with no injection and no per-tab race. This is the
  // fix for the real-timezone leak (proxy in the US but JS reporting Asia/Karachi).
  if (timezoneId) launchOptions.env = { ...process.env, TZ: timezoneId };

  const browser = await puppeteer.launch(launchOptions);

  // CRITICAL: stop puppeteer-extra-stealth from auto-injecting its ~11 evasions
  // into EVERY new tab. On the transient New Tab Page (chrome://new-tab-page),
  // the target's CDP session closes before injection finishes, so each evasion
  // throws `TargetCloseError (Page.addScriptToEvaluateOnNewDocument)` — a flood of
  // unhandled rejections on every "+" tab that destabilized the browser. The
  // FIRST page was processed by stealth during launch; the CDP auto-attach below
  // injects the full fingerprint into every subsequent tab, so removing the
  // plugin's new-target listener loses nothing and ends the crash.
  browser.removeAllListeners('targetcreated');

  // --- Reliable cross-channel fingerprint injection -------------------------
  // Real Chrome (stable channel) SILENTLY IGNORES --load-extension (a 2025
  // security change), so the MAIN-world content-script extension never loads and
  // its injection is dead. AND puppeteer's per-page evaluateOnNewDocument RACES a
  // browser-opened tab: a window.open() / target=_blank / "+" tab commits its
  // first document before our targetcreated handler can register a script
  // (verified). The result was the real WebRTC IP, real GPU, and unspoofed
  // deviceMemory leaking on every new tab while the first tab looked fine.
  //
  // Fix: drive injection from a BROWSER-LEVEL CDP auto-attach with
  // waitForDebuggerOnStart. Every new target (page / iframe / worker) PAUSES
  // before running any script; we register the fingerprint init script (+ the
  // native hardwareConcurrency override) and then resume. Channel-independent
  // (works on real Chrome AND Chrome-for-Testing) and never races the first doc.
  const fpInjectSource = `(${fingerprintScript.toString()})(${JSON.stringify(fpConfig)});`;
  try {
    const rootCdp = await browser.target().createCDPSession();
    rootCdp.on('Target.attachedToTarget', async (ev) => {
      const info = ev.targetInfo || {};
      // Inject the FP script (best-effort) and ALWAYS resume the paused target.
      // Returns true once the flattened session is available so we can resume it.
      const handle = async () => {
        let sess = null;
        try { sess = rootCdp.connection().session(ev.sessionId); } catch (e) {}
        if (!sess) return false; // puppeteer hasn't created the flattened session yet
        try {
          if (info.type === 'page' || info.type === 'iframe') {
            await sess.send('Page.addScriptToEvaluateOnNewDocument', { source: fpInjectSource }).catch(() => {});
            if (fpConfig.cores) await sess.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores }).catch(() => {});
          } else if (/worker/i.test(info.type || '')) {
            if (fpConfig.cores) await sess.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores }).catch(() => {});
          }
        } catch (e) { /* best-effort per target */ }
        // ALWAYS resume — even on error — or the paused target hangs at about:blank.
        try { await sess.send('Runtime.runIfWaitingForDebugger').catch(() => {}); } catch (e) {}
        return true;
      };
      // Common case: the session exists and we resume immediately. If it doesn't
      // yet (a race with puppeteer's own target bookkeeping that otherwise leaves
      // a new tab/popup frozen at about:blank), retry briefly so it always resumes.
      if (!(await handle())) {
        for (let i = 0; i < 20 && !(await handle()); i += 1) await sleep(50);
      }
    });
    await rootCdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  } catch (e) { /* fall back to per-page evaluateOnNewDocument in applyToPage */ }

  // Track PID to prevent orphaned processes
  const browserProcess = browser.process();
  if (browserProcess) {
    const pid = browserProcess.pid;
    trackPid(pid);
    // DIAGNOSTIC: a profile browser that "closes by itself" is otherwise silent
    // because every CDP path is .catch()'d and Chrome's own stderr is never read.
    // Surface (a) Chrome's stderr crash lines and (b) the real exit code/signal so
    // a new-tab teardown is visible in the terminal instead of vanishing.
    try {
      if (browserProcess.stderr) {
        browserProcess.stderr.on('data', (d) => {
          const s = String(d);
          // Known-harmless Chrome stderr that ALWAYS appears and is not a crash:
          //  • google_apis/gcm registration (PHONE_REGISTRATION_ERROR / DEPRECATED_ENDPOINT)
          //    — Chrome's push-messaging signup, irrelevant to an automated profile.
          //  • new_tab_ui.cc "incorrect profile type" — Chrome declining to serve its
          //    WebUI new-tab page in this profile context; the tab still opens, no crash.
          //  • device_event_log / bluetooth_adapter — BT adapter probing on a machine
          //    without one. None of these touch the page or the fingerprint, so we drop
          //    them — otherwise they bury a genuine crash line under recurring noise.
          if (/registration_request\.cc|gcm[\\/]engine|DEPRECATED_ENDPOINT|PHONE_REGISTRATION_ERROR|new_tab_ui\.cc|device_event_log|bluetooth_adapter|Getting Default Adapter/i.test(s)) {
            return;
          }
          if (/FATAL|ERROR:|Check failed|received signal|DCHECK|crash|GPU process|renderer|0xC0000005|access violation/i.test(s)) {
            console.error('[SG][chrome-stderr]', s.trim().slice(0, 600));
          }
        });
      }
    } catch (e) {}
    browserProcess.once('exit', (code, signal) => {
      console.error(`[SG][chrome-exit] pid=${pid} code=${code} signal=${signal} — the profile browser process ended.`);
    });
    browser.on('disconnected', () => {
      console.error(`[SG][browser-disconnected] pid=${pid} — puppeteer lost the connection (browser gone).`);
      untrackPid(pid);
    });
    // Best-effort window icon. For a Chromium-BRAND profile (Edge/Brave/…) always
    // paint the brand colour. For a plain Chrome identity, only override the icon
    // on Chrome-for-Testing (to hide its "Testing" badge) — real Chrome already
    // shows the genuine Chrome icon, which we must not clobber. Off-Windows: no-op.
    const brandIsChrome = !/edge|brave|opera|opr|vivaldi|yandex/i.test(String(profile.browserBrand || ''));
    if (!brandIsChrome || usingCft) {
      try { applyBrandWindowIcon(pid, profile.browserBrand); } catch (e) {}
    }
  }

  const versionString = await browser.version(); // e.g. "Chrome/149.0.7827.155"
  const fullVersionMatch = versionString.match(/\/([\d.]+)/);
  const realFullVersion = fullVersionMatch ? fullVersionMatch[1] : '';
  const realMajor = Number.parseInt(realFullVersion.split('.')[0] || '125', 10);

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  const manualLat = profile.locationType === 'Custom' ? Number.parseFloat(profile.locationLat) : NaN;
  const manualLng = profile.locationType === 'Custom' ? Number.parseFloat(profile.locationLng) : NaN;

  // Fallback geo: if the pre-launch (Node) lookup didn't resolve — e.g. a SOCKS
  // proxy, which the http module can't speak — resolve it in-page now so timezone
  // and geolocation can still be applied via CDP. Authenticate first so an
  // authenticated proxy doesn't answer 407 (which would null the lookup).
  if (geoMatchEnabled && !geo && resolvedProxy && profile.timezoneType !== 'Real') {
    if (proxyCreds) await page.authenticate(proxyCreds).catch(() => {});
    geo = await lookupProxyGeo(page);
    if (!timezoneId && geo && geo.timezone) timezoneId = geo.timezone;
  }

  const geoLat = Number.isFinite(manualLat) ? manualLat : (geo && Number.isFinite(geo.lat) ? geo.lat : null);
  const geoLng = Number.isFinite(manualLng) ? manualLng : (geo && Number.isFinite(geo.lon) ? geo.lon : null);

  // navigator.languages is delivered by the injection extension (fpConfig.langs,
  // built before launch). Keep the Accept-Language HEADER consistent with it so
  // headers and JS never disagree (a mismatch is itself a detection signal).
  const acceptLanguage = localeToAcceptLanguage(fpConfig.langs[0] || 'en-US');
  const dnt = fpConfig.dnt; // reused for the DNT request header in applyToPage

  const ua = buildUserAgentBundle(profile, realMajor, realFullVersion, seed);

  // Mobile (Android) profiles: the UA + Client-Hints are already Android (via
  // buildUserAgentBundle / osTokens), but a real mobile device also has a small
  // high-DPR viewport and a touchscreen. We apply those at the CDP layer per page
  // (DevTools device-mode emulation) so navigator.maxTouchPoints, ontouchstart,
  // window.devicePixelRatio and the viewport all line up with the Android UA. The
  // in-page script already sets screen.width/height from resolutionW/H (which the
  // generator pins to the Pixel 7's 412x915), so the two layers agree.
  const isMobile = String(profile.deviceClass || '').toLowerCase() === 'mobile'
    || /android/i.test(String(profile.os || ''));
  const mobileMetrics = isMobile ? {
    width: toInt(profile.resolutionW, 412),
    height: toInt(profile.resolutionH, 915),
    deviceScaleFactor: 2.625, // Pixel 7 DPR
    maxTouchPoints: 5
  } : null;

  // Apply the full fingerprint to a single page. Used for the first tab AND for
  // every tab/popup opened later, so new windows are never left un-spoofed
  // (leaking the real UA / timezone / devices). Idempotent per page.
  const appliedPages = new WeakSet();
  const applyToPage = async (targetPage, isNewTab = false) => {
    if (!targetPage || appliedPages.has(targetPage)) return;
    // Never touch browser-internal pages (New Tab Page, settings, devtools). There
    // is nothing to spoof there, and running proxy-auth / CDP work on the NTP —
    // which fetches Google content through the proxy — was crashing the browser
    // when a new tab was opened. We re-run on the real navigation (see below).
    let pageUrl = '';
    try { pageUrl = targetPage.url(); } catch (e) {}
    const isInternal = /^(chrome|chrome-extension|devtools|edge|view-source):/i.test(pageUrl);
    const isBlank = pageUrl === '' || pageUrl === 'about:blank';
    // For a freshly-opened tab (the "+" button), its URL at targetcreated time is
    // often '' or about:blank BEFORE it resolves to the network New Tab Page. Doing
    // proxy-auth / CDP / request-interception on that transient/internal tab is the
    // exact thing that crashed the browser. The MAIN-world extension already injects
    // the full fingerprint into every new tab, so we simply wait and (re)apply the
    // CDP-only extras once the tab navigates to a REAL http(s) page.
    if (isNewTab && (isInternal || isBlank)) return;
    if (isInternal) return;
    appliedPages.add(targetPage);
    try {
      // MOST timing-sensitive FIRST: a target="_blank" popup begins navigating
      // the instant it's created, so the init script must be registered before
      // any other awaits — otherwise the popup's first document commits with the
      // REAL navigator (this was the new-tab fingerprint leak). Verified: with
      // evaluateOnNewDocument called before navigation, the override applies.
      await targetPage.evaluateOnNewDocument(fingerprintScript, fpConfig).catch(() => {});
      // Proxy auth for HTTP(S) proxies — version-agnostic, no MV2 extension.
      if (proxyCreds) await targetPage.authenticate(proxyCreds).catch(() => {});
      const cdp = await targetPage.target().createCDPSession();
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: ua.userAgent,
        acceptLanguage,
        platform: ua.navPlatform,
        userAgentMetadata: ua.userAgentMetadata
      }).catch(() => {});
      if (timezoneId) await cdp.send('Emulation.setTimezoneOverride', { timezoneId }).catch(() => {});
      // Mobile device metrics + touch — makes the Android UA coherent with a real
      // phone: high-DPR viewport, screen size, and a working touchscreen
      // (navigator.maxTouchPoints > 0 + ontouchstart). Desktop profiles skip this.
      if (mobileMetrics) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: mobileMetrics.width,
          height: mobileMetrics.height,
          deviceScaleFactor: mobileMetrics.deviceScaleFactor,
          mobile: true,
          screenWidth: mobileMetrics.width,
          screenHeight: mobileMetrics.height
        }).catch(() => {});
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: mobileMetrics.maxTouchPoints }).catch(() => {});
        await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => {});
      }
      // Native cores override — applies to the page AND the dedicated/shared
      // workers it spawns, even before their script runs (no JS-injection race).
      // Belt-and-suspenders with the in-page navigator override + worker prelude.
      if (fpConfig.cores) await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores }).catch(() => {});
      if (geoLat !== null && geoLng !== null) {
        await cdp.send('Browser.grantPermissions', { permissions: ['geolocation'] }).catch(() => {});
        await cdp.send('Emulation.setGeolocationOverride', {
          latitude: geoLat,
          longitude: geoLng,
          accuracy: toInt(profile.locationAcc, 100)
        }).catch(() => {});
      }
      // DNT belongs on the wire as an HTTP header, not just navigator.
      if (dnt === '1') await targetPage.setExtraHTTPHeaders({ DNT: '1', 'Sec-GPC': '1' }).catch(() => {});
      // Captcha auto-solver (paid 2captcha/anti-captcha; user-supplied API key).
      try { attachCaptchaSolver(targetPage, captcha); } catch (e) {}
      // Unified request filter — covers three global settings at once so we only
      // enable interception (and one handler) when something actually needs it:
      //   • browser.disableVideos        → abort media (saves proxy traffic)
      //   • website.localNetworkAccess   → block LAN/loopback probing (anti-leak)
      //   • website.blockAccess          → block/allow-list of hosts
      const webRules = buildWebsiteRules(browserSettings);
      const needFilter = browserSettings.disableVideos || webRules.blockLocal || webRules.accessEnabled;
      if (needFilter) {
        await targetPage.setRequestInterception(true);
        targetPage.on('request', (req) => {
          try {
            if (browserSettings.disableVideos && req.resourceType() === 'media') return req.abort();
            let host = '';
            try { host = new URL(req.url()).hostname.toLowerCase(); } catch (e) { host = ''; }
            if (host) {
              if (webRules.blockLocal && isPrivateHost(host)) return req.abort();
              if (webRules.accessEnabled) {
                const listed = webRules.hostListed(host);
                if (webRules.accessMode === 'blocklist' && listed) return req.abort();
                if (webRules.accessMode === 'allowlist' && !listed) return req.abort();
              }
            }
            return req.continue();
          } catch (e) {
            try { req.continue(); } catch (_) {}
          }
        });
      }
    } catch (e) { /* best-effort per page — never block the launch */ }
  };

  await applyToPage(page);

  // NEW tabs/popups: the CDP auto-attach above already injects the full JS
  // fingerprint (cores/RAM/GPU/screen/WebRTC/etc.) before any page script runs in
  // every tab and iframe. This handler only adds the things that injection can't:
  // proxy auth, the UA/timezone/geo CDP overrides, request interception, DNT
  // header, captcha — applied once the tab navigates to a real page.
  browser.on('targetcreated', async (target) => {
   try {
    const targetType = target.type();
    // Service / shared / dedicated workers are SEPARATE targets with their own JS
    // realm. CreepJS et al. read navigator.hardwareConcurrency inside a worker to
    // catch a mismatch with the page. A dedicated/shared worker is already covered
    // by our worker prelude, but a SERVICE worker runs a script we can't wrap, so
    // we apply the native cores override to its target directly (best-effort).
    if (targetType === 'service_worker' || targetType === 'shared_worker' || targetType === 'worker') {
      try {
        const wcdp = await target.createCDPSession();
        if (fpConfig.cores) await wcdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores }).catch(() => {});
      } catch (e) { /* worker target may close immediately */ }
      return;
    }
    if (targetType !== 'page') return;
    try {
      const newPage = await target.page();
      if (!newPage) return;
      await applyToPage(newPage, true).catch(() => {});
      // A new tab usually starts on the internal New Tab Page (skipped above), so
      // apply once it actually navigates to a real site. Idempotent via the
      // appliedPages set, so this never double-applies. The async call is given a
      // .catch so a transient CDP error can never surface as an unhandledRejection
      // (which, in the Electron main process, would have torn down the browser).
      newPage.on('framenavigated', (frame) => {
        try { if (frame === newPage.mainFrame()) applyToPage(newPage, true).catch(() => {}); } catch (e) {}
      });
    } catch (e) { /* ignore transient targets */ }
   } catch (outer) { /* never let a new-tab/worker target tear down the session */ }
  });

  // On-startup mode: 'detection' shows the SoftGlaze IP/fingerprint start page;
  // 'blank' and 'last' skip it (no proxy-detection page) and open about:blank.
  const startupMode = browserSettings.mode || 'detection';
  let startUrl = 'about:blank';
  if (startupMode === 'detection') {
    startUrl = await generateStartPage(userDataDir, { title, profileId: profileId || 'TEMP-ID', proxyLabel, geo });
  }
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

  const sessionId = String(profileId || crypto.randomUUID());
  // The CDP/WebDriver debugging endpoint — handed to the local REST API so users
  // can attach external Playwright/Puppeteer/Selenium scripts to this container.
  let wsEndpoint = null;
  try { wsEndpoint = browser.wsEndpoint(); } catch (e) { wsEndpoint = null; }
  activeSessions.set(sessionId, {
    browser,
    page,
    userDataDir,
    wsEndpoint,
    title: title || `Profile ${sessionId}`,
    proxyLabel,
    createdAt: new Date()
  });
  browser.on('disconnected', () => activeSessions.delete(sessionId));

  return { sessionId, userDataDir, wsEndpoint };
}

// Drive an already-open session's primary page to a URL. Used by the Pro
// Cookie Warmer to accumulate cookies/history by visiting real sites. Returns
// true on a successful navigation, false otherwise — never throws (a dead tab or
// a slow site must not crash the warmer or the main process).
async function navigateSession(sessionId, url, options = {}) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) return false;
  try {
    await session.page.goto(String(url), {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: Number(options.timeout) || 30000
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Softglaze Pro — Cookie Robot / Session Warmer.
//
// Drives a profile session through a list of real sites to build organic cookies
// + history: navigate → dismiss the cookie-consent dialog → human-like scrolling
// → random dwell. Operates on an already-running session (the caller decides
// whether to launch one first, so the profile's proxy + fingerprint are reused
// exactly as a real launch). Fully best-effort — a dead tab or slow site is
// logged into `errors`, never thrown.
// ---------------------------------------------------------------------------
async function dismissCookieConsent(page) {
  // 1) Known one-click selectors (covers OneTrust / Cookiebot / common CMPs).
  const selectors = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    'button[aria-label="Accept all"]',
    'button[aria-label="Accept all cookies"]',
    '.fc-cta-consent', '.js-accept-cookies', '#accept-cookies'
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) { await el.click({ delay: 30 }).catch(() => {}); await sleep(250); return true; }
    } catch (e) { /* try the next selector */ }
  }
  // 2) Text-based fallback for buttons whose markup varies by site.
  try {
    const clicked = await page.evaluate(() => {
      const wants = ['accept all', 'accept cookies', 'i agree', 'agree', 'got it', 'allow all', 'accept'];
      const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
      for (const n of nodes) {
        const t = (n.innerText || n.textContent || n.value || '').trim().toLowerCase();
        if (t && wants.some((w) => t === w || t.startsWith(w))) { n.click(); return true; }
      }
      return false;
    });
    return Boolean(clicked);
  } catch (e) { return false; }
}

async function humanScroll(page, opts = {}) {
  const steps = Math.max(2, Math.min(12, Number(opts.steps) || 5));
  try {
    for (let i = 0; i < steps; i++) {
      const dy = 250 + Math.floor(Math.random() * 500);
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy).catch(() => {});
      await sleep(400 + Math.floor(Math.random() * 1100));
    }
    // Occasionally scroll back up a little, like a real reader.
    if (Math.random() < 0.5) {
      await page.evaluate(() => window.scrollBy({ top: -300, behavior: 'smooth' })).catch(() => {});
      await sleep(300 + Math.floor(Math.random() * 700));
    }
  } catch (e) { /* non-fatal */ }
}

async function runCookieRobot(sessionId, targetUrls = [], opts = {}) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) throw new Error('That profile is not running.');
  const urls = (Array.isArray(targetUrls) ? targetUrls : []).map((u) => String(u || '').trim()).filter(Boolean);
  if (!urls.length) throw new Error('runCookieRobot needs at least one target URL.');

  const page = session.page;
  const result = { visited: [], errors: [] };
  for (const url of urls) {
    try {
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const ok = await navigateSession(id, target, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!ok) { result.errors.push({ url, error: 'navigation failed' }); continue; }
      await sleep(700 + Math.floor(Math.random() * 1200));
      await dismissCookieConsent(page).catch(() => {});
      await humanScroll(page, opts).catch(() => {});
      await sleep(Number(opts.perUrlMs) > 0 ? Number(opts.perUrlMs) : (1500 + Math.floor(Math.random() * 3000)));
      result.visited.push(target);
    } catch (e) {
      result.errors.push({ url, error: (e && e.message) || 'failed' });
    }
  }
  return result;
}

// Click a few random visible interactive elements (links/buttons) — best-effort
// "browsing noise" for cookie warming. Never throws; stops early if the page
// navigates away. Returns the number of clicks performed.
async function randomClicks(page, count = 2) {
  const n = Math.max(1, Math.min(6, Number(count) || 2));
  let clicked = 0;
  for (let i = 0; i < n; i++) {
    try {
      const did = await page.evaluate(() => {
        const inView = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 8 && r.height > 8 && r.top >= 0 && r.top < (window.innerHeight || 800) && r.left >= 0;
        };
        const nodes = Array.from(document.querySelectorAll('a[href], button, [role="button"]')).filter(inView);
        if (!nodes.length) return false;
        const el = nodes[Math.floor(Math.random() * nodes.length)];
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      });
      if (!did) break;
      clicked += 1;
      await sleep(600 + Math.floor(Math.random() * 1400));
    } catch (e) { break; } // page likely navigated — stop clicking
  }
  return clicked;
}

// Navigate to a random same-origin link to build in-site history (skips obvious
// sign-out links). Returns true if it navigated.
async function clickRandomLink(page) {
  try {
    const href = await page.evaluate(() => {
      const origin = location.origin;
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.href)
        .filter((h) => { try { const u = new URL(h); return u.origin === origin && !/(logout|sign-?out)/i.test(h); } catch (e) { return false; } });
      if (!links.length) return null;
      return links[Math.floor(Math.random() * links.length)];
    });
    if (!href) return false;
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return true;
  } catch (e) { return false; }
}

// Post-navigation interaction for the Cookie Warmer: dismiss the consent dialog,
// human-scroll, then apply the per-site click behaviour. Operates on the
// session's live page; fully best-effort. Returns what it did.
async function warmInteract(sessionId, opts = {}) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) return { ok: false, consent: false, scrolled: false, clicked: 0 };
  const page = session.page;
  const out = { ok: true, consent: false, scrolled: false, clicked: 0 };
  try { out.consent = Boolean(await dismissCookieConsent(page).catch(() => false)); } catch (e) { /* non-fatal */ }
  if (opts.scroll !== false) { try { await humanScroll(page, opts); out.scrolled = true; } catch (e) { /* non-fatal */ } }
  const mode = String(opts.clickMode || 'none');
  try {
    if (mode === 'random') out.clicked = await randomClicks(page, opts.clicks || 2);
    else if (mode === 'links') out.clicked = (await clickRandomLink(page)) ? 1 : 0;
  } catch (e) { /* best-effort */ }
  return out;
}

// ---------------------------------------------------------------------------
// Softglaze Premium — Stealth "Human Paste" typing engine.
//
// Anti-fraud systems flag credentials that appear instantly (a paste). This
// types a string into the session's focused element ONE KEY AT A TIME via CDP
// Input.dispatchKeyEvent, with a randomized 40–150 ms gap between keys, so the
// keystroke cadence looks human. Fully best-effort: a failed key is skipped and
// it never throws into the caller.
// ---------------------------------------------------------------------------
function humanKeyProps(ch) {
  if (ch === '\n' || ch === '\r') {
    return { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' };
  }
  if (ch === '\t') return { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 };
  // For printable characters, `text` is what makes Chrome insert the glyph.
  return { key: ch, text: ch, unmodifiedText: ch };
}

async function humanType(sessionId, text, options = {}) {
  const session = activeSessions.get(String(sessionId || '').trim());
  if (!session || !session.page) return { ok: false, error: 'That profile is not running.' };
  const str = String(text == null ? '' : text);
  if (!str) return { ok: true, typed: 0 };

  const minDelay = Math.max(0, Number(options.minDelay) || 40);
  const maxDelay = Math.max(minDelay, Number(options.maxDelay) || 150);

  let cdp;
  try { cdp = await session.page.target().createCDPSession(); }
  catch (e) { return { ok: false, error: 'Could not attach to the running session.' }; }

  let typed = 0;
  try {
    for (const ch of str) {
      const props = humanKeyProps(ch);
      try {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...props });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...props });
        typed += 1;
      } catch (e) { /* skip a problematic key, keep the rhythm going */ }
      const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
      await sleep(delay);
    }
  } finally {
    try { await cdp.detach(); } catch (e) {}
  }
  return { ok: true, typed };
}

// ---------------------------------------------------------------------------
// Softglaze Premium — "Synchronizer" (multi-window mirroring) FOUNDATION.
//
// One Master profile drives N Slave profiles: input performed in the Master is
// replayed into every Slave. This is the architecture scaffold — launch +
// grouping + CDP plumbing + a basic click/keystroke mirror are wired; the
// higher-fidelity pieces (pointer-move streaming, scroll sync, coordinate
// normalization across differing viewports, and Page.captureScreenshot-based
// visual diffing) are marked TODO so the feature can be completed iteratively.
// ---------------------------------------------------------------------------
const syncGroups = new Map(); // groupId -> { masterSessionId, slaves:[{sessionId, cdp}], dispose }

async function launchSynchronizedSessions(profileIds, launchProfileById) {
  if (!Array.isArray(profileIds) || profileIds.length < 2) {
    throw new Error('Synchronize needs at least two profiles (one Master + one or more Slaves).');
  }
  if (typeof launchProfileById !== 'function') {
    throw new Error('Synchronizer launch dependency was not provided.');
  }
  const [masterId, ...slaveIds] = profileIds;

  // Master first so it is the focused/front window the operator drives.
  const master = await launchProfileById(masterId);
  const slaves = [];
  for (const sid of slaveIds) {
    try { slaves.push({ profileId: sid, ...(await launchProfileById(sid)) }); }
    catch (e) { /* one slave failing must not abort the whole group */ }
  }

  const groupId = `sync-${master.sessionId}`;
  const group = await beginSyncGroup(master.sessionId, slaves.map((s) => s.sessionId)).catch(() => null);

  return {
    groupId,
    master: { profileId: masterId, sessionId: master.sessionId },
    slaves: slaves.map((s) => ({ profileId: s.profileId, sessionId: s.sessionId })),
    mirroring: Boolean(group)
  };
}

// Attach CDP to each Slave and inject a capture binding into the Master that
// forwards discrete input events to be replayed. Returns the group handle.
async function beginSyncGroup(masterSessionId, slaveSessionIds) {
  const masterSession = activeSessions.get(String(masterSessionId));
  if (!masterSession || !masterSession.page) throw new Error('Master session is not running.');

  // Open a persistent CDP session per Slave so we can dispatch input into each.
  const slaves = [];
  for (const sid of slaveSessionIds) {
    const s = activeSessions.get(String(sid));
    if (!s || !s.page) continue;
    try {
      const cdp = await s.page.target().createCDPSession();
      slaves.push({ sessionId: String(sid), cdp });
    } catch (e) { /* skip slaves we can't attach to */ }
  }

  // Replay a captured Master event into every Slave (best-effort per slave).
  const mirror = async (evt) => {
    if (!evt || typeof evt !== 'object') return;
    for (const slave of slaves) {
      try {
        if (evt.k === 'click') {
          // TODO(foundation): normalize x/y across differing Slave viewports &
          // scroll offsets. For now we replay raw client coordinates 1:1.
          await slave.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: evt.x, y: evt.y, button: evt.button === 2 ? 'right' : 'left', clickCount: 1 });
          await slave.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: evt.x, y: evt.y, button: evt.button === 2 ? 'right' : 'left', clickCount: 1 });
        } else if (evt.k === 'key') {
          const props = humanKeyProps(evt.text || evt.key || '');
          await slave.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...props });
          await slave.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...props });
        }
        // TODO(foundation): handle 'mousemove' (throttled streaming) and 'scroll'.
      } catch (e) { /* a slave may have navigated/closed — ignore and continue */ }
    }
  };

  // Bind a node-side receiver into the Master page, then add capturing listeners
  // at document_start so every navigation re-installs them.
  const BINDING = '__sgSyncDispatch';
  try {
    await masterSession.page.exposeFunction(BINDING, (evt) => { mirror(evt).catch(() => {}); }).catch(() => {});
    await masterSession.page.evaluateOnNewDocument((bindingName) => {
      try {
        const post = (payload) => { try { if (typeof window[bindingName] === 'function') window[bindingName](payload); } catch (e) {} };
        document.addEventListener('click', (e) => post({ k: 'click', x: Math.round(e.clientX), y: Math.round(e.clientY), button: e.button }), true);
        document.addEventListener('keydown', (e) => post({ k: 'key', key: e.key, code: e.code, keyCode: e.keyCode, text: e.key && e.key.length === 1 ? e.key : '' }), true);
        // TODO(foundation): capture 'mousemove' (throttled) and 'scroll' here too.
      } catch (e) {}
    }, BINDING).catch(() => {});
    // Apply to the already-open document as well (the init script only covers
    // future navigations).
    await masterSession.page.evaluate((bindingName) => {
      try {
        const post = (payload) => { try { if (typeof window[bindingName] === 'function') window[bindingName](payload); } catch (e) {} };
        document.addEventListener('click', (e) => post({ k: 'click', x: Math.round(e.clientX), y: Math.round(e.clientY), button: e.button }), true);
        document.addEventListener('keydown', (e) => post({ k: 'key', key: e.key, code: e.code, keyCode: e.keyCode, text: e.key && e.key.length === 1 ? e.key : '' }), true);
      } catch (e) {}
    }, BINDING).catch(() => {});
  } catch (e) { /* mirroring is best-effort; the windows still launch */ }

  const dispose = async () => {
    for (const slave of slaves) { try { await slave.cdp.detach(); } catch (e) {} }
  };
  const group = { masterSessionId: String(masterSessionId), slaves, dispose };
  syncGroups.set(group.masterSessionId, group);

  // Auto-clean the group when the Master disconnects.
  try { masterSession.browser.on('disconnected', () => { dispose().catch(() => {}); syncGroups.delete(group.masterSessionId); }); } catch (e) {}
  return group;
}

function stopSyncGroup(masterSessionId) {
  const group = syncGroups.get(String(masterSessionId));
  if (!group) return { stopped: false };
  group.dispose().catch(() => {});
  syncGroups.delete(String(masterSessionId));
  return { stopped: true };
}

async function closeProfileSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session) return { closed: false };
  try { await session.browser.close(); } catch (e) {}
  activeSessions.delete(id);
  return { closed: true };
}

async function closeAllProfileSessions() {
  for (const session of activeSessions.values()) {
    try { await session.browser.close(); } catch (e) {}
  }
  activeSessions.clear();
}

function formatUptime(createdAt) {
  const totalSec = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// --- Cookie I/O over CDP (decrypted, browser-wide) for the live session ---
// Returns an array of cookie objects, or null when the profile isn't running.
// Reads REAL environment values from the running session's page: navigator,
// timezone, screen, a WebRTC ICE-candidate IP probe, and the page-visible exit
// IP (fetched in-page so it routes through the profile's proxy).
// Returns { env, webrtcIps, exit } or null when the profile isn't running.
async function liveLeakTest(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) return null;
  const page = session.page;

  const env = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    languages: navigator.languages,
    platform: navigator.platform,
    vendor: navigator.vendor,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: { width: screen.width, height: screen.height },
    doNotTrack: navigator.doNotTrack
  })).catch(() => ({}));

  const webrtcIps = await page.evaluate(() => new Promise((resolve) => {
    const ips = new Set();
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    } catch (e) { resolve([]); return; }
    pc.createDataChannel('probe');
    pc.onicecandidate = (e) => {
      if (!e || !e.candidate || !e.candidate.candidate) return;
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})|([a-fA-F0-9]{1,4}(?::[a-fA-F0-9]{1,4}){7})/.exec(e.candidate.candidate);
      if (m && m[0]) ips.add(m[0]);
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
    setTimeout(() => { try { pc.close(); } catch (e) {} resolve([...ips]); }, 2500);
  })).catch(() => []);

  let exit = null;
  try {
    exit = await page.evaluate(async () => {
      const r = await fetch('https://ipinfo.io/json', { cache: 'no-store' });
      return r.json();
    });
  } catch (e) { exit = null; }

  return { env, webrtcIps, exit };
}

// Resolve a CURRENTLY-OPEN page target for a session. The stored session.page
// can become stale (the user navigated cross-origin or closed that tab), which
// makes createCDPSession fail with "Target.attachToTarget: No target with given
// id found". Always pick a live page from the browser instead.
async function sessionCdpSession(session) {
  let target = null;
  try {
    const pages = await session.browser.pages();
    const live = pages.find((p) => { try { return !p.isClosed(); } catch (e) { return true; } });
    target = (live || session.page).target();
  } catch (e) {
    target = session.page && session.page.target();
  }
  if (!target) throw new Error('No live browser target for this session.');
  return target.createCDPSession();
}

async function exportSessionCookies(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.browser) return null;
  const client = await sessionCdpSession(session);
  try {
    const { cookies } = await client.send('Network.getAllCookies');
    return Array.isArray(cookies) ? cookies : [];
  } finally {
    await client.detach().catch(() => {});
  }
}

// Injects cookie params (CDP CookieParam shape) into the running session's
// browser-wide store. Returns { imported } or null when the profile isn't running.
async function importSessionCookies(sessionId, cookies) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.browser) return null;
  if (!Array.isArray(cookies) || cookies.length === 0) return { imported: 0 };
  const client = await sessionCdpSession(session);
  try {
    await client.send('Network.setCookies', { cookies });
    return { imported: cookies.length };
  } finally {
    await client.detach().catch(() => {});
  }
}

// Read/write a profile's persisted cookies WITHOUT a visible session, by briefly
// opening its userDataDir headless. This is what lets users export/import cookies
// for a profile that isn't currently launched. The caller must ensure the profile
// is not already running (a second open on the same userDataDir would conflict).
async function withOfflineProfile(opts, fn) {
  const { userDataDir, executablePath } = opts || {};
  if (!userDataDir) throw new Error('No data directory for this profile.');
  const args = ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--disable-extensions'];
  const launchOptions = { headless: true, userDataDir, args };
  if (executablePath) launchOptions.executablePath = executablePath;
  const browser = await puppeteer.launch(launchOptions);
  browser.removeAllListeners('targetcreated'); // no stealth auto-inject flood here either
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    const client = await page.target().createCDPSession();
    try { return await fn(client); }
    finally { await client.detach().catch(() => {}); }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function exportStoredCookies(opts) {
  return withOfflineProfile(opts, async (client) => {
    const { cookies } = await client.send('Network.getAllCookies');
    return Array.isArray(cookies) ? cookies : [];
  });
}

async function importStoredCookies(opts, cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return { imported: 0 };
  return withOfflineProfile(opts, async (client) => {
    await client.send('Network.setCookies', { cookies });
    return { imported: cookies.length };
  });
}

// ---------------------------------------------------------------------------
// Softglaze Pro — Macro engine (runner + visual recorder).
//
// Canonical step shape (serialized into Macro.stepsJson):
//   { type: 'goto',    url }
//   { type: 'click',   selector }
//   { type: 'type',    selector, value }
//   { type: 'keypress', key }            // e.g. 'Enter'
//   { type: 'scroll',  steps? }
//   { type: 'wait',    ms }
//
// The runner replays steps against an already-open session's primary page (so the
// profile's proxy + fingerprint are reused exactly). The recorder attaches DOM
// listeners to the live page and serializes interactions into the SAME shape, so
// recorded macros round-trip straight back through the runner. Best-effort:
// selectors are derived heuristically and SPA in-app navigations may not capture
// as discrete 'goto' steps — documented, never silently wrong.
// ---------------------------------------------------------------------------
const VALID_MACRO_STEPS = new Set(['goto', 'click', 'type', 'keypress', 'scroll', 'wait']);

// Center point of an element in viewport coordinates (null if not found/visible).
async function elementCenter(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Run a macro's steps in a live session. opts:
//   continueOnError — keep going past a failed step.
//   control { paused, aborted } — external flags for pause/resume/stop (mutated by
//     the caller), checked between steps so a long run is interruptible.
//   onStep(event) — progress callback: { index, total, type, status, step?, error? }.
// Backward-compatible: callers that pass neither control nor onStep behave as before.
async function runMacro(sessionId, steps, opts = {}) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) throw new Error('No active session for that profile — launch it first.');
  const page = session.page;
  const list = Array.isArray(steps) ? steps : [];
  const log = [];

  const control = opts.control || null;
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;
  const isAborted = () => Boolean(control && control.aborted);
  const waitWhilePaused = async () => { while (control && control.paused && !control.aborted) await sleep(150); };

  for (let i = 0; i < list.length; i += 1) {
    if (isAborted()) break;
    await waitWhilePaused();
    if (isAborted()) break;

    const step = list[i] || {};
    const type = String(step.type || '').toLowerCase();
    if (onStep) onStep({ index: i, total: list.length, type, status: 'running', step });
    try {
      switch (type) {
        case 'goto':
          await page.goto(String(step.url || step.value || 'about:blank'), {
            waitUntil: 'domcontentloaded',
            timeout: Number(step.timeout) || 30000
          });
          break;
        case 'click':
          if (!step.selector) throw new Error('click step requires a selector');
          await page.waitForSelector(step.selector, { timeout: Number(step.timeout) || 15000 });
          { const c = await elementCenter(page, step.selector); if (c) await page.mouse.move(c.x, c.y, { steps: 10 }); }
          await page.click(step.selector, { delay: 30 });
          break;
        case 'type':
          if (!step.selector) throw new Error('type step requires a selector');
          await page.waitForSelector(step.selector, { timeout: Number(step.timeout) || 15000 });
          await page.type(step.selector, String(step.value == null ? '' : step.value), { delay: 40 });
          break;
        case 'keypress':
          await page.keyboard.press(String(step.key || 'Enter'));
          break;
        case 'scroll':
          await humanScroll(page, { steps: Number(step.steps) || 4 });
          break;
        case 'wait':
          await sleep(Math.max(0, Math.min(60000, Number(step.ms) || 1000)));
          break;
        case 'move': {
          let pt = null;
          if (step.selector) { await page.waitForSelector(step.selector, { timeout: Number(step.timeout) || 15000 }).catch(() => {}); pt = await elementCenter(page, step.selector); }
          else if (step.x != null && step.y != null) pt = { x: Number(step.x), y: Number(step.y) };
          if (!pt) throw new Error('move step needs a valid selector or x/y');
          await page.mouse.move(pt.x, pt.y, { steps: 12 });
          break;
        }
        case 'hover': {
          if (!step.selector) throw new Error('hover step requires a selector');
          await page.waitForSelector(step.selector, { timeout: Number(step.timeout) || 15000 });
          const pt = await elementCenter(page, step.selector);
          if (!pt) throw new Error('hover target is not visible');
          await page.mouse.move(pt.x, pt.y, { steps: 12 });
          await sleep(Math.max(0, Math.min(60000, Number(step.ms) || 800)));
          break;
        }
        default:
          throw new Error(`Unknown step type: ${type || '(empty)'}`);
      }
      log.push({ index: i, type, ok: true });
      if (onStep) onStep({ index: i, total: list.length, type, status: 'ok' });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      log.push({ index: i, type, ok: false, error: msg });
      if (onStep) onStep({ index: i, total: list.length, type, status: 'error', error: msg });
      if (!opts.continueOnError) break;
    }
  }

  return { ok: log.length > 0 && log.every((l) => l.ok), total: list.length, ran: log.length, log, aborted: isAborted() };
}

// Per-session recorder state. The exposed page->node bridge looks up the current
// recorder by sessionId at call time, so re-recording cleanly re-routes.
const macroRecorders = new Map(); // sessionId -> { steps, stopped, page, navHandler }

// Injected into the page: derive a stable-ish CSS selector and forward click /
// input / Enter events to the node bridge. Self-contained (no closure refs) so it
// survives .toString() serialization.
function macroRecorderClientScript() {
  if (window.__sgzRecording) return;
  window.__sgzRecording = true;
  function cssPath(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let sel = node.nodeName.toLowerCase();
      // Prefer a stable attribute over a positional :nth-of-type when present —
      // far more robust to replay than "div > div:nth-of-type(3) > a".
      let stable = '';
      for (const attr of ['data-testid', 'name', 'aria-label', 'placeholder']) {
        const v = node.getAttribute && node.getAttribute(attr);
        if (v) { stable = sel + '[' + attr + '="' + CSS.escape(v) + '"]'; break; }
      }
      if (stable) { parts.unshift(stable); node = node.parentNode; continue; }
      const parent = node.parentNode;
      if (parent && parent.children) {
        const sibs = Array.prototype.filter.call(parent.children, (c) => c.nodeName === node.nodeName);
        if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(' > ');
  }
  document.addEventListener('click', (e) => {
    try {
      // A click on a link (or inside one) is most reliably replayed as a
      // navigation: capture the resolved href as a 'goto'. A target="_blank" link
      // would otherwise open a NEW tab that the runner (which drives the primary
      // tab) never follows — the exact reason recorded link-clicks did nothing.
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && a.href && /^https?:/i.test(a.href)) {
        if (window.__sgzRecordStep) window.__sgzRecordStep({ type: 'goto', url: a.href });
        return;
      }
      const sel = cssPath(e.target);
      if (sel && window.__sgzRecordStep) window.__sgzRecordStep({ type: 'click', selector: sel });
    } catch (err) { /* ignore */ }
  }, true);
  document.addEventListener('change', (e) => {
    try {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        const sel = cssPath(t);
        if (sel && window.__sgzRecordStep) window.__sgzRecordStep({ type: 'type', selector: sel, value: String(t.value || '') });
      }
    } catch (err) { /* ignore */ }
  }, true);
  document.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Enter' && window.__sgzRecordStep) window.__sgzRecordStep({ type: 'keypress', key: 'Enter' });
    } catch (err) { /* ignore */ }
  }, true);
}

async function startMacroRecording(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) throw new Error('No active session for that profile — launch it first.');
  const existing = macroRecorders.get(id);
  if (existing && !existing.stopped) return { recording: true, already: true };

  const page = session.page;
  const rec = { steps: [], stopped: false, page };
  macroRecorders.set(id, rec);

  // Bridge page -> node. exposeFunction persists on the page; if it's already
  // installed (a prior recording on this page), the throw is benign — the bound
  // callback always resolves the CURRENT recorder via macroRecorders.get(id).
  try {
    await page.exposeFunction('__sgzRecordStep', (step) => {
      const cur = macroRecorders.get(id);
      if (cur && !cur.stopped && step && step.type) cur.steps.push(step);
    });
  } catch (e) { /* already exposed on this page */ }

  const client = `(${macroRecorderClientScript.toString()})()`;
  await page.evaluateOnNewDocument(client).catch(() => {});
  await page.evaluate(client).catch(() => {});

  // Capture top-frame navigations as 'goto' steps (deduped, skipping about:blank).
  const navHandler = (frame) => {
    try {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (!url || url === 'about:blank') return;
      const last = rec.steps[rec.steps.length - 1];
      if (last && last.type === 'goto' && last.url === url) return;
      if (!rec.stopped) rec.steps.push({ type: 'goto', url });
    } catch (err) { /* ignore */ }
  };
  page.on('framenavigated', navHandler);
  rec.navHandler = navHandler;
  return { recording: true };
}

async function stopMacroRecording(sessionId) {
  const id = String(sessionId || '').trim();
  const rec = macroRecorders.get(id);
  if (!rec) return { recording: false, steps: [] };
  rec.stopped = true;
  try { if (rec.navHandler && rec.page) rec.page.off('framenavigated', rec.navHandler); } catch (e) { /* ignore */ }
  try { await rec.page.evaluate(() => { window.__sgzRecording = false; }); } catch (e) { /* page may be gone */ }
  return { recording: false, steps: rec.steps };
}

function listActiveSessions() {
  return Array.from(activeSessions.entries()).map(([sessionId, session]) => ({
    id: sessionId,
    sessionId,
    profileName: session.title,
    ip: session.proxyLabel,
    uptime: formatUptime(session.createdAt),
    userDataDir: session.userDataDir,
    createdAt: session.createdAt.toISOString()
  }));
}

module.exports = {
  DEFAULT_PROFILE_ROOT,
  parseProxyInput,
  launchProfileSession,
  closeProfileSession,
  closeAllProfileSessions,
  listActiveSessions,
  navigateSession,
  runCookieRobot,
  warmInteract,
  runMacro,
  startMacroRecording,
  stopMacroRecording,
  humanType,
  launchSynchronizedSessions,
  stopSyncGroup,
  exportSessionCookies,
  importSessionCookies,
  liveLeakTest,
  exportStoredCookies,
  importStoredCookies,
  listAvailableBrowsers,
  resolveBrowserExecutable,
  // Debug hook (used by test harnesses) — returns the live puppeteer Browser.
  __browserFor: (sessionId) => {
    const s = activeSessions.get(String(sessionId));
    return s ? s.browser : null;
  }
};