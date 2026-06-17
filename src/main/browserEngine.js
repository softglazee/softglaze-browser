'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs'); // Added for synchronous PID tracking
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable the stealth plugin for anti-detect capabilities
puppeteer.use(StealthPlugin());

const DEFAULT_PROFILE_ROOT = path.resolve(process.cwd(), 'softglaze_profiles');
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 720 };
const GEO_LOOKUP_TIMEOUT_MS = 8000;
const activeSessions = new Map();

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

function buildUserAgentBundle(profile, realMajor, seed) {
  const os = osTokens(profile.os);
  const major = toInt(profile.browserVersion, realMajor) || realMajor;
  const explicit = String(profile.userAgent || '').trim();
  const userAgent = explicit && /mozilla/i.test(explicit)
    ? explicit
    : `Mozilla/5.0 (${os.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

  const brands = [
    { brand: 'Chromium', version: String(major) },
    { brand: 'Google Chrome', version: String(major) },
    { brand: 'Not_A Brand', version: '24' }
  ];

  const userAgentMetadata = {
    brands,
    fullVersionList: brands.map((b) => ({ brand: b.brand, version: `${major}.0.0.0` })),
    platform: os.chPlatform,
    platformVersion: os.chVersion,
    architecture: 'x86',
    bitness: '64',
    model: '',
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
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (e) {}

  const define = (obj, prop, value) => {
    try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e) {}
  };

  if (fp.langs && fp.langs.length) {
    define(navigator, 'languages', Object.freeze(fp.langs.slice()));
    define(navigator, 'language', fp.langs[0]);
  }
  if (fp.navPlatform) define(navigator, 'platform', fp.navPlatform);
  if (fp.cores) define(navigator, 'hardwareConcurrency', fp.cores);
  if (fp.mem) define(navigator, 'deviceMemory', fp.mem);

  if (fp.screenW && fp.screenH) {
    define(screen, 'width', fp.screenW);
    define(screen, 'height', fp.screenH);
    define(screen, 'availWidth', fp.screenW);
    define(screen, 'availHeight', fp.screenH);
  }

  let s = fp.seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  if (fp.noise.canvas) {
    const perturb = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 0) data[i] = (data[i] + (Math.floor(rnd() * 3) - 1)) & 0xFF;
      }
    };
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      const img = origGetImageData.apply(this, arguments);
      perturb(img.data);
      return img;
    };
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      try {
        const ctx = this.getContext('2d');
        if (ctx && this.width && this.height) {
          const img = origGetImageData.call(ctx, 0, 0, this.width, this.height);
          perturb(img.data);
          ctx.putImageData(img, 0, 0);
        }
      } catch (e) {}
      return origToDataURL.apply(this, arguments);
    };
  }

  const patchGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = function (pname) {
      if (fp.webglVendor && pname === 37445) return fp.webglVendor;
      if (fp.webglRenderer && pname === 37446) return fp.webglRenderer;
      return orig.apply(this, arguments);
    };
  };
  if (fp.noise.webgl) {
    patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  }

  if (fp.noise.audio && window.AudioBuffer) {
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function () {
      const buf = origGetChannelData.apply(this, arguments);
      const limit = Math.min(buf.length, 600);
      for (let i = 0; i < limit; i += 1) buf[i] = buf[i] + (rnd() - 0.5) * 1e-7;
      return buf;
    };
  }

  if (fp.noise.clientRects) {
    const jitter = () => (rnd() - 0.5) * 0.02;
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const r = origRect.apply(this, arguments);
      try { return new DOMRect(r.x + jitter(), r.y + jitter(), r.width + jitter(), r.height + jitter()); } catch (e) { return r; }
    };
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

  const backgroundJs = `
    var config = {
        mode: "fixed_servers",
        rules: {
          singleProxy: { scheme: "${scheme}", host: "${proxy.host}", port: parseInt(${proxy.port}) },
          bypassList: ["localhost", "127.0.0.1"]
        }
      };
    chrome.proxy.settings.set({ value: config, scope: "regular" }, function () {});
    function callbackFn(details) {
        return { authCredentials: { username: "${proxy.username}", password: "${proxy.password}" } };
    }
    chrome.webRequest.onAuthRequired.addListener(callbackFn, { urls: ["<all_urls>"] }, ['blocking']);
  `;

  await fs.writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(extensionDir, 'background.js'), backgroundJs);
  return extensionDir;
}

// ---------------------------------------------------------------------------
// Start page
// ---------------------------------------------------------------------------
async function generateStartPage(userDataDir, profileData) {
  const startPagePath = path.join(userDataDir, 'start.html');
  const now = new Date().toLocaleString();
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>SoftGlaze Start Page</title>
<style>
body{background:#f3f5f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0;padding:40px;color:#333}
.container{max-width:1000px;margin:0 auto}
.ip-card{background:linear-gradient(135deg,#1e3c72,#2a5298);color:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,.1);margin-bottom:20px;text-align:center}
.ip-card h1{font-size:48px;margin:0 0 10px;letter-spacing:2px}.ip-card p{font-size:18px;margin:0;opacity:.9}
.nav-links{display:flex;gap:15px;margin-bottom:30px}
.nav-links a{background:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;color:#333;font-weight:bold;border:1px solid #e2e8f0;box-shadow:0 2px 4px rgba(0,0,0,.05)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.card{background:#fff;border-radius:12px;padding:25px;box-shadow:0 2px 10px rgba(0,0,0,.05)}
.card h3{margin-top:0;border-bottom:1px solid #edf2f7;padding-bottom:15px;font-size:16px;color:#2d3748}
.row{display:flex;padding:12px 0;border-bottom:1px dashed #edf2f7}.row:last-child{border-bottom:none}
.label{width:140px;color:#718096;font-size:14px}.value{flex:1;font-size:14px;color:#1a202c;font-weight:500;word-break:break-all}
</style></head><body><div class="container">
<div class="ip-card"><h1 id="ip">Checking IP...</h1><p id="loc">Connecting to network...</p></div>
<div class="nav-links">
<a href="https://browserscan.net" target="_blank">BrowserScan</a>
<a href="https://browserleaks.com" target="_blank">BrowserLeaks</a>
<a href="https://whoer.net" target="_blank">Whoer.net</a></div>
<div class="grid">
<div class="card"><h3>Account Information</h3>
<div class="row"><div class="label">Name</div><div class="value">${profileData.title}</div></div>
<div class="row"><div class="label">Startup time</div><div class="value">${now}</div></div>
<div class="row"><div class="label">Profile ID</div><div class="value">${profileData.profileId}</div></div>
<div class="row"><div class="label">Proxy</div><div class="value">${profileData.proxyLabel}</div></div></div>
<div class="card"><h3>Fingerprint Information</h3>
<div class="row"><div class="label">User Agent</div><div class="value" id="ua">Loading...</div></div>
<div class="row"><div class="label">Platform</div><div class="value" id="pf">Loading...</div></div>
<div class="row"><div class="label">Languages</div><div class="value" id="lg">Loading...</div></div>
<div class="row"><div class="label">Timezone</div><div class="value" id="tz">Loading...</div></div></div></div></div>
<script>
document.getElementById('ua').innerText=navigator.userAgent;
document.getElementById('pf').innerText=navigator.platform;
document.getElementById('lg').innerText=(navigator.languages||[]).join(', ');
document.getElementById('tz').innerText=Intl.DateTimeFormat().resolvedOptions().timeZone;
fetch('http://ip-api.com/json').then(r=>r.json()).then(d=>{
document.getElementById('ip').innerText=d.query;
document.getElementById('loc').innerText=d.country+' / '+d.regionName+' / '+d.city;
}).catch(()=>{document.getElementById('ip').innerText='IP Load Failed';document.getElementById('loc').innerText='Check Proxy Connection';});
</script></body></html>`;
  await fs.writeFile(startPagePath, html);
  return `file://${startPagePath}`;
}

