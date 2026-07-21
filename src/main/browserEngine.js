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
// Canonical install root for downloaded Chrome-for-Testing builds. Imported so the
// binary RESOLVER reads exactly where the DOWNLOADER writes (userData when packaged,
// project root in dev). No circular dep — browserDownloader needs only node + electron.
const { CHROME_ROOT: DOWNLOAD_CHROME_ROOT } = require('./browserDownloader');
// Smart Autofill (Identity Data Vault) — source of the in-page widget injected
// into every launched page. No deps; just returns a self-contained IIFE string.
const { buildAutofillBootstrap } = require('./personaAutofill');
const PERSONA_AUTOFILL_SOURCE = buildAutofillBootstrap();
// Local SOCKS5 auth-injecting relay — Chromium can't authenticate to a SOCKS5
// proxy, so an authenticated one is routed through this instead (audit).
const { startSocksAuthRelay } = require('./socksRelay');
const { startHttpAuthRelay } = require('./httpRelay');

// SoftGlaze first-party extension (Chrome Web Store ID). Best-effort force-install
// on Chromium / Chrome-for-Testing so the store counts active users; the unpacked
// --load-extension load remains the guaranteed fallback (and is what loads it in
// SoftGlaze profiles). Real stable Chrome ignores --load-extension, so the policy
// path is the only way it would load there — but we scope the policy to the Chromium
// key ONLY and never touch the user's personal Google Chrome.
const SOFTGLAZE_RECORDER_ID = 'ofjommapkklakbolagajoiklgfldhlmp';
let forceInstallWritten = false;
function ensureChromiumForceInstall(extId) {
  if (process.platform !== 'win32' || forceInstallWritten) return;
  forceInstallWritten = true;
  try {
    const { spawn } = require('node:child_process');
    const value = `${extId};https://clients2.google.com/service/update2/crx`;
    // Per-user (HKCU → no admin) policy read by Chromium / Chrome-for-Testing.
    const key = 'HKCU\\Software\\Policies\\Chromium\\ExtensionInstallForcelist';
    const p = spawn('reg', ['add', key, '/v', '100', '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'ignore' });
    p.on('error', () => {}); // best-effort — the unpacked inject fallback covers any failure
  } catch (e) { /* ignore */ }
}

// Stealth hides automation tells, but several of its evasions set the SAME
// properties we spoof ourselves (UA, WebGL vendor, hardwareConcurrency,
// languages). Running both produces the inconsistent values detectors flag
// (e.g. CreepJS seeing "Intel Iris" from stealth AND our AMD GPU). Disable the
// overlapping evasions so OUR per-profile values are the single source of truth.
// Build a stealth plugin with the overlapping evasions stripped (our per-profile values
// are the single source of truth). A FRESH instance is required per puppeteer engine —
// a plugin instance cannot be shared across two PuppeteerExtra instances.
function makeStealth() {
  const s = StealthPlugin();
  ['user-agent-override', 'navigator.hardwareConcurrency', 'navigator.languages', 'webgl.vendor']
    .forEach((e) => { try { s.enabledEvasions.delete(e); } catch (err) {} });
  return s;
}
puppeteer.use(makeStealth());

// OPT-IN "minimize CDP footprint" engine (default OFF; browserSettings.minimizeCdpFootprint).
// Stock puppeteer keeps the CDP Runtime domain ENABLED for the whole session — the #1
// Cloudflare/anti-bot automation tell (a page-side getter detects it), which no stealth
// evasion covers. rebrowser-puppeteer-core in enableDisable mode avoids the PERSISTENT
// Runtime.enable (it enables only transiently, per navigation, to acquire the main-world
// execution context), removing that tell while keeping page.evaluate working.
// TRADE-OFF (verified): page->node bindings (page.exposeFunction) REQUIRE the persistent
// Runtime.enable — a binding does not survive Runtime.disable — so with this engine the
// exposeFunction features (persona autofill, start-page check-links / __sgzOpenTab, and
// synchronized-session mirroring) do NOT work. It is therefore an opt-in probe to A/B
// whether the leak fix beats a real CAPTCHA, not the default. Required lazily so a
// stock-engine launch never loads the dependency.
let _runtimeFixPuppeteer = null;
function getRuntimeFixPuppeteer() {
  if (_runtimeFixPuppeteer) return _runtimeFixPuppeteer;
  // rebrowser reads this from process.env at runtime. enableDisable is the only mode
  // that keeps main-world page.evaluate working (addBinding is unwired in 22.15.0;
  // alwaysIsolated loses the main world).
  if (!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE) process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = 'enableDisable';
  const { addExtra } = require('puppeteer-extra');
  const engine = addExtra(require('rebrowser-puppeteer-core'));
  engine.use(makeStealth());
  _runtimeFixPuppeteer = engine;
  return engine;
}

// Anti-detect (fingerprint-chromium) engine driver: a puppeteer-extra instance with NO
// stealth plugin. fingerprint-chromium already hides navigator.webdriver + the
// HeadlessChrome UA and spoofs canvas/webgl/audio/UA NATIVELY, so the stealth evasions
// are redundant AND self-defeating — their patch patterns are themselves fingerprintable
// (CreepJS was reporting "60% stealth" on this engine). A clean instance drives the
// browser without adding that tell. Persona autofill / exposeFunction still work: those
// need only the CDP Runtime domain, which stock puppeteer keeps enabled.
let _nativeEngine = null;
function getNativeEngine() {
  if (_nativeEngine) return _nativeEngine;
  const { addExtra } = require('puppeteer-extra');
  _nativeEngine = addExtra(require('puppeteer-core'));
  return _nativeEngine;
}

const DEFAULT_PROFILE_ROOT = path.resolve(process.cwd(), 'softglaze_profiles');
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 720 };
const GEO_LOOKUP_TIMEOUT_MS = 8000;
const activeSessions = new Map();

// --- Session lifecycle events (sink set by ipcHandlers) --------------------
// browserEngine stays free of DB/IPC deps; it just reports launched/closed/crashed
// through a sink so ipcHandlers can persist SessionState and notify the renderer.
let sessionEventSink = null;
function setSessionEventSink(fn) { sessionEventSink = (typeof fn === 'function') ? fn : null; }
function emitSessionEvent(evt) { try { if (sessionEventSink) sessionEventSink(evt); } catch (e) { /* never let reporting break a launch/close */ } }
const intentionalClose = new Set(); // sessionIds the user explicitly closed (so the disconnect isn't read as a crash)
let shuttingDown = false;           // app is quitting; closes are not crashes and must not clear restore state

// --- Smart Autofill (Identity Data Vault) bridge -------------------------------
// Wired by ipcHandlers at startup with the persona DB operations, so the
// page-injected widget can reach Prisma through puppeteer's exposeFunction — no
// HTTP server, no auth, in-process. Stays a no-op until configured.
let personaBridge = null;
function configurePersonaBridge(deps) {
  if (deps && typeof deps.listForUrl === 'function' && typeof deps.markUsed === 'function') {
    personaBridge = deps;
  }
}

// Expose the two persona bridge functions on a page and inject the autofill widget
// (both for future navigations and the currently-loaded document). Safe to call
// once per page — exposeFunction throws if a name is already bound, which we
// swallow. Chromium-only: this whole module is the puppeteer/CDP launch path.
// Hardening (audit C2): exposeFunction binds into the page's MAIN world, so ANY
// script on ANY page can call these — not just our widget. Three defenses:
//   1. Origin is taken from the REAL committed page URL (targetPage.url()), never
//      from a page-supplied argument, so a hostile page can't pass a random host
//      to dump personas it hasn't "used" yet.
//   2. Passwords are NEVER sent into page context: the list payload omits the
//      password (only `hasPassword` is exposed), and password fields are filled
//      server-side by persona id via the fill plan — the plaintext only ever
//      reaches the DOM field the user is filling, exactly like a password manager.
//   3. The fill plan is bounded (item count + a total typed-character budget) so a
//      page can't tie up the CDP keyboard for hours with a giant value.
const PERSONA_FILL_MAX_ITEMS = 40;
const PERSONA_FILL_MAX_VALUE_LEN = 256;   // per page-supplied field value
const PERSONA_FILL_MAX_TOTAL_CHARS = 4000; // whole-plan typing budget

// Strip secrets from a persona before it is handed to page JS. Keeps the
// non-secret fields the widget needs to fill (name/email/address/…) but replaces
// the password with a boolean so the page can never read it in bulk.
function toPublicPersona(p) {
  if (!p || typeof p !== 'object') return null;
  const { password, ...rest } = p;
  return { ...rest, hasPassword: Boolean(password) };
}

async function attachPersonaAutofill(targetPage) {
  if (!personaBridge || !targetPage) return;
  // Respect the global Smart Autofill toggle (fail-open if the check throws).
  if (personaBridge.isEnabled) { try { if (!(await personaBridge.isEnabled())) return; } catch (e) { /* default on */ } }
  // The real committed origin of THIS page — the single source of truth for which
  // host personas are scoped to. Falls back to '' (bridge then returns nothing).
  const pageUrl = () => { try { return targetPage.url() || ''; } catch (e) { return ''; } };
  try {
    await targetPage.exposeFunction('__sgPersonaList', async () => {
      try {
        const r = await personaBridge.listForUrl(pageUrl());
        const list = (r && Array.isArray(r.personas)) ? r.personas : (Array.isArray(r) ? r : []);
        return list.map(toPublicPersona).filter(Boolean);
      } catch (e) { return []; }
    });
  } catch (e) { /* already exposed on this page */ }
  try {
    await targetPage.exposeFunction('__sgPersonaMarkUsed', async (id) => {
      try { await personaBridge.markUsed(String(id || ''), pageUrl()); return { ok: true }; }
      catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    });
  } catch (e) { /* already exposed on this page */ }
  try {
    // CDP "trusted" typing: the in-page widget stamps each matched field and hands
    // us a fill plan; we type it here with REAL keyboard events (isTrusted:true) and
    // human-like random delays — defeating isTrusted-based bot checks. Selects are
    // set via the native picker. Password items carry NO value — only a personaId —
    // and the plaintext is resolved server-side (see defense #2 above).
    await targetPage.exposeFunction('__sgPersonaFillPlan', async (plan) => {
      if (!Array.isArray(plan)) return { ok: false, filled: 0 };
      const items = plan.slice(0, PERSONA_FILL_MAX_ITEMS);
      const secretCache = new Map(); // personaId -> password (fetched once per plan)
      let filled = 0;
      let charBudget = PERSONA_FILL_MAX_TOTAL_CHARS;
      // audit C2 bypass: the page supplies both the selector AND the personaId, so a
      // hostile page could aim a password fill at its own hidden input and read the
      // value back — defeating "the plaintext only reaches the field the user is
      // filling". Two HARD gates guard the secret path, resolved once per plan:
      //   (1) the page must have had a genuine user gesture (userActivation), and
      //   (2) the personaId must be one actually OFFERED for THIS committed origin
      //       (present in listForUrl(pageUrl())) — never an arbitrary/guessed id.
      // Non-secret fields are unaffected. An empty allow-set → no password resolves.
      let allowedSecretIds = null;
      const ensureAllowedSecretIds = async () => {
        if (allowedSecretIds) return allowedSecretIds;
        allowedSecretIds = new Set();
        let gestured = false;
        try { gestured = await targetPage.evaluate(() => { try { return !!(navigator.userActivation && navigator.userActivation.hasBeenActive); } catch (e) { return false; } }); } catch (e) { gestured = false; }
        if (!gestured) return allowedSecretIds;
        if (typeof personaBridge.listForUrl !== 'function') return allowedSecretIds;
        try {
          const r = await personaBridge.listForUrl(pageUrl());
          const list = (r && Array.isArray(r.personas)) ? r.personas : (Array.isArray(r) ? r : []);
          for (const p of list) if (p && p.id != null) allowedSecretIds.add(String(p.id));
        } catch (e) { /* empty set → refuse every secret */ }
        return allowedSecretIds;
      };
      for (const item of items) {
        const sel = item && item.sel;
        if (!sel) continue;
        let value;
        if (item.kind === 'password') {
          // Password value NEVER comes from the page — resolve it server-side by id,
          // but only when gesture-gated AND offered for this origin (see above).
          const pid = item.personaId != null ? String(item.personaId) : '';
          if (!pid || typeof personaBridge.getSecret !== 'function') continue;
          const allowed = await ensureAllowedSecretIds();
          if (!allowed.has(pid)) continue;
          if (!secretCache.has(pid)) {
            try { const s = await personaBridge.getSecret(pid); secretCache.set(pid, (s && s.password != null) ? String(s.password) : ''); }
            catch (e) { secretCache.set(pid, ''); }
          }
          value = secretCache.get(pid);
          if (!value) continue;
        } else {
          value = item.value != null ? String(item.value) : '';
          if (value.length > PERSONA_FILL_MAX_VALUE_LEN) value = value.slice(0, PERSONA_FILL_MAX_VALUE_LEN);
        }
        try {
          if (item.kind === 'select') {
            // page.select returns the option values it ACTUALLY applied ([] when none of
            // the <option>s match, e.g. persona 'United States' vs option value 'US'). Only
            // count it as filled when something matched — otherwise the widget reports
            // "Filled N fields" for a dropdown it left untouched.
            const applied = await targetPage.select(sel, value).catch(() => []);
            if (Array.isArray(applied) && applied.length) filled += 1;
            continue;
          }
          const el = await targetPage.$(sel);
          if (!el) continue;
          await el.click({ clickCount: 3 }).catch(() => {}); // focus + select any existing text (first keystroke overwrites)
          const typed = charBudget > 0 ? value.slice(0, charBudget) : '';
          for (const ch of typed) {
            await targetPage.keyboard.type(ch, { delay: 50 + Math.floor(Math.random() * 100) });
          }
          charBudget -= typed.length;
          await el.evaluate((node) => { try { node.dispatchEvent(new Event('change', { bubbles: true })); if (node.blur) node.blur(); } catch (e) {} }).catch(() => {});
          await el.dispose().catch(() => {});
          filled += 1;
        } catch (e) { /* skip one field, keep going */ }
      }
      return { ok: true, filled };
    });
  } catch (e) { /* already exposed on this page */ }
  try { await targetPage.evaluateOnNewDocument(PERSONA_AUTOFILL_SOURCE); } catch (e) {}
  try { await targetPage.evaluate(PERSONA_AUTOFILL_SOURCE); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Real Chrome binaries. Profiles launch an ACTUAL Chrome build (Chrome for
// Testing) whose version matches the profile — so UA, Client-Hints, TLS/JA4 and
// even Web Worker contexts all natively report the same real version. This is
// what makes "SunBrowser 149" genuinely present as 149 everywhere, instead of
// faking the UA on top of a different engine (which detectors catch as a
// mismatch). Layout on disk: <root>/chrome/win64-<version>/chrome-win64/chrome.exe
// ---------------------------------------------------------------------------
const CHROME_DIRS = [
  DOWNLOAD_CHROME_ROOT,                                     // where the downloader installs (userData when packaged)
  path.resolve(__dirname, '../../chrome'),                 // dev: project root (same as above in dev)
  process.env.SOFTGLAZE_CHROME_DIR || ''                   // optional override
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
  // Match on the MAJOR only — `desired` may be a bare major ("142") or a full
  // version ("142.0.7444.176"); take the first run of digits either way.
  const major = Number.parseInt((String(desired || '').match(/\d+/) || [])[0] || '', 10);
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
function chooseBrowserBinary(profile, opts = {}) {
  // When this profile is set to load SoftGlaze/team extensions, prefer Chrome-for-Testing:
  // real stable Chrome SILENTLY IGNORES --load-extension (a 2025 security change), so the
  // extensions would never mount there. This is a deliberate per-profile trade-off —
  // real Chrome is stealthier (genuine binary, no "Testing" build, no NTP-override
  // workaround), so profiles that DON'T need extensions keep preferring it.
  if (opts.preferCftForExtensions) {
    const cft = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
    if (cft) return { ...cft, isReal: false };
    // No CfT build installed — fall through to real Chrome so the profile still launches
    // (the extensions just won't mount; the UI hint tells the user to install a browser).
  }
  const real = findRealChrome();
  if (real) return real;
  const cft = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
  return cft ? { ...cft, isReal: false } : null;
}

// --- FINGERPRINT-CHROMIUM (native anti-detect engine, opt-in) ------------------
// adryfish/fingerprint-chromium is a source-patched Ungoogled-Chromium that spoofs
// the fingerprint NATIVELY (canvas / webgl / audio / UA / platform / timezone) from
// a seed + flags — no JS injection, no CDP overrides, no first-load race. It also
// natively hides navigator.webdriver + the HeadlessChrome UA AND blocks the WebRTC
// real-IP leak (all proven in the Phase-0 head-to-head). We drive it through the
// SAME puppeteer path as stock Chrome but pass native flags and SKIP our JS layer
// (fpConfig.nativeEngine) so the two identities can't contradict each other.
// Default OFF; binary resolved from a managed dir, so nothing changes until opt-in.
const FP_CHROMIUM_ROOT = path.join(path.dirname(DOWNLOAD_CHROME_ROOT), 'fp-chromium');
function resolveAntidetectBinary() {
  // Packaged (userData/../fp-chromium) first, then the dev checkout's <repo>/fp-chromium.
  const roots = [FP_CHROMIUM_ROOT, path.resolve(__dirname, '../../fp-chromium')];
  for (const root of roots) {
    try {
      const direct = path.join(root, 'chrome.exe');
      if (fsSync.existsSync(direct)) return direct;
      // The GitHub release extracts to a single versioned subdir (…_windows_x64/chrome.exe).
      for (const ent of fsSync.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const nested = path.join(root, ent.name, 'chrome.exe');
        if (fsSync.existsSync(nested)) return nested;
      }
    } catch (e) { /* root missing — try the next */ }
  }
  return null;
}

// Map a profile's generated identity onto fingerprint-chromium's native flags. Only
// the coherently-mappable axes are passed (seed / platform / brand / cores / locale
// / timezone); the binary derives everything else (canvas, webgl, audio, exact UA)
// from the seed, guaranteeing internal coherence. WebRTC real-IP leak is blocked
// natively via --disable-non-proxied-udp whenever a proxy is in play.
function buildAntidetectFlags(profile, fpConfig, seed, timezoneId, hasProxy) {
  const flags = [`--fingerprint=${(seed >>> 0) || 1}`];
  const os = String(profile.os || '').toLowerCase();
  flags.push(`--fingerprint-platform=${os.includes('mac') ? 'macos' : os.includes('linux') ? 'linux' : 'windows'}`);
  // fingerprint-chromium accepts Chrome / Edge / Opera / Vivaldi; anything else → Chrome.
  const rawBrand = String(profile.browserBrand || profile.browser || 'Chrome');
  const brand = /edge/i.test(rawBrand) ? 'Edge' : /opera/i.test(rawBrand) ? 'Opera'
    : /vivaldi/i.test(rawBrand) ? 'Vivaldi' : 'Chrome';
  flags.push(`--fingerprint-brand=${brand}`);
  const cores = Number(fpConfig && fpConfig.cores) || Number(profile.cpuCores) || 0;
  if (cores > 0) flags.push(`--fingerprint-hardware-concurrency=${cores}`);
  const langs = (fpConfig && Array.isArray(fpConfig.langs) && fpConfig.langs.length) ? fpConfig.langs : null;
  if (langs) {
    // --lang may also be emitted by the shared arg-builder with the same value; a
    // duplicate is harmless (Chromium honors the last, identical, occurrence).
    flags.push(`--lang=${langs[0]}`, `--accept-lang=${langs.join(',')}`);
  }
  if (timezoneId) flags.push(`--timezone=${timezoneId}`);
  if (hasProxy) flags.push('--disable-non-proxied-udp');
  return flags;
}

// --- PID TRACKING FOR ORPHAN CLEANUP ---
const PID_FILE = path.join(os.tmpdir(), 'softglaze_active_pids.json');

function trackPid(pid) {
  try {
    let pids = [];
    if (fsSync.existsSync(PID_FILE)) {
      const content = fsSync.readFileSync(PID_FILE, 'utf8').trim();
      if (content) pids = JSON.parse(content);
    }
    if (!Array.isArray(pids)) pids = []; // Fallback if JSON is an object instead of an array
    
    if (!pids.includes(pid)) pids.push(pid);
    fsSync.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) { 
    console.error('[PID Tracker] Failed to track PID', e.message); 
  }
}

function untrackPid(pid) {
  try {
    if (!fsSync.existsSync(PID_FILE)) return;
    const content = fsSync.readFileSync(PID_FILE, 'utf8').trim();
    if (!content) return; // Skip if file is empty
    
    let pids = JSON.parse(content);
    if (!Array.isArray(pids)) return;
    
    pids = pids.filter(p => p !== pid);
    fsSync.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) { 
    console.error('[PID Tracker] Failed to untrack PID', e.message); 
  }
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
  // Classify by scheme: socks4/socks4a → SOCKS4, socks5/bare socks → SOCKS5, else HTTP.
  // SOCKS4 vs SOCKS5 is not cosmetic — Chromium speaks a different wire protocol for
  // each and SOCKS4 has no username/password auth, so mislabeling one as the other
  // breaks the connection. The prefix (INCLUDING socks4://, which the old regex missed
  // and left in — mangling host:port) is stripped for every scheme before parsing.
  const scheme = (raw.match(/^(socks4a?|socks5|socks|https?):\/\//i) || [])[1] || '';
  const type = /^socks4/i.test(scheme) ? 'SOCKS4' : (/^socks/i.test(scheme) ? 'SOCKS5' : 'HTTP');
  const working = raw.replace(/^(socks4a?|socks5|socks|https?):\/\//i, '');
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
  // Chromium accepts socks5://, socks4:// and http:// proxy schemes natively. Emitting
  // the WRONG scheme (e.g. http:// for a SOCKS proxy) makes every request fail, so map
  // the type exactly rather than collapsing everything non-socks5 to http.
  const t = String(proxy.type).toLowerCase();
  const protocol = t === 'socks5' ? 'socks5' : (t === 'socks4' ? 'socks4' : 'http');
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
  // COHERENCE GUARD (anti-detect critical). The reported Chrome major MUST equal the
  // major of the binary we actually launched. TLS ClientHello (JA3/JA4), the HTTP/2
  // SETTINGS frame, and JS-engine feature detection all come from the REAL binary and
  // cannot be spoofed — so a UA / Client-Hints major that disagrees with them is a hard,
  // deterministic bot signal. The fingerprint generator pins a per-profile
  // browserVersion drawn from a fixed pool; on a machine whose real Chrome has
  // auto-updated PAST that pool, honoring the pin would advertise e.g. Chrome 149 over a
  // real-150+ handshake — the exact mismatch this guard closes.
  //
  // So whenever we can read the launched binary's version (the normal case) we report
  // THAT major AND full version — every layer then agrees. The profile's pin is used
  // only as a best-guess fallback when browser.version() is unreadable (essentially
  // never after a successful launch). Build/patch digits are not observable on the wire,
  // so reporting the binary's real full version is both coherent and safe. Two profiles
  // on the same real Chrome build therefore share a UA — which is exactly what two real
  // Chrome users do; a fake-unique major that contradicts the TLS is far more detectable.
  const pinned = String(profile.browserVersion || '').trim();
  const pinnedFull = /^\d+\.\d+\.\d+\.\d+$/.test(pinned) ? pinned : '';
  const pinnedMajor = (pinned && pinned.toLowerCase() !== 'auto')
    ? Number.parseInt((pinned.match(/\d+/) || [])[0] || '', 10)
    : NaN;
  const binaryVersionKnown = /^\d+\.\d/.test(String(realFullVersion || ''));
  const major = binaryVersionKnown
    ? realMajor
    : ((Number.isFinite(pinnedMajor) && pinnedMajor > 0) ? pinnedMajor : realMajor);
  const fullVersion = binaryVersionKnown
    ? realFullVersion
    : (pinnedFull || `${major}.0.0.0`);

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
  // Native anti-detect engine (fingerprint-chromium) spoofs the fingerprint at the
  // binary level from launch flags. When it's driving, this JS layer must NOT run: a
  // second, differently-derived spoof would CONTRADICT the native one (canvas / UA /
  // platform disagreeing across layers is itself a detection signal). Bail immediately.
  if (fp && fp.nativeEngine) return;
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
  // Native-toString masking. Detectors (browserscan flags "Canvas Tampering") test
  // whether overridden methods still report "[native code]" from .toString(). Make
  // every function we patch — and toString itself — look native, with the right .name.
  const _patched = new WeakSet();
  const _origFnToString = Function.prototype.toString;
  const _fnToString = function toString() {
    if (_patched.has(this)) return 'function ' + (this.name || '') + '() { [native code] }';
    return _origFnToString.call(this);
  };
  try {
    // Real Chrome: Function.prototype.toString.name === 'toString' and its OWN
    // toString() reports [native code]. Pin the name explicitly — otherwise it reports
    // the internal helper name (previously "_fnToString"), a global automation tell
    // that fires on every page and every proxy.
    try { Object.defineProperty(_fnToString, 'name', { value: 'toString', configurable: true }); } catch (e) {}
    Object.defineProperty(Function.prototype, 'toString', { value: _fnToString, configurable: true, writable: true });
    _patched.add(_fnToString);
  } catch (e) {}
  const markNative = (fn, name) => {
    try { if (name) Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
    try { _patched.add(fn); } catch (e) {}
    return fn;
  };

  // Define a spoofed accessor the way real Chrome exposes it: ON THE PROTOTYPE (so
  // navigator/screen.hasOwnProperty(prop) stays false, as in a real browser) with a
  // getter that itself reports [native code] and carries the correct "get <prop>"
  // name. Placing these on the instance (the old behavior) leaked the entire spoofed
  // field list via Object.getOwnPropertyNames(navigator) + a "() => value" getter
  // source — both classic navigator-tampering signatures. Falls back to an instance
  // define when the property isn't on the prototype (e.g. window.doNotTrack).
  const define = (obj, prop, value) => {
    try {
      const proto = Object.getPrototypeOf(obj);
      const onProto = proto && Object.getOwnPropertyDescriptor(proto, prop);
      const target = onProto ? proto : obj;
      const existing = onProto || Object.getOwnPropertyDescriptor(obj, prop);
      const getter = markNative(function () { return value; }, 'get ' + prop);
      Object.defineProperty(target, prop, { get: getter, configurable: true, enumerable: existing ? existing.enumerable : true });
    } catch (e) {
      try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e2) {}
    }
  };

  try {
    // navigator.webdriver === false, exposed on Navigator.prototype (the property
    // EXISTS and is false). undefined — or an own instance prop — is itself a tell.
    define(navigator, 'webdriver', false);
  } catch (e) {}

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
    // Reserve the OS task/menu bar so availHeight < height (availHeight === height is
    // itself a spoofing tell) — and do it PER-OS, not always the Windows taskbar:
    //  • Windows: ~48px taskbar at the BOTTOM (availTop 0).
    //  • macOS:   ~25px menu bar at the TOP (availTop ≈ 25) — a Windows-style availTop 0
    //    on a "macOS" profile is an OS mismatch.
    //  • Linux (GNOME): ~32px top bar.
    var _navp = String(fp.navPlatform || '');
    var _isMac = _navp.indexOf('Mac') !== -1;
    var _isLin = _navp.indexOf('Linux') !== -1;
    var _reserve = _isMac ? 25 : (_isLin ? 32 : 48);
    define(screen, 'availWidth', fp.screenW);
    define(screen, 'availHeight', Math.max(0, fp.screenH - _reserve));
    try {
      define(screen, 'availLeft', 0);
      define(screen, 'availTop', _isMac ? 25 : 0);
      // colorDepth/pixelDepth are 24 on virtually every real display; pin them so an
      // uncontrolled host value can't vary (and pair the two, which real browsers do).
      define(screen, 'colorDepth', 24);
      define(screen, 'pixelDepth', 24);
    } catch (e) {}
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
      Date.prototype.getTimezoneOffset = markNative(function () {
        const v = offsetFor(this);
        return Number.isFinite(v) ? v : origGetOffset.call(this);
      }, 'getTimezoneOffset');
      // Intl.DateTimeFormat → default unspecified timeZone to TZ and report it.
      const WrappedDTF = markNative(function (locales, options) {
        const opts = Object.assign({}, options);
        if (!opts.timeZone) opts.timeZone = TZ;
        return new OrigDTF(locales, opts);
      }, 'DateTimeFormat');
      WrappedDTF.prototype = OrigDTF.prototype;
      // Real Chrome: Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat.
      // Point the shared prototype's constructor at the wrapper so that identity holds.
      try { Object.defineProperty(OrigDTF.prototype, 'constructor', { value: WrappedDTF, configurable: true, writable: true }); } catch (e) {}
      WrappedDTF.supportedLocalesOf = markNative(OrigDTF.supportedLocalesOf.bind(OrigDTF), 'supportedLocalesOf');
      const origResolved = OrigDTF.prototype.resolvedOptions;
      // The host's REAL zone, captured before wrapping — lets us tell an IMPLICIT
      // (defaulted-to-host) formatter from one built with an explicit timeZone.
      let HOST_TZ = '';
      try { HOST_TZ = origResolved.call(new OrigDTF()).timeZone; } catch (e) {}
      OrigDTF.prototype.resolvedOptions = markNative(function () {
        const r = origResolved.apply(this, arguments);
        // Only rewrite when the formatter resolved to the HOST zone (i.e. no explicit
        // timeZone was given). Never clobber an explicitly-constructed zone such as
        // new Intl.DateTimeFormat('en',{timeZone:'UTC'}) — reporting the proxy zone
        // there is a self-contradiction (format() in UTC vs resolvedOptions() in the
        // proxy zone) that detectors read directly, and it breaks legitimate date code.
        try { if (r && HOST_TZ && r.timeZone === HOST_TZ) r.timeZone = TZ; } catch (e) {}
        return r;
      }, 'resolvedOptions');
      Intl.DateTimeFormat = WrappedDTF;
      // Date string methods that embed the zone name/offset (whoer reads these).
      // Reproduce V8's EXACT Date.prototype.toString format on Windows:
      //   "Sun Jul 05 2026 12:00:00 GMT-0700 (Pacific Daylight Time)"
      // built from formatToParts (space-separated, NO commas) with the trailing
      // long zone name — the previous Intl.format() output was comma-delimited and
      // dropped the "(Long Zone Name)" suffix, a Date-string tell the spoof itself
      // introduced.
      const longZoneName = (date) => {
        try {
          const parts = new OrigDTF('en-US', { timeZone: TZ, timeZoneName: 'long' }).formatToParts(date);
          const z = parts.find((x) => x.type === 'timeZoneName');
          return z ? z.value : '';
        } catch (e) { return ''; }
      };
      Date.prototype.toString = markNative(function () {
        if (Number.isNaN(this.getTime())) return 'Invalid Date';
        const off = offsetFor(this);
        const sign = off <= 0 ? '+' : '-';
        const abs = Math.abs(off);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        const P = {};
        try {
          new OrigDTF('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            .formatToParts(this).forEach((x) => { if (x.type !== 'literal') P[x.type] = x.value; });
        } catch (e) {}
        const hourStr = (P.hour === '24') ? '00' : (P.hour || '00'); // V8 renders midnight as 00, not 24
        const core = `${P.weekday} ${P.month} ${P.day} ${P.year} ${hourStr}:${P.minute}:${P.second}`;
        const zone = longZoneName(this);
        return `${core} GMT${sign}${hh}${mm}${zone ? ' (' + zone + ')' : ''}`;
      }, 'toString');
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
    var prelude = '(function(){' +
      // Native-code mask INSIDE the worker realm (parity with the main thread). Without
      // it, a worker probe reads getParameter.toString() / getTimezoneOffset.toString()
      // as raw JS source and flags the patch; and the navigator overrides below are
      // placed on the PROTOTYPE (not the instance) so hasOwnProperty stays false.
      'var _o=Function.prototype.toString,_p=new WeakSet();' +
      'var _t=function toString(){return _p.has(this)?"function "+(this.name||"")+"() { [native code] }":_o.call(this);};' +
      'try{Object.defineProperty(_t,"name",{value:"toString"});}catch(e){}' +
      'try{Object.defineProperty(Function.prototype,"toString",{value:_t,configurable:true,writable:true});}catch(e){}_p.add(_t);' +
      'var mk=function(f,n){try{if(n)Object.defineProperty(f,"name",{value:n});}catch(e){}_p.add(f);return f;};' +
      'var o=' + JSON.stringify(workerData) + ';' +
      'var d=function(p,v){if(v===undefined||v===null)return;var pr=Object.getPrototypeOf(navigator)||navigator;try{Object.defineProperty(pr,p,{get:mk(function(){return v;},"get "+p),configurable:true});}catch(e){}};' +
      'd("hardwareConcurrency",o.hardwareConcurrency);d("deviceMemory",o.deviceMemory);' +
      'd("languages",o.languages);d("language",o.language);d("platform",o.platform);' +
      'try{var pg=function(proto){if(!proto)return;var g=proto.getParameter;proto.getParameter=mk(function(p){' +
      'if(o.webglVendor&&p===37445)return o.webglVendor;if(o.webglRenderer&&p===37446)return o.webglRenderer;' +
      'return g.apply(this,arguments);},"getParameter");};' +
      'if(typeof WebGLRenderingContext!=="undefined")pg(WebGLRenderingContext.prototype);' +
      'if(typeof WebGL2RenderingContext!=="undefined")pg(WebGL2RenderingContext.prototype);}catch(e){}' +
      'try{if(o.timezone){var TZ=o.timezone,ODTF=Intl.DateTimeFormat,' +
      'pf=new ODTF("en-US",{timeZone:TZ,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}),' +
      'ofs=function(d){try{var pp={};pf.formatToParts(d).forEach(function(x){if(x.type!=="literal")pp[x.type]=x.value;});' +
      'var u=Date.UTC(+pp.year,+pp.month-1,+pp.day,+pp.hour,+pp.minute,+pp.second);return Math.round((d.getTime()-u)/60000);}catch(e){return 0;}};' +
      'Date.prototype.getTimezoneOffset=mk(function(){return ofs(this);},"getTimezoneOffset");' +
      'var WD=function(l,op){op=Object.assign({},op);if(!op.timeZone)op.timeZone=TZ;return new ODTF(l,op);};' +
      'WD.prototype=ODTF.prototype;WD.supportedLocalesOf=ODTF.supportedLocalesOf.bind(ODTF);' +
      'var orz=ODTF.prototype.resolvedOptions;var HZ="";try{HZ=orz.call(new ODTF()).timeZone;}catch(e){}' +
      'ODTF.prototype.resolvedOptions=mk(function(){var r=orz.apply(this,arguments);try{if(r&&HZ&&r.timeZone===HZ)r.timeZone=TZ;}catch(e){}return r;},"resolvedOptions");' +
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
        // Route through the module's native-mask machinery (name + _patched) rather
        // than an OWN toString: CreepJS probes Function.prototype.toString.call(Worker)
        // — which the patched _fnToString serves as "[native code]" only for _patched
        // members — and real Chrome's Worker has no own toString property.
        markNative(Wrapped, Native.name);
        try { Object.defineProperty(Native.prototype, 'constructor', { value: Wrapped, configurable: true, writable: true }); } catch (e) {}
      } catch (e) {}
      return Wrapped;
    };

    if (typeof Worker !== 'undefined') window.Worker = wrapWorker(window.Worker);
    if (typeof SharedWorker !== 'undefined') window.SharedWorker = wrapWorker(window.SharedWorker);
  } catch (e) {}

  let s = fp.seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

if (fp.noise.canvas) {
    // Intentionally left blank in JS.
    // Canvas and WebGL uniqueness is now handled natively via Chromium's 
    // --use-angle and --use-gl backend rendering flags at launch.
    // JS tampering is easily detected by Pixelscan, so we rely entirely on native hardware rendering.
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
    // Track which channel arrays we've already perturbed. getChannelData returns the
    // SAME live Float32Array for a given channel on every call, so perturbing in
    // place on EVERY call (the old behavior) applied the delta cumulatively and made
    // consecutive reads of the same channel differ — an "unstable audio fingerprint"
    // tell (the exact instability the canvas path restores against). Perturb each
    // channel array ONCE; later reads return the identical, stable values, and the
    // live buffer's write-through semantics are preserved (we still return it).
    const _perturbedAudio = new WeakSet();
    AudioBuffer.prototype.getChannelData = markNative(function getChannelData() {
      const buf = origGetChannelData.apply(this, arguments);
      try {
        if (buf && buf.length && !_perturbedAudio.has(buf)) {
          const limit = Math.min(buf.length, 600);
          for (let i = 0; i < limit; i += 1) {
            const u = ((aseed ^ ((i + 1) * 40503)) >>> 0) / 4294967296;
            buf[i] = buf[i] + (u - 0.5) * 1e-7;
          }
          _perturbedAudio.add(buf);
        }
      } catch (e) {}
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
          if (/^a=candidate:.*\.local\s/.test(line)) continue;
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
        if (/\.local\s/.test(event.candidate.candidate)) return null;
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
        // Native-mask the wrapper: as a bare ES class, RTCPeerConnection.name was
        // "ProtectedRTC" and .toString() dumped the class source — a one-read spoofer
        // tell on every proxied profile. markNative fixes .name + routes toString
        // through _fnToString ("[native code]"); realign the constructor's own
        // [[Prototype]] to the native's (EventTarget) so it isn't the shadowed native.
        markNative(ProtectedRTC, 'RTCPeerConnection');
        try { Object.setPrototypeOf(ProtectedRTC, Object.getPrototypeOf(Native)); } catch (e) {}
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
      proto.getVoices = markNative(function () {
        const real = (function () { try { return orig.apply(this, arguments); } catch (e) { return []; } })();
        return real && real.length ? real : fakeVoices.map((v) => Object.assign({}, v));
      }, 'getVoices');
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
      // audit: place the overrides on MediaDevices.prototype (non-enumerable) — NOT
      // as own instance data properties on navigator.mediaDevices. The old instance
      // assignment surfaced in Object.getOwnPropertyNames(navigator.mediaDevices) and
      // hasOwnProperty('enumerateDevices'), which real Chrome never does (these live
      // only on the prototype) — an own-vs-prototype spoofer tell.
      const mdProto = Object.getPrototypeOf(md) || md;
      const defineOnMd = (name, fn) => {
        try { Object.defineProperty(mdProto, name, { value: fn, configurable: true, writable: true, enumerable: false }); }
        catch (e) { try { md[name] = fn; } catch (e2) {} }
      };
      if (typeof md.getUserMedia === 'function') {
        const origGUM = md.getUserMedia.bind(md);
        defineOnMd('getUserMedia', markNative(function getUserMedia() {
          let p;
          try { p = origGUM.apply(md, arguments); } catch (e) { return Promise.reject(e); }
          try { return p.then((stream) => { granted = true; return stream; }); } catch (e) { return p; }
        }, 'getUserMedia'));
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

      defineOnMd('enumerateDevices', markNative(function enumerateDevices() {
        try {
          return Promise.resolve(build().map((d) => ({
            kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: d.label,
            toJSON() { return { kind: this.kind, deviceId: this.deviceId, groupId: this.groupId, label: this.label }; }
          })));
        } catch (e) { return Promise.resolve([]); }
      }, 'enumerateDevices'));
    } catch (e) { /* never break the page over device spoofing */ }
  }

  // Font fingerprint protection — seeded sub-pixel noise on canvas text
  // measurement so width-comparison font enumeration can't reliably probe the
  // installed font set. Noise is tiny (±0.01px) so real layout is unaffected.
  if (fp.fontsNoise) {
    const fontJitter = (v) => (typeof v === 'number' ? v + (rnd() - 0.5) * 0.02 : v);
    const origMeasure = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = markNative(function () {
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
    }, 'measureText');

    // Mirror the jitter onto OffscreenCanvas (used inside Web Workers), closing the
    // worker-thread font-probing gap the main-thread CanvasRenderingContext2D
    // override above does not cover.
    if (window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.measureText) {
      const origMeasureOff = OffscreenCanvasRenderingContext2D.prototype.measureText;
      OffscreenCanvasRenderingContext2D.prototype.measureText = markNative(function () {
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
      }, 'measureText');
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
      window.fetch = markNative(function (input) {
        const url = typeof input === 'string' ? input : (input && input.url);
        if (url && isPrivate(url)) return Promise.reject(new TypeError('Failed to fetch'));
        return origFetch.apply(this, arguments);
      }, 'fetch');
    }
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = markNative(function (method, url) {
      if (url && isPrivate(url)) throw new DOMException('Network error', 'NetworkError');
      return origOpen.apply(this, arguments);
    }, 'open');
    const OrigWS = window.WebSocket;
    if (OrigWS) {
      const PatchedWS = markNative(function (url, protocols) {
        if (url && isPrivate(url)) throw new DOMException('Insecure WebSocket blocked', 'SecurityError');
        return protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
      }, 'WebSocket');
      PatchedWS.prototype = OrigWS.prototype;
      try {
        PatchedWS.CONNECTING = OrigWS.CONNECTING; PatchedWS.OPEN = OrigWS.OPEN;
        PatchedWS.CLOSING = OrigWS.CLOSING; PatchedWS.CLOSED = OrigWS.CLOSED;
      } catch (e) {}
      window.WebSocket = PatchedWS;
    }
  }
}

// audit: the old createProxyAuthExtension() was removed here — it wrote the proxy
// username/password in PLAINTEXT into a generated background.js inside the profile
// dir. It was dead code (never called or exported). Authenticated proxies are
// handled without touching disk: HTTP via page.authenticate() and SOCKS5 via the
// in-memory local socksRelay (socksRelay.js).

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
  <a href="https://browserscan.net/">BrowserScan</a>
  <a href="https://browserleaks.com/">BrowserLeaks</a>
  <a href="https://whoer.net/">Whoer.net</a>
  <a href="https://pixelscan.net/">Pixelscan</a>
  <a href="https://abrahamjuliot.github.io/creepjs/">CreepJS</a>
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
  // Open each check link in a NEW tab via the main process, which attaches proxy
  // auth BEFORE navigating — so an authenticated proxy doesn't stall the new tab
  // on a 407 (the reason target="_blank" tabs hung at about:blank). Falls back to
  // a normal same-tab navigation if the bridge isn't available.
  try{
    var navAs=document.querySelectorAll('.nav-links a');
    for(var i=0;i<navAs.length;i++){
      navAs[i].addEventListener('click',function(e){
        if(window.__sgzOpenTab){e.preventDefault();try{window.__sgzOpenTab(this.href);}catch(_){}}
      });
    }
  }catch(e){}
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
// Submit a token job to 2captcha and poll until solved. Returns the token string.
async function solveWith2captcha(apiKey, job) {
  let method = 'userrecaptcha';
  if (job.type === 'hcaptcha') method = 'hcaptcha';
  else if (job.type === 'turnstile') method = 'turnstile'; // ADDED TURNSTILE

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
// anti-captcha JSON task API (createTask → getTaskResult).
async function solveWithAnticaptcha(apiKey, job) {
  let taskType = 'RecaptchaV2TaskProxyless';
  if (job.type === 'hcaptcha') taskType = 'HCaptchaTaskProxyless';
  else if (job.type === 'turnstile') taskType = 'TurnstileTaskProxyless'; // ADDED TURNSTILE

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
document.querySelectorAll('.g-recaptcha[data-sitekey],[data-sitekey],.cf-turnstile').forEach((el) => {
          const k = el.getAttribute('data-sitekey');
          const isH = el.classList.contains('h-captcha');
          const isCF = el.classList.contains('cf-turnstile');
          if (isCF) push('turnstile', k);
          else push(isH ? 'hcaptcha' : 'recaptcha', k);
        });
        document.querySelectorAll('iframe[src*="/recaptcha/"]').forEach((f) => {
          const m = /[?&]k=([^&]+)/.exec(f.src || ''); if (m) push('recaptcha', decodeURIComponent(m[1]));
        });
        document.querySelectorAll('iframe[src*="hcaptcha.com"]').forEach((f) => {
          const m = /[?&]sitekey=([^&]+)/.exec(f.src || ''); if (m) push('hcaptcha', decodeURIComponent(m[1]));
        });
        // Turnstile can also be loaded via cloudflare challenges iframe
        document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').forEach((f) => {
          const m = /[?&]sitekey=([^&]+)/.exec(f.src || ''); if (m) push('turnstile', decodeURIComponent(m[1]));
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
          fill('[name="cf-turnstile-response"]'); // CLOUDFLARE INJECTION
          fill('[name="g-recaptcha-response"]');
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
    
    let ProxyAgent;
    try {
      ({ ProxyAgent } = require('proxy-agent'));
    } catch (e) {
      const scheme = String(proxy.type || '').toLowerCase();
      if (scheme.startsWith('socks')) return resolve(null);
    }

    const targetUrl = 'https://ipinfo.io/json'; // Using HTTPS to prevent proxy blocking
    const schemeLc = String(proxy.type || '').toLowerCase();
    
    // Map ipinfo.io response to the expected legacy ip-api format for the app
    const mapResponse = (j) => {
      if (j && j.ip) {
        return {
          status: 'success',
          query: j.ip,
          countryCode: j.country,
          timezone: j.timezone,
          city: j.city,
          regionName: j.region,
          isp: j.org,
          lat: j.loc ? parseFloat(j.loc.split(',')[0]) : null,
          lon: j.loc ? parseFloat(j.loc.split(',')[1]) : null
        };
      }
      return null;
    };

    // Use proxy-agent to correctly route SOCKS5 / SOCKS4 / HTTP requests
    if (ProxyAgent) {
      const scheme = schemeLc === 'socks5' ? 'socks5' : (schemeLc === 'socks4' ? 'socks4' : 'http');
      const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
      const proxyUrl = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
      
      const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      
      // Use node:https since targetUrl is https://
      const req = require('node:https').get(targetUrl, { 
        agent, 
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { 
            const j = JSON.parse(data); 
            done(mapResponse(j)); 
          } catch (e) { done(null); }
        });
      });
      
      req.on('error', () => done(null));
      req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} done(null); });
      return;
    }

    // --- FALLBACK IF PROXY-AGENT IS MISSING ---
    if (schemeLc.startsWith('socks')) return resolve(null);
    
    const fallbackUrl = 'http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,lat,lon,isp,query';
    const headers = { Host: 'ip-api.com', 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Connection: 'close' };
    
    if (proxy.username || proxy.password) {
      const token = Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
      headers['Proxy-Authorization'] = `Basic ${token}`;
    }
    
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    
    const req = require('node:http').request({ host: proxy.host, port: Number(proxy.port), method: 'GET', path: fallbackUrl, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { 
        try { const j = JSON.parse(data); done(j && j.status === 'success' ? j : null); } 
        catch (e) { done(null); } 
      });
    });
    
    req.on('error', () => done(null));
    req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} done(null); });
    req.end();
  });
}

