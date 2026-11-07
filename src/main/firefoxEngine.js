'use strict';
// Firefox has no CDP, so profiles are configured via user.js: proxy, UA, locale, TZ env and WebRTC
// off (no real-IP leak). Authenticated proxies go through a local relay; prefs cannot hold creds.
const fs = require('node:fs');
const { firefoxDirName } = require('./profileData');
const { doNotTrackFlag, dntPrefToWrite } = require('./doNotTrack');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { parseProxyInput } = require('./browserEngine');
const { startSocksAuthRelay } = require('./socksRelay');
const { assertAllowedDownloadUrl, resolveRedirect, HOSTS } = require('./downloadGuard');
const platform = require('./platform');
const { extractFirefox } = require('./extractArchive');
const autofillBridge = require('./autofillBridge');
// `app` is a string path (not the API object) when required outside Electron, so
// `app && app.isPackaged` is a safe runtime guard.
const { app } = require('electron');

// Packaged, __dirname is inside app.asar (a file), so writes there throw ENOTDIR; use userData.
const FIREFOX_ROOT = (app && app.isPackaged)
  ? path.join(app.getPath('userData'), 'firefox')
  : path.resolve(__dirname, '../../firefox');

function firefoxBinaryInDir(dir) { return path.join(dir, ...platform.firefoxBinaryRel().split('/')); }

// System Firefox locations for this OS, then an optional downloaded copy at the root.
const FIREFOX_CANDIDATES = [
  ...platform.firefoxSystemCandidates(),
  firefoxBinaryInDir(FIREFOX_ROOT)
].filter(Boolean);

