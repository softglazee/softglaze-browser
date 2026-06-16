'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer');

const DEFAULT_PROFILE_ROOT = path.resolve(process.cwd(), 'softglaze_profiles');
const SUPPORTED_PROXY_TYPES = new Set(['HTTP', 'HTTPS', 'SOCKS5']);
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 720 };
const activeSessions = new Map();

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
}

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
  
  let working = raw.replace(/^(http|https|socks5|socks):\/\//i, '');
  let parts = working.split(':');
  
  if (parts.length >= 4) {
    return { type: 'HTTP', host: parts[0].trim(), port: Number.parseInt(parts[1].trim(), 10), username: parts[2].trim(), password: parts[3].trim() };
  } else if (parts.length === 2) {
    return { type: 'HTTP', host: parts[0].trim(), port: Number.parseInt(parts[1].trim(), 10), username: null, password: null };
  }
  throw new Error('Invalid proxy connection string format.');
}

function buildProxyServerArgument(proxy) {
  if (!proxy) return null;
  const protocol = proxy.type.toLowerCase() === 'socks5' ? 'socks5' : 'http';
  return `${protocol}://${proxy.host}:${proxy.port}`;
}

// ==========================================
// ANTI-DETECT & FINGERPRINTING
// ==========================================
async function applyAntiDetectMasks(page, profileSeed) {
  let hash = 0;
  for (let i = 0; i < profileSeed.length; i++) { hash = profileSeed.charCodeAt(i) + ((hash << 5) - hash); }
  const numericSeed = Math.abs(hash);

  await page.evaluateOnNewDocument((seed) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    const coreOptions = [4, 8, 12, 16];
    const ramOptions = [4, 8, 16, 32];
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => coreOptions[seed % coreOptions.length] });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ramOptions[(seed >> 2) % ramOptions.length] });

    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      const imgData = originalGetImageData.apply(this, arguments);
      for (let i = 0; i < imgData.data.length; i += 4) {
        if (imgData.data[i] > 0) imgData.data[i] = (imgData.data[i] + (seed % 3) - 1) & 0xFF;
      }
      return imgData;
    };

    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (pname) {
      if (pname === 0x9245) return "Google Inc. (NVIDIA)";
      if (pname === 0x9246) return `NVIDIA GeForce RTX 40${70 + (seed % 3)}0 Laptop GPU`;
      return originalGetParameter.apply(this, arguments);
    };

    const originalGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function () {
      const buffer = originalGetChannelData.apply(this, arguments);
      for (let i = 0; i < Math.min(buffer.length, 15); i++) { buffer[i] += (seed % 99) * 0.00000001; }
      return buffer;
    };
  }, numericSeed);
}

// ==========================================
// BULLETPROOF PROXY EXTENSION GENERATOR
// ==========================================
async function createProxyAuthExtension(userDataDir, proxy) {
  if (!proxy || !proxy.username || !proxy.password) return null;
  const extensionDir = path.join(userDataDir, 'proxy-auth-extension');
  await fs.mkdir(extensionDir, { recursive: true });

  const manifest = {
    version: "1.0.0",
    manifest_version: 2,
    name: "SoftGlaze Proxy Auth",
    permissions: ["proxy", "tabs", "unlimitedStorage", "storage", "<all_urls>", "webRequest", "webRequestBlocking"],
    background: { scripts: ["background.js"] },
    minimum_chrome_version: "22.0.0"
  };

  const backgroundJs = `
    var config = {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: "${proxy.type.toLowerCase() === 'socks5' ? 'socks5' : 'http'}",
            host: "${proxy.host}",
            port: parseInt(${proxy.port})
          },
          bypassList: ["localhost", "127.0.0.1"]
        }
      };
    chrome.proxy.settings.set({value: config, scope: "regular"}, function() {});
    function callbackFn(details) {
        return {
            authCredentials: {
                username: "${proxy.username}",
                password: "${proxy.password}"
            }
        };
    }
    chrome.webRequest.onAuthRequired.addListener(
            callbackFn,
            {urls: ["<all_urls>"]},
            ['blocking']
    );
  `;

  await fs.writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(extensionDir, 'background.js'), backgroundJs);
  return extensionDir;
}

