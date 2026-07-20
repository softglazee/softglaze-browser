'use strict';
// Real Firefox launch engine. Firefox is a different engine from Chrome (no CDP /
// MV3), so instead of the extension-based injection we configure a dedicated
// profile via user.js prefs: proxy, User-Agent, locale, timezone (TZ env) and
// WebRTC-off (so the real IP can't leak). Authenticated HTTP proxies are handled
// by a tiny local relay (Firefox can't store proxy creds in prefs).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { parseProxyInput } = require('./browserEngine');
const { startSocksAuthRelay } = require('./socksRelay');
const { assertAllowedDownloadUrl, resolveRedirect, HOSTS } = require('./downloadGuard');
// `app` is a string path (not the API object) when required outside Electron, so
// `app && app.isPackaged` is a safe runtime guard.
const { app } = require('electron');

// Must be a writable, real directory. In a packaged build `__dirname` lives inside
// app.asar (a FILE), so `../../firefox` → `…/app.asar/firefox` and any write throws
// ENOTDIR. Use userData when packaged; keep the project-root path in dev.
const FIREFOX_ROOT = (app && app.isPackaged)
  ? path.join(app.getPath('userData'), 'firefox')
  : path.resolve(__dirname, '../../firefox');

const FIREFOX_CANDIDATES = [
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Mozilla Firefox', 'firefox.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Mozilla Firefox', 'firefox.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Mozilla Firefox', 'firefox.exe'),
  path.join(FIREFOX_ROOT, 'firefox.exe') // optional downloaded copy
].filter(Boolean);