// ---------------------------------------------------------------------------
// Geo lookup through the active proxy (runs inside the page so it routes via
// the proxy). Returns { countryCode, timezone, lat, lon } or null.
// ---------------------------------------------------------------------------
async function lookupProxyGeo(page) {
  const evaluation = page.evaluate(async () => {
    try {
      const res = await fetch('http://ip-api.com/json/?fields=status,countryCode,timezone,lat,lon,query', { cache: 'no-store' });
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
// Launch
// ---------------------------------------------------------------------------
async function launchProfileSession(options = {}) {
  const {
    profileId,
    title,
    dataDirName,
    profileRoot = DEFAULT_PROFILE_ROOT,
    headless = false,
    profile = {}
  } = options;

  const resolvedProxy = parseProxyInput(options.proxy || options.proxyInfoString);
  const proxyLabel = resolvedProxy ? `${resolvedProxy.type} ${resolvedProxy.host}:${resolvedProxy.port}` : 'Direct (No Proxy)';

  const safeDirName = sanitizeDataDirName(dataDirName || title || `profile-${profileId || crypto.randomUUID()}`);
  const root = path.resolve(profileRoot);
  const userDataDir = resolveInside(root, safeDirName);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });

  const seed = seedFromString(safeDirName);

  const resW = profile.resolutionType && profile.resolutionType !== 'Real' ? toInt(profile.resolutionW, 1920) : 1920;
  const resH = profile.resolutionType && profile.resolutionType !== 'Real' ? toInt(profile.resolutionH, 1080) : 1080;
  const winW = toInt(profile.resolutionW, DEFAULT_WINDOW_SIZE.width);
  const winH = toInt(profile.resolutionH, DEFAULT_WINDOW_SIZE.height);

  const webrtcMode = profile.webrtc || 'Forward';

  const args = [
    `--window-size=${winW},${winH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled'
  ];

  if (resolvedProxy && webrtcMode !== 'Real') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }

  const extensionDir = await createProxyAuthExtension(userDataDir, resolvedProxy);
  if (extensionDir) {
    args.push(`--disable-extensions-except=${extensionDir}`);
    args.push(`--load-extension=${extensionDir}`);
  } else if (resolvedProxy) {
    const proxyServer = buildProxyServerArgument(resolvedProxy);
    if (proxyServer) args.push(`--proxy-server=${proxyServer}`);
  }

  const browser = await puppeteer.launch({ headless, userDataDir, defaultViewport: null, args });
  
  // Track PID to prevent orphaned processes
  const browserProcess = browser.process();
  if (browserProcess) {
    const pid = browserProcess.pid;
    trackPid(pid);
    browser.on('disconnected', () => {
      untrackPid(pid);
    });
  }

  const versionMatch = (await browser.version()).match(/\/(\d+)\./);
  const realMajor = Number.parseInt(versionMatch ? versionMatch[1] : '125', 10);

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  const client = await page.target().createCDPSession();

  const manualTz = profile.timezoneType === 'Custom' && profile.timezoneCustom ? String(profile.timezoneCustom).trim() : null;
  const manualLat = profile.locationType === 'Custom' ? Number.parseFloat(profile.locationLat) : NaN;
  const manualLng = profile.locationType === 'Custom' ? Number.parseFloat(profile.locationLng) : NaN;
  const manualLang = profile.languageType === 'Custom' && profile.languageCustom ? String(profile.languageCustom).trim() : null;

  const wantAuto =
    resolvedProxy &&
    profile.timezoneType !== 'Real' &&
    (!manualTz || !Number.isFinite(manualLat) || !Number.isFinite(manualLng) || !manualLang);

  let geo = null;
  if (wantAuto) geo = await lookupProxyGeo(page);

  const timezoneId = manualTz || (geo && geo.timezone) || null;
  const geoLat = Number.isFinite(manualLat) ? manualLat : (geo && Number.isFinite(geo.lat) ? geo.lat : null);
  const geoLng = Number.isFinite(manualLng) ? manualLng : (geo && Number.isFinite(geo.lon) ? geo.lon : null);

  const locale = manualLang
    ? manualLang.split(',')[0].trim()
    : (geo && COUNTRY_LOCALE[geo.countryCode]) || 'en-US';
  const acceptLanguage = manualLang ? manualLang : localeToAcceptLanguage(locale);
  const langs = manualLang
    ? manualLang.split(',').map((l) => l.split(';')[0].trim()).filter(Boolean)
    : Array.from(new Set([locale, locale.split('-')[0], 'en']));

  const ua = buildUserAgentBundle(profile, realMajor, seed);
  await client.send('Emulation.setUserAgentOverride', {
    userAgent: ua.userAgent,
    acceptLanguage,
    platform: ua.navPlatform,
    userAgentMetadata: ua.userAgentMetadata
  }).catch(() => {});

  if (timezoneId) {
    await client.send('Emulation.setTimezoneOverride', { timezoneId }).catch(() => {});
  }

  if (geoLat !== null && geoLng !== null) {
    await client.send('Browser.grantPermissions', { permissions: ['geolocation'] }).catch(() => {});
    await client.send('Emulation.setGeolocationOverride', {
      latitude: geoLat,
      longitude: geoLng,
      accuracy: toInt(profile.locationAcc, 100)
    }).catch(() => {});
  }

  const webglVendor = profile.webglVendor || pick(['Google Inc. (NVIDIA)', 'Google Inc. (Intel)', 'Google Inc. (AMD)'], seed);
  const webglRenderer = profile.webglRenderer || pick([
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)'
  ], seed >> 3);

  const fpConfig = {
    seed,
    langs,
    navPlatform: ua.navPlatform,
    cores: toInt(profile.cpuCores, pick([4, 8, 12, 16], seed)),
    mem: toInt(profile.ramGb, pick([4, 8, 16, 32], seed >> 2)),
    screenW: resW,
    screenH: resH,
    webglVendor,
    webglRenderer,
    webrtcMode,
    noise: {
      canvas: profile.canvasNoise !== false,
      webgl: profile.webglImageNoise !== false,
      audio: profile.audioContextNoise !== false,
      clientRects: profile.clientRectsNoise !== false
    }
  };

  await page.evaluateOnNewDocument(fingerprintScript, fpConfig);

  const startUrl = await generateStartPage(userDataDir, { title, profileId: profileId || 'TEMP-ID', proxyLabel });
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

  const sessionId = String(profileId || crypto.randomUUID());
  activeSessions.set(sessionId, {
    browser,
    page,
    userDataDir,
    title: title || `Profile ${sessionId}`,
    proxyLabel,
    createdAt: new Date()
  });
  browser.on('disconnected', () => activeSessions.delete(sessionId));

  return { sessionId, userDataDir };
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

async function exportSessionCookies(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) return null;
  const client = await session.page.target().createCDPSession();
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
  if (!session || !session.page) return null;
  if (!Array.isArray(cookies) || cookies.length === 0) return { imported: 0 };
  const client = await session.page.target().createCDPSession();
  try {
    await client.send('Network.setCookies', { cookies });
    return { imported: cookies.length };
  } finally {
    await client.detach().catch(() => {});
  }
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
  exportSessionCookies,
  importSessionCookies,
  liveLeakTest
};