// In-memory geo cache. Bulk/parallel launches frequently reuse the same few
// proxies (pools); without caching, every launch re-hits the API THROUGH the
// proxy — slow and easily rate-limited. Cache successful lookups for a TTL.
const GEO_NODE_CACHE_TTL_MS = 10 * 60 * 1000;
const geoNodeCache = new Map();    // key -> { value, at }
const geoNodeInflight = new Map(); // key -> Promise<value|null>

function proxyGeoKey(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return null;
  return `${String(proxy.type || '').toLowerCase()}://${proxy.host}:${proxy.port}`;
}

async function lookupProxyGeoNodeCached(proxy) {
  const key = proxyGeoKey(proxy);
  if (!key) return lookupProxyGeoNode(proxy);
  const hit = geoNodeCache.get(key);
  if (hit && (Date.now() - hit.at) < GEO_NODE_CACHE_TTL_MS) return hit.value;
  if (geoNodeInflight.has(key)) return geoNodeInflight.get(key);
  const inflight = (async () => {
    const value = await lookupProxyGeoNode(proxy);
    if (value) geoNodeCache.set(key, { value, at: Date.now() }); // cache successes only; nulls retry next launch
    return value;
  })();
  geoNodeInflight.set(key, inflight);
  try { return await inflight; }
  finally { geoNodeInflight.delete(key); }
}