function findFirefoxBinary() {
  for (const p of FIREFOX_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return null;
}

// --- Versioned Firefox installs (downloaded on demand into /firefox/<version>) ---

function firefoxInstallDir(version) { return path.join(FIREFOX_ROOT, String(version)); }

function isFirefoxVersionInstalled(version) {
  try { return fs.existsSync(path.join(firefoxInstallDir(version), 'firefox.exe')); }
  catch (e) { return false; }
}

// Resolve the binary for a profile's selected version: prefer a downloaded
// versioned install, then fall back to whatever Firefox is on the machine.
function resolveFirefoxBinary(version) {
  if (version && String(version) !== 'Auto') {
    const p = path.join(firefoxInstallDir(version), 'firefox.exe');
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return findFirefoxBinary();
}

// --- Smart Autofill extension --------------------------------------------------
// Firefox has no CDP/exposeFunction, so the Identity-Vault autofill widget ships
// as a real WebExtension installed into the profile's extensions/ dir + a loopback
// bridge (src/main/autofillBridge.js). Packaged builds use the Mozilla-SIGNED .xpi
// (release Firefox requires signing); dev copies the unpacked source for
// Developer-Edition/Nightly testing (with xpinstall.signatures.required=false).
const AUTOFILL_EXT_ID = 'autofill@softglaze.app';

// Bundled signed .xpi (copied into resources by build/afterPack.js). Only present
// in packaged builds once `npm run sign:firefox-ext` has produced it.
function autofillSignedXpiPath() {
  if (app && app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'firefox-extension', `${AUTOFILL_EXT_ID}.xpi`);
  }
  return null;
}

// Unpacked extension source (dev only — inside app.asar when packaged, so it is
// never loadable from there; the signed .xpi is the packaged path).
function autofillUnpackedSrcDir() {
  return path.resolve(__dirname, '../firefox-extension');
}

// Place the extension where Firefox auto-installs profile add-ons. Returns the
// install mode so the caller knows whether to enable the autofill prefs.
//   { mode: 'xpi' | 'unpacked' | 'none' }
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

const ffSessions = new Map(); // sessionId -> { proc, relay, userDataDir, title, proxyLabel, createdAt }
// Session lifecycle sink (set by ipcHandlers) — parity with browserEngine so Firefox
// launches/closes/crashes feed the same SessionState + crash-recovery pipeline.
let sessionEventSink = null;
function setSessionEventSink(fn) { sessionEventSink = (typeof fn === 'function') ? fn : null; }
function emitSessionEvent(evt) { try { if (sessionEventSink) sessionEventSink(evt); } catch (e) { /* never break a launch/close */ } }
const ffIntentionalClose = new Set(); // sessionIds the user explicitly closed
let ffShuttingDown = false;            // app quitting — closes are not crashes

// Local HTTP proxy that injects Proxy-Authorization to an authenticated upstream,
// so Firefox connects auth-free to 127.0.0.1:<port>. Supports GET + CONNECT.
function startAuthRelay(proxy) {
  return new Promise((resolve, reject) => {
    const authHeader = 'Basic ' + Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
    const upstreamHost = proxy.host;
    const upstreamPort = Number(proxy.port);
    const open = new Set(); // live tunnel sockets — destroyed on close() so none leak
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
          upstream.setTimeout(0); // tunnel established — long-lived, so drop the connect timeout
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

  // Windows: disable the launcher/stub process so the process we spawn IS the real
  // browser. With the launcher on, the first firefox.exe hands off and exits right after
  // startup, and that exit is misread as a crash (the tracked PID dies while Firefox
  // keeps running). Honored from prefs on subsequent launches.
  pref('browser.launcherProcess.enabled', false);

  // Full first-run / onboarding suppression, so a brand-new profile opens straight to the
  // start page instead of the multi-step "first time user setup" (about:welcome, the
  // import wizard, the What's-New panel, the DoH first-run, the upgrade dialog).
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

  // Anti-leak: turn OFF WebRTC and geolocation so the real IP/location can't escape.
  pref('media.peerconnection.enabled', false);
  pref('media.navigator.enabled', false);
  pref('geo.enabled', false);
  pref('dom.webnotifications.enabled', false);

  // User-Agent override (kept consistent with the profile).
  if (opts.userAgent) pref('general.useragent.override', opts.userAgent);

  // Locale.
  if (opts.acceptLanguages) {
    pref('intl.accept_languages', opts.acceptLanguages);
    pref('intl.locale.requested', opts.acceptLanguages.split(',')[0]);
  }

  // Smart Autofill extension (installed into <profile>/extensions/). Allow
  // profile-scope (sideloaded) add-ons to install + stay enabled, and don't let
  // Firefox phone home to update them.
  if (opts.autofill) {
    pref('extensions.autoDisableScopes', 0);
    pref('extensions.enabledScopes', 15);
    pref('extensions.startupScanScopes', 15);
    pref('extensions.installDistroAddons', false);
    pref('extensions.update.enabled', false);
    pref('extensions.getAddons.cache.enabled', false);
    // Honored on Developer Edition / Nightly / ESR-unbranded → loads the UNSIGNED
    // build for testing. Locked-true on release/beta, which require the signed .xpi.
    pref('xpinstall.signatures.required', false);
  }

  // Proxy. type 1 = manual. `opts.proxy` is the EFFECTIVE proxy — the caller has
  // already swapped it to point at a local no-auth relay when the upstream needs
  // credentials (Firefox prefs can carry NO proxy auth, for HTTP or SOCKS), so this
  // just maps host/port/type onto the right prefs.
  if (opts.proxy) {
    const p = opts.proxy;
    const isSocks = /socks/i.test(p.type);
    pref('network.proxy.type', 1);
    pref('network.proxy.no_proxies_on', '');
    if (isSocks) {
      pref('network.proxy.socks', p.host);
      pref('network.proxy.socks_port', Number(p.port));
      pref('network.proxy.socks_version', /4/.test(p.type) ? 4 : 5);
      pref('network.proxy.socks_remote_dns', true);
    } else {
      pref('network.proxy.http', p.host);
      pref('network.proxy.http_port', Number(p.port));
      pref('network.proxy.ssl', p.host);
      pref('network.proxy.ssl_port', Number(p.port));
      pref('network.proxy.share_proxy_settings', true);
    }
  }

  return lines.join('\n') + '\n';
}

// Map a proxy-geo result (from browserEngine.lookupProxyGeoNodeCached) to a Firefox
// intl.accept_languages value (e.g. "de-DE,de,en"). Returns null when the country is
// unknown so the caller leaves the locale untouched.
function ipLocaleFromGeo(geo) {
  if (!geo || !geo.countryCode) return null;
  let COUNTRY_LOCALE;
  try { ({ COUNTRY_LOCALE } = require('./browserEngine')); } catch (e) { return null; }
  const loc = COUNTRY_LOCALE[geo.countryCode];
  if (!loc) return null;
  return Array.from(new Set([loc, loc.split('-')[0], 'en'])).join(',');
}

async function launchFirefoxProfile(options = {}) {
  const {
    profileId, title, dataDirName, profileRoot, profile = {}, startUrl = 'about:blank'
  } = options;

  const wantVersion = profile.browserVersion || options.browserVersion || 'Auto';
  const ff = resolveFirefoxBinary(wantVersion);
  if (!ff) throw new Error('Firefox is not installed. Download a FlowerBrowser version from the browser selector (or install Firefox on this machine) to launch this profile.');

  const root = path.resolve(profileRoot || path.resolve(process.cwd(), 'softglaze_profiles'));
  const safe = String(dataDirName || title || `ff-${profileId || crypto.randomUUID()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const userDataDir = path.join(root, 'firefox', safe);
  await fsp.mkdir(userDataDir, { recursive: true });

  const proxy = parseProxyInput(options.proxy || options.proxyInfoString);
  const proxyLabel = proxy ? `${proxy.type} ${proxy.host}:${proxy.port}` : 'Direct (No Proxy)';

  // Firefox prefs can carry NO proxy credentials — neither for HTTP nor SOCKS. When the
  // upstream needs auth, run a tiny local NO-AUTH relay that injects the credentials and
  // point Firefox at 127.0.0.1:<relayPort> instead:
  //   • authenticated HTTP(S) proxy → HTTP relay (startAuthRelay)
  //   • authenticated SOCKS5 proxy  → SOCKS5 relay (startSocksAuthRelay) — mirrors the
  //     Chrome engine; without it an auth SOCKS5 proxy makes Firefox report "The proxy
  //     server is refusing connections" because it can only offer NO-AUTH.
  // No-auth proxies (IP-whitelisted) are pointed at directly. A relay that fails to bind
  // now THROWS a clear error instead of silently falling back to a broken direct config.
  let relay = null;              // { port, close } — closed on teardown / launch failure
  let effectiveProxy = proxy;
  if (proxy && (proxy.username || proxy.password)) {
    const typeLc = String(proxy.type || '').toLowerCase();
    const isSocks5 = typeLc === 'socks5';   // only SOCKS5 carries username/password auth
    const isSocks4 = typeLc.startsWith('socks') && !isSocks5; // socks4/4a can't carry a password
    // A SOCKS4/4a upstream has no password handshake — its optional userid isn't auth we
    // can inject, so pass it directly (matches the Chrome engine, which only relays socks5).
    if (!isSocks4) {
      try {
        relay = isSocks5 ? await startSocksAuthRelay(proxy) : await startAuthRelay(proxy);
      } catch (e) {
        throw new Error(`Could not start the local ${isSocks5 ? 'SOCKS5' : 'HTTP'} proxy authentication relay for this profile: ${(e && e.message) || e}`);
      }
      effectiveProxy = { type: isSocks5 ? 'SOCKS5' : 'HTTP', host: '127.0.0.1', port: relay.port, username: null, password: null };
    }
  }

  // Bind timezone + locale to the PROXY EXIT (parity with the Chrome engine). Firefox
  // previously left both on the HOST unless the user picked "Custom", so a proxied
  // profile on the default "Based on IP" leaked the host timezone/locale while exiting
  // in another country — a direct IP-vs-JS mismatch every scanner flags. Look the geo up
  // THROUGH the real upstream proxy (which carries the creds + real exit), cached so
  // repeat launches of the same proxy don't re-hit the network.
  const tzCustom = profile.timezoneType === 'Custom' && profile.timezoneCustom;
  const langCustom = profile.languageType === 'Custom' && profile.languageCustom;
  let proxyGeo = null;
  if (proxy && (!tzCustom || !langCustom)) {
    try {
      const { lookupProxyGeoNodeCached } = require('./browserEngine');
      proxyGeo = await lookupProxyGeoNodeCached(proxy);
    } catch (e) { proxyGeo = null; }
  }
  const acceptLanguages = langCustom
    ? String(profile.languageCustom).split(';')[0].trim()
    : ipLocaleFromGeo(proxyGeo);
  const timezoneId = tzCustom
    ? String(profile.timezoneCustom).trim()
    : (proxyGeo && proxyGeo.timezone ? String(proxyGeo.timezone).trim() : null);

  // Smart Autofill — install the WebExtension into the profile (and only enable
  // the supporting prefs if it actually landed). Gated by the caller's setting;
  // never fatal to a launch.
  let autofillInstalled = false;
  if (options.autofillEnabled !== false) {
    const r = await installAutofillExtension(userDataDir).catch(() => ({ mode: 'none' }));
    autofillInstalled = r.mode !== 'none';
  }

  // UA override for real Firefox. NEVER apply a Chrome-family UA to a Gecko binary: the
  // engine still exposes Firefox-only tells (buildID, oscpu, no navigator.userAgentData),
  // so a `Chrome/NNN` UA over them is an instant engine/UA mismatch (the pixelscan flag).
  // Honor an explicit *Firefox* UA if one is set; for 'Auto', empty, or a Chrome UA fall
  // back to null → the binary's own native, coherent Firefox UA (matches its TLS/JA4).
  const storedUa = profile.userAgent && profile.userAgent !== 'Auto' ? String(profile.userAgent).trim() : '';
  const firefoxUserAgent = (/firefox\//i.test(storedUa) && !/chrome\//i.test(storedUa)) ? storedUa : null;
  const userJs = buildUserJs({
    proxy: effectiveProxy,
    userAgent: firefoxUserAgent,
    acceptLanguages,
    autofill: autofillInstalled
  });
  // audit: from relay creation until the exit handlers are wired, a throw here leaves
  // the relay (an open authenticated local proxy) listening forever. Close it on any
  // failure of the two realistic throw points (user.js write, spawn) before re-throwing.
  try {
    await fsp.writeFile(path.join(userDataDir, 'user.js'), userJs);
  } catch (e) {
    if (relay) { try { relay.close(); } catch (_) {} }
    throw e;
  }

  const env = { ...process.env };
  if (timezoneId) env.TZ = timezoneId; // Firefox honors TZ for Date/Intl on all platforms

  // Open the SoftGlaze start page (proxy IP / geo card + quick links) — the same page the
  // Chrome engine shows — unless the caller passed a concrete URL. Generated INTO the
  // profile dir and passed as a proper file:// URL (Firefox needs the file:///C:/… form).
  let openUrl = (startUrl && startUrl !== 'about:blank') ? startUrl : null;
  if (!openUrl) {
    try {
      const { generateStartPage } = require('./browserEngine');
      await generateStartPage(userDataDir, { title: title || `Profile ${profileId}`, profileId: profileId != null ? profileId : 'TEMP-ID', proxyLabel, geo: null });
      openUrl = pathToFileURL(path.join(userDataDir, 'start.html')).href;
    } catch (e) { openUrl = null; /* fall back to the homepage prefs */ }
  }

  // -wait-for-browser: keep THIS process alive until the real browser exits. Without it the
  // initial firefox.exe hands off to the actual browser and returns immediately, so the
  // tracked process died right after launch — the session was dropped from the registry (no
  // Stop button in the UI) while Firefox kept running. --no-first-run is a CHROME flag;
  // Firefox's first-run is suppressed via prefs (buildUserJs) instead.
  const args = ['-profile', userDataDir, '-no-remote', '-new-instance', '-wait-for-browser'];
  if (openUrl) args.push('-url', openUrl);

  // stdio:'ignore' — nothing reads Firefox's stdout/stderr, and an undrained pipe can
  // fill its buffer and stall the child on Windows.
  let proc;
  try {
    proc = spawn(ff, args, { env, detached: false, windowsHide: false, stdio: 'ignore' });
  } catch (e) {
    if (relay) { try { relay.close(); } catch (_) {} } // don't leak the relay on a spawn failure
    throw e;
  }
  const sessionId = String(profileId || crypto.randomUUID());
  const session = { proc, relay, userDataDir, title: title || `Profile ${sessionId}`, proxyLabel, createdAt: new Date(), engine: 'firefox' };
  ffSessions.set(sessionId, session);

  let ffSettled = false;
  const onGone = () => {
    // 'exit' and 'error' can BOTH fire for one process — run teardown (and emit the
    // session event) exactly once, or a single close is reported as two and can drive a
    // spurious crash-recovery relaunch.
    if (ffSettled) return;
    ffSettled = true;
    if (session.relay) session.relay.close();
    ffSessions.delete(sessionId);
    let reason = 'crash';
    if (ffShuttingDown) reason = 'shutdown';
    else if (ffIntentionalClose.has(sessionId)) { reason = 'user'; ffIntentionalClose.delete(sessionId); }
    emitSessionEvent({ type: reason === 'crash' ? 'crashed' : 'closed', sessionId, reason, engine: 'firefox' });
  };
  proc.on('exit', onGone);
  proc.on('error', onGone);

  emitSessionEvent({ type: 'launched', sessionId, profileId: (profileId != null ? Number(profileId) : null), engine: 'firefox' });

  return { sessionId, userDataDir, engine: 'firefox' };
}

// Kill the tracked process AND its children. With -wait-for-browser the process we hold is
// the parent of the real browser; a plain proc.kill() would end the waiter but leave the
// browser window open (and the profile locked). taskkill /T reaps the whole tree on Windows.
function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); return; }
    catch (e) { /* fall through to a plain kill */ }
  }
  try { proc.kill(); } catch (e) { /* ignore */ }
}

async function closeFirefoxSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = ffSessions.get(id);
  if (!session) return { closed: false };
  ffIntentionalClose.add(id); // deliberate close — the exit must not be read as a crash
  killProcessTree(session.proc);
  if (session.relay) session.relay.close();
  ffSessions.delete(id);
  return { closed: true };
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
  ffShuttingDown = true; // app quitting — Firefox closes are not crashes
  for (const id of Array.from(ffSessions.keys())) await closeFirefoxSession(id);
}

// --- On-demand Firefox download + PORTABLE extract -----------------------------
// We pull the FULL offline installer from Mozilla's release archive and, instead of
// RUNNING it (which would register Firefox system-wide in Windows), EXTRACT its
// payload into /firefox/<version> so the launcher can resolve a version-matched
// binary. Pure Node + Windows' built-in bsdtar — no new npm dependency, and NO
// system footprint (mirrors the portable Chrome-for-Testing unzip).

const FF_HISTORY = 'https://product-details.mozilla.org/1.0/firefox_history_major_releases.json';
const FF_STATE_FILE = path.join(FIREFOX_ROOT, '.download-state.json');
const ffDownloads = new Map(); // major -> { version, major, percent, state, error, receivedBytes, totalBytes, url, dest }
const ffAborters = new Map(); // major -> abort fn while downloading
const ffPaused = new Set(); // majors the user explicitly paused
let ffCatalog = null;
let ffCatalogAt = 0;
let ffLastPersist = 0;

// Stable partial-download path (NOT keyed by PID, so it survives an app restart
// and can be resumed). bsdtar sniffs the archive by content, not extension, so we
// extract straight from the .part file.
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
    // audit: https-only + Mozilla-host allowlist on the URL and every redirect.
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
  const full = ffFullVersion(version);
  return `https://ftp.mozilla.org/pub/firefox/releases/${full}/win64/en-US/Firefox%20Setup%20${full}.exe`;
}

// SHA-256 of a local file (streamed).
function ffSha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('error', reject);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

// Fetch Mozilla's published SHA256SUMS for a release and return the expected hash
// for the win64/en-US installer, or null if it can't be obtained/parsed. Served
// from the ftp.mozilla.org ORIGIN (the installer itself may come from a CDN edge),
// so this is an independent integrity path on top of https + host-pinning.
async function ffExpectedInstallerSha(version) {
  const full = ffFullVersion(version);
  const url = `https://ftp.mozilla.org/pub/firefox/releases/${full}/SHA256SUMS`;
  let res;
  try { res = await ffHttpsGet(url); } catch (e) { return null; }
  if (res.statusCode !== 200) { try { res.resume(); } catch (_) {} return null; }
  let text = '';
  try { for await (const chunk of res) { text += chunk; if (text.length > 5_000_000) break; } } catch (e) { return null; }
  const wanted = `win64/en-US/Firefox Setup ${full}.exe`;
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
    // Offline / blocked — fall back to a constructed recent-major list.
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

// GET carrying custom headers (Range) AND following redirects preserving them.
// Resolves with the FINAL { res, req } so the caller can abort the live request.
function ffRawGet(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    // audit: https-only + Mozilla-host allowlist on the URL and every redirect.
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

// Portable extraction — NO Windows install. The Mozilla "Firefox Setup <v>.exe" is a
// 7-Zip SFX whose payload lives under a top-level `core/` folder. Running the NSIS
// installer (even silent /S /D=) registers Firefox system-wide: HKLM/HKCU keys, an
// Add/Remove-Programs entry PER version, the Mozilla Maintenance Service, and the
// default-browser-agent scheduled task — exactly the footprint we must avoid. Instead
// we extract the payload with Windows' built-in bsdtar (System32\tar.exe, libarchive
// — ships on Win10 17063+/Win11, no new dependency), flattening `core/` so
// firefox.exe lands directly at <dir>/firefox.exe (the layout resolveFirefoxBinary /
// isFirefoxVersionInstalled expect). Result: a self-contained /firefox/<major> tree
// with zero system footprint, exactly like the unzipped Chrome-for-Testing build.
function extractFirefoxPortable(part, dir) {
  return new Promise((resolve, reject) => {
    const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    // --strip-components=1 core : take ONLY the installer's core/ tree and drop the
    // leading "core/" path segment, so we get <dir>/firefox.exe not <dir>/core/firefox.exe.
    const ps = spawn(tarExe, ['-xf', part, '-C', dir, '--strip-components=1', 'core'], { windowsHide: true });
    let err = '';
    if (ps.stderr) ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0
      ? resolve()
      : reject(new Error('Firefox extract failed: ' + (err.slice(0, 300) || `exit ${code}`)))));
  });
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

      // audit: verify the downloaded installer against Mozilla's published
      // SHA256SUMS before running it. If the checksum is available and mismatches,
      // refuse to execute (fatal — the partial file is then wiped below). If
      // SHA256SUMS can't be fetched (offline / older layout), fall back to the
      // transport trust already enforced (https + Mozilla-host pinning).
      entry.state = 'verifying';
      entry.percent = 86;
      ffPersistState(true);
      const expectedSha = await ffExpectedInstallerSha(major);
      if (expectedSha) {
        const actualSha = (await ffSha256File(part)).toLowerCase();
        if (actualSha !== expectedSha) {
          throw Object.assign(new Error('Firefox installer failed SHA-256 verification — refusing to run it.'), { fatal: true });
        }
      }

      entry.state = 'installing';
      entry.percent = 88;
      ffPersistState(true);
      // Portable extract into /firefox/<major> — NO system install (see
      // extractFirefoxPortable). bsdtar needs the -C target to exist first.
      await fsp.mkdir(firefoxInstallDir(major), { recursive: true });
      await extractFirefoxPortable(part, firefoxInstallDir(major));
      await fsp.unlink(part).catch(() => {});

      if (!isFirefoxVersionInstalled(major)) throw Object.assign(new Error('Extracted but firefox.exe was not found.'), { fatal: true });
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

// Pause an in-flight Firefox download: abort the socket, KEEP the partial file.
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
  resolveFirefoxBinary,
  isFirefoxVersionInstalled,
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
  FIREFOX_ROOT
};