// ==========================================
// ADSPOWER STYLE START PAGE GENERATOR
// ==========================================
async function generateStartPage(userDataDir, profileData) {
  const startPagePath = path.join(userDataDir, 'start.html');
  const now = new Date().toLocaleString();
  
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <title>SoftGlaze Start Page</title>
      <style>
          body { background-color: #f3f5f8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px; color: #333; }
          .container { max-width: 1000px; margin: 0 auto; }
          .ip-card { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin-bottom: 20px; text-align: center; }
          .ip-card h1 { font-size: 48px; margin: 0 0 10px 0; letter-spacing: 2px; }
          .ip-card p { font-size: 18px; margin: 0; opacity: 0.9; }
          .nav-links { display: flex; gap: 15px; margin-bottom: 30px; }
          .nav-links a { background: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; color: #333; font-weight: bold; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: 0.2s; }
          .nav-links a:hover { border-color: #3182ce; color: #3182ce; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
          .card { background: white; border-radius: 12px; padding: 25px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
          .card h3 { margin-top: 0; border-bottom: 1px solid #edf2f7; padding-bottom: 15px; font-size: 16px; color: #2d3748; }
          .row { display: flex; padding: 12px 0; border-bottom: 1px dashed #edf2f7; }
          .row:last-child { border-bottom: none; }
          .label { width: 140px; color: #718096; font-size: 14px; }
          .value { flex: 1; font-size: 14px; color: #1a202c; font-weight: 500; word-break: break-all; }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="ip-card">
              <h1 id="ip-display">Checking IP...</h1>
              <p id="location-display">Connecting to network...</p>
          </div>
          <div class="nav-links">
              <a href="https://browserscan.net" target="_blank">BrowserScan</a>
              <a href="https://browserleaks.com" target="_blank">BrowserLeaks</a>
              <a href="https://whoer.net" target="_blank">Whoer.net</a>
          </div>
          <div class="grid">
              <div class="card">
                  <h3>Account Information</h3>
                  <div class="row"><div class="label">Name</div><div class="value">${profileData.title}</div></div>
                  <div class="row"><div class="label">Startup time</div><div class="value">${now}</div></div>
                  <div class="row"><div class="label">Profile ID</div><div class="value">${profileData.profileId}</div></div>
                  <div class="row"><div class="label">Proxy type</div><div class="value">${profileData.proxy ? profileData.proxy.type : 'Direct (No Proxy)'}</div></div>
                  <div class="row"><div class="label">Remark</div><div class="value">--</div></div>
              </div>
              <div class="card">
                  <h3>Fingerprint Information</h3>
                  <div class="row"><div class="label">Kernel version</div><div class="value">Chrome 124</div></div>
                  <div class="row"><div class="label">OS</div><div class="value">Windows</div></div>
                  <div class="row"><div class="label">User Agent</div><div class="value" id="ua-display">Loading...</div></div>
                  <div class="row"><div class="label">Timezone</div><div class="value" id="tz-display">Loading...</div></div>
              </div>
          </div>
      </div>
      <script>
          document.getElementById('ua-display').innerText = navigator.userAgent;
          document.getElementById('tz-display').innerText = Intl.DateTimeFormat().resolvedOptions().timeZone;
          fetch('http://ip-api.com/json').then(res => res.json()).then(data => {
              document.getElementById('ip-display').innerText = data.query;
              document.getElementById('location-display').innerText = data.country + ' / ' + data.regionName + ' / ' + data.city;
          }).catch(() => {
              document.getElementById('ip-display').innerText = "IP Load Failed";
              document.getElementById('location-display').innerText = "Check Proxy Connection";
          });
      </script>
  </body>
  </html>
  `;
  await fs.writeFile(startPagePath, html);
  return `file://${startPagePath}`;
}

async function launchProfileSession(options = {}) {
  const { profileId, title, dataDirName, proxyInfoString, profileRoot = DEFAULT_PROFILE_ROOT, headless = false } = options;
  const safeDirName = sanitizeDataDirName(dataDirName || title || `profile-${profileId || crypto.randomUUID()}`);
  const root = path.resolve(profileRoot);
  const userDataDir = resolveInside(root, safeDirName);

  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });

  const resolvedProxy = parseProxyInput(proxyInfoString);
  
  const args = [
    `--window-size=${DEFAULT_WINDOW_SIZE.width},${DEFAULT_WINDOW_SIZE.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--force-webrtc-ip-handling=default_public_interface_only',
    '--disable-peer-connection-encryption'
  ];

  // If proxy has authentication, generate and load the extension
  const extensionDir = await createProxyAuthExtension(userDataDir, resolvedProxy);
  if (extensionDir) {
    args.push(`--disable-extensions-except=${extensionDir}`);
    args.push(`--load-extension=${extensionDir}`);
  } else if (resolvedProxy) {
    const proxyServer = buildProxyServerArgument(resolvedProxy);
    if (proxyServer) args.push(`--proxy-server=${proxyServer}`);
  }

  // Generate Start Page
  const startUrl = await generateStartPage(userDataDir, { title, profileId: profileId || 'TEMP-ID', proxy: resolvedProxy });

  const browser = await puppeteer.launch({
    headless,
    userDataDir,
    defaultViewport: null,
    args
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  await applyAntiDetectMasks(page, safeDirName);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const sessionId = String(profileId || crypto.randomUUID());
  activeSessions.set(sessionId, { browser, page, userDataDir, createdAt: new Date() });
  browser.on('disconnected', () => activeSessions.delete(sessionId));

  return { sessionId, userDataDir };
}

function parseProxyInput(input) {
  if (!input) return null;
  return typeof input === 'string' ? parseProxyString(input) : input;
}

async function closeProfileSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session) return { closed: false };
  await session.browser.close();
  activeSessions.delete(id);
  return { closed: true };
}

async function closeAllProfileSessions() {
  for (const session of activeSessions.values()) { try { await session.browser.close(); } catch {} }
  activeSessions.clear();
}

function listActiveSessions() {
  return Array.from(activeSessions.entries()).map(([sessionId, session]) => ({
    sessionId, userDataDir: session.userDataDir, createdAt: session.createdAt.toISOString()
  }));
}

module.exports = { DEFAULT_PROFILE_ROOT, parseProxyInput, launchProfileSession, closeProfileSession, closeAllProfileSessions, listActiveSessions };