// In-page geo fallback. The Node-side lookup (lookupProxyGeoNode) can't tunnel a SOCKS
// proxy without proxy-agent and times out on slow/blocked proxies, returning null. When
// that happens we resolve the exit location through the BROWSER's own proxied connection:
// navigate the tab to a geo API and parse the JSON. NEVER throws.
// AUDIT/CRITICAL FIX: this function did not exist — the call site (the fallback in
// launchProfileSession) referenced a missing `lookupProxyGeo`, throwing ReferenceError
// inside the launch guard, which closed the freshly-opened browser and FAILED every
// proxied launch whose pre-launch lookup returned null (slow/blocked/rate-limited proxy).
async function lookupProxyGeo(page) {
  if (!page) return null;
  const url = 'http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,lat,lon,isp,query';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GEO_LOOKUP_TIMEOUT_MS });
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const j = JSON.parse(txt);
    if (j && j.status === 'success') return j;
  } catch (e) { /* proxy dead / non-JSON / timeout — geo stays null, launch continues */ }
  return null;
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
  // Override the New Tab Page for browsers whose built-in NTP is unusable:
  //   • Chrome-for-Testing — its remote NTP/realbox/signin code CRASHES the whole
  //     browser (access violation 0xC0000005) on recent builds, so clicking "+"
  //     killed the session.
  //   • fingerprint-chromium (Ungoogled) — ships NO Google NTP at all; a new tab is
  //     a near-empty dark page with only a "Web Store" icon (no search box), which
  //     users reasonably read as "the browser is broken / blank black screen".
  // Real Chrome's NTP works fine, so we DON'T override it there (the override would
  // needlessly trip Chrome's "changed by extension" consent bubble). Gated on
  // opts.ntpOverride. The replacement is a self-contained, functional NTP: a search
  // box (Google search or direct-URL navigation) plus the profile-check quick links.
  if (opts.ntpOverride) {
    manifest.chrome_url_overrides = { newtab: 'newtab.html' };
    const newtabHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>New Tab</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:radial-gradient(1200px 600px at 50% -12%,#13233b 0%,#0b0f17 60%);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#e5e7eb}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.5px;color:#93c5fd;font-size:15px}
.brand .dot{width:9px;height:9px;border-radius:50%;background:#38bdf8}
form{width:min(560px,92vw)}
input{width:100%;padding:15px 20px;font-size:16px;border-radius:14px;border:1px solid #26344b;background:#0f1623;color:#f1f5f9;outline:none;box-shadow:0 10px 30px -12px rgba(0,0,0,.6);transition:border-color .15s}
input:focus{border-color:#38bdf8}
.links{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-width:560px}
.links a{background:#111827;padding:8px 14px;border-radius:9px;text-decoration:none;color:#cbd5e1;font-weight:600;font-size:12.5px;border:1px solid #1f2937;transition:border-color .15s,color .15s}
.links a:hover{border-color:#38bdf8;color:#fff}</style></head>
<body><div class="brand"><span class="dot"></span> SOFTGLAZE BROWSER</div>
<form id="f"><input id="q" type="text" placeholder="Search Google or type a URL" autofocus autocomplete="off" spellcheck="false"></form>
<div class="links"><a href="https://browserleaks.com/">BrowserLeaks</a><a href="https://browserscan.net/">BrowserScan</a><a href="https://pixelscan.net/">Pixelscan</a><a href="https://whoer.net/">Whoer</a><a href="https://abrahamjuliot.github.io/creepjs/">CreepJS</a></div>
<script>(function(){var f=document.getElementById('f'),q=document.getElementById('q');f.addEventListener('submit',function(e){e.preventDefault();var v=(q.value||'').trim();if(!v)return;var direct=/^https?:\\/\\//i.test(v),host=/^[^\\s]+\\.[a-z]{2,}(\\/|$|\\?|:)/i.test(v)&&!/\\s/.test(v);location.href=direct?v:(host?'https://'+v:'https://www.google.com/search?q='+encodeURIComponent(v));});try{q.focus();}catch(_){}})();</script>
</body></html>`;
    await fs.writeFile(path.join(extDir, 'newtab.html'), newtabHtml);
  }
  await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
  // Self-contained: serialize the function and invoke it with the baked config.
  const source = `(${fingerprintScript.toString()})(${JSON.stringify(fpConfig)});`;
  await fs.writeFile(path.join(extDir, 'fp.js'), source);
  return extDir;
}

// Ungoogled-Chromium (the anti-detect engine) ships with NO default search engine, so a
// bare term typed in the address bar is treated as a hostname ("google" → https://google/,
// which errors). Seed Google as the default search provider in the profile's Preferences
// BEFORE launch. default_search_provider_data is a REGULAR (not MAC-protected) pref, so
// Chromium keeps it — verified: the value survives a launch and drives the omnibox. Only
// set it when none exists, so a user's later manual choice is never overridden. Best-effort:
// the New Tab page search box works regardless. Chrome / CfT already have Google built in.
async function ensureNativeDefaultSearch(userDataDir) {
  try {
    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    let prefs = {};
    try { prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8')); } catch (e) { prefs = {}; }
    const existing = prefs.default_search_provider_data && prefs.default_search_provider_data.template_url_data;
    if (existing && existing.url) return; // respect an existing / user-chosen default
    prefs.default_search_provider_data = {
      template_url_data: {
        short_name: 'Google',
        keyword: 'google.com',
        url: 'https://www.google.com/search?q={searchTerms}',
        suggestions_url: 'https://www.google.com/complete/search?output=chrome&q={searchTerms}',
        favicon_url: 'https://www.google.com/favicon.ico',
        safe_for_autoreplace: false,
        is_active: 1,
        prepopulate_id: 1,
        date_created: '13300000000000000',
        last_modified: '13300000000000000'
      }
    };
    await fs.mkdir(path.dirname(prefsPath), { recursive: true });
    await fs.writeFile(prefsPath, JSON.stringify(prefs));
  } catch (e) { /* best-effort — the New Tab search box still works */ }
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
    // Per-profile opt-in: load SoftGlaze/team extensions (prefers Chrome-for-Testing so
    // --load-extension actually mounts them). Off = prefer real Chrome (stealthier).
    loadExtensions = false,
    // Geo auto-match (timezone/locale/WebRTC derived from the proxy exit) is ON by
    // default. A global Settings toggle can disable it; when off we skip the geo
    // lookup entirely so only the profile's manual values apply.
    geoMatchEnabled = true
  } = options;

  // Dedupe (audit: double-launch orphans Chrome). A profile has exactly ONE
  // session (sessionId === String(profileId)). A rapid double-launch — a
  // double-click, or the same profileId appearing twice in a batch — would
  // otherwise open a SECOND Chrome on the same userDataDir (singleton-lock
  // conflict) and overwrite the activeSessions entry, leaving the first browser
  // unreachable and unclosable. Return the running session instead of relaunching.
  if (profileId != null) {
    const existing = activeSessions.get(String(profileId));
    if (existing) {
      return { sessionId: String(profileId), userDataDir: existing.userDataDir, wsEndpoint: existing.wsEndpoint, alreadyRunning: true };
    }
  }

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

  // Decide the anti-detect engine BEFORE the geo lookup: fingerprint-chromium bakes the
  // timezone as a LAUNCH flag (--timezone) and cannot correct it afterward, so its geo
  // must be resolved FRESH (uncached). A stale-cached exit — e.g. a sticky proxy session
  // that has since rotated to a different city — would otherwise leave the browser on a
  // timezone that doesn't match the live proxy IP, the single loudest CAPTCHA tell (we
  // saw Pacific/Honolulu on a Wisconsin exit). Stock Chrome keeps the 10-min cache: it
  // applies the timezone per-page via CDP AFTER the in-page geo lookup, so it self-corrects.
  let usingAntidetect = false;
  let antidetectExe = null;
  if (browserSettings.antidetectEngine === true) {
    antidetectExe = resolveAntidetectBinary();
    if (antidetectExe) usingAntidetect = true;
    else console.warn('[SG] antidetectEngine ON but fingerprint-chromium binary not found — using stock Chrome.');
  }

  let geo = geoMatchEnabled && resolvedProxy && profile.timezoneType !== 'Real'
    ? await (usingAntidetect ? lookupProxyGeoNode(resolvedProxy) : lookupProxyGeoNodeCached(resolvedProxy))
    : null;
  let timezoneId = manualTz || (geo && geo.timezone) || null;

  // Build the fingerprint config (geo-aware) and bake it into a MAIN-world
  // content-script extension BEFORE launch — this is the reliable injection path.
  const fpConfig = buildFingerprintConfig(profile, { seed, resW, resH, webrtcMode, hasProxy: Boolean(resolvedProxy), geo, timezone: timezoneId });
  if (usingAntidetect) fpConfig.nativeEngine = true;
  // Binary: fingerprint-chromium when the anti-detect engine is active (its native spoof
  // replaces our JS/CDP layer via fpConfig.nativeEngine), else real Chrome / CfT. The
  // extension below is written with the NTP override ONLY when it's NOT real Chrome.
  const chosenBrowser = usingAntidetect
    ? { exePath: antidetectExe, version: '', major: 0, isReal: false, antidetect: true }
    : chooseBrowserBinary(profile, { preferCftForExtensions: loadExtensions });
  if (!chosenBrowser) {
    // No system Chrome AND no downloaded Chrome-for-Testing build. Packaged builds don't
    // bundle a Chromium, so puppeteer would otherwise throw a cryptic "Could not find
    // Chrome" — exactly what a brand-new device hits. Only fall through to puppeteer's own
    // bundled Chromium when it genuinely exists (dev installs); else give a clear, actionable
    // error instead of the raw puppeteer one.
    let bundled = '';
    try { bundled = puppeteer.executablePath(); } catch (e) { bundled = ''; }
    if (!bundled || !fsSync.existsSync(bundled)) {
      throw new Error('No Chrome or Chromium was found on this device. Open the Browsers page and download a browser version (or install Google Chrome) before launching Chrome profiles.');
    }
  }
  const usingCft = !(chosenBrowser && chosenBrowser.isReal);
  const fpExtDir = await writeFingerprintExtension(userDataDir, fpConfig, { ntpOverride: usingCft });
  // Seed a working address-bar default search engine for the anti-detect engine (Ungoogled
  // ships none). Before launch so Chromium reads it at startup.
  if (usingAntidetect) await ensureNativeDefaultSearch(userDataDir);

  // Merge the fingerprint "Core" extension with any globally-enabled team
  // extensions (installed via the Extensions page) into a single comma-separated
  // list. Chromium accepts multiple unpacked extensions this way; both
  // --disable-extensions-except and --load-extension must carry the SAME list so
  // every one of them is whitelisted AND loaded.
  const extensionDirs = [fpExtDir, ...(Array.isArray(globalExtensionDirs) ? globalExtensionDirs : [])].filter(Boolean);
  const extensionArg = extensionDirs.join(',');

  // If the SoftGlaze recorder is among the globally-injected extensions and we're
  // launching Chrome-for-Testing, also register it as a store force-install (counts
  // CWS active users). Best-effort + scoped to the Chromium policy key; the unpacked
  // load above is the guaranteed fallback.
  if (usingCft && extensionDirs.some((d) => path.basename(d) === SOFTGLAZE_RECORDER_ID)) {
    ensureChromiumForceInstall(SOFTGLAZE_RECORDER_ID);
  }

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
  if (profile.canvasNoise !== false || profile.webglImageNoise !== false) {
    const angleBackends = ['d3d11', 'd3d9', 'gl', 'vulkan'];
    const chosenAngle = angleBackends[seed % angleBackends.length];
    args.push(`--use-angle=${chosenAngle}`);
    if (chosenAngle === 'gl') {
      args.push('--use-gl=angle');
    }
  }

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

  // Anti-detect engine: append fingerprint-chromium's native spoofing flags. They
  // REPLACE our JS/CDP fingerprint layer (skipped via fpConfig.nativeEngine): the
  // binary derives a coherent identity (canvas/webgl/audio/exact-UA) from --fingerprint,
  // reports the mapped platform/brand/cores/locale, sets the timezone, and blocks the
  // WebRTC real-IP leak — all natively, so there's no injection race for a site to spot.
  if (usingAntidetect) {
    args.push(...buildAntidetectFlags(profile, fpConfig, seed, timezoneId, Boolean(resolvedProxy)));
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

  // Authenticated SOCKS5: Chromium has NO SOCKS proxy-auth support and
  // page.authenticate() only answers HTTP 407, so an authenticated SOCKS5 proxy
  // silently fails on every request. Route it through a local no-auth SOCKS5 relay
  // that injects the credentials upstream, and point Chromium at the relay. HTTP(S)
  // proxies keep using page.authenticate below (which works for their 407). (audit)
  const proxyTypeLc = resolvedProxy ? String(resolvedProxy.type).toLowerCase() : '';
  const proxyIsSocks = proxyTypeLc.startsWith('socks'); // socks4 OR socks5 — neither answers HTTP 407
  const proxyIsSocks5 = proxyTypeLc === 'socks5';       // only socks5 carries user/pass auth (via the relay)
  const socksNeedsAuth = proxyIsSocks5 && Boolean(resolvedProxy.username || resolvedProxy.password);
  // HTTP(S) proxies CAN answer page.authenticate()'s 407, but that is applied per-page
  // and only after a tab exists — so a browser-opened "+" tab fires its FIRST request
  // BEFORE auth is wired, drawing a 407 that stalls the tab and looks suspicious to
  // bot-detection. Give authenticated HTTP(S) proxies the same treatment as SOCKS5: a
  // local no-auth relay that injects the credentials upstream, so Chromium never sees a
  // challenge on ANY tab and the new-tab proxy-auth race disappears.
  const httpNeedsAuth = Boolean(resolvedProxy) && !proxyIsSocks && Boolean(resolvedProxy.username || resolvedProxy.password);
  // Holds whichever local auth-injecting relay is active — SOCKS5 (startSocksAuthRelay)
  // OR HTTP (startHttpAuthRelay). Both expose { port, close }, so the session teardown
  // that calls socksRelay.close() tears down either kind. (Named socksRelay historically.)
  let socksRelay = null;
  let proxyForArg = resolvedProxy;
  if (socksNeedsAuth) {
    try {
      socksRelay = await startSocksAuthRelay(resolvedProxy);
    } catch (e) {
      throw new Error(`Could not start the local SOCKS5 authentication relay for this proxy: ${(e && e.message) || e}`);
    }
    proxyForArg = { type: 'SOCKS5', host: '127.0.0.1', port: socksRelay.port, username: null, password: null };
  } else if (httpNeedsAuth) {
    try {
      socksRelay = await startHttpAuthRelay(resolvedProxy);
      proxyForArg = { type: 'HTTP', host: '127.0.0.1', port: socksRelay.port, username: null, password: null };
    } catch (e) {
      // Relay failed to START — degrade gracefully to the previous per-page
      // page.authenticate() path (proxyForArg stays the real proxy; proxyCreds below is
      // set because socksRelay is null) rather than failing the whole launch.
      console.warn('[SG][proxy] HTTP auth relay failed to start — falling back to page.authenticate:', (e && e.message) || e);
      socksRelay = null;
    }
  }

  // Proxy via --proxy-server. Authenticated proxies now route through the local relay
  // above (auth-free to Chromium); page.authenticate stays only as a fallback for the
  // unexpected case where a relay wasn't started for an authenticated HTTP(S) proxy.
  if (resolvedProxy) {
    const proxyServer = buildProxyServerArgument(proxyForArg);
    if (proxyServer) args.push(`--proxy-server=${proxyServer}`);
  }
  // With a relay in front, Chromium points at an auth-free local proxy, so per-page
  // authenticate() is unnecessary (and never fires). Only fall back to it when no relay
  // is active for an authenticated HTTP(S) proxy.
  const proxyCreds = (resolvedProxy && !proxyIsSocks && !socksRelay && (resolvedProxy.username || resolvedProxy.password))
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
    ignoreDefaultArgs: ['--enable-automation'],
    // Give CDP longer to attach/initialize new targets. The browser-level auto-attach
    // (waitForDebuggerOnStart) can hold a "+"-tab / worker target briefly before it
    // resumes, and puppeteer's own Network.enable on that target was hitting the default
    // timeout ("Network.enable timed out") on slower machines/proxies.
    protocolTimeout: 120000
  };
  if (resolvedBrowser && resolvedBrowser.exePath) launchOptions.executablePath = resolvedBrowser.exePath;
  // Set the timezone on the Chrome PROCESS via the TZ env var. Chromium honors it
  // for ICU/Date/Intl in EVERY context — main thread, dedicated workers, AND
  // service workers — natively, with no injection and no per-tab race. This is the
  // fix for the real-timezone leak (proxy in the US but JS reporting Asia/Karachi).
  if (timezoneId) launchOptions.env = { ...process.env, TZ: timezoneId };

  // Engine: stock puppeteer by default; the opt-in rebrowser engine (persistent
  // Runtime.enable dropped) when "minimize CDP footprint" is on for this launch.
  const engine = browserSettings.minimizeCdpFootprint === true ? getRuntimeFixPuppeteer()
    : usingAntidetect ? getNativeEngine()
    : puppeteer;
  let browser;
  try {
    browser = await engine.launch(launchOptions);
  } catch (launchErr) {
    // Launch itself failed — the SOCKS relay (if any) would otherwise leak.
    if (socksRelay) { try { socksRelay.close(); } catch (e) {} }
    throw launchErr;
  }

  // Guard the ENTIRE post-launch setup (audit: launch-failure orphans Chrome).
  // Until the session is registered in activeSessions (and its 'disconnected'
  // cleanup wired), this browser is tracked NOWHERE else — so any throw here
  // (browser.version()/pages()/newPage() and generateStartPage are the classic
  // offenders) would leave a live Chrome running forever with no handle to close
  // it. On failure, tear it down and rethrow.
  let sessionRegistered = false;
  try {

  // KEEP puppeteer-extra-stealth's onTargetCreated listener so its ~11 evasions
  // (window.chrome, navigator.plugins, navigator.permissions, iframe.contentWindow,
  // WebGL vendor, etc.) apply to EVERY new tab — not just the first. The custom CDP
  // auto-attach below only spoofs GPU/RAM/WebRTC/screen; with stealth stripped from new
  // tabs, Google's BotGuard saw a missing window.chrome and threw the /sorry CAPTCHA on
  // a "+"-tab search. The known cost of leaving it on — stealth injecting into a
  // transient New Tab Page whose CDP session closes mid-write throws
  // `TargetCloseError (Page.addScriptToEvaluateOnNewDocument)` — is a rejected promise
  // caught by the global unhandledRejection handler in main.js (one-offs are swallowed;
  // the app is not torn down), so we no longer removeAllListeners('targetcreated').

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
  // Fingerprint values the early auto-attach handler needs to fully spoof NEW
  // tabs BEFORE their first byte. Declared here (so the handler closes over it)
  // but POPULATED later, once ua/timezone/geo/mobile are computed — reading the
  // object lazily avoids a temporal-dead-zone error and keeps it a harmless no-op
  // for the very first page (which applyToPage covers directly).
  const fpLate = {};
  try {
const rootCdp = await browser.target().createCDPSession();
    // puppeteer's Connection (shared by every flat child session). We address each
    // auto-attached child target through its REAL CDPSession on this connection.
    const conn = rootCdp.connection();
    rootCdp.on('Target.attachedToTarget', async (ev) => {
      const info = ev.targetInfo || {};
      const isPageish = info.type === 'page' || info.type === 'iframe';
      const isWorker = /worker/i.test(info.type || '');
      
      let scriptAdded = false;

      // Flat auto-attach (flatten:true) means puppeteer's Connection has ALREADY
      // created and stored a real child CDPSession for this target by the time this
      // event fires (Connection.onMessage stores it before dispatching the event),
      // so conn.session(ev.sessionId) resolves it here. Talk to the child DIRECTLY.
      //
      // The previous implementation sent through the deprecated
      // Target.sendMessageToTarget wrapper, which does NOT route to a flat-attached
      // session, AND swallowed every error — so inject() below always "succeeded"
      // (its try/catch never saw a throw), the retry loop + failure log were dead
      // code, and the fingerprint init script + UA-CH/timezone/geolocation overrides
      // never actually landed on new tabs. Those tabs painted with the REAL
      // GPU/canvas/screen/UA-CH, which Cloudflare Turnstile flags => a challenge on
      // every "+"-tab (and the "unsolvable" challenge on start-page check-links,
      // which open as new tabs). Sending on the child session lets a genuine failure
      // reject so inject() truthfully returns false and the retry/log path works.
      const child = conn ? conn.session(ev.sessionId) : null;
      // Bound EVERY child CDP call so a single stalled command (e.g. a browser-domain
      // command that a page session answers slowly, or a target mid-teardown) can never
      // block the resume below — a new tab must never hang at about:blank. A timed-out
      // call rejects; inject() catches it and the resume still fires.
      const withTimeout = (p, ms) => Promise.race([
        p, new Promise((_, rej) => setTimeout(() => rej(new Error('cdp call timed out')), ms))
      ]);
      const sendMsg = (method, params = {}) => (child
        ? withTimeout(child.send(method, params), 4000)
        : Promise.reject(new Error('no flat child CDP session for ' + ev.sessionId)));

      const inject = async () => {
        try {
          if (isPageish) {
            // Native engine spoofs UA / timezone / cores / device-metrics + the whole
            // fingerprint itself via launch flags; skip the JS inject + CDP overrides on
            // new tabs too (a CDP UA fighting the native Sec-CH-UA is a tell). Geolocation
            // below isn't native, so it still applies to popups.
            if (!fpConfig.nativeEngine) {
            if (!scriptAdded) {
              await sendMsg('Page.addScriptToEvaluateOnNewDocument', { source: fpInjectSource });
              scriptAdded = true;
            }
            if (fpConfig.cores) await sendMsg('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores });
            if (fpLate.ua) {
              await sendMsg('Emulation.setUserAgentOverride', {
                userAgent: fpLate.ua.userAgent,
                acceptLanguage: fpLate.acceptLanguage,
                platform: fpLate.ua.navPlatform,
                userAgentMetadata: fpLate.ua.userAgentMetadata
              });
            }
            if (fpLate.timezoneId) await sendMsg('Emulation.setTimezoneOverride', { timezoneId: fpLate.timezoneId });
            if (fpLate.mobileMetrics) {
              const m = fpLate.mobileMetrics;
              await sendMsg('Emulation.setDeviceMetricsOverride', { width: m.width, height: m.height, deviceScaleFactor: m.deviceScaleFactor, mobile: true, screenWidth: m.width, screenHeight: m.height });
              await sendMsg('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: m.maxTouchPoints });
              await sendMsg('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
            }
            } // end !nativeEngine — native flags cover UA/timezone/cores/device-metrics
            // Native engine has NO screen flag, so it leaks the REAL monitor (linking every
            // profile on the machine). Spoof screen.* to the profile's resolution:
            // deviceScaleFactor:0 keeps the real dpr + rendering, width/height:0 leaves the
            // viewport untouched (verified). Applies to new tabs too, before first paint.
            if (fpConfig.nativeEngine && fpConfig.screenW && fpConfig.screenH) {
              await sendMsg('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: fpConfig.screenW, screenHeight: fpConfig.screenH });
            }
            if (fpLate.geoLat != null && fpLate.geoLng != null) {
              await sendMsg('Browser.grantPermissions', { permissions: ['geolocation'] });
              await sendMsg('Emulation.setGeolocationOverride', { latitude: fpLate.geoLat, longitude: fpLate.geoLng, accuracy: fpLate.geoAcc });
            }
            return true;
          }
          if (isWorker) {
            // Native engine already reports the spoofed core count to workers.
            if (!fpConfig.nativeEngine && fpConfig.cores) await sendMsg('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores });
            return true;
          }
          return true; // 'other'/'browser' target
        } catch (e) {
          return false;
        }
      };

      let resumed = false;
      const resume = async () => {
        if (resumed) return; // idempotent: the guard timer AND the final call may both fire
        resumed = true;
        // waitForDebuggerOnStart pauses every new target — it MUST be resumed or the
        // tab hangs at about:blank. Normal path: resume on the flat child session
        // (time-bounded so even a stalled resume can't wedge the tab).
        try {
          if (child) { await withTimeout(child.send('Runtime.runIfWaitingForDebugger'), 4000); return; }
        } catch (e) { /* fall through to a best-effort resume below */ }
        // No flat child session (target detached before we saw it, or a rare
        // non-routable type): best-effort legacy resume so the target can never
        // hang. Failure here just means the target is already gone.
        try {
          await rootCdp.send('Target.sendMessageToTarget', {
            sessionId: ev.sessionId,
            message: JSON.stringify({ id: Math.floor(Math.random() * 1e6), method: 'Runtime.runIfWaitingForDebugger', params: {} })
          });
        } catch (e2) { /* target already gone */ }
      };

      // GUARANTEE the target resumes even if inject() stalls: arm a resume on a short
      // timer BEFORE awaiting injection. Node's timer fires independently of the
      // pending inject() await, so a window.open()/target=_blank tab can never hang at
      // about:blank waiting on a slow/stuck CDP call. The init script + overrides are
      // sent first and normally finish in <100ms (clearTimeout below cancels this);
      // the timer only fires in the degenerate stall case, un-pausing the tab anyway.
      const resumeGuard = setTimeout(() => { resume().catch(() => {}); }, 1500);
      let injected = false;
      try {
        injected = await inject();
        for (let i = 0; i < 20 && !injected && child; i += 1) {
          await new Promise(r => setTimeout(r, 25));
          injected = await inject();
        }
      } catch (e) { /* inject self-catches; guard the loop too so resume always runs */ }
      clearTimeout(resumeGuard);

      if (isPageish && !injected) {
        console.error('[SG][fingerprint] new-tab injection FAILED — this tab may expose the REAL GPU/RAM/WebRTC. profile',
          profileId, title || '', '— target', info.url || info.targetId || info.type);
      }

      // ALWAYS resume (idempotent via `resumed`), even if injection failed, so the tab never hangs.
      await resume();
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

  // Compute the UA / Client-Hints / Accept-Language / mobile identity NOW and hand it
  // to the early auto-attach handler BEFORE the geo lookup below. None of it depends on
  // geo, and the in-page SOCKS geo lookup can block for several seconds — a tab opened
  // during that window would otherwise attach with the fingerprint script but NO CDP
  // UA/CH override, leaking the REAL Chrome UA on its first request (a header/JS split
  // and exactly the kind of new-tab inconsistency that trips bot detection). Timezone +
  // geolocation, which DO depend on the lookup, are handed over afterward.
  // navigator.languages is delivered by the injection extension (fpConfig.langs, built
  // before launch); keep the Accept-Language HEADER consistent with it so headers and JS
  // never disagree (a mismatch is itself a detection signal).
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

  fpLate.ua = ua;
  fpLate.acceptLanguage = acceptLanguage;
  fpLate.mobileMetrics = mobileMetrics;

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

  // Timezone + geolocation depend on the lookup above, so hand them to the auto-attach
  // handler now (new tabs opened after this point get the full identity).
  fpLate.timezoneId = timezoneId;
  fpLate.geoLat = geoLat;
  fpLate.geoLng = geoLng;
  fpLate.geoAcc = toInt(profile.locationAcc, 100);

  // Apply the full fingerprint to a single page. Used for the first tab AND for
  // every tab/popup opened later, so new windows are never left un-spoofed
  // (leaking the real UA / timezone / devices). Idempotent per page.
  const appliedPages = new WeakSet();
  // audit: applyToPage previously swallowed ALL injection errors, so a profile
  // could report "launched" while running with the REAL identity. Track whether
  // the identity setup on the primary tab actually completed and surface it.
  let injectionDegraded = false;
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
      // Native engine spoofs UA / timezone / cores / device-metrics itself from launch
      // flags; re-applying them over CDP would fight the native identity (a CDP UA that
      // disagrees with the native Sec-CH-UA headers is a tell). Skip them when native —
      // geolocation / DNT / request-filtering below aren't native, so they still run.
      if (!fpConfig.nativeEngine) {
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
      } // end !nativeEngine — native flags already set UA/timezone/cores/device-metrics
      // Native engine: spoof screen.* to the profile resolution (fingerprint-chromium has no
      // screen flag → it would leak the real monitor across all profiles). deviceScaleFactor:0
      // preserves the real dpr + rendering; width/height:0 leaves the viewport intact.
      if (fpConfig.nativeEngine && fpConfig.screenW && fpConfig.screenH) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: fpConfig.screenW, screenHeight: fpConfig.screenH }).catch(() => {});
      }
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
      // Smart Autofill — expose the persona bridge + inject the in-page widget on
      // this tab and its future navigations (no-op unless the bridge is configured).
      await attachPersonaAutofill(targetPage);
    } catch (e) {
      // Per-page best-effort — never block the launch — but no longer SILENT:
      // record that this tab's identity setup did not fully complete so the
      // caller/UI can warn instead of implying protection that isn't there.
      if (!isNewTab) injectionDegraded = true;
      console.error('[SG][fingerprint] injection error on', (isNewTab ? 'new tab' : 'primary tab'),
        'for profile', profileId, title || '', '—', (e && e.message) || e);
    }
  };

  await applyToPage(page);
  if (injectionDegraded) {
    console.error('[SG][fingerprint] WARNING: profile', (title || profileId),
      'launched WITHOUT full fingerprint masking — the real UA/timezone/devices may be exposed.');
  }

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
        // Native engine already reports the spoofed core count inside workers.
        if (!fpConfig.nativeEngine && fpConfig.cores) await wcdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores }).catch(() => {});
      } catch (e) { /* worker target may close immediately */ }
      return;
    }
    if (targetType !== 'page') return;
    try {
      const newPage = await target.page();
      if (!newPage) return;
      // Proxy auth FIRST — before applyToPage's blank-tab early-return and before
      // the tab navigates. A new tab's very first request hits the proxy and gets a
      // 407; with an authenticated proxy that 407 never resolves into a
      // 'framenavigated' event, so deferring auth to applyToPage left such tabs
      // "loading forever". authenticate() persists on the page and answers the
      // in-flight challenge, so the navigation completes. Harmless when no creds.
      if (proxyCreds) await newPage.authenticate(proxyCreds).catch(() => {});
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

  // Bridge for the start page's check links: open each in a NEW tab from the main
  // process, attaching proxy auth BEFORE the navigation so an authenticated proxy
  // never stalls the tab on a 407 (a window.open/target=_blank popup navigates the
  // instant it opens, racing per-tab auth — this sequences auth-then-goto). Exposed
  // before the start page loads so window.__sgzOpenTab exists when it runs.
  try {
    await page.exposeFunction('__sgzOpenTab', async (url) => {
      try {
        if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
        const np = await browser.newPage();
        if (proxyCreds) await np.authenticate(proxyCreds).catch(() => {});
        await np.bringToFront().catch(() => {});
        await np.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } catch (e) { /* best-effort — a failed open must never affect the session */ }
    });
  } catch (e) { /* already exposed on this page */ }

  // On-startup mode: 'detection' shows the SoftGlaze IP/fingerprint start page;
  // 'blank' and 'last' skip it (no proxy-detection page) and open about:blank.
  const startupMode = browserSettings.mode || 'detection';
  let startUrl = 'about:blank';
  if (startupMode === 'detection') {
    startUrl = await generateStartPage(userDataDir, { title, profileId: profileId || 'TEMP-ID', proxyLabel, geo });
  } else if (usingCft) {
    // CfT and the anti-detect engine (Ungoogled-Chromium) have no usable blank/NTP:
    // about:blank renders as a dark VOID in OS dark-mode, and Ungoogled's own new tab
    // is a bare "Web Store" icon — both read as "the browser launched blank / broken"
    // (exactly the report we got). Point the first tab at chrome://newtab, which the
    // extension redirects to our functional New Tab Page (search box + check links).
    // Real Chrome (usingCft === false) keeps about:blank — its blank page is fine.
    startUrl = 'chrome://newtab';
  }
  // DIAGNOSTIC: pins down the exact launch state when a profile shows a blank/black tab.
  console.log(`[SG][launch] antidetect=${usingAntidetect} cft=${usingCft} realChrome=${Boolean(chosenBrowser && chosenBrowser.isReal)} minCdp=${browserSettings.minimizeCdpFootprint === true} mode=${startupMode} startUrl=${startUrl} binary=${String((chosenBrowser && chosenBrowser.exePath) || '').split(/[\\/]/).pop()}`);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => { console.log('[SG][launch] startUrl navigation failed:', e && e.message); });

  const sessionId = String(profileId || crypto.randomUUID());
  // The CDP/WebDriver debugging endpoint — handed to the local REST API so users
  // can attach external Playwright/Puppeteer/Selenium scripts to this container.
  let wsEndpoint = null;
  try { wsEndpoint = browser.wsEndpoint(); } catch (e) { wsEndpoint = null; }
  let sessionPid = null;
  try { sessionPid = browser.process() ? browser.process().pid : null; } catch (e) { sessionPid = null; }
  activeSessions.set(sessionId, {
    browser,
    page,
    userDataDir,
    wsEndpoint,
    pid: sessionPid,
    title: title || `Profile ${sessionId}`,
    proxyLabel,
    injectionOk: !injectionDegraded,
    socksRelay, // local SOCKS5 auth relay (or null) — closed when the session ends
    createdAt: new Date()
  });
  sessionRegistered = true;
  browser.on('disconnected', () => {
    activeSessions.delete(sessionId);
    if (socksRelay) { try { socksRelay.close(); } catch (e) {} } // tear down the relay with the browser
    // Classify the disconnect: app shutdown and explicit user-close are clean;
    // anything else is a crash (ipcHandlers bumps crashCount + notifies).
    let reason = 'crash';
    if (shuttingDown) reason = 'shutdown';
    else if (intentionalClose.has(sessionId)) { reason = 'user'; intentionalClose.delete(sessionId); }
    emitSessionEvent({ type: reason === 'crash' ? 'crashed' : 'closed', sessionId, reason });
  });

  // Success — emit 'launched' and return the session handle from INSIDE the guard try,
  // where sessionId / wsEndpoint / sessionPid / injectionDegraded are in scope. They are
  // block-scoped (const/let) to this try, so emitting + returning AFTER the catch threw
  // `ReferenceError: sessionId is not defined` and failed EVERY launch — after the
  // browser had already opened, leaving a half-set-up session (browserEngine.js:2713).
  emitSessionEvent({ type: 'launched', sessionId, profileId: (profileId != null ? Number(profileId) : null), engine: 'chrome', pid: sessionPid });
  return { sessionId, userDataDir, wsEndpoint, injectionOk: !injectionDegraded };

  } catch (launchErr) {
    // Post-launch setup failed before the session was registered. Close the
    // now-orphaned browser + SOCKS relay (best-effort) and rethrow so the caller
    // reports failure.
    if (!sessionRegistered) {
      try { await browser.close(); } catch (e) { /* already gone */ }
      if (socksRelay) { try { socksRelay.close(); } catch (e) {} }
    }
    throw launchErr;
  }
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

// Close a browser but NEVER hang the caller (audit: close() had no timeout and
// never force-killed). A wedged Chrome can leave close() pending forever, which
// would block app quit. Race close() against a timeout; if it doesn't finish,
// SIGKILL the tracked OS process so the app can still exit cleanly.
async function closeBrowserWithTimeout(session, timeoutMs = 8000) {
  if (!session || !session.browser) return;
  const browser = session.browser;
  let pid = session.pid || null;
  if (!pid) { try { const p = browser.process(); pid = p ? p.pid : null; } catch (e) { pid = null; } }
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  const closed = browser.close().then(() => 'closed', () => 'error');
  const outcome = await Promise.race([closed, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome !== 'closed') {
    // audit: SIGKILL on only the parent Chrome PID orphans its renderer/GPU/utility
    // children on Windows (no process groups), leaving them holding the profile's
    // userDataDir lock + memory until the next launch. Use taskkill /T (tree kill).
    if (process.platform === 'win32' && pid) {
      try { require('node:child_process').spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); }
      catch (e) { try { process.kill(pid, 'SIGKILL'); } catch (e2) { /* already gone */ } }
    } else {
      try { const p = browser.process(); if (p && !p.killed) p.kill('SIGKILL'); } catch (e) { /* ignore */ }
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (e) { /* already gone */ } }
    }
  }
  // Tear down the SOCKS relay too (idempotent — the 'disconnected' handler may
  // also close it; double-close is safe). Guards the force-kill path where the
  // disconnect event might not fire.
  if (session.socksRelay) { try { session.socksRelay.close(); } catch (e) {} }
}

async function closeProfileSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session) return { closed: false };
  intentionalClose.add(id); // deliberate close — the disconnect must not be read as a crash
  await closeBrowserWithTimeout(session);
  activeSessions.delete(id);
  return { closed: true };
}

async function closeAllProfileSessions() {
  shuttingDown = true; // app is quitting — these closes are not crashes; SessionState rows stay 'running' for restore
  // Close every session concurrently, each with its own timeout+force-kill, so one
  // wedged Chrome can't stall the whole quit sequence behind the others.
  await Promise.all(Array.from(activeSessions.values()).map((s) => closeBrowserWithTimeout(s)));
  activeSessions.clear();
}

// Validate the live-session registry against real browser connections and drop
// entries whose Chromium exited silently without firing 'disconnected' (external
// kill, crash, OOM). Keeps the running count honest for the concurrency ceiling
// and the UI. Returns the number of stale sessions pruned.
function pruneDeadSessions() {
  let pruned = 0;
  for (const [sessionId, session] of activeSessions) {
    let alive = true;
    try { alive = Boolean(session && session.browser && session.browser.isConnected()); }
    catch (e) { alive = false; }
    if (!alive) { activeSessions.delete(sessionId); pruned += 1; }
  }
  return pruned;
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

// Snapshot of running sessions with their main-process PID, for OS-level memory
// queries (ipcHandlers maps PIDs -> RSS via tasklist). pid is null when the
// browser didn't expose a process handle.
function listSessionPids() {
  return Array.from(activeSessions.entries()).map(([sessionId, s]) => ({
    sessionId,
    pid: s.pid || null,
    title: s.title
  }));
}

module.exports = {
  DEFAULT_PROFILE_ROOT,
  parseProxyInput,
  // Pure helper exported for regression tests: maps a proxy type to its --proxy-server
  // scheme (asserts SOCKS4 → socks4://, not http://).
  buildProxyServerArgument,
  // Exported for regression tests: the in-page fingerprint/anti-leak script. Tests run
  // it in a vm sandbox to assert overrides don't leak (toString/name integrity, spoofed
  // navigator props on the prototype rather than the instance).
  fingerprintScript,
  // Reused by the Firefox engine so both engines open the same SoftGlaze start page.
  generateStartPage,
  // Reused by the Firefox engine to bind timezone/locale to the proxy exit IP (parity
  // with the Chrome engine): maps the proxy's geo → IANA timezone + a country locale.
  lookupProxyGeoNodeCached,
  COUNTRY_LOCALE,
  configurePersonaBridge,
  launchProfileSession,
  closeProfileSession,
  closeAllProfileSessions,
  listActiveSessions,
  pruneDeadSessions,
  listSessionPids,
  setSessionEventSink,
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
  // Pure helper exported for regression tests: builds the reported UA + Client-Hints
  // bundle. Tests assert the coherence guard clamps the reported major to the launched
  // binary (guarding against the "reported 149 vs real 150+" TLS mismatch).
  buildUserAgentBundle,
  // Debug hook (used by test harnesses) — returns the live puppeteer Browser.
  __browserFor: (sessionId) => {
    const s = activeSessions.get(String(sessionId));
    return s ? s.browser : null;
  }
};