function findFirefoxBinary() {
  for (const p of FIREFOX_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return null;
}

// ---- Versioned installs (downloaded on demand into firefox/<version>) ----

function firefoxInstallDir(version) { return path.join(FIREFOX_ROOT, String(version)); }

function isFirefoxVersionInstalled(version) {
  try { return fs.existsSync(firefoxBinaryInDir(firefoxInstallDir(version))); }
  catch (e) { return false; }
}

// Prefer a downloaded versioned install, then any Firefox on the machine.
function resolveFirefoxBinary(version) {
  if (version && String(version) !== 'Auto') {
    const p = firefoxBinaryInDir(firefoxInstallDir(version));
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return findFirefoxBinary();
}

// ---- Smart Autofill extension ----
// Firefox has no CDP, so autofill ships as a WebExtension plus a loopback bridge (autofillBridge.js).
// Release Firefox requires the signed .xpi; dev copies the unpacked source for unsigned testing.
const AUTOFILL_EXT_ID = 'autofill@softglaze.app';

// Bundled signed .xpi (copied into resources by build/afterPack.js). Only present
// in packaged builds once `npm run sign:firefox-ext` has produced it.
function autofillSignedXpiPath() {
  if (app && app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'firefox-extension', `${AUTOFILL_EXT_ID}.xpi`);
  }
  return null;
}

// Dev only: when packaged this lives inside app.asar, which Firefox cannot read.
function autofillUnpackedSrcDir() {
  return path.resolve(__dirname, '../firefox-extension');
}

// Installs into the profile's extensions/ dir. Returns { mode: 'xpi' | 'unpacked' | 'none' }.
async function installAutofillExtension(userDataDir) {
  const extDir = path.join(userDataDir, 'extensions');
  try { await fsp.mkdir(extDir, { recursive: true }); } catch (e) { return { mode: 'none' }; }

  // Packaged: the signed .xpi is the only thing release Firefox will load (and the
  // src/ tree lives inside app.asar, which Firefox can't read).
  if (app && app.isPackaged) {
    const signed = autofillSignedXpiPath();
    if (signed) {
      try {
        await fsp.access(signed);
        await fsp.copyFile(signed, path.join(extDir, `${AUTOFILL_EXT_ID}.xpi`));
        return { mode: 'xpi' };
      } catch (e) { /* not signed/bundled yet */ }
    }
    return { mode: 'none' };
  }

  // Dev: copy the unpacked source so Developer-Edition/Nightly can load it unsigned.
  const src = autofillUnpackedSrcDir();
  try {
    await fsp.access(path.join(src, 'manifest.json'));
    const dest = path.join(extDir, AUTOFILL_EXT_ID);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.cp(src, dest, { recursive: true });
    return { mode: 'unpacked' };
  } catch (e) { return { mode: 'none' }; }
}

// The bridge's per-run token reaches the extension via Firefox's managed-storage manifest
// (browser.storage.managed): a signed .xpi cannot carry it and an extension cannot read prefs.
// On Windows an HKCU ManagedStorage registry key points at the JSON file.
let managedTokenWritten = null;
function managedStoragePath() {
  if (process.platform === 'win32') return path.join(FIREFOX_ROOT, `${AUTOFILL_EXT_ID}.managed.json`);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'ManagedStorage', `${AUTOFILL_EXT_ID}.json`);
  return path.join(os.homedir(), '.mozilla', 'managed-storage', `${AUTOFILL_EXT_ID}.json`);
}
function buildManagedStorageManifest(token) {
  return JSON.stringify({
    name: AUTOFILL_EXT_ID,
    description: 'SoftGlaze autofill: per-run bridge token',
    type: 'storage',
    data: { token: String(token) }
  });
}
async function writeAutofillManagedToken(token) {
  if (!token) return false;
  if (managedTokenWritten === token) return true;
  const file = managedStoragePath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, buildManagedStorageManifest(token), { mode: 0o600 });
  if (process.platform === 'win32') {
    const key = `HKCU\\Software\\Mozilla\\ManagedStorage\\${AUTOFILL_EXT_ID}`;
    await new Promise((resolve, reject) => {
      execFile('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    });
  }
  managedTokenWritten = token;
  return true;
}

const ffSessions = new Map(); // sessionId -> { proc, relay, userDataDir, title, proxyLabel, createdAt }
// Launches in flight, so a double-click cannot start two Firefox processes on one profile.
const ffLaunching = new Map(); // sessionId -> Promise<launch result>
// Set by ipcHandlers so Firefox sessions feed the same SessionState and crash-recovery pipeline.
let sessionEventSink = null;
function setSessionEventSink(fn) { sessionEventSink = (typeof fn === 'function') ? fn : null; }
function emitSessionEvent(evt) { try { if (sessionEventSink) sessionEventSink(evt); } catch (e) { /* never break a launch/close */ } }
const ffIntentionalClose = new Set(); // sessionIds the user explicitly closed
let ffShuttingDown = false;            // app quitting - closes are not crashes

// Local HTTP proxy that injects Proxy-Authorization to an authenticated upstream,
// so Firefox connects auth-free to 127.0.0.1:<port>. Supports GET + CONNECT.
function startAuthRelay(proxy) {
  return new Promise((resolve, reject) => {
    const authHeader = 'Basic ' + Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
    const upstreamHost = proxy.host;
    const upstreamPort = Number(proxy.port);
    const open = new Set(); // live tunnel sockets - destroyed on close() so none leak
    const track = (sock) => { if (!sock) return; open.add(sock); sock.once('close', () => open.delete(sock)); };

    const server = http.createServer((req, res) => {
      const opts = { host: upstreamHost, port: upstreamPort, method: req.method, path: req.url,
        headers: { ...req.headers, 'Proxy-Authorization': authHeader } };
      const fwd = http.request(opts, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
      fwd.setTimeout(30000, () => { try { fwd.destroy(); } catch (e) {} }); // no unbounded upstream stall
      fwd.on('error', () => { try { res.writeHead(502); res.end(); } catch (e) {} });
      req.pipe(fwd);
    });
    server.on('connect', (req, clientSocket, head) => {
      // Tunnel HTTPS through the upstream proxy with auth.
      track(clientSocket);
      const upstream = net.connect(upstreamPort, upstreamHost, () => {
        upstream.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${authHeader}\r\n\r\n`);
        upstream.once('data', (chunk) => {
          upstream.setTimeout(0); // tunnel established - long-lived, so drop the connect timeout
          // Pass the upstream's CONNECT response straight back, then splice.
          clientSocket.write(chunk);
          if (head && head.length) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
      });
      track(upstream);
      upstream.setTimeout(30000, () => { try { upstream.destroy(); } catch (e) {} }); // bound the connect/handshake
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => {
        try { server.close(); } catch (e) {}
        for (const s of open) { try { s.destroy(); } catch (e) {} } // reap in-flight tunnels
        open.clear();
      }
    }));
  });
}

function buildUserJs(opts) {
  const lines = [];
  const pref = (k, v) => lines.push(`user_pref(${JSON.stringify(k)}, ${typeof v === 'string' ? JSON.stringify(v) : v});`);

  // First-run / telemetry / noise suppression.
  pref('browser.shell.checkDefaultBrowser', false);
  pref('browser.startup.homepage_override.mstone', 'ignore');
  pref('startup.homepage_welcome_url', '');
  pref('startup.homepage_welcome_url.additional', '');
  pref('browser.aboutwelcome.enabled', false);
  pref('datareporting.policy.dataSubmissionEnabled', false);
  pref('datareporting.healthreport.uploadEnabled', false);
  pref('toolkit.telemetry.enabled', false);
  pref('app.shield.optoutstudies.enabled', false);
  pref('browser.newtabpage.enabled', false);
  pref('browser.newtab.url', 'about:blank');

  // Windows: disable the launcher stub so the spawned process is the real browser; otherwise
  // firefox.exe hands off and exits, which reads as a crash. Honored from prefs on later launches.
  pref('browser.launcherProcess.enabled', false);

  // Skip first-run onboarding (about:welcome, import wizard, What's New, DoH first-run, upgrade dialog).
  pref('browser.aboutwelcome.enabled', false);
  pref('browser.startup.firstrunSkipsHomepage', true);
  pref('trailhead.firstrun.didSeeAboutWelcome', true);
  pref('datareporting.policy.firstRunURL', '');
  pref('doh-rollout.doneFirstRun', true);
  pref('browser.messaging-system.whatsNewPanel.enabled', false);
  pref('browser.migrate.automigrate.enabled', false);
  pref('browser.migrate.chrome.enabled', false);
  pref('browser.startup.upgradeDialog.enabled', false);
  pref('startup.homepage_override_url', '');
  pref('browser.startup.homepage', 'about:blank');
  // Stop closes Firefox gracefully first; a "close N tabs?" prompt would block that and force a kill.
  pref('browser.tabs.warnOnClose', false);
  pref('browser.warnOnQuit', false);
  pref('browser.sessionstore.warnOnQuit', false);

  // Disable WebRTC and geolocation so the real IP and location cannot leak.
  pref('media.peerconnection.enabled', false);
  pref('media.navigator.enabled', false);
  pref('geo.enabled', false);
  pref('dom.webnotifications.enabled', false);

  if (opts.userAgent) pref('general.useragent.override', opts.userAgent);

  // Do Not Track through Firefox's own pref: with it on, Firefox itself sends DNT: 1 and reports
  // navigator.doNotTrack "1"; off, no header and "unspecified". '1' / '0' from dntPrefToWrite; null
  // writes nothing (Firefox keeps its own value, off by default).
  if (opts.doNotTrack === '1' || opts.doNotTrack === '0') pref('privacy.donottrackheader.enabled', opts.doNotTrack === '1');

  if (opts.acceptLanguages) {
    pref('intl.accept_languages', opts.acceptLanguages);
    pref('intl.locale.requested', opts.acceptLanguages.split(',')[0]);
  }

  // Let profile-scope (sideloaded) add-ons install and stay enabled, without update checks.
  if (opts.autofill) {
    pref('extensions.autoDisableScopes', 0);
    pref('extensions.enabledScopes', 15);
    pref('extensions.startupScanScopes', 15);
    pref('extensions.installDistroAddons', false);
    pref('extensions.update.enabled', false);
    pref('extensions.getAddons.cache.enabled', false);
    // Honored on Developer Edition/Nightly/unbranded ESR for unsigned testing; release and beta lock it
    // to true and need the signed .xpi.
    pref('xpinstall.signatures.required', false);
  }

  // type 1 = manual. opts.proxy is already the local no-auth relay when the upstream needs creds,
  // since Firefox prefs cannot carry proxy auth for HTTP or SOCKS.
  for (const [k, v] of firefoxProxyPrefs(opts.proxy)) pref(k, v);

  return lines.join('\n') + '\n';
}

// Firefox reads its zone from TZ. On Windows SpiderMonkey accepts only EST5EDT, CST6CDT, MST7MDT,
// PST8PDT and UTC/GMT variants and ignores IANA names, so zones map to the id with the same offsets
// and DST rules; a zone with none returns null and the launch warns.
const FIREFOX_WIN_TZ_EXACT = new Set(['EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT', 'UTC', 'UCT', 'GMT', 'GMT0', 'GMT+0', 'GMT-0']);
const FIREFOX_WIN_TZ_MAP = (() => {
  const m = new Map();
  const add = (id, zones) => zones.forEach((z) => m.set(z, id));
  add('EST5EDT', ['America/New_York', 'US/Eastern', 'America/Detroit', 'US/Michigan', 'America/Toronto', 'America/Montreal',
    'America/Nipigon', 'America/Thunder_Bay', 'America/Iqaluit', 'America/Nassau', 'America/Indiana/Indianapolis',
    'America/Indianapolis', 'America/Fort_Wayne', 'US/East-Indiana', 'America/Indiana/Marengo', 'America/Indiana/Petersburg',
    'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Kentucky/Louisville',
    'America/Louisville', 'America/Kentucky/Monticello', 'Canada/Eastern']);
  add('CST6CDT', ['America/Chicago', 'US/Central', 'America/Indiana/Knox', 'America/Knox_IN', 'US/Indiana-Starke',
    'America/Indiana/Tell_City', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem',
    'America/North_Dakota/Beulah', 'America/Winnipeg', 'America/Rainy_River', 'America/Rankin_Inlet', 'America/Resolute',
    'America/Matamoros', 'Canada/Central']);
  add('MST7MDT', ['America/Denver', 'US/Mountain', 'America/Shiprock', 'Navajo', 'America/Boise', 'America/Edmonton',
    'America/Cambridge_Bay', 'America/Inuvik', 'America/Yellowknife', 'America/Ciudad_Juarez', 'America/Ojinaga', 'Canada/Mountain']);
  add('PST8PDT', ['America/Los_Angeles', 'US/Pacific', 'America/Vancouver', 'America/Tijuana', 'America/Ensenada',
    'America/Santa_Isabel', 'Mexico/BajaNorte', 'Canada/Pacific']);
  // Zero offset all year, no DST.
  add('UTC', ['Etc/UTC', 'Etc/UCT', 'Etc/Universal', 'Etc/Zulu', 'Universal', 'Zulu', 'Etc/GMT', 'Etc/GMT0', 'Etc/GMT+0',
    'Etc/GMT-0', 'Etc/Greenwich', 'Greenwich', 'Africa/Abidjan', 'Africa/Accra', 'Africa/Bamako', 'Africa/Banjul',
    'Africa/Bissau', 'Africa/Conakry', 'Africa/Dakar', 'Africa/Freetown', 'Africa/Lome', 'Africa/Monrovia',
    'Africa/Nouakchott', 'Africa/Ouagadougou', 'Africa/Timbuktu', 'Atlantic/Reykjavik', 'Iceland', 'Atlantic/St_Helena',
    'America/Danmarkshavn']);
  return m;
})();

function firefoxTzEnv(timezoneId, osPlatform = process.platform) {
  const tz = String(timezoneId || '').trim();
  if (!tz) return null;
  if (osPlatform !== 'win32') return tz;
  if (FIREFOX_WIN_TZ_EXACT.has(tz)) return tz;
  return FIREFOX_WIN_TZ_MAP.get(tz) || null;
}

function firefoxTzUnsupportedWarning(timezoneId) {
  return `Firefox on Windows cannot use the ${timezoneId} time zone (it only supports the US Eastern, Central, Mountain and Pacific zones and UTC), so this profile shows your PC's time zone. Use a Chrome-based browser for this profile to match the proxy's time zone.`;
}

// Every proxy pref is written on every launch: Firefox keeps user.js values in prefs.js after a line
// is removed, so stale relay host/ports would survive and could route through another profile's relay.
// No proxy = type 5 (system settings), Firefox's default and what Chromium does without --proxy-server.
function firefoxProxyPrefs(proxy) {
  const out = [];
  const isSocks = Boolean(proxy) && /socks/i.test(String(proxy.type || ''));
  const host = proxy ? String(proxy.host) : '';
  const port = proxy ? Number(proxy.port) || 0 : 0;
  out.push(['network.proxy.type', proxy ? 1 : 5]);
  out.push(['network.proxy.no_proxies_on', '']);
  out.push(['network.proxy.socks', isSocks ? host : '']);
  out.push(['network.proxy.socks_port', isSocks ? port : 0]);
  out.push(['network.proxy.socks_version', isSocks && /4/.test(String(proxy.type)) ? 4 : 5]);
  out.push(['network.proxy.socks_remote_dns', true]);
  out.push(['network.proxy.http', proxy && !isSocks ? host : '']);
  out.push(['network.proxy.http_port', proxy && !isSocks ? port : 0]);
  out.push(['network.proxy.ssl', proxy && !isSocks ? host : '']);
  out.push(['network.proxy.ssl_port', proxy && !isSocks ? port : 0]);
  out.push(['network.proxy.share_proxy_settings', Boolean(proxy) && !isSocks]);
  return out;
}

// Proxy geo to intl.accept_languages (e.g. "de-DE,de,en"); null when the country is unknown.
function ipLocaleFromGeo(geo) {
  if (!geo || !geo.countryCode) return null;
  let COUNTRY_LOCALE;
  try { ({ COUNTRY_LOCALE } = require('./browserEngine')); } catch (e) { return null; }
  const loc = COUNTRY_LOCALE[geo.countryCode];
  if (!loc) return null;
  return Array.from(new Set([loc, loc.split('-')[0], 'en'])).join(',');
}

// One Firefox per profile: a second launch for a running or starting profile gets the same session.
function launchFirefoxProfile(options = {}) {
  const key = options && options.profileId != null && String(options.profileId).trim() ? String(options.profileId).trim() : null;
  if (key) {
    const running = ffSessions.get(key);
    if (running) return Promise.resolve({ sessionId: key, userDataDir: running.userDataDir, engine: 'firefox', alreadyRunning: true });
    if (ffLaunching.has(key)) return ffLaunching.get(key);
  }
  const p = launchFirefoxProfileNow(options);
  if (!key) return p;
  ffLaunching.set(key, p);
  const clear = () => { if (ffLaunching.get(key) === p) ffLaunching.delete(key); };
  p.then(clear, clear);
  return p;
}

async function launchFirefoxProfileNow(options = {}) {
  const {
    profileId, title, dataDirName, profileRoot, profile = {}, startUrl = 'about:blank',
    // The profile's saved start links (Profile.startupUrls), opened as extra tabs.
    startupUrls = []
  } = options;

  const wantVersion = profile.browserVersion || options.browserVersion || 'Auto';
  const ff = resolveFirefoxBinary(wantVersion);
  if (!ff) throw new Error('Firefox is not installed. Download a Firefox version from the browser selector (or install Firefox on this machine) to launch this profile.');

  const root = path.resolve(profileRoot || path.resolve(process.cwd(), 'softglaze_profiles'));
  const safe = firefoxDirName(dataDirName || title || `ff-${profileId || crypto.randomUUID()}`);
  const userDataDir = path.join(root, 'firefox', safe);
  await fsp.mkdir(userDataDir, { recursive: true });

  const proxy = parseProxyInput(options.proxy || options.proxyInfoString);
  const proxyLabel = proxy ? `${proxy.type} ${proxy.host}:${proxy.port}` : 'Direct (No Proxy)';

  // Firefox prefs cannot carry proxy creds, so an authenticated upstream gets a local no-auth relay
  // (HTTP or SOCKS5) on 127.0.0.1; without it auth SOCKS5 fails as "refusing connections".
  // No-auth proxies are used directly; a relay that fails to bind throws.
  let relay = null;              // { port, close } - closed on teardown / launch failure
  let effectiveProxy = proxy;
  if (proxy && (proxy.username || proxy.password)) {
    const typeLc = String(proxy.type || '').toLowerCase();
    const isSocks5 = typeLc === 'socks5';   // only SOCKS5 carries username/password auth
    const isSocks4 = typeLc.startsWith('socks') && !isSocks5; // socks4/4a can't carry a password
    // SOCKS4/4a has no password handshake, so pass it directly (the Chrome engine relays only SOCKS5).
    if (!isSocks4) {
      try {
        relay = isSocks5 ? await startSocksAuthRelay(proxy) : await startAuthRelay(proxy);
      } catch (e) {
        throw new Error(`Could not start the local ${isSocks5 ? 'SOCKS5' : 'HTTP'} proxy authentication relay for this profile: ${(e && e.message) || e}`);
      }
      effectiveProxy = { type: isSocks5 ? 'SOCKS5' : 'HTTP', host: '127.0.0.1', port: relay.port, username: null, password: null };
    }
  }

  // Bind timezone and locale to the proxy exit, or a proxied "Based on IP" profile leaks the host's.
  // The geo lookup goes through the real upstream and is cached per proxy.
  const tzCustom = profile.timezoneType === 'Custom' && profile.timezoneCustom;
  const langCustom = profile.languageType === 'Custom' && profile.languageCustom;
  let proxyGeo = null;
  if (proxy && (!tzCustom || !langCustom)) {
    try {
      const { lookupProxyGeoNodeCached } = require('./browserEngine');
      proxyGeo = await lookupProxyGeoNodeCached(proxy);
    } catch (e) { proxyGeo = null; }
  }
  // Lookup failed: use the last geo this proxy resolved to; with none, the launch returns a geoWarning
  // instead of running on the host timezone.
  if (proxy && !proxyGeo && (!tzCustom || !langCustom)) {
    try { proxyGeo = require('./browserEngine').lastKnownProxyGeo(proxy); } catch (e) { proxyGeo = null; }
  }
  const acceptLanguages = langCustom
    ? String(profile.languageCustom).split(';')[0].trim()
    : ipLocaleFromGeo(proxyGeo);
  const timezoneId = tzCustom
    ? String(profile.timezoneCustom).trim()
    : (proxyGeo && proxyGeo.timezone ? String(proxyGeo.timezone).trim() : null);
  let geoWarning = null;
  if (proxy && !timezoneId && profile.timezoneType !== 'Real') {
    try { geoWarning = require('./browserEngine').GEO_DEGRADED_WARNING; } catch (e) { geoWarning = 'The proxy location could not be looked up.'; }
  }
  // The TZ value Firefox will actually honor on this OS (see firefoxTzEnv). On Windows
  // most zones cannot be applied; say so instead of silently showing the PC's zone.
  const tzEnv = timezoneId ? firefoxTzEnv(timezoneId) : null;
  if (timezoneId && !tzEnv && !geoWarning) geoWarning = firefoxTzUnsupportedWarning(timezoneId);

  // Prefs are enabled only if the extension actually installed; never fatal to a launch.
  let autofillInstalled = false;
  if (options.autofillEnabled !== false) {
    const r = await installAutofillExtension(userDataDir).catch(() => ({ mode: 'none' }));
    autofillInstalled = r.mode !== 'none';
  }
  // The loopback bridge listens only during a Firefox autofill session, and the extension gets the token
  // from managed storage; if the token cannot be handed over, skip the bridge.
  let autofillHeld = false;
  if (autofillInstalled) {
    try {
      await writeAutofillManagedToken(autofillBridge.getToken());
      await autofillBridge.acquire();
      autofillHeld = true;
    } catch (e) {
      console.warn('[SG][firefox] autofill bridge token handoff failed:', (e && e.message) || e);
    }
  }
  const releaseAutofill = () => { if (autofillHeld) { autofillHeld = false; autofillBridge.release().catch(() => {}); } };

  // Never apply a Chrome UA to Gecko: buildID, oscpu and the missing userAgentData still say Firefox.
  // Honor an explicit Firefox UA; otherwise null keeps the binary's native UA (matches its TLS/JA4).
  const storedUa = profile.userAgent && profile.userAgent !== 'Auto' ? String(profile.userAgent).trim() : '';
  const firefoxUserAgent = (/firefox\//i.test(storedUa) && !/chrome\//i.test(storedUa)) ? storedUa : null;
  const userJs = buildUserJs({
    proxy: effectiveProxy,
    userAgent: firefoxUserAgent,
    acceptLanguages,
    autofill: autofillInstalled,
    doNotTrack: await dntPrefToWrite(userDataDir, doNotTrackFlag(profile.doNotTrack))
  });
  // Until exit handlers are wired, a throw would leave the authenticated relay listening; close it.
  try {
    await fsp.writeFile(path.join(userDataDir, 'user.js'), userJs);
  } catch (e) {
    if (relay) { try { relay.close(); } catch (_) {} }
    releaseAutofill();
    throw e;
  }

  const env = { ...process.env };
  if (tzEnv) env.TZ = tzEnv;

  // A start URL given for this launch opens first (http(s) only, as on Chromium); otherwise the
  // SoftGlaze start page (proxy IP/geo card), written into the profile dir. Firefox needs it as a
  // proper file:/// URL.
  let openUrl = (typeof startUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(startUrl.trim())) ? startUrl.trim() : null;
  if (!openUrl) {
    try {
      const { generateStartPage } = require('./browserEngine');
      await generateStartPage(userDataDir, { title: title || `Profile ${profileId}`, profileId: profileId != null ? profileId : 'TEMP-ID', proxyLabel, geo: null });
      openUrl = pathToFileURL(path.join(userDataDir, 'start.html')).href;
    } catch (e) { openUrl = null; /* fall back to the homepage prefs */ }
  }

  // -wait-for-browser keeps this process alive until the browser exits; otherwise firefox.exe hands
  // off and returns at once, dropping the session while Firefox runs. First-run is suppressed via prefs.
  const args = ['-profile', userDataDir, '-no-remote', '-new-instance', '-wait-for-browser'];
  if (openUrl) args.push('-url', openUrl);
  // The profile's own start links. Firefox opens each bare URL argument in its own
  // tab. Restricted to http(s) so nothing else can be smuggled onto the command line.
  for (const u of (Array.isArray(startupUrls) ? startupUrls : [])) {
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) args.push(u);
  }

  // stdio:'ignore' - nothing reads Firefox's stdout/stderr, and an undrained pipe can
  // fill its buffer and stall the child on Windows.
  let proc;
  try {
    proc = spawn(ff, args, { env, detached: false, windowsHide: false, stdio: 'ignore' });
  } catch (e) {
    if (relay) { try { relay.close(); } catch (_) {} } // don't leak the relay on a spawn failure
    releaseAutofill();
    throw e;
  }
  const sessionId = String(profileId || crypto.randomUUID());
  const session = { proc, relay, userDataDir, title: title || `Profile ${sessionId}`, proxyLabel, createdAt: new Date(), engine: 'firefox', releaseAutofill, geoWarning };
  ffSessions.set(sessionId, session);

  let ffSettled = false;
  // `exit` = { code, signal } from the process 'exit' event; null for a spawn 'error'.
  const onGone = (exit) => {
    // 'exit' and 'error' can both fire; tear down once, or one close is reported twice and can trigger
    // a spurious crash-recovery relaunch.
    if (ffSettled) return;
    ffSettled = true;
    if (session.relay) session.relay.close();
    session.releaseAutofill();
    // Drop the entry only if it is still this session; a relaunch may have registered a new one.
    if (ffSessions.get(sessionId) === session) ffSessions.delete(sessionId);
    // A Firefox closed with its own X exits with code 0 and must not count as a crash.
    const intentional = ffIntentionalClose.has(sessionId);
    if (intentional) ffIntentionalClose.delete(sessionId);
    const { classifyBrowserExit } = require('./browserEngine');
    const reason = classifyBrowserExit({ shuttingDown: ffShuttingDown, intentional, exit });
    emitSessionEvent({ type: reason === 'crash' ? 'crashed' : 'closed', sessionId, reason, engine: 'firefox' });
  };
  proc.on('exit', (code, signal) => onGone({ code, signal }));
  proc.on('error', () => onGone(null));

  emitSessionEvent({ type: 'launched', sessionId, profileId: (profileId != null ? Number(profileId) : null), engine: 'firefox' });

  return { sessionId, userDataDir, engine: 'firefox', geoDegraded: Boolean(geoWarning), geoWarning };
}

// The held process is the waiter parent of the real browser; a plain kill leaves the window open and
// the profile locked, so taskkill /T reaps the tree. force=false asks politely (no /F, or SIGTERM)
// so Firefox flushes cookies, session and storage.
function killProcessTree(proc, force = true) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    const args = ['/PID', String(proc.pid), '/T'];
    if (force) args.push('/F');
    try { spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }); return; }
    catch (e) { /* fall through to a plain kill */ }
  }
  try { proc.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch (e) { /* ignore */ }
}

const FF_GRACEFUL_STOP_MS = 8000;
function waitForExit(proc, ms) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) { resolve(true); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => finish(false), ms);
    proc.once('exit', () => finish(true));
  });
}

async function closeFirefoxSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = ffSessions.get(id);
  if (!session) return { closed: false };
  ffIntentionalClose.add(id); // deliberate close - the exit must not be read as a crash
  // Graceful close first so profile data is written; force only if still running after the timeout.
  killProcessTree(session.proc, false);
  const exited = await waitForExit(session.proc, FF_GRACEFUL_STOP_MS);
  if (!exited) killProcessTree(session.proc, true);
  if (session.relay) session.relay.close();
  session.releaseAutofill();
  if (ffSessions.get(id) === session) ffSessions.delete(id);
  return { closed: true, forced: !exited };
}

function isFirefoxSession(sessionId) {
  return ffSessions.has(String(sessionId || '').trim());
}

function listFirefoxSessions() {
  const fmt = (d) => {
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  return Array.from(ffSessions.entries()).map(([sessionId, s]) => ({
    id: sessionId, sessionId, profileName: s.title, ip: s.proxyLabel,
    uptime: fmt(s.createdAt), userDataDir: s.userDataDir, engine: 'firefox',
    createdAt: s.createdAt.toISOString()
  }));
}

async function closeAllFirefoxSessions() {
  ffShuttingDown = true; // app quitting - Firefox closes are not crashes
  // In parallel, so N graceful waits cost ~8 s in total, not 8 s each.
  await Promise.all(Array.from(ffSessions.keys()).map((id) => closeFirefoxSession(id).catch(() => ({ closed: false }))));
}

// ---- On-demand Firefox download ----
// The release package is extracted into firefox/<version> rather than installed, so nothing is
// registered system-wide.

const FF_HISTORY = 'https://product-details.mozilla.org/1.0/firefox_history_major_releases.json';
const FF_STATE_FILE = path.join(FIREFOX_ROOT, '.download-state.json');
const ffDownloads = new Map(); // major -> { version, major, percent, state, error, receivedBytes, totalBytes, url, dest }
const ffAborters = new Map(); // major -> abort fn while downloading
const ffPaused = new Set(); // majors the user explicitly paused
let ffCatalog = null;
let ffCatalogAt = 0;
let ffLastPersist = 0;

// Not keyed by PID, so a partial download survives a restart and can resume.
// The extractor sniffs content, so the .part file is extracted as-is.
function ffPartialPath(major) { return path.join(FIREFOX_ROOT, `_download-ff-${major}.part`); }

function ffPersistState(force) {
  const now = Date.now();
  if (!force && now - ffLastPersist < 1000) return;
  ffLastPersist = now;
  const resumable = [];
  for (const e of ffDownloads.values()) {
    if (e.state === 'downloading' || e.state === 'paused' || e.state === 'interrupted' || e.state === 'installing') {
      resumable.push({ version: e.version, major: e.major, url: e.url || '', dest: e.dest || '', receivedBytes: e.receivedBytes || 0, totalBytes: e.totalBytes || 0, state: e.state, updatedAt: now });
    }
  }
  try {
    fs.mkdirSync(FIREFOX_ROOT, { recursive: true });
    fs.writeFileSync(FF_STATE_FILE, JSON.stringify(resumable));
  } catch (e) { /* best-effort */ }
}

// Re-surface any Firefox download that was mid-flight when the app died.
async function initFirefoxResumableState() {
  let raw;
  try { raw = await fsp.readFile(FF_STATE_FILE, 'utf8'); } catch (e) { return; }
  let list;
  try { list = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(list)) return;
  for (const s of list) {
    if (!s || s.major == null) continue;
    if (isFirefoxVersionInstalled(s.major)) continue;
    let partial = 0;
    if (s.dest) { try { partial = (await fsp.stat(s.dest)).size; } catch (e) { partial = 0; } }
    if (partial <= 0) continue;
    const total = s.totalBytes || 0;
    ffDownloads.set(String(s.major), {
      version: s.version || `${s.major}.0`,
      major: s.major,
      percent: total ? Math.min(85, Math.round((partial / total) * 85)) : 0,
      state: 'interrupted',
      error: null,
      receivedBytes: partial,
      totalBytes: total,
      url: s.url || '',
      dest: s.dest || ''
    });
  }
}

function ffHttpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    // https-only and Mozilla-host allowlist on the URL and every redirect.
    let target;
    try { target = assertAllowedDownloadUrl(url, HOSTS.firefox, 'Firefox download'); }
    catch (e) { return reject(e); }
    const req = https.get(target, { headers: { 'User-Agent': 'SoftGlaze' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = resolveRedirect(res.headers.location, target, HOSTS.firefox, 'Firefox download'); }
        catch (e) { return reject(e); }
        return ffHttpsGet(next, redirects + 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
  });
}

async function ffFetchJson(url) {
  const res = await ffHttpsGet(url);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} fetching Firefox version list`);
  let data = '';
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

function ffMajor(v) { return parseInt(String(v), 10); }
// "140" -> "140.0"; "140.0.1" stays as-is. Install dirs are keyed by major so the
// profile's stored version (a major, like Chrome) resolves directly to a binary.
function ffFullVersion(v) { const s = String(v); return /^\d+\.\d/.test(s) ? s : `${ffMajor(v)}.0`; }

function ffInstallerUrl(version) {
  // Per-OS artifact: win64 .exe, mac .dmg, linux-x86_64 .tar.xz.
  return platform.firefoxInstallerUrl(ffFullVersion(version));
}

function ffSha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('error', reject);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

// Expected installer hash from Mozilla's SHA256SUMS, or null. Served from the ftp.mozilla.org origin
// while the installer may come from a CDN edge, so it is an independent integrity check.
async function ffExpectedInstallerSha(version) {
  const full = ffFullVersion(version);
  const url = `https://ftp.mozilla.org/pub/firefox/releases/${full}/SHA256SUMS`;
  let res;
  try { res = await ffHttpsGet(url); } catch (e) { return null; }
  if (res.statusCode !== 200) { try { res.resume(); } catch (_) {} return null; }
  let text = '';
  try { for await (const chunk of res) { text += chunk; if (text.length > 5_000_000) break; } } catch (e) { return null; }
  const wanted = platform.firefoxSha256Key(full); // per-OS key in SHA256SUMS
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+(.+)$/.exec(line.trim());
    if (m && m[2] === wanted) return m[1].toLowerCase();
  }
  return null;
}

// Recent major Firefox releases available for win64, newest first, with install status.
async function listFirefoxDownloadable() {
  const now = Date.now();
  let majors = [];
  try {
    if (!ffCatalog || now - ffCatalogAt > 10 * 60 * 1000) {
      ffCatalog = await ffFetchJson(FF_HISTORY);
      ffCatalogAt = now;
    }
    majors = Object.keys(ffCatalog).filter((v) => /^\d+\.0$/.test(v)).map((v) => ffMajor(v));
  } catch (e) {
    // Offline / blocked - fall back to a constructed recent-major list.
    majors = Array.from({ length: 25 }, (_, i) => 140 - i);
  }
  majors = Array.from(new Set(majors)).sort((a, b) => b - a).slice(0, 30);

  const statusByMajor = new Map(getFirefoxDownloadStatus().map((s) => [s.major, s]));
  const sys = findFirefoxBinary();
  return {
    system: sys ? { path: sys } : null,
    items: majors.map((major) => ({
      version: `${major}.0`,
      major,
      installed: isFirefoxVersionInstalled(major),
      download: statusByMajor.get(major) || null
    }))
  };
}

// GET with custom headers (Range) kept across redirects. Resolves with the final { res, req }
// so the caller can abort the live request.
function ffRawGet(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    // https-only and Mozilla-host allowlist on the URL and every redirect.
    let target;
    try { target = assertAllowedDownloadUrl(url, HOSTS.firefox, 'Firefox download'); }
    catch (e) { return reject(e); }
    const req = https.get(target, { headers: Object.assign({ 'User-Agent': 'SoftGlaze' }, headers) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = resolveRedirect(res.headers.location, target, HOSTS.firefox, 'Firefox download'); }
        catch (e) { return reject(e); }
        return ffRawGet(next, headers, redirects + 1).then(resolve, reject);
      }
      resolve({ res, req });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out')));
  });
}

// Resumable streaming download (Range continue / clean restart on 200 / done on
// 416). `registerAbort` receives an abort fn for pause. Resolves { received, total }.
async function ffDownloadToFile(url, dest, onProgress, registerAbort) {
  let startByte = 0;
  try { startByte = (await fsp.stat(dest)).size; } catch (e) { startByte = 0; }

  const headers = {};
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;

  const { res, req } = await ffRawGet(url, headers);
  if (registerAbort) registerAbort(() => { try { req.destroy(new Error('aborted')); } catch (e) {} });

  let received = startByte;
  let total = 0;
  let append = false;

  if (res.statusCode === 206) {
    append = true;
    const cr = res.headers['content-range'] || '';
    const m = /\/(\d+)\s*$/.exec(cr);
    total = m ? parseInt(m[1], 10) : startByte + parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 200) {
    append = false;
    received = 0;
    total = parseInt(res.headers['content-length'] || '0', 10);
  } else if (res.statusCode === 416) {
    res.resume();
    onProgress(startByte, startByte);
    return { received: startByte, total: startByte };
  } else {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} downloading Firefox`);
  }

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    res.on('data', (c) => { received += c.length; onProgress(received, total); });
    res.on('error', (e) => finish(reject, e));
    res.on('aborted', () => finish(reject, Object.assign(new Error('Download aborted'), { aborted: true })));
    ws.on('error', (e) => finish(reject, e));
    ws.on('finish', () => finish(resolve));
    res.pipe(ws);
  });

  return { received, total };
}

// No system install: running the NSIS installer would register Firefox system-wide (registry keys,
// Add/Remove entry, Maintenance Service, default-browser agent). See extractArchive.extractFirefox.
function extractFirefoxPortable(part, dir) {
  return extractFirefox(part, dir);
}

function startFirefoxDownload(version) {
  const major = ffMajor(version);
  const key = String(major);
  const active = ffDownloads.get(key);
  if (active && (active.state === 'downloading' || active.state === 'installing')) return active;

  // Resume an interrupted/paused/errored entry in place so its byte offset + dest
  // survive; otherwise start fresh.
  const entry = (active && (active.state === 'interrupted' || active.state === 'paused' || active.state === 'error'))
    ? active
    : { version: `${major}.0`, major, percent: 0, state: 'queued', error: null, receivedBytes: 0, totalBytes: 0, url: '', dest: '' };
  entry.state = 'queued';
  entry.error = null;
  ffPaused.delete(major);
  ffDownloads.set(key, entry);

  (async () => {
    try {
      if (isFirefoxVersionInstalled(major)) { entry.state = 'done'; entry.percent = 100; ffPersistState(true); return; }
      await fsp.mkdir(FIREFOX_ROOT, { recursive: true });
      const part = ffPartialPath(major);
      entry.url = ffInstallerUrl(major);
      entry.dest = part;

      entry.state = 'downloading';
      ffPersistState(true);
      const { received, total } = await ffDownloadToFile(entry.url, part, (rec, tot) => {
        entry.receivedBytes = rec;
        entry.totalBytes = tot || entry.totalBytes;
        entry.percent = tot ? Math.min(85, Math.round((rec / tot) * 85)) : entry.percent;
        ffPersistState(false);
      }, (abortFn) => { ffAborters.set(major, abortFn); });
      ffAborters.delete(major);

      if (total && received < total) {
        throw Object.assign(new Error('Connection interrupted before completion.'), { interrupted: true });
      }

      // Verify against Mozilla's SHA256SUMS before use; a mismatch is fatal and wipes the partial file.
      // If SHA256SUMS is unavailable, rely on https plus Mozilla-host pinning.
      entry.state = 'verifying';
      entry.percent = 86;
      ffPersistState(true);
      const expectedSha = await ffExpectedInstallerSha(major);
      if (expectedSha) {
        const actualSha = (await ffSha256File(part)).toLowerCase();
        if (actualSha !== expectedSha) {
          throw Object.assign(new Error('Firefox installer failed SHA-256 verification - refusing to run it.'), { fatal: true });
        }
      }

      entry.state = 'installing';
      entry.percent = 88;
      ffPersistState(true);
      // Portable extract, no system install; the -C target must exist first.
      await fsp.mkdir(firefoxInstallDir(major), { recursive: true });
      await extractFirefoxPortable(part, firefoxInstallDir(major));
      await fsp.unlink(part).catch(() => {});

      if (!isFirefoxVersionInstalled(major)) throw Object.assign(new Error('Extracted but the Firefox binary was not found.'), { fatal: true });
      entry.percent = 100;
      entry.state = 'done';
      ffAborters.delete(major);
      ffPersistState(true);
    } catch (e) {
      ffAborters.delete(major);
      const wasPaused = ffPaused.has(major);
      const isInterrupted = wasPaused || (e && (e.aborted || e.interrupted));
      if (isInterrupted && !(e && e.fatal)) {
        entry.state = wasPaused ? 'paused' : 'interrupted';
        entry.error = wasPaused ? null : (e instanceof Error ? e.message : String(e));
        try { entry.receivedBytes = (await fsp.stat(entry.dest)).size; } catch (_) {}
        entry.percent = entry.totalBytes ? Math.min(85, Math.round((entry.receivedBytes / entry.totalBytes) * 85)) : entry.percent;
        ffPersistState(true);
        return;
      }
      entry.state = 'error';
      entry.error = e instanceof Error ? e.message : String(e);
      try { if (!isFirefoxVersionInstalled(major)) await fsp.rm(firefoxInstallDir(major), { recursive: true, force: true }); } catch (_) {}
      ffPersistState(true);
    }
  })();

  return entry;
}

// Abort the socket but keep the partial file so the download can resume.
function pauseFirefoxDownload(version) {
  const major = ffMajor(version);
  const entry = ffDownloads.get(String(major));
  if (!entry) return { ok: false, error: 'No such download.' };
  if (entry.state !== 'downloading' && entry.state !== 'queued') return { ok: false, error: `Cannot pause a ${entry.state} download.` };
  ffPaused.add(major);
  const abort = ffAborters.get(major);
  if (abort) abort();
  entry.state = 'paused';
  ffPersistState(true);
  return { ok: true, version: entry.version, state: entry.state };
}

function resumeFirefoxDownload(version) {
  return startFirefoxDownload(version);
}

function getFirefoxDownloadStatus() {
  return Array.from(ffDownloads.values());
}

module.exports = {
  findFirefoxBinary,
  listFirefoxDownloadable,
  startFirefoxDownload,
  pauseFirefoxDownload,
  resumeFirefoxDownload,
  initFirefoxResumableState,
  getFirefoxDownloadStatus,
  launchFirefoxProfile,
  closeFirefoxSession,
  isFirefoxSession,
  listFirefoxSessions,
  closeAllFirefoxSessions,
  setSessionEventSink,
  // Exported for tests.
  buildManagedStorageManifest,
  managedStoragePath,
  buildUserJs,
  firefoxTzEnv,
};
