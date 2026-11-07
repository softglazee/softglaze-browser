'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs'); // sync API for PID tracking
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { generateMediaDevices, buildBrandIdentity } = require('./fingerprintGenerator');
const { applyBrandWindowIcon } = require('./windowIcon');
const platform = require('./platform');
// Shared with browserDownloader so the binary resolver reads exactly where the downloader writes
// (userData when packaged, project root in dev). browserDownloader does not require this module.
const { CHROME_ROOT: DOWNLOAD_CHROME_ROOT } = require('./browserDownloader');
const { buildAutofillRunSource } = require('./personaAutofill');
const { attachPageBridge, attachIsolatedWorld } = require('./pageBridge');
const { attachBrowserLocks } = require('./browserLocks');
// A function expression taking the isolated world's rpc - see attachPersonaAutofill.
const PERSONA_AUTOFILL_RUN_SOURCE = buildAutofillRunSource();
// Chromium cannot authenticate to a SOCKS5 proxy, so authenticated ones go through a local relay.
const { startSocksAuthRelay } = require('./socksRelay');
const { startHttpAuthRelay } = require('./httpRelay');
const { GEOJS_URL, normalizeGeoJs, pickGeoConsensus } = require('./proxyVendorUtils');
const blockDetect = require('./blockDetect');

// Puppeteer defaults a page can observe: webdriver/infobar, popup blocking, IPC flood throttling,
// forced sRGB, missing component extensions. Background-throttling switches stay so runners do not
// stall in hidden windows; puppeteer merges its --disable-features into ours, so those cannot go.
const PUPPETEER_DEFAULT_ARGS_TO_DROP = Object.freeze([
  '--enable-automation',
  '--disable-popup-blocking',
  '--disable-ipc-flooding-protection',
  '--force-color-profile=srgb',
  '--disable-component-extensions-with-background-pages'
]);

// A free loopback TCP port, found by binding port 0 and releasing it. Used for Chrome's
// DevTools port, because an auto-assigned (0) port puts Chrome into automation mode.
function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Drop stealth evasions that set properties spoofed per profile (UA, WebGL vendor, cores, languages):
// running both gives the inconsistent values detectors flag. A plugin instance cannot be shared
// between two PuppeteerExtra instances, so each engine needs a fresh one.
function makeStealth() {
  const s = StealthPlugin();
  ['user-agent-override', 'navigator.hardwareConcurrency', 'navigator.languages', 'webgl.vendor']
    .forEach((e) => { try { s.enabledEvasions.delete(e); } catch (err) {} });
  return s;
}
puppeteer.use(makeStealth());

// Opt-in engine (browserSettings.minimizeCdpFootprint): rebrowser in enableDisable mode enables the
// CDP Runtime domain only briefly per navigation, hiding a top anti-bot tell. Opt-in until A/B tested
// on a live CAPTCHA. Loaded lazily; cached with stealth (headless) and without (visible profiles).
const _runtimeFixPuppeteer = { stealth: null, clean: null };
function getRuntimeFixPuppeteer({ stealth = false } = {}) {
  const slot = stealth ? 'stealth' : 'clean';
  if (_runtimeFixPuppeteer[slot]) return _runtimeFixPuppeteer[slot];
  // rebrowser reads this from process.env at runtime. enableDisable is the only mode
  // that keeps main-world page.evaluate working (addBinding is unwired in 22.15.0;
  // alwaysIsolated loses the main world).
  if (!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE) process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = 'enableDisable';
  const { addExtra } = require('puppeteer-extra');
  const engine = addExtra(require('rebrowser-puppeteer-core'));
  if (stealth) engine.use(makeStealth());
  _runtimeFixPuppeteer[slot] = engine;
  return engine;
}

// Stealth evasions disguise headless Chromium; a visible real browser already has real chrome.*,
// plugins and iframes, so they only add fakes (measured: Google CAPTCHA every run). Headless only.
function useStealthFor({ headless }) {
  return Boolean(headless) && headless !== 'false';
}


// Driver for fingerprint-chromium, without stealth: the engine already hides webdriver and spoofs
// canvas/WebGL/audio/UA natively, so the evasions would only add their own fingerprintable patterns.
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

// ---- Session lifecycle events ----
// ipcHandlers sets the sink and persists SessionState; this module stays free of DB/IPC deps.
let sessionEventSink = null;
function setSessionEventSink(fn) { sessionEventSink = (typeof fn === 'function') ? fn : null; }
function emitSessionEvent(evt) { try { if (sessionEventSink) sessionEventSink(evt); } catch (e) { /* never let reporting break a launch/close */ } }
const intentionalClose = new Set(); // sessionIds the user explicitly closed (so the disconnect isn't read as a crash)
let shuttingDown = false;           // app is quitting; closes are not crashes and must not clear restore state

// ---- Smart Autofill bridge ----
// ipcHandlers wires in the persona DB operations at startup; a no-op until configured.
let personaBridge = null;
function configurePersonaBridge(deps) {
  if (deps && typeof deps.listForUrl === 'function' && typeof deps.markUsed === 'function') {
    personaBridge = deps;
  }
}

// Runs the autofill widget and its bridge in a private isolated world (once per page; Chromium only).
// Defense in depth: origin comes from the committed page URL, passwords never enter page context
// (filled by persona id), and fill plans are bounded so a page cannot hog the CDP keyboard.
const PERSONA_FILL_MAX_ITEMS = 40;
const PERSONA_FILL_MAX_VALUE_LEN = 256;   // per page-supplied field value
const PERSONA_FILL_MAX_TOTAL_CHARS = 4000; // whole-plan typing budget

// Strips secrets before a persona reaches page JS: the password becomes `hasPassword`, so the page
// can never read passwords in bulk.
function toPublicPersona(p) {
  if (!p || typeof p !== 'object') return null;
  const { password, ...rest } = p;
  // `rest` may already be stripped by ipcHandlers (no `password` key), so keep an existing hasPassword
  // instead of clobbering it to false. The strip stays as defense in depth.
  return { ...rest, hasPassword: Boolean(password) || Boolean(rest.hasPassword) };
}

// Active identities, per launched browser (so every tab of one profile shares them and
// they die with the session). 30 minutes of no activity releases one.
const { siteKeyOf } = require('./siteKey');
const ACTIVE_IDENTITY_TTL_MS = 30 * 60 * 1000;
const activeIdentityStores = new WeakMap(); // Browser -> Map(siteKey -> { id, url, at })
function activeStoreFor(targetPage) {
  let owner = null;
  try { owner = targetPage.browser(); } catch (e) { owner = null; }
  if (!owner) return new Map();
  let m = activeIdentityStores.get(owner);
  if (!m) { m = new Map(); activeIdentityStores.set(owner, m); }
  return m;
}

async function attachPersonaAutofill(targetPage) {
  if (!personaBridge || !targetPage) return;
  // Respect the global Smart Autofill toggle (fail-open if the check throws).
  if (personaBridge.isEnabled) { try { if (!(await personaBridge.isEnabled())) return; } catch (e) { /* default on */ } }
  // The page's real committed origin, the single source of truth for persona scoping.
  // Falls back to '' (the bridge then returns nothing).
  const pageUrl = () => { try { return targetPage.url() || ''; } catch (e) { return ''; } };
  // Each handler is defined once and served over both isolated-world transports, so they never drift.
  // Nothing comes from the vault while locked or signed out; fails closed if the check throws.
  const vaultOpen = async () => {
    if (typeof personaBridge.isAvailable !== 'function') return true;
    try { return (await personaBridge.isAvailable()) === true; } catch (e) { return false; }
  };
  const hPersonaList = async () => {
      if (!(await vaultOpen())) return [];
      try {
        const r = await personaBridge.listForUrl(pageUrl());
        const list = (r && Array.isArray(r.personas)) ? r.personas : (Array.isArray(r) ? r : []);
        return list.map(toPublicPersona).filter(Boolean);
      } catch (e) { return []; }
  };
  // Multi-step signups: the identity picked on step 1 stays active for this site across steps and
  // page loads, and is marked used only on the final submit. In memory, per profile session.
  const activeSites = activeStoreFor(targetPage);
  const hPersonaActive = async (op, id) => {
      if (!(await vaultOpen())) return null;
      const url = pageUrl();
      const key = siteKeyOf(url);
      if (!key) return null;
      const now = Date.now();
      if (op === 'clear') { activeSites.delete(key); return null; }
      if (op === 'set') {
        const pid = String(id || '');
        if (!pid) return null;
        // Only an identity actually offered for this origin can become active.
        let offered = false;
        try {
          const r = await personaBridge.listForUrl(url);
          const list = (r && Array.isArray(r.personas)) ? r.personas : (Array.isArray(r) ? r : []);
          offered = list.some((p) => p && String(p.id) === pid);
        } catch (e) { offered = false; }
        if (!offered) return null;
        activeSites.set(key, { id: pid, url, at: now });
        return { id: pid };
      }
      const e = activeSites.get(key);
      if (!e || now - e.at > ACTIVE_IDENTITY_TTL_MS) {
        activeSites.delete(key);
        // A "finishing" identity nobody continued with was a real final submit.
        if (e && e.pending) { try { await personaBridge.markUsed(e.id, e.url); } catch (err) { /* best effort */ } }
        return null;
      }
      // 'finish': a submit that looks final but has no password ("Start my free trial" on step 1).
      // It stays pending and the next page decides: more fields = a step, nothing to fill = mark used.
      if (op === 'finish') {
        if (String(id || '') !== e.id) return null;
        e.pending = true;
      }
      e.at = now; // each step keeps it alive
      return { id: e.id, pending: !!e.pending };
  };
  const hPersonaMarkUsed = async (id) => {
      if (!(await vaultOpen())) return { ok: false, error: 'locked' };
      const pid = String(id || '');
      // The final submit often navigates first, so pageUrl() may already be the post-signup page.
      // Mark the identity on the site recorded when it became active.
      let url = pageUrl();
      const key = siteKeyOf(url);
      let activeKey = null;
      for (const [k, e] of activeSites) { if (e.id === pid && (k === key || !activeKey)) activeKey = k; }
      if (activeKey) url = activeSites.get(activeKey).url;
      try {
        await personaBridge.markUsed(pid, url);
        if (activeKey) activeSites.delete(activeKey);
        return { ok: true };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  };
    // Trusted typing: the widget hands over a fill plan, typed here with real (isTrusted) key events and
    // human delays. Password items carry only a personaId; the plaintext is resolved here. `world` is the
    // widget's isolated world, where page JS cannot patch the DOM APIs that guard a password.
  let world = null;
  const fillPlanOnce = async (plan, meta) => {
      if (!Array.isArray(plan)) return { ok: false, filled: 0 };
      if (!(await vaultOpen())) return { ok: false, filled: 0 };
      const items = plan.slice(0, PERSONA_FILL_MAX_ITEMS);
      const secretCache = new Map(); // personaId -> password (fetched once per plan)
      let filled = 0;
      let failed = 0; // fields we could not verify - never counted as filled
      let charBudget = PERSONA_FILL_MAX_TOTAL_CHARS;
      // The plan only comes from the isolated world, yet secrets keep their own gates, checked up front:
      // (1) an isTrusted click on the widget (meta.gesture) plus transient user activation in this frame,
      // (2) a personaId offered for this committed origin, (3) each target re-validated right before typing.
      const wantsSecret = items.some((it) => it && it.kind === 'password');
      let gestured = false;
      if (wantsSecret && meta && meta.gesture === true && world) {
        try { gestured = (await world.evaluate(personaActivationProbe)) === true; } catch (e) { gestured = false; }
      }
      let allowedSecretIds = null;
      const ensureAllowedSecretIds = async () => {
        if (allowedSecretIds) return allowedSecretIds;
        allowedSecretIds = new Set();
        if (!gestured) return allowedSecretIds;
        if (typeof personaBridge.listForUrl !== 'function') return allowedSecretIds;
        try {
          const r = await personaBridge.listForUrl(pageUrl());
          const list = (r && Array.isArray(r.personas)) ? r.personas : (Array.isArray(r) ? r : []);
          for (const p of list) if (p && p.id != null) allowedSecretIds.add(String(p.id));
        } catch (e) { /* empty set → refuse every secret */ }
        return allowedSecretIds;
      };
      // The plan index is reported back so the widget knows which fields did not take and keeps them
      // retryable instead of marking them done.
      const failedIdx = [];
      const markFailed = (i) => { failed += 1; failedIdx.push(i); };
      for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
        const item = items[itemIdx];
        const sel = item && item.sel;
        if (!sel) { markFailed(itemIdx); continue; }
        let value;
        if (item.kind === 'password') {
          // The password value never comes from the page: it is resolved here by id, only when gesture-gated
          // and offered for this origin.
          const pid = item.personaId != null ? String(item.personaId) : '';
          // Every refusal below leaves a password field empty, so it must be reported as failed.
          if (!pid || typeof personaBridge.getSecret !== 'function') { markFailed(itemIdx); continue; }
          const allowed = await ensureAllowedSecretIds();
          if (!allowed.has(pid)) { markFailed(itemIdx); continue; }
          if (!secretCache.has(pid)) {
            try { const s = await personaBridge.getSecret(pid); secretCache.set(pid, (s && s.password != null) ? String(s.password) : ''); }
            catch (e) { secretCache.set(pid, ''); }
          }
          value = secretCache.get(pid);
          if (!value) { markFailed(itemIdx); continue; }
          // (3) Re-validate the target in the isolated world right before typing: one match, a visible password
          // input in the viewport, opacity > 0, >= 2px, not aria-hidden. A re-tagged hidden trap gets nothing.
          let targetOk = false;
          try { targetOk = (await world.evaluate(personaPickPasswordTarget, sel, pwSlot)) === true; } catch (e) { targetOk = false; }
          if (!targetOk) { markFailed(itemIdx); continue; }
        } else {
          value = item.value != null ? String(item.value) : '';
          if (value.length > PERSONA_FILL_MAX_VALUE_LEN) value = value.slice(0, PERSONA_FILL_MAX_VALUE_LEN);
        }
        // DOM steps run in the widget's isolated world, not via main-world handles (page.$, page.select):
        // with Minimize CDP footprint, rebrowser gives fingerprint-chromium a blank about:blank main world.
        // Mouse and keyboard still go through the CDP Input domain, so events stay trusted.
        try {
          if (item.kind === 'select') {
            let selOk = false;
            try { selOk = (await world.evaluate(personaSetSelect, sel, value)) === true; } catch (e) { selOk = false; }
            if (selOk) filled += 1; else markFailed(itemIdx);
            continue;
          }
          // Focus with a real trusted click (focus without mousedown is a behavioural tell), but only where
          // the point hits this field; the panel, a sticky header or a cookie bar may cover it. Otherwise,
          // or when focus does not verify, fall back to DOM focus.
          let spot = null;
          try { spot = await world.evaluate(personaPrepareTarget, sel); } catch (e) { spot = null; }
          if (!spot || !spot.ok) { markFailed(itemIdx); continue; }
          let focused = false;
          if (spot.click) {
            try {
              await targetPage.mouse.click(spot.x, spot.y, { delay: 30 + Math.floor(Math.random() * 60) });
              focused = (await world.evaluate(personaFocusTarget, sel, true)) === true;
            } catch (e) { focused = false; }
          }
          if (!focused) {
            try { focused = (await world.evaluate(personaFocusTarget, sel, false)) === true; } catch (e) { focused = false; }
          }
          // Focus did not land where we aimed - typing now would spray keystrokes into
          // whatever else has focus. Skip the field and report it instead.
          if (!focused) { markFailed(itemIdx); continue; }
          const isSecret = item.kind === 'password';
          // A password is typed only while focus is on the exact node validated in the isolated world,
          // checked before every keystroke, so a page that moves focus mid-fill stops the secret at once.
          const onTarget = async () => {
            try { return (await world.evaluate(personaTargetFocused, pwSlot)) === true; } catch (e) { return false; }
          };
          if (isSecret && !(await onTarget())) { markFailed(itemIdx); continue; }
          const typed = charBudget > 0 ? value.slice(0, charBudget) : '';
          if (!typed) { markFailed(itemIdx); continue; }
          let aborted = false;
          for (const ch of typed) {
            if (isSecret && !(await onTarget())) { aborted = true; break; }
            // Same guard for plain fields: if focus moved (the user clicked elsewhere,
            // the page re-rendered), stop rather than type into the wrong field.
            if (!isSecret && !(await world.evaluate(personaIsFocused, sel).catch(() => false))) { aborted = true; break; }
            await targetPage.keyboard.type(ch, { delay: 50 + Math.floor(Math.random() * 100) });
          }
          if (aborted) { markFailed(itemIdx); continue; }
          charBudget -= typed.length;
          // Confirm the characters landed in this element before counting a fill. Length only, so a password
          // never travels out of the page. Then commit (change + blur).
          let landed = false;
          try { landed = (await world.evaluate(personaCommitTarget, sel, typed.length)) === true; } catch (e) { landed = false; }
          if (landed) filled += 1; else markFailed(itemIdx);
        } catch (e) { markFailed(itemIdx); /* skip one field, keep going */ }
      }
      return { ok: true, filled, failed, failedIdx };
  };
  // One fill at a time per tab: page.keyboard types into whatever has focus, so parallel plans
  // interleave keystrokes. Backstop for multi-step re-runs and double clicks; the widget also refuses.
  let fillChain = Promise.resolve();
  const hPersonaFillPlan = (plan, meta) => {
    const run = fillChain.then(() => fillPlanOnce(plan, meta));
    fillChain = run.catch(() => {});
    return run;
  };

  const personaHandlers = {
    __sgPersonaList: hPersonaList,
    __sgPersonaMarkUsed: hPersonaMarkUsed,
    __sgPersonaFillPlan: hPersonaFillPlan,
    __sgPersonaActive: hPersonaActive
  };
  // The widget and its bridge live only in a private CDP isolated world, so a site can neither call
  // the vault nor detect SoftGlaze through it. No world, no widget: there is no main-world fallback.
  const pwSlot = 's' + crypto.randomBytes(9).toString('hex'); // isolated-world global
  try { world = await attachIsolatedWorld(targetPage, personaHandlers, PERSONA_AUTOFILL_RUN_SOURCE); } catch (e) { world = null; }
  if (world && !world.ok) world = null;
}

// Isolated-world probes for the password gate. Serialized and run via
// world.evaluate, so they must be self-contained.
function personaActivationProbe() {
  try { return !!(navigator.userActivation && navigator.userActivation.isActive); } catch (e) { return false; }
}
function personaPickPasswordTarget(sel, slot) {
  try {
    window[slot] = null;
    var list = document.querySelectorAll(sel);
    if (list.length !== 1) return false;
    var el = list[0];
    if (String(el.type || '').toLowerCase() !== 'password' || el.disabled || el.readOnly) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    var inView = function (r) { return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };
    var r = el.getBoundingClientRect();
    // A real field below the fold is scrolled to (as a person would); a decoy parked
    // off-screen with absolute positioning stays out of view and is refused.
    if (!inView(r) && r.width >= 2 && r.height >= 2) { try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {} r = el.getBoundingClientRect(); }
    if (r.width < 2 || r.height < 2 || !inView(r)) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = window.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) === 0) return false;
    }
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    window[slot] = el;
    return true;
  } catch (e) { return false; }
}
function personaTargetFocused(slot) {
  try { var el = window[slot]; return !!el && el.isConnected && document.activeElement === el; } catch (e) { return false; }
}
// Non-secret field helpers, same isolated world: each re-resolves the field and needs one match.
// Scrolls instantly (a smooth scroll moves the field after measuring) and returns a click point only
// if that point hits the field.
function personaPrepareTarget(sel) {
  try {
    var list = document.querySelectorAll(sel);
    if (list.length !== 1) return { ok: false };
    var el = list[0];
    if (el.disabled || el.readOnly) return { ok: false };
    var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    var r = el.getBoundingClientRect();
    var comfy = function (b) { return b.top >= 8 && b.left >= 0 && b.bottom <= vh - 8 && b.right <= vw; };
    if (!comfy(r)) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch (e) {}
      r = el.getBoundingClientRect();
    }
    if (r.width < 2 || r.height < 2 || !comfy(r)) return { ok: true, click: false };
    // Left of centre: keeps clear of the show-password eyes and clear buttons that sit
    // on the right of many inputs.
    var x = r.left + Math.min(r.width / 2, Math.max(10, r.width * 0.35));
    var y = r.top + r.height / 2;
    var hit = document.elementFromPoint(x, y);
    var ok = !!hit && (hit === el || el.contains(hit) || (hit.tagName === 'LABEL' && hit.control === el));
    return { ok: true, click: ok, x: x, y: y };
  } catch (e) { return { ok: false }; }
}
// Confirm focus is on the field; with `checkOnly` false, move it there (no scroll)
// and select any existing text so typing replaces it.
function personaFocusTarget(sel, checkOnly) {
  try {
    var list = document.querySelectorAll(sel);
    if (list.length !== 1) return false;
    var el = list[0];
    if (!checkOnly && document.activeElement !== el) el.focus({ preventScroll: true });
    if (document.activeElement !== el) return false;
    if (typeof el.select === 'function') { try { el.select(); } catch (e) {} }
    return true;
  } catch (e) { return false; }
}
function personaIsFocused(sel) {
  try { var list = document.querySelectorAll(sel); return list.length === 1 && document.activeElement === list[0]; } catch (e) { return false; }
}
// Did at least `n` characters land in the field? Length only, the value never leaves
// the page. Then commit it the way a person leaving the field would (change + blur).
function personaCommitTarget(sel, n) {
  try {
    var list = document.querySelectorAll(sel);
    if (list.length !== 1) return false;
    var el = list[0];
    var len = typeof el.value === 'string' ? el.value.length : (el.isContentEditable ? String(el.textContent || '').length : -1);
    try { el.dispatchEvent(new Event('change', { bubbles: true })); if (el.blur) el.blur(); } catch (e) {}
    return len >= n;
  } catch (e) { return false; }
}
// Native <select>: pick the option whose value the widget resolved, then fire the
// same input + change events page.select() fires.
function personaSetSelect(sel, value) {
  try {
    var list = document.querySelectorAll(sel);
    if (list.length !== 1) return false;
    var el = list[0];
    if (el.tagName !== 'SELECT' || el.disabled) return false;
    var v = String(value);
    var has = Array.prototype.some.call(el.options || [], function (o) { return o.value === v; });
    if (!has) return false;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === v;
  } catch (e) { return false; }
}

// ---- Real Chrome binaries ----
// Profiles launch a Chrome for Testing build matching their version, so UA, Client Hints, TLS/JA4 and
// workers all report the same real version; a faked UA on another engine is a detectable mismatch.
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
      // CHROME_INSTALL_DIR_RE captures [full, cftToken, major, rest] across all OSes.
      const m = platform.CHROME_INSTALL_DIR_RE.exec(ent.name);
      if (!m) continue;
      const exe = path.join(dir, ent.name, ...platform.chromeBinaryFromInstallDir().split('/'));
      if (!fsSync.existsSync(exe)) continue;
      const version = `${m[2]}.${m[3]}`;
      if (!seen.has(version)) seen.set(version, { major: Number(m[2]), version, exePath: exe });
    }
  }
  // newest first
  return Array.from(seen.values()).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

// Picks the on-disk Chrome matching the profile's major version, else the newest build, or null
// (bundled Chromium) when none are installed.
function resolveBrowserExecutable(desired) {
  const all = listAvailableBrowsers();
  if (all.length === 0) return null;
  // Match on the major only: `desired` may be a bare major ("142") or a full version
  // ("142.0.7444.176"); take the first run of digits.
  const major = Number.parseInt((String(desired || '').match(/\d+/) || [])[0] || '', 10);
  if (Number.isFinite(major)) {
    const match = all.filter((b) => b.major === major); // already sorted newest-patch first
    if (match.length) return match[0];
  }
  return all[0]; // newest available
}

// Finds a system-installed Google Chrome (stable), preferred over Chrome for Testing: CfT's New Tab
// Page crashes the browser on "+" and its icon is branded Testing.
// Returns { exePath, version, major, isReal: true } or null.
function findRealChrome() {
  // System Chrome/Chromium install locations for this OS (Windows Program Files,
  // macOS /Applications bundles, Linux /usr/bin and snap).
  const candidates = platform.realChromeCandidates();
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

// Real system Chrome is preferred: its New Tab Page is stable, it has no Testing icon, and it needs no
// NTP-override workaround (which Chrome's consent bubble lets the user disable). Without it, fall
// back to a downloaded CfT build (with the NTP override) by the profile's version.
function chooseBrowserBinary(profile, opts = {}) {
  // Profiles that load extensions prefer Chrome for Testing: stable Chrome silently ignores
  // --load-extension. Profiles without extensions keep the stealthier real Chrome.
  if (opts.preferCftForExtensions) {
    const cft = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
    if (cft) return { ...cft, isReal: false };
    // No CfT build installed - fall through to real Chrome so the profile still launches
    // (the extensions just won't mount; the UI hint tells the user to install a browser).
  }
  const real = findRealChrome();
  if (real) return real;
  const cft = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
  return cft ? { ...cft, isReal: false } : null;
}

// ---- fingerprint-chromium (native anti-detect engine, opt-in) ----
// Spoofs canvas/WebGL/audio/UA/platform/timezone natively from a seed, hides webdriver and blocks the
// WebRTC IP leak. Same puppeteer path, but our JS layer is skipped so the identities cannot conflict.
const FP_CHROMIUM_ROOT = path.join(path.dirname(DOWNLOAD_CHROME_ROOT), 'fp-chromium');
function resolveAntidetectBinary() {
  // Packaged (userData/../fp-chromium) first, then the dev checkout's <repo>/fp-chromium.
  const roots = [FP_CHROMIUM_ROOT, path.resolve(__dirname, '../../fp-chromium')];
  for (const root of roots) {
    const bin = platform.findFpChromiumBinary(root); // per-OS scan of root + one level
    if (bin) return bin;
  }
  return null;
}

// Maps the profile onto fingerprint-chromium's flags. Only coherently mappable axes are passed; the
// binary derives canvas, WebGL, audio and the exact UA from the seed. --disable-non-proxied-udp
// blocks the WebRTC IP leak when a proxy is set.
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

// ---- PID tracking for orphan cleanup ----
const PID_FILE = path.join(os.tmpdir(), 'softglaze_active_pids.json');

// How a profile browser ended, for Chrome and Firefox: 'shutdown' (app quitting), 'user' (our Stop),
// 'window-closed' (exit code 0, no signal: closed by X or over CDP), else 'crash' (non-zero, signal,
// or the connection dropped while the process ran or its end was not seen).
function classifyBrowserExit({ shuttingDown = false, intentional = false, exit = null } = {}) {
  if (shuttingDown) return 'shutdown';
  if (intentional) return 'user';
  if (exit && exit.code === 0 && !exit.signal) return 'window-closed';
  return 'crash';
}

// Resolve with { code, signal } once the process has exited, or null after `ms` if it
// is still running (or there is no process handle).
function waitForProcessExit(proc, ms = 3000) {
  return new Promise((resolve) => {
    if (!proc) return resolve(null);
    if (proc.exitCode !== null && proc.exitCode !== undefined) return resolve({ code: proc.exitCode, signal: null });
    if (proc.signalCode) return resolve({ code: null, signal: proc.signalCode });
    const timer = setTimeout(() => resolve(null), ms);
    proc.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

// Each entry is { pid, dir }: the user-data-dir lets the next start verify a leftover PID is this
// profile's browser before killing it (orphanCleanup.js). Old bare-number files are still read there.
const pidOf = (p) => (p && typeof p === 'object' ? p.pid : p);

function trackPid(pid, userDataDir = null) {
  try {
    let pids = [];
    if (fsSync.existsSync(PID_FILE)) {
      const content = fsSync.readFileSync(PID_FILE, 'utf8').trim();
      if (content) pids = JSON.parse(content);
    }
    if (!Array.isArray(pids)) pids = [];

    pids = pids.filter((p) => pidOf(p) !== pid);
    pids.push({ pid, dir: userDataDir ? String(userDataDir) : null });
    fsSync.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) {
    console.error('[PID Tracker] Failed to track PID', e.message);
  }
}

function untrackPid(pid) {
  try {
    if (!fsSync.existsSync(PID_FILE)) return;
    const content = fsSync.readFileSync(PID_FILE, 'utf8').trim();
    if (!content) return;

    let pids = JSON.parse(content);
    if (!Array.isArray(pids)) return;

    pids = pids.filter((p) => pidOf(p) !== pid);
    fsSync.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) {
    console.error('[PID Tracker] Failed to untrack PID', e.message);
  }
}

// ---- Helpers ----
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

// An IPv6 literal must be bracketed in a URL authority, or its colons read as the port separator
// and the --proxy-server arg or agent URL is malformed. IPv4 and hostnames pass through.
function formatProxyHost(host) {
  const h = String(host || '').trim();
  if (!h || h.startsWith('[')) return h;
  return h.includes(':') ? `[${h}]` : h;
}

function splitHostPort(tail) {
  const t = String(tail || '').trim();
  if (!t) return null;
  let host, portRaw;
  const v6 = t.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) { host = v6[1]; portRaw = v6[2]; }
  else {
    const i = t.lastIndexOf(':');
    if (i === -1) return null;
    host = t.slice(0, i);
    portRaw = t.slice(i + 1);
  }
  const port = Number.parseInt(String(portRaw || '').trim(), 10);
  if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: host.trim(), port };
}

// Percent-decode a userinfo field, but only when it actually looks encoded and the
// decode succeeds - a pasted password containing a bare '%' must survive untouched.
function decodeUserinfo(value) {
  const v = String(value || '').trim();
  if (!/%[0-9a-fA-F]{2}/.test(v)) return v;
  try { return decodeURIComponent(v); } catch (e) { return v; }
}

function parseProxyString(rawProxyString) {
  const raw = String(rawProxyString || '').trim();
  if (!raw) return null;
  // SOCKS4 vs SOCKS5 matters: Chromium speaks a different wire protocol for each and SOCKS4 has no
  // auth, so a wrong label breaks the connection. The scheme prefix is stripped before parsing.
  const scheme = (raw.match(/^(socks4a?|socks5|socks|https?):\/\//i) || [])[1] || '';
  const type = /^socks4/i.test(scheme) ? 'SOCKS4' : (/^socks/i.test(scheme) ? 'SOCKS5' : 'HTTP');
  const working = raw.replace(/^(socks4a?|socks5|socks|https?):\/\//i, '');

  // userinfo form user:pass@host:port (a documented batch format). Split at the last '@': a host
  // never contains one, a pasted password sometimes does.
  const at = working.lastIndexOf('@');
  if (at !== -1) {
    const userinfo = working.slice(0, at);
    const sep = userinfo.indexOf(':'); // first colon only; a password may contain more
    const hp = splitHostPort(working.slice(at + 1));
    if (!hp) throw new Error('Invalid proxy connection string format.');
    return {
      type,
      host: hp.host,
      port: hp.port,
      username: decodeUserinfo(sep === -1 ? userinfo : userinfo.slice(0, sep)) || null,
      password: sep === -1 ? null : (decodeUserinfo(userinfo.slice(sep + 1)) || null)
    };
  }

  // Bracketed IPv6 with no userinfo: [2001:db8::1]:8080[:user[:pass]]. The colon split
  // below reads '[2001' as the host, so peel the literal before it gets there.
  if (working.startsWith('[')) {
    const close = working.indexOf(']');
    if (close === -1) throw new Error('Invalid proxy connection string format.');
    const v6host = working.slice(1, close).trim();
    const rest = working.slice(close + 1).replace(/^:/, '');
    const seg = rest ? rest.split(':') : [];
    const v6port = Number.parseInt(String(seg[0] || '').trim(), 10);
    if (!v6host || !Number.isInteger(v6port) || v6port < 1 || v6port > 65535) {
      throw new Error('Invalid proxy connection string format.');
    }
    return {
      type,
      host: v6host,
      port: v6port,
      username: String(seg[1] || '').trim() || null,
      password: seg.slice(2).join(':').trim() || null
    };
  }

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
      password: input.password || null,
      // The country the vendor pull targeted (or the last check saw). Only a tie-breaker
      // for the launch geo lookup when the geo services disagree; never sent anywhere.
      country: (input.country || input.lastCountry || null)
    };
  }
  return null;
}

function buildProxyServerArgument(proxy) {
  if (!proxy) return null;
  // Map the type exactly: a wrong scheme (http:// for SOCKS) makes every request fail. Only http:// and
  // socks5:// resolve DNS on the proxy side; Chromium's socks4:// uses local DNS, which
  // launchProfileSession refuses. This mapper stays exact for the proxy checker and tests.
  const t = String(proxy.type).toLowerCase();
  const protocol = t === 'socks5' ? 'socks5' : (t === 'socks4' ? 'socks4' : 'http');
  return `${protocol}://${formatProxyHost(proxy.host)}:${proxy.port}`;
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
  // Check iOS before linux/android. Real iOS browsers are WebKit, so a Blink engine cannot carry an iOS
  // identity coherently; Android is the closest one it can (Blink, mobile GPU pool, mobile deviceClass).
  if (value.includes('ios') || value.includes('iphone') || value.includes('ipad')) {
    console.warn('[SG][fp] profile OS "iOS" is not supported on a Chromium engine (real iOS browsers are WebKit); using an Android mobile identity instead so the profile is at least coherent.');
    return { uaPlatform: 'Linux; Android 13; Pixel 7', navPlatform: 'Linux armv8l', chPlatform: 'Android', chVersion: '13.0.0' };
  }
  if (value.includes('android')) return { uaPlatform: 'Linux; Android 13; Pixel 7', navPlatform: 'Linux armv8l', chPlatform: 'Android', chVersion: '13.0.0' };
  if (value.includes('linux')) return { uaPlatform: 'X11; Linux x86_64', navPlatform: 'Linux x86_64', chPlatform: 'Linux', chVersion: '' };
  return { uaPlatform: 'Windows NT 10.0; Win64; x64', navPlatform: 'Win32', chPlatform: 'Windows', chVersion: '15.0.0' };
}

function buildUserAgentBundle(profile, realMajor, realFullVersion, seed) {
  const os = osTokens(profile.os);
  // Coherence guard: the reported Chrome major must match the launched binary, since TLS (JA3/JA4),
  // HTTP/2 SETTINGS and JS features come from it. Report the binary's real version; the profile pin is
  // only a fallback when browser.version() is unreadable. Build digits are not visible on the wire.
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

  // Chromium-family brands share Chrome's engine, so the real Chromium major stays everywhere and only
  // the vendor's UA token and brand entry are added. Plain Chrome adds no token.
  const ident = buildBrandIdentity(profile.browserBrand, major, fullVersion);
  const userAgent = `Mozilla/5.0 (${os.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0${ident.uaInfix || ''} Safari/537.36${ident.uaSuffix || ''}`;

  const brands = ident.brands.map((b) => ({ brand: b.brand, version: b.version }));

  // Client-Hint platform metadata must match the spoofed OS and GPU, or Platform-Version/Arch contradict
  // the UA and WebGL renderer. Derived from the profile, not hardcoded.
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
    // Windows: CH encodes the OS in platformVersion - Win11 ⇒ "15.0.0", Win10 ⇒ "10.0.0".
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

// ---- Native-engine gap filler ----
// fingerprint-chromium 148 exposes no speech voices (real Windows Chrome always has SAPI voices) and
// the host's real media devices. nativeGapScript fills only those two axes.
function randomGuardName() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const chars = letters + letters.toUpperCase() + '0123456789';
  const bytes = crypto.randomBytes(13);
  let out = letters[bytes[0] % 26];
  const len = 6 + (bytes[1] % 6);
  for (let i = 0; i < len; i += 1) out += chars[bytes[2 + i] % chars.length];
  return out;
}

function nativeGapScript(fp) {
  // Run-once guard: a per-launch random, non-enumerable name from the launcher (fp.guard), so neither
  // Object.keys nor a fixed-name probe like `'__sgn' in window` can single SoftGlaze out.
  const _guard = (fp && typeof fp.guard === 'string' && fp.guard) || ('_' + Math.random().toString(36).slice(2, 11));
  try {
    if (Object.getOwnPropertyDescriptor(window, _guard)) return;
    Object.defineProperty(window, _guard, { value: 1, enumerable: false, configurable: false, writable: false });
  } catch (e) {
    return; // cannot mark this document: skip rather than risk a double patch
  }

  // Patched functions must still report as native, or the override is the giveaway.
  const markNative = (fn, name) => {
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      Object.defineProperty(fn, 'toString', {
        value: function () { return 'function ' + name + '() { [native code] }'; },
        configurable: true, writable: true
      });
    } catch (e) {}
    return fn;
  };

  if (fp && fp.speechVoices && window.speechSynthesis) {
    const primary = (fp.langs && fp.langs[0]) || 'en-US';
    const base = String(primary).split('-')[0];
    const fake = [
      { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', localService: false, default: true },
      { voiceURI: 'Google UK English Female', name: 'Google UK English Female', lang: 'en-GB', localService: false, default: false },
      { voiceURI: 'Microsoft Natural', name: 'Microsoft Natural (' + base + ')', lang: primary, localService: true, default: false }
    ];
    try {
      const proto = Object.getPrototypeOf(window.speechSynthesis) || window.speechSynthesis;
      const orig = proto.getVoices;
      proto.getVoices = markNative(function () {
        const real = (function () { try { return orig.apply(this, arguments); } catch (e) { return []; } })();
        return real && real.length ? real : fake.map((v) => Object.assign({}, v));
      }, 'getVoices');
    } catch (e) {}
  }

  // Mirrors the enumerateDevices block in fingerprintScript, pre-grant and post-grant shapes included.
  // fp.mediaSet is generateMediaDevices()'s output: { os, isWindows, mic, spk, cam, hasCamera }
  // (labels, not counts).
  if (fp && fp.mediaDevices && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
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

      let granted = false;
      const md = navigator.mediaDevices;
      // Defined on the prototype, non-enumerable: an own property would show in
      // Object.getOwnPropertyNames(navigator.mediaDevices), which real Chrome never does.
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
          // Observe on a separate chain and return the original promise: returning p.then(...) would put this
          // script's filename in the page's rejection stacks, a direct tell. The caller still gets p.
          try { p.then(() => { granted = true; }, () => {}); } catch (e) { /* ignore */ }
          return p;
        }, 'getUserMedia'));
      }

      const build = () => {
        const rows = [];
        const audioIn = (deviceId, label) => rows.push({ kind: 'audioinput', deviceId, groupId: gMicIn, label });
        const audioOut = (deviceId, label) => rows.push({ kind: 'audiooutput', deviceId, groupId: gSpkOut, label });
        if (granted) {
          audioIn('default', 'Default - ' + micLabel);
          if (isWin) audioIn('communications', 'Communications - ' + micLabel);
          audioIn(micId, micLabel);
          rows.push({ kind: 'videoinput', deviceId: camId, groupId: gCam, label: camLabel });
          audioOut('default', 'Default - ' + spkLabel);
          if (isWin) audioOut('communications', 'Communications - ' + spkLabel);
          audioOut(spkId, spkLabel);
        } else {
          // Pre-grant: one endpoint per kind, empty deviceId + label, stable groupId -
          // precisely what real Chrome exposes before a permission grant.
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
}

// Seeds a native-engine profile with the Do-Not-Track preference. The default search provider cannot
// be seeded: it is a MAC-protected pref, so Chromium drops planted values. Only enterprise policy
// works, and that shows "Managed by your organization", itself a detection signal.
async function ensureNativeProfilePrefs(userDataDir, fpConfig) {
  try {
    // Nothing to write unless the profile states a DNT preference. null means "leave
    // alone", matching stock Chrome's default of not sending the header at all.
    if (!(fpConfig && (fpConfig.dnt === '1' || fpConfig.dnt === '0'))) return;

    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    let prefs = {};
    let hadFile = false;
    try {
      prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
      hadFile = true;
    } catch (e) {
      // Tell "no file yet" (create one) from "exists but did not parse" (partial write or corruption):
      // writing {} in the second case would wipe the profile's whole Chromium preferences.
      if (e && e.code !== 'ENOENT') return;
      prefs = {};
    }
    if (hadFile && (!prefs || typeof prefs !== 'object' || Array.isArray(prefs))) return;

    prefs.enable_do_not_track = fpConfig.dnt === '1';

    await fs.mkdir(path.dirname(prefsPath), { recursive: true });
    await fs.writeFile(prefsPath, JSON.stringify(prefs));
  } catch (e) { /* best-effort - DNT is not worth failing a launch over */ }
}

// Chrome's profile.cookie_controls_mode: 0 allow all, 1 block third-party, 2 block in Incognito only
// (Chrome's default). fingerprint-chromium defaults to 1, which worsens CAPTCHAs (they score with
// third-party cookies) and is unlike real Chrome, so use 2 unless the workspace blocks them (1).
const COOKIE_MODE_CHROME_DEFAULT = 2;
const COOKIE_MODE_BLOCK_THIRD_PARTY = 1;

function cookieControlsModeFor(browserSettings) {
  return browserSettings && browserSettings.blockThirdPartyCookies === true
    ? COOKIE_MODE_BLOCK_THIRD_PARTY
    : COOKIE_MODE_CHROME_DEFAULT;
}

async function ensureCookiePolicyPref(userDataDir, browserSettings) {
  try {
    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    let prefs = {};
    let hadFile = false;
    try {
      prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
      hadFile = true;
    } catch (e) {
      // Same rule as ensureNativeProfilePrefs: never overwrite a Preferences file that
      // exists but did not parse (that would wipe the profile's whole settings).
      if (e && e.code !== 'ENOENT') return;
      prefs = {};
    }
    if (hadFile && (!prefs || typeof prefs !== 'object' || Array.isArray(prefs))) return;
    const mode = cookieControlsModeFor(browserSettings);
    if (!prefs.profile || typeof prefs.profile !== 'object' || Array.isArray(prefs.profile)) prefs.profile = {};
    if (prefs.profile.cookie_controls_mode === mode) return; // already right: no write
    prefs.profile.cookie_controls_mode = mode;
    await fs.mkdir(path.dirname(prefsPath), { recursive: true });
    await fs.writeFile(prefsPath, JSON.stringify(prefs));
  } catch (e) { /* best-effort - a cookie preference is not worth failing a launch over */ }
}

function fingerprintScript(fp) {
  // fingerprint-chromium spoofs at the binary level, so this JS layer must not run: a second,
  // differently derived spoof would contradict it, which is itself a detection signal.
  if (fp && fp.nativeEngine) return;
  // Run once per document: the script lands via both evaluateOnNewDocument and CDP auto-attach, and
  // running twice double-wraps Worker. The marker is a non-enumerable window property with a random
  // per-launch name (fp.guard), so no key listing or fixed-name probe can detect SoftGlaze.
  const _guard = (fp && typeof fp.guard === 'string' && fp.guard) || ('_' + Math.random().toString(36).slice(2, 11));
  try {
    if (Object.getOwnPropertyDescriptor(window, _guard)) return;
    Object.defineProperty(window, _guard, { value: 1, enumerable: false, configurable: false, writable: false });
  } catch (e) {
    return; // cannot mark this document: skip rather than risk a double patch
  }
  // Native-toString masking. Detectors (browserscan flags "Canvas Tampering") test
  // whether overridden methods still report "[native code]" from .toString(). Make
  // every function we patch - and toString itself - look native, with the right .name.
  const _patched = new WeakSet();
  const _origFnToString = Function.prototype.toString;
  // Built as an object method: methods have no .prototype and throw on `new`, like real built-ins.
  // A plain function has both, which a detector can test in one line.
  const _fnToString = ({ toString() {
    if (_patched.has(this)) return 'function ' + (this.name || '') + '() { [native code] }';
    return _origFnToString.call(this);
  } }).toString;
  try {
    // Real Chrome's Function.prototype.toString.name is 'toString'; pin it, or the helper's own name
    // leaks as a global automation tell.
    try { Object.defineProperty(_fnToString, 'name', { value: 'toString', configurable: true }); } catch (e) {}
    Object.defineProperty(Function.prototype, 'toString', { value: _fnToString, configurable: true, writable: true });
    _patched.add(_fnToString);
  } catch (e) {}
  const markNative = (fn, name) => {
    try { if (name) Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
    try { _patched.add(fn); } catch (e) {}
    return fn;
  };

  // Spoofed accessors go on the prototype, as in real Chrome, with a getter that reports [native code]
  // and is named "get <prop>"; instance properties leak via Object.getOwnPropertyNames(navigator).
  // Falls back to the instance when the prototype lacks the property (e.g. window.doNotTrack).
  const define = (obj, prop, value) => {
    try {
      const proto = Object.getPrototypeOf(obj);
      const onProto = proto && Object.getOwnPropertyDescriptor(proto, prop);
      const target = onProto ? proto : obj;
      const existing = onProto || Object.getOwnPropertyDescriptor(obj, prop);
      // An accessor-shorthand getter: no .prototype and not constructible, like the native one.
      const getter = markNative(Object.getOwnPropertyDescriptor({ get [prop]() { return value; } }, prop).get, 'get ' + prop);
      Object.defineProperty(target, prop, { get: getter, configurable: true, enumerable: existing ? existing.enumerable : true });
    } catch (e) {
      try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e2) {}
    }
  };

  try {
    // Touch navigator.webdriver only when it reports true: on a fixed DevTools port Chrome already reports
    // false, and replacing the native getter alone triggered a Google Search CAPTCHA on every run.
    if (navigator.webdriver === true) define(navigator, 'webdriver', false);
  } catch (e) {}

  if (fp.langs && fp.langs.length) {
    define(navigator, 'languages', Object.freeze(fp.langs.slice()));
    define(navigator, 'language', fp.langs[0]);
  }
  if (fp.navPlatform) define(navigator, 'platform', fp.navPlatform);
  if (fp.cores) define(navigator, 'hardwareConcurrency', fp.cores);
  if (fp.mem) define(navigator, 'deviceMemory', fp.mem);

  // ---- Chromium-family brand identity ----
  // UA and Sec-CH-UA brands are set via CDP. navigator.vendor stays "Google Inc."; vendor globals are
  // added so the claimed brand exists in the page (Brave with no navigator.brave is a mismatch).
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
    // Vivaldi exposes no stable page-level global by default - its identity is the
    // UA/Client-Hints layer only, so there's nothing extra to inject here.
  } catch (e) {}

  if (fp.screenW && fp.screenH) {
    define(screen, 'width', fp.screenW);
    define(screen, 'height', fp.screenH);
    // Reserve the OS task/menu bar so availHeight < height (equal values are a spoofing tell), per OS:
    // Windows ~48px bottom taskbar, macOS ~25px top menu bar (availTop 25), Linux (GNOME) ~32px top bar.
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

  // ---- Timezone spoof ----
  // Windows Chrome ignores TZ and CDP setTimezoneOverride races new tabs' first document, so the real
  // OS zone leaks. Date/Intl are overridden in-page; fp.timezone is the proxy's IANA zone.
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
      // The host's real zone, captured before wrapping, tells an implicit (host-default) formatter from
      // one built with an explicit timeZone.
      let HOST_TZ = '';
      try { HOST_TZ = origResolved.call(new OrigDTF()).timeZone; } catch (e) {}
      OrigDTF.prototype.resolvedOptions = markNative(function () {
        const r = origResolved.apply(this, arguments);
        // Rewrite only when the formatter resolved to the host zone. An explicit zone such as {timeZone:'UTC'}
        // must stay: reporting the proxy zone there contradicts format() and breaks legitimate date code.
        try { if (r && HOST_TZ && r.timeZone === HOST_TZ) r.timeZone = TZ; } catch (e) {}
        return r;
      }, 'resolvedOptions');
      Intl.DateTimeFormat = WrappedDTF;
      // Date string methods that embed the zone (whoer reads these). Reproduce V8's exact toString format:
      // "Sun Jul 05 2026 12:00:00 GMT-0700 (Pacific Daylight Time)": no commas, long zone name last.
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

  // ---- Web Worker spoofing ----
  // Workers start a fresh realm that reports the real cores and memory, and CreepJS flags the mismatch.
  // Worker/SharedWorker are wrapped so each worker first runs a prelude with the same overrides.
  try {
    var workerData = {
      hardwareConcurrency: fp.cores || undefined,
      deviceMemory: fp.mem || undefined,
      languages: (fp.langs && fp.langs.length) ? fp.langs.slice() : undefined,
      language: (fp.langs && fp.langs.length) ? fp.langs[0] : undefined,
      platform: fp.navPlatform || undefined,
      // OffscreenCanvas WebGL runs in the worker realm too; without these the worker reports the real GPU.
      webglVendor: (fp.noise && fp.noise.webgl) ? (fp.webglVendor || undefined) : undefined,
      webglRenderer: (fp.noise && fp.noise.webgl) ? (fp.webglRenderer || undefined) : undefined,
      // The worker realm reads timezone from the OS too - spoof it there as well
      // so the worker's zone matches the main thread / proxy.
      timezone: fp.timezone || undefined
    };
    // Runs first in every worker realm; must be a self-contained literal.
    var prelude = '(function(){' +
      // Native-code mask inside the worker realm too, or a worker probe reads patched toString() as source.
      // Navigator overrides go on the prototype so hasOwnProperty stays false.
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
      'var orz=ODTF.prototype.resolvedOptions;ODTF.prototype.resolvedOptions=mk(function(){var r=orz.apply(this,arguments);try{r.timeZone=TZ;}catch(e){}return r;},"resolvedOptions");' +
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
        // Use markNative rather than an own toString: CreepJS probes Function.prototype.toString.call(Worker),
        // and real Chrome's Worker has no own toString property.
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
    // Left empty: canvas and WebGL uniqueness come from the --use-angle/--use-gl flags at launch,
    // since Pixelscan detects JS canvas tampering.
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

    // Perturb WebGL readPixels, the image CreepJS/browserleaks hash: seed-keyed so reads stay stable,
    // one low bit on a 64-pixel prefix so output looks unchanged. getParameter limits are not spoofed;
    // values inconsistent with the reported renderer would create new mismatches.
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
    // Deterministic, seed-derived perturbation (stable across reads - an unstable
    // audio fingerprint is a tell, same as canvas).
    const aseed = (fp.seed >>> 0) || 1;
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    // getChannelData returns the same live Float32Array per channel, so perturbing on every call would
    // drift across reads (an unstable fingerprint). Perturb each array once and still return it.
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

  // The AnalyserNode spectrum is a separate audio-fingerprint surface from getChannelData (browserleaks
  // probes both). Same seed-keyed tiny perturbation: stable per read, unique per profile.
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
    // Jitter keyed to the rect's own geometry: the same element reads the same value every time,
    // but values differ per profile.
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

  // WebRTC can leak the real IP in ICE candidates even when HTTP is proxied. Every path a page can read
  // a candidate from is sanitized, localDescription getters included: public IPs become the proxy IP
  // when known, else the candidate is dropped. RTCPeerConnection stays (removal is more detectable).
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
      // Rewrite every public IPv4 to the proxy IP (private and loopback untouched).
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
      // Returns the event to deliver, or null to drop it (leak with no proxy IP).
      const processEvent = (event) => {
        if (!event || !event.candidate || !event.candidate.candidate) return event; // end-of-gathering sentinel
        if (/\.local\s/.test(event.candidate.candidate)) return null;
        if (!leaks(event.candidate.candidate)) return event; // mDNS/private/proxy-only - safe
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
                // Wire to the native event so the handler actually fires.
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
        // Native-mask the wrapper: a bare class would show name "ProtectedRTC" and dump its source via
        // toString(), a one-read spoofer tell.
        markNative(ProtectedRTC, 'RTCPeerConnection');
        // Never setPrototypeOf(ProtectedRTC, Object.getPrototypeOf(Native)): super() takes its parent from
        // the current [[Prototype]], so new RTCPeerConnection() would build a bare EventTarget and throw
        // "Illegal invocation". A subclass keeping its natural superclass is not a meaningful tell.
        window.RTCPeerConnection = ProtectedRTC;
        if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = ProtectedRTC;
      } catch (e) { /* leave native in place if wrapping fails */ }
    }
  }

  // Do Not Track - '1' / '0' / null (leave native untouched when not configured).
  if (fp.dnt === '1' || fp.dnt === '0') {
    define(navigator, 'doNotTrack', fp.dnt);
    try { define(window, 'doNotTrack', fp.dnt); } catch (e) {}
    if (fp.dnt === '1') { try { define(navigator, 'globalPrivacyControl', true); } catch (e) {} }
  }

  // WebGPU - when disabled, hide navigator.gpu so sites can't read the real
  // adapter (which would contradict the spoofed WebGL renderer).
  if (fp.webgpuDisabled) {
    try { define(navigator, 'gpu', undefined); } catch (e) {}
  }

  // Speech synthesis voices - return a stable, seeded list localized to the
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

  // ---- Media device enumeration ----
  // Zero devices, or labels before a permission grant, look like automation. Ids derive from the seed
  // so they are stable across launches; labels and real ids appear only after getUserMedia, like Chrome.
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
      // Overrides go on MediaDevices.prototype (non-enumerable): own properties show in
      // Object.getOwnPropertyNames(navigator.mediaDevices), which real Chrome never does.
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
          // Observe on a separate chain and return the original promise: returning p.then(...) would put this
          // script's filename in the page's rejection stacks, a direct tell. The caller still gets p.
          try { p.then(() => { granted = true; }, () => {}); } catch (e) { /* ignore */ }
          return p;
        }, 'getUserMedia'));
      }

      const build = () => {
        const rows = [];
        const audioIn = (deviceId, label) => rows.push({ kind: 'audioinput', deviceId, groupId: gMicIn, label });
        const audioOut = (deviceId, label) => rows.push({ kind: 'audiooutput', deviceId, groupId: gSpkOut, label });
        if (granted) {
          // Full structured list: the Default / Communications pseudo-endpoints
          // (Communications is Windows-only) plus the real endpoints, all with
          // concrete ids + labels - the shape real Chrome returns post-grant.
          audioIn('default', 'Default - ' + micLabel);
          if (isWin) audioIn('communications', 'Communications - ' + micLabel);
          audioIn(micId, micLabel);
          rows.push({ kind: 'videoinput', deviceId: camId, groupId: gCam, label: camLabel });
          audioOut('default', 'Default - ' + spkLabel);
          if (isWin) audioOut('communications', 'Communications - ' + spkLabel);
          audioOut(spkId, spkLabel);
        } else {
          // Pre-grant: one endpoint per kind, empty deviceId + label, stable
          // groupId - precisely what real Chrome exposes before a permission grant.
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

  // Font fingerprint protection - seeded sub-pixel noise on canvas text
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

    // Mirror the jitter onto OffscreenCanvas, which workers use and the main-thread override misses.
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

  // Port-scan protection - reject page-initiated requests to localhost and
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

// Hosts on the local machine or LAN. Blocks local-network probing (an anti-detect leak) when
// website.localNetworkAccess is off.
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
  // Block user-added extensions; the proxy-auth extension loads via --load-extension and is unaffected.
  if (browserSettings.lockExtensions) {
    policy.ExtensionInstallBlocklist = ['*'];
    policy.BlockExternalExtensions = true;
  }
  if (Object.keys(policy).length === 0) return null;
  const filePath = path.join(userDataDir, 'managed_policies.json');
  await fs.writeFile(filePath, JSON.stringify(policy, null, 2)).catch(() => {});
  return filePath;
}

// ---- Start page ----
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Omnibox guard: ungoogled-chromium's "No Search" default turns one typed word into http://<word>.
// Prefs get MAC-reverted and policy shows "Managed by", so single-label http hosts are rewritten.
// DuckDuckGo, not Google: Google 429s cookie-less /search from shared IPs. Override via searchUrl.
const DEFAULT_SEARCH_TEMPLATE = 'https://duckduckgo.com/?q={searchTerms}';

function omniboxSearchUrl(rawUrl, template) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch (e) { return null; }
  if (u.protocol !== 'http:') return null;             // an https single label is deliberate
  const host = u.hostname;
  if (!host || host.includes('.')) return null;        // a real domain
  if (host === 'localhost') return null;               // developer target
  if (host.startsWith('[') || /^\d+$/.test(host)) return null; // IP literal / numeric
  if (u.port) return null;                             // host:port is a deliberate target
  // Everything after the bare host is still part of what was typed, e.g. `foo/bar`.
  const typed = host + (u.pathname && u.pathname !== '/' ? u.pathname : '') + (u.search || '');
  const tpl = String(template || '');
  const use = tpl.includes('{searchTerms}') ? tpl : DEFAULT_SEARCH_TEMPLATE;
  return use.replace('{searchTerms}', encodeURIComponent(typed));
}

// targetcreated can fire more than once per tab (blank first, then after navigation),
// so track guarded pages or they would redirect twice.
const omniboxGuarded = new WeakSet();

function attachOmniboxSearchGuard(page, template) {
  try {
    if (!page || omniboxGuarded.has(page)) return;
    omniboxGuarded.add(page);
    const redirect = async (raw) => {
      const target = omniboxSearchUrl(raw, template);
      if (!target) return;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    };
    // Act on the request, not the committed URL: a failed http://<word> commits chrome-error://.
    // Listening is passive (no request interception), so nothing is delayed or modified.
    page.on('request', (req) => {
      try {
        if (!req.isNavigationRequest()) return;
        if (req.frame() !== page.mainFrame()) return;
        redirect(req.url());
      } catch (e) { /* a guard must never break the session */ }
    });
    // Backstop in case the request event is missed but the frame still reports the failed URL.
    page.on('framenavigated', (frame) => {
      try {
        if (frame !== page.mainFrame()) return;
        redirect(frame.url());
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* best-effort */ }
}

async function generateStartPage(userDataDir, profileData) {
  const startPagePath = path.join(userDataDir, 'start.html');
  const now = new Date().toLocaleString();
  const title = escapeHtml(profileData.title);
  const profileId = escapeHtml(profileData.profileId);
  const proxyLabel = escapeHtml(profileData.proxyLabel);
  // Proxy exit IP/location resolved through the proxy at launch, rendered server-side so the card
  // still shows it when the page's own lookup is blocked or rate-limited.
  const geo = profileData.geo || null;
  const seedIp = geo && geo.query ? escapeHtml(geo.query) : '';
  const seedLoc = geo
    ? escapeHtml([geo.country, geo.regionName, geo.city].filter(Boolean).join(' / '))
    : '';
  const seedIsp = geo && geo.isp ? escapeHtml(geo.isp) : '';
  const seedJson = JSON.stringify({ ip: seedIp, loc: seedLoc, isp: seedIsp });
  // Custom start links share .nav-links so they open via __sgzOpenTab. http/https only, escaped.
  const customLinks = Array.isArray(profileData.startPageLinks) ? profileData.startPageLinks : [];
  const customLinksHtml = customLinks.map((l) => {
    const url = String((l && l.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) return '';
    const label = escapeHtml((l && l.label) || url);
    return `\n  <a href="${escapeHtml(url)}">${label}</a>`;
  }).join('');
  // Test links open in new tabs; targetcreated fingerprints each one (evaluateOnNewDocument runs first).
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoftGlaze - ${title}</title>
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
  <div class="right"><div id="isp">ISP: ${seedIsp || '-'}</div><div id="proxyState">Proxy: ${proxyLabel}</div></div>
</div>
<div class="nav-links">
  <a href="https://browserscan.net/">BrowserScan</a>
  <a href="https://browserleaks.com/">BrowserLeaks</a>
  <a href="https://whoer.net/">Whoer.net</a>
  <a href="https://pixelscan.net/">Pixelscan</a>
  <a href="https://abrahamjuliot.github.io/creepjs/">CreepJS</a>${customLinksHtml}
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
<div class="foot">All values above are read live from this profile's browser - they reflect what websites see.</div>
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
  // WebRTC probe (should show proxy IP or none - never your real IP)
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
    $('isp').textContent='ISP: '+(d.isp||seed.isp||'-');
  }).catch(function(){
    return fetch('https://ipwho.is/').then(function(r){return r.json();}).then(function(d){
      setIfReal('ip',d.ip);
      setIfReal('loc',[d.country,d.region,d.city].filter(Boolean).join(' / '));
      $('isp').textContent='ISP: '+((d.connection&&d.connection.isp)||seed.isp||'-');
    });
  }).catch(function(){
    // Both live lookups failed - fall back to whatever the proxy resolved at launch.
    if(seed.ip){setIfReal('ip',seed.ip);setIfReal('loc',seed.loc);}
    else{$('ip').textContent='IP load failed';$('loc').textContent='Check proxy connection';}
  });
  // Check links open in a new tab via the main process, which sets proxy auth first (no 407 stall).
  // fingerprint-chromium strips CDP bindings, so __sgzOpenTab can throw: then fall back to a plain
  // new tab, then to same-tab navigation.
  try{
    var navAs=document.querySelectorAll('.nav-links a');
    for(var i=0;i<navAs.length;i++){
      navAs[i].addEventListener('click',function(e){
        var href=this.href;
        if(!href){return;}
        var openFallback=function(){
          try{ if(window.open(href,'_blank')){return true;} }catch(_){}
          try{ location.href=href; return true; }catch(_){}
          return false;
        };
        if(typeof window.__sgBridge!=='function'){return;} // no bridge - default navigation
        try{
          var p=window.__sgBridge('__sgzOpenTab',href);
          e.preventDefault();
          if(p&&typeof p.catch==='function'){p.catch(function(){openFallback();});}
        }catch(_){
          e.preventDefault();
          openFallback();
        }
      });
    }
  }catch(e){}
})();
</script></body></html>`;
  await fs.writeFile(startPagePath, html);
  return `file://${startPagePath}`;
}

// ---- Captcha auto-solving (2captcha / anti-captcha) ----
// Needs the user's own paid solver key, billed by that provider. Token-grant captchas only.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpJson(url, init) {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable in this runtime');
  const res = await fetch(url, init);
  return res.json();
}

// Submit a token job to 2captcha and poll until solved. Returns the token string.
async function solveWith2captcha(apiKey, job) {
  let method = 'userrecaptcha';
  if (job.type === 'hcaptcha') method = 'hcaptcha';
  else if (job.type === 'turnstile') method = 'turnstile';

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

// anti-captcha JSON task API (createTask -> getTaskResult).
async function solveWithAnticaptcha(apiKey, job) {
  let taskType = 'RecaptchaV2TaskProxyless';
  if (job.type === 'hcaptcha') taskType = 'HCaptchaTaskProxyless';
  else if (job.type === 'turnstile') taskType = 'TurnstileTaskProxyless';

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

// On every navigation, scan for supported captcha widgets, solve new ones and inject the token.
// Best-effort: a solver or network failure never breaks the page.
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
          fill('[name="cf-turnstile-response"]');
          fill('[name="g-recaptcha-response"]');
          // Best-effort: call any registered reCAPTCHA callback so the form reacts as if solved by hand.
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

// ---- Proxy geo lookup ----
// In-page fallback for when the pre-launch Node lookup returns null: resolve the exit location
// through the browser's own proxied connection. Never throws.
async function lookupProxyGeo(page) {
  if (!page) return null;
  const url = 'http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,lat,lon,isp,query';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GEO_LOOKUP_TIMEOUT_MS });
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const j = JSON.parse(txt);
    if (j && j.status === 'success') return j;
  } catch (e) { /* proxy dead / non-JSON / timeout - try the dual-stack service below */ }
  // ip-api.com has no AAAA record, so an IPv6-only exit cannot reach it. get.geojs.io can.
  try {
    await page.goto(GEOJS_URL, { waitUntil: 'domcontentloaded', timeout: GEO_LOOKUP_TIMEOUT_MS });
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const g = normalizeGeoJs(JSON.parse(txt));
    if (g) return { status: 'success', query: g.ip, countryCode: g.country, timezone: g.timezone, city: g.city, regionName: g.region, isp: g.isp, lat: g.lat, lon: g.lon };
  } catch (e) { /* geo stays null, launch continues */ }
  return null;
}

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
    
    // Map the ipinfo.io response to the ip-api shape the app expects.
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
      // socks5h makes the proxy resolve the geo hostnames; plain socks5 would use the host's DNS.
      const scheme = schemeLc === 'socks5' ? 'socks5h' : (schemeLc === 'socks4' ? 'socks4' : 'http');
      const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
      const proxyUrl = `${scheme}://${auth}${formatProxyHost(proxy.host)}:${proxy.port}`;
      
      const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });

      // One HTTPS GET through the proxy, mapped to the ip-api shape; resolves null on any failure.
      const attempt = (url, map) => new Promise((settle) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; settle(v); } };
        const req = require('node:https').get(url, {
          agent,
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
        }, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try { done(map(JSON.parse(data))); } catch (e) { done(null); }
          });
        });
        req.on('error', () => done(null));
        req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} done(null); });
      });

      // Same, over plain HTTP (ip-api.com's free tier has no HTTPS).
      const attemptHttp = (url) => new Promise((settle) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; settle(v); } };
        const req = require('node:http').get(url, { agent, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => { try { const j = JSON.parse(data); done(j && j.status === 'success' ? j : null); } catch (e) { done(null); } });
        });
        req.on('error', () => done(null));
        req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} done(null); });
      });

      // Ask three geo services in parallel and take the consensus: one database can misplace a leased range,
      // and the profile's timezone and language follow the result. geojs also answers IPv6-only exits.
      Promise.all([
        attempt(targetUrl, mapResponse),
        attemptHttp('http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,lat,lon,isp,query'),
        attempt(GEOJS_URL, (j) => {
          const g = normalizeGeoJs(j);
          return g ? { status: 'success', query: g.ip, countryCode: g.country, timezone: g.timezone, city: g.city, regionName: g.region, isp: g.isp, lat: g.lat, lon: g.lon } : null;
        })
      ])
        .then((answers) => pickGeoConsensus(answers, { countryHint: proxy.country }))
        .then(resolve, () => resolve(null));
      return;
    }

    // Fallback when proxy-agent is missing.
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

// Cache successful geo lookups: bulk launches reuse the same pool proxies, and each lookup
// through the proxy is slow and easily rate-limited.
const GEO_NODE_CACHE_TTL_MS = 10 * 60 * 1000;
const geoNodeCache = new Map();    // key -> { value, at }
const geoNodeInflight = new Map(); // key -> Promise<value|null>
// Last geo each proxy resolved to, with no TTL. Used when a launch lookup fails: leaving the host
// timezone on a proxied profile is an IP-vs-timezone mismatch every scanner flags.
const geoLastKnown = new Map();    // key -> value
function rememberProxyGeo(proxy, value) {
  const key = proxyGeoKey(proxy);
  if (key && value && value.timezone) geoLastKnown.set(key, value);
}
function lastKnownProxyGeo(proxy) {
  const key = proxyGeoKey(proxy);
  return key ? (geoLastKnown.get(key) || null) : null;
}
const GEO_DEGRADED_WARNING = 'The proxy location could not be looked up, so this profile is using the local computer timezone. Relaunch it once the proxy answers.';

function proxyGeoKey(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return null;
  // Credentials are part of the key: gateway vendors put the sticky session and country in the
  // username or password on one host:port, so host:port alone would share one location.
  const who = `${proxy.username || ''}\u0000${proxy.password || ''}`;
  const tag = require('node:crypto').createHash('sha256').update(who).digest('hex').slice(0, 16);
  return `${String(proxy.type || '').toLowerCase()}://${tag}@${formatProxyHost(proxy.host)}:${proxy.port}`;
}

async function lookupProxyGeoNodeCached(proxy) {
  const key = proxyGeoKey(proxy);
  if (!key) return lookupProxyGeoNode(proxy);
  const hit = geoNodeCache.get(key);
  if (hit && (Date.now() - hit.at) < GEO_NODE_CACHE_TTL_MS) return hit.value;
  if (geoNodeInflight.has(key)) return geoNodeInflight.get(key);
  const inflight = (async () => {
    const value = await lookupProxyGeoNode(proxy);
    if (value) { geoNodeCache.set(key, { value, at: Date.now() }); rememberProxyGeo(proxy, value); } // cache successes only; nulls retry next launch
    return value;
  })();
  geoNodeInflight.set(key, inflight);
  try { return await inflight; }
  finally { geoNodeInflight.delete(key); }
}

// ---- Fingerprint config + injection extension ----
// Fingerprint JS ships as an MV3 MAIN-world content script at document_start: unlike CDP injection,
// it runs before page scripts in every tab, popup and iframe, with no race on new tabs.
function buildFingerprintConfig(profile, opts) {
  const { seed, resW, resH, webrtcMode, hasProxy, geo, timezone } = opts;
  const osTok = osTokens(profile.os);
  const manualLang = profile.languageType === 'Custom' && profile.languageCustom
    ? String(profile.languageCustom).trim() : null;
  // Language: profile setting, else the proxy country's locale (to match the exit IP), else en-US.
  const geoLocale = geo && geo.countryCode ? COUNTRY_LOCALE[geo.countryCode] : null;
  const langs = manualLang
    ? manualLang.split(',').map((l) => l.split(';')[0].trim()).filter(Boolean)
    : (geoLocale ? Array.from(new Set([geoLocale, geoLocale.split('-')[0], 'en'])) : ['en-US', 'en']);

  // WebGL reports the real GPU by default: spoofing it on the main thread but not in the service worker
  // (which can't be injected) is a main-vs-worker mismatch CreepJS flags. Only "Custom" with an
  // explicit non-Auto vendor spoofs.
  const isCustomGpu = String(profile.webglMetadata || 'Real').toLowerCase() === 'custom'
    && profile.webglVendor && !/^(real|auto|default|based)/i.test(String(profile.webglVendor));

  // Cross-OS: a profile claiming another OS must not report the host GPU (Mac platform with a Direct3D
  // renderer is an instant tell), so spoof the stored per-OS GPU regardless of the toggle. Fonts,
  // canvas raster and TLS still betray a cross-OS profile; this only removes the loudest tell.
  const HOST_OS_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || 'Windows';
  const claimedOs = (() => {
    const v = String(profile.os || '').toLowerCase();
    if (v.includes('mac')) return 'macOS';
    if (v.includes('android')) return 'Android';
    if (v.includes('ios') || v.includes('iphone') || v.includes('ipad')) return 'iOS';
    if (v.includes('linux') || v.includes('ubuntu') || v.includes('debian') || v.includes('fedora') || v.includes('arch') || v.includes('chromeos')) return 'Linux';
    if (v.includes('win')) return 'Windows';
    return HOST_OS_NAME; // blank / Auto => the host, which is coherent by definition
  })();
  const crossOs = claimedOs !== HOST_OS_NAME;

  const FALLBACK_GPU = {
    macOS: ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
    Linux: ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)'],
    Android: ['Google Inc. (ARM)', 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)'],
    iOS: ['Apple Inc.', 'ANGLE (Apple, ANGLE Metal Renderer: Apple A16 GPU, Unspecified Version)'],
    Windows: ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)']
  };
  // A stored value is only usable if it is a real string, not the "Auto"/"Real" sentinel.
  const storedVendor = profile.webglVendor && !/^(real|auto|default|based)/i.test(String(profile.webglVendor))
    ? profile.webglVendor : null;
  const storedRenderer = profile.webglRenderer && !/^(real|auto|default|based)/i.test(String(profile.webglRenderer))
    ? profile.webglRenderer : null;

  let webglVendor = isCustomGpu ? profile.webglVendor : null;
  let webglRenderer = isCustomGpu ? (profile.webglRenderer || null) : null;
  if (crossOs && !webglVendor) {
    const fb = FALLBACK_GPU[claimedOs] || FALLBACK_GPU.Windows;
    webglVendor = storedVendor || fb[0];
    webglRenderer = storedRenderer || fb[1];
    console.log(`[SG][fp] cross-OS profile (claims ${claimedOs} on ${HOST_OS_NAME}) - forcing a coherent GPU instead of the host's: ${webglRenderer}`);
  }

  const dntRaw = String(profile.doNotTrack || '').toLowerCase();
  const dnt = /^(on|enable|enabled|1|true|yes)$/.test(dntRaw) ? '1'
    : (/^(off|disable|disabled|0|false|no)$/.test(dntRaw) ? '0' : null);

  // CPU cores and RAM are spoofed unless the user picks "Real"; blank still spoofs (stable seeded pick).
  // navigator.deviceMemory caps at 8 in real Chrome, so RAM GB maps to {1,2,4,8}.
  const realCpu = /^real$/i.test(String(profile.cpuType || ''));
  const realRam = /^real$/i.test(String(profile.ramType || ''));
  const spoofCores = toInt(profile.cpuCores, pick([4, 6, 8, 8, 12, 16], seed));
  const ramGb = toInt(profile.ramGb, pick([8, 8, 16, 16], seed >> 2));
  const deviceMemory = ramGb >= 8 ? 8 : (ramGb >= 4 ? 4 : (ramGb >= 2 ? 2 : 1));

  // vendor/inject don't depend on the major version; UA token and brands are applied via CDP.
  const brandIdent = buildBrandIdentity(profile.browserBrand, 0, '');

  return {
    seed,
    langs,
    brand: brandIdent.id,
    brandVendor: brandIdent.vendor,
    brandInject: brandIdent.inject,
    timezone: timezone || null,
    navPlatform: osTok.navPlatform,
    // null ⇒ no override (report the real value) - only when the user picks "Real".
    cores: realCpu ? null : spoofCores,
    mem: realRam ? null : deviceMemory,
    screenW: resW,
    screenH: resH,
    webglVendor,
    webglRenderer,
    webrtcMode,
    // On with a proxy unless the mode is pass-through. Candidates are rewritten to the known proxy exit
    // IP (matching the HTTP IP); if it is unknown, the in-page guard drops public-IP candidates.
    webrtcProtect: Boolean(hasProxy) && webrtcMode !== 'Real' && webrtcMode !== 'Disabled',
    webrtcPublicIp: (geo && geo.query) ? String(geo.query) : null,
    dnt,
    webgpuDisabled: /disabled?/i.test(String(profile.webgpu || '')),
    speechVoices: profile.speechVoicesNoise !== false,
    mediaDevices: !/^real$/i.test(String(profile.mediaDevice || 'Auto')),
    // Realistic OS-matched enumerateDevices() set from the same seed, so it is stable across launches.
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

// Writes the MAIN-world content-script extension into the profile; returns its --load-extension path.
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
  // Override the NTP only for Chrome-for-Testing: CfT's chrome://newtab crashes the browser (0xC0000005)
  // on 151+. Real Chrome's NTP works, and overriding it trips the "changed by extension" bubble.
  if (opts.ntpOverride) {
    manifest.chrome_url_overrides = { newtab: 'newtab.html' };
    // The override page carries a search box, since ungoogled's "No Search" default turns a typed word
    // into http://<word>. Keep it fully local: anything the NTP fetches goes through the proxy.
    const searchTpl = String(opts.searchUrl || '').includes('{searchTerms}')
      ? String(opts.searchUrl)
      : 'https://www.google.com/search?q={searchTerms}';
    const newtabHtml = '<!doctype html><html><head><meta charset="utf-8"><title>New Tab</title>'
      + '<style>html,body{margin:0;height:100%;background:#1f2430;color:#e5e7eb;'
      + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
      + '.w{height:100%;display:flex;align-items:center;justify-content:center}'
      + 'form{width:min(560px,86vw)}'
      + 'input{width:100%;box-sizing:border-box;padding:14px 18px;border-radius:12px;'
      + 'border:1px solid #2b3b54;background:#0f1623;color:#f1f5f9;font-size:15px;outline:none}'
      + 'input:focus{border-color:#38bdf8}'
      + 'p{margin:14px 2px 0;font-size:12px;color:#7c8aa0}</style></head>'
      + '<body><div class="w"><form id="f" autocomplete="off">'
      + '<input id="q" name="q" type="text" placeholder="Search" autofocus>'
      + '<p>Type to search. A full address still opens directly.</p>'
      + '</form></div><script src="newtab.js"></script></body></html>';
    await fs.writeFile(path.join(extDir, 'newtab.html'), newtabHtml);
    // CSP forbids inline script in an extension page, so the handler ships as a file.
    const newtabJs = 'var TPL=' + JSON.stringify(searchTpl) + ';\n'
      + 'document.getElementById("f").addEventListener("submit",function(e){\n'
      + '  e.preventDefault();\n'
      + '  var v=document.getElementById("q").value.trim();\n'
      + '  if(!v)return;\n'
      + '  // A real URL or a dotted host goes straight there; anything else is a search.\n'
      + '  var direct=/^[a-z][a-z0-9+.-]*:\\/\\//i.test(v)||(/^[^\\s\\/]+\\.[^\\s\\/]{2,}/.test(v)&&!/\\s/.test(v));\n'
      + '  location.href=direct?(/^[a-z][a-z0-9+.-]*:\\/\\//i.test(v)?v:"https://"+v)\n'
      + '    :TPL.replace("{searchTerms}",encodeURIComponent(v));\n'
      + '});\n';
    await fs.writeFile(path.join(extDir, 'newtab.js'), newtabJs);
  } else {
    // Remove leftover override files when it is off, so a stale newtab.html is never picked up
    // and the profile doesn't look like it ships a New Tab replacement.
    for (const stale of ['newtab.html', 'newtab.js']) {
      await fs.unlink(path.join(extDir, stale)).catch(() => {});
    }
  }
  await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
  // Self-contained: serialize the function and invoke it with the baked config. Under the native engine
  // fingerprintScript bails, so ship the small gap filler for the two axes fingerprint-chromium misses.
  const fn = fpConfig && fpConfig.nativeEngine ? nativeGapScript : fingerprintScript;
  const source = `(${fn.toString()})(${JSON.stringify(fpConfig)});`;
  await fs.writeFile(path.join(extDir, 'fp.js'), source);
  return extDir;
}

// ---- Launch ----
// Launches in flight per profile: activeSessions only sees a session after the slow geo/spawn phase,
// so a second call gets the first one's promise instead of spawning on the same userDataDir.
const chromeLaunching = new Map(); // String(profileId) -> Promise<launch result>
function launchProfileSession(options = {}) {
  const key = options && options.profileId != null ? String(options.profileId) : null;
  if (key && !activeSessions.has(key) && chromeLaunching.has(key)) return chromeLaunching.get(key);
  const p = launchProfileSessionNow(options);
  if (!key) return p;
  chromeLaunching.set(key, p);
  const clear = () => { if (chromeLaunching.get(key) === p) chromeLaunching.delete(key); };
  p.then(clear, clear);
  return p;
}

// The start URL given for one launch (SoftGlaze AI start_profile {url}, REST start {startUrl},
// profiles.launch(id, { startUrl })). Only a valid http(s) URL counts; anything else, including the
// callers' 'about:blank' default, means "none" and the normal start page stays.
function launchStartUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u.href : null;
  } catch (e) {
    return null;
  }
}

// Opens the launch's start URL in the main tab, so page tools, macros and the Cookie Warmer (which
// all drive session.page) act on it. Authenticates first, or an authenticated proxy stalls the
// navigation on a 407. Best-effort: a slow or failing site never fails the launch.
async function openLaunchUrl(page, url, proxyCreds) {
  if (!page || !url) return false;
  if (proxyCreds) await page.authenticate(proxyCreds).catch(() => {});
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return true;
  } catch (e) {
    return false;
  }
}

async function launchProfileSessionNow(options = {}) {
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
    // Geo auto-match (timezone/locale/WebRTC from the proxy exit). Off skips the lookup for manual values.
    geoMatchEnabled = true,
    // Global custom start-page links (Start Links page), rendered on the detection start page.
    startPageLinks = [],
    // This profile's own start links (Profile.startupUrls), opened as tabs at launch;
    // startPageLinks are global anchors on the start page.
    startupUrls = []
  } = options;
  const launchUrl = launchStartUrl(options.startUrl);

  // One session per profile: a double-launch would open a second Chrome on the same userDataDir
  // (singleton-lock conflict) and orphan the first. Return the running session instead.
  if (profileId != null) {
    const existing = activeSessions.get(String(profileId));
    if (existing) {
      return { sessionId: String(profileId), userDataDir: existing.userDataDir, wsEndpoint: existing.wsEndpoint, alreadyRunning: true };
    }
  }

  const resolvedProxy = parseProxyInput(options.proxy || options.proxyInfoString);
  const proxyLabel = resolvedProxy ? `${resolvedProxy.type} ${resolvedProxy.host}:${resolvedProxy.port}` : 'Direct (No Proxy)';
  // The saved proxy this session runs on (a rotation pool may pick one other than the profile's), so
  // a block is charged to the proxy that was really used.
  const sessionProxyId = (options.proxy && typeof options.proxy === 'object' && Number.isInteger(options.proxy.id)) ? options.proxy.id : null;

  if (browserSettings.onlyOpenWithProxy && !resolvedProxy) {
    throw new Error('This profile is set to only open with an available proxy, but no proxy is configured.');
  }

  const safeDirName = sanitizeDataDirName(dataDirName || title || `profile-${profileId || crypto.randomUUID()}`);
  const root = path.resolve(profileRoot);
  const userDataDir = resolveInside(root, safeDirName);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });

  // Chromium on Windows reads policy only from the registry, so this file is reference only;
  // attachBrowserLocks() enforces the locks after launch.
  await writeManagedPolicies(userDataDir, browserSettings);

  const seed = seedFromString(safeDirName);

  const resW = profile.resolutionType && profile.resolutionType !== 'Real' ? toInt(profile.resolutionW, 1920) : 1920;
  const resH = profile.resolutionType && profile.resolutionType !== 'Real' ? toInt(profile.resolutionH, 1080) : 1080;
  const winW = toInt(profile.resolutionW, DEFAULT_WINDOW_SIZE.width);
  const winH = toInt(profile.resolutionH, DEFAULT_WINDOW_SIZE.height);

  const webrtcMode = profile.webrtc || 'Forward';

  // Pre-launch geo lookup through the proxy: knowing the timezone up front sets TZ on the Chrome process
  // (every tab and worker, no injection race) and bakes the proxy IP and locale into the extension.
  const manualTz = profile.timezoneType === 'Custom' && profile.timezoneCustom
    ? String(profile.timezoneCustom).trim() : null;
  // Pick the engine before the geo lookup: fingerprint-chromium bakes --timezone at launch and can't
  // correct it, so its geo must be fresh (uncached) or a rotated sticky session leaves a mismatched
  // timezone. Stock Chrome applies timezone via CDP after the lookup, so it can use the cache.
  let usingAntidetect = false;
  let antidetectExe = null;
  // Enabled EITHER globally (Settings toggle) OR per-profile (Profile.antidetectEngine),
  // so some profiles can use it while others stay on standard Chrome.
  if (browserSettings.antidetectEngine === true || profile.antidetectEngine === true) {
    antidetectExe = resolveAntidetectBinary();
    if (antidetectExe) usingAntidetect = true;
    else console.warn('[SG] anti-detect engine requested but fingerprint-chromium binary not found - using stock Chrome.');
  }

  let geo = geoMatchEnabled && resolvedProxy && profile.timezoneType !== 'Real'
    ? await (usingAntidetect ? lookupProxyGeoNode(resolvedProxy) : lookupProxyGeoNodeCached(resolvedProxy))
    : null;
  let timezoneId = manualTz || (geo && geo.timezone) || null;
  // Geo-match applies but the lookup failed: use this proxy's last known geo (the in-page lookup may
  // still replace it); with none, the launch reports a geoWarning instead of a silent success.
  const geoApplies = Boolean(geoMatchEnabled && resolvedProxy && profile.timezoneType !== 'Real');
  let tzFromLastKnown = false;
  if (geo) rememberProxyGeo(resolvedProxy, geo);
  if (geoApplies && !timezoneId) {
    const lk = lastKnownProxyGeo(resolvedProxy);
    if (lk && lk.timezone) { timezoneId = lk.timezone; tzFromLastKnown = true; }
  }

  // Bake the geo-aware fingerprint config into a MAIN-world extension before launch (the reliable path).
  const fpConfig = buildFingerprintConfig(profile, { seed, resW, resH, webrtcMode, hasProxy: Boolean(resolvedProxy), geo, timezone: timezoneId });
  // Decide the binary up front so the NTP override is written only for Chrome-for-Testing.
  if (usingAntidetect) fpConfig.nativeEngine = true;
  // Per-launch random name for the in-page run-once guard. Not part of the fingerprint,
  // so the profile's values stay identical across launches.
  fpConfig.guard = randomGuardName();
  // Binary: fingerprint-chromium when the anti-detect engine is active (its native spoof
  // replaces our JS/CDP layer via fpConfig.nativeEngine), else real Chrome / CfT.
  const chosenBrowser = usingAntidetect
    ? { exePath: antidetectExe, version: '', major: 0, isReal: false, antidetect: true }
    : chooseBrowserBinary(profile, { preferCftForExtensions: loadExtensions });
  if (!chosenBrowser) {
    // No system Chrome and no downloaded CfT. Packaged builds bundle no Chromium, so use puppeteer's
    // only if it exists (dev installs); otherwise throw a clear error, not "Could not find Chrome".
    let bundled = '';
    try { bundled = puppeteer.executablePath(); } catch (e) { bundled = ''; }
    if (!bundled || !fsSync.existsSync(bundled)) {
      throw new Error('No Chrome or Chromium was found on this device. Open the Browsers page and download a browser version (or install Google Chrome) before launching Chrome profiles.');
    }
  }
  // Seed Default/Preferences before launch: an address-bar search engine (ungoogled ships none)
  // and the Do Not Track choice, which has no native flag.
  if (usingAntidetect) await ensureNativeProfilePrefs(userDataDir, fpConfig);
  // Third-party cookies: Chrome's normal default for every engine (the anti-detect
  // build blocks them by default, which hurts CAPTCHA scoring) - see ensureCookiePolicyPref.
  await ensureCookiePolicyPref(userDataDir, browserSettings);

  const usingCft = !(chosenBrowser && chosenBrowser.isReal);
  // usingCft means "not real Chrome", which includes the anti-detect build. Only real CfT needs the NTP
  // override (its own NTP crashes); on fingerprint-chromium it shows a "changed by extension" prompt
  // on every new tab, itself an anti-detect tell.
  const isChromeForTesting = usingCft && !(chosenBrowser && chosenBrowser.antidetect);
  const fpExtDir = await writeFingerprintExtension(userDataDir, fpConfig, {
    ntpOverride: isChromeForTesting,
    searchUrl: browserSettings && browserSettings.searchUrl
  });

  // Chromium takes several unpacked extensions as a comma list; --disable-extensions-except and
  // --load-extension must carry the same list so each one is whitelisted and loaded.
  const extensionDirs = [fpExtDir, ...(Array.isArray(globalExtensionDirs) ? globalExtensionDirs : [])].filter(Boolean);
  // Extensions load only into this profile via launch args; nothing is written to system policy.
  const extensionArg = extensionDirs.join(',');

  const args = [
    `--window-size=${winW},${winH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    // Kill any infobars (belt-and-suspenders with ignoreDefaultArgs below).
    '--disable-infobars',
    // Suppresses the "Disable developer mode extensions" warning and the flag/NTP consent bubbles.
    // Process-level only: not page-observable (navigator.webdriver stays false).
    '--test-type',
    `--disable-extensions-except=${extensionArg}`,
    `--load-extension=${extensionArg}`
  ];
  if (profile.canvasNoise !== false || profile.webglImageNoise !== false) {
    // Pin ANGLE to Chrome's real Windows default (d3d11): d3d9 drops WebGL2, gl often degrades to
    // SwiftShader and vulkan is rare, so other backends black-screen profiles and stand out.
    // Per-profile GPU variety comes from the readPixels perturbation instead.
    if (process.platform === 'win32') args.push('--use-angle=d3d11');
  }

  // --lang aligns the whole locale stack (ICU/Intl and Accept-Language) with navigator.language;
  // otherwise Intl reports en-US under a spoofed en-GB, a mismatch CreepJS flags.
  const primaryLocale = (fpConfig.langs && fpConfig.langs[0]) || null;
  if (primaryLocale) args.push(`--lang=${primaryLocale}`);

  // Always block non-proxied UDP when proxied: Chrome's mDNS host candidate (xxxx.local) can be
  // resolved to the real IP, so only the proxied srflx candidate (proxy IP) or nothing is exposed.
  if (resolvedProxy && webrtcMode !== 'Real') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }

  // fingerprint-chromium flags replace the JS/CDP layer: the binary derives canvas/webgl/audio/UA from
  // --fingerprint and handles platform, cores, locale, timezone and WebRTC natively, with no race.
  if (usingAntidetect) {
    args.push(...buildAntidetectFlags(profile, fpConfig, seed, timezoneId, Boolean(resolvedProxy)));
  }

  // Chromium keeps only the last --enable-features / --disable-features switch (no merge),
  // so collect every feature here and emit one combined switch of each below.
  const enableFeatures = [];
  const disableFeatures = [];

  // Keep UserAgentClientHint on so navigator.userAgentData and Sec-CH-UA-* carry the CDP
  // userAgentMetadata override; it is default in modern Chrome, explicit for older builds.
  enableFeatures.push('UserAgentClientHint');

  // Global browser settings via Chromium flags. Disabling images saves proxy traffic.
  if (browserSettings.disableImages) args.push('--blink-settings=imagesEnabled=false');
  // Secure access: auto-upgrade http→https where possible (Chrome-version dependent).
  if (browserSettings.secureAccess) enableFeatures.push('HttpsUpgrades');
  // Translate uses a real flag (the policy file is a no-op); off keeps the locale story consistent.
  if (browserSettings.offerTranslate === false) disableFeatures.push('Translate');
  // A Google session can de-anonymize a profile, so sync is off unless explicitly allowed.
  if (!browserSettings.allowChromeSignin) args.push('--disable-sync');

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

  // QUIC/HTTP3 is UDP and bypasses an HTTP or SOCKS proxy, leaking DNS and IP; off when proxied.
  // Avoid --host-resolver-rules=MAP * ~NOTFOUND: it breaks all name resolution.
  // enableQuic === true (High-Speed Trusted Mode) keeps QUIC; safe only on proxies that tunnel UDP.
  if (resolvedProxy && profile.enableQuic !== true) {
    args.push('--disable-quic');
  }

  // One switch each: repeated feature switches clobber rather than merge.
  if (enableFeatures.length) args.push(`--enable-features=${[...new Set(enableFeatures)].join(',')}`);
  if (disableFeatures.length) args.push(`--disable-features=${[...new Set(disableFeatures)].join(',')}`);

  // Chromium has no SOCKS proxy auth and page.authenticate() only answers HTTP 407, so authenticated
  // SOCKS5 goes through a local no-auth relay that injects the credentials upstream.
  const proxyTypeLc = resolvedProxy ? String(resolvedProxy.type).toLowerCase() : '';
  const proxyIsSocks = proxyTypeLc.startsWith('socks'); // socks4 OR socks5 - neither answers HTTP 407
  const proxyIsSocks5 = proxyTypeLc === 'socks5';       // only socks5 carries user/pass auth (via the relay)
  const socksNeedsAuth = proxyIsSocks5 && Boolean(resolvedProxy.username || resolvedProxy.password);
  // Chromium's SOCKS4 client resolves hostnames locally, leaking every site to the host's DNS, and the
  // relay only speaks to SOCKS5 upstreams. Refuse the launch rather than leak silently.
  if (proxyTypeLc === 'socks4') {
    const e = new Error('This profile uses a SOCKS4 proxy. Chrome cannot send DNS lookups through SOCKS4, so every site you visit would be looked up outside the proxy (a DNS leak). Switch the proxy type to SOCKS5 or HTTP, or open this profile in Firefox.');
    e.code = 'SOCKS4_DNS_LEAK';
    throw e;
  }
  // Authenticated HTTP(S) proxies also use a local relay: page.authenticate() is per-page, so a new "+"
  // tab's first request draws a 407 before auth is wired, stalling the tab and looking like a bot.
  const httpNeedsAuth = Boolean(resolvedProxy) && !proxyIsSocks && Boolean(resolvedProxy.username || resolvedProxy.password);
  // Active auth-injecting relay, SOCKS5 or HTTP despite the name; both expose { port, close },
  // so session teardown closes either.
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
      // Relay failed to start: fall back to per-page page.authenticate() rather than failing the launch.
      console.warn('[SG][proxy] HTTP auth relay failed to start - falling back to page.authenticate:', (e && e.message) || e);
      socksRelay = null;
    }
  }

  // Proxy via --proxy-server; authenticated proxies point at the local relay.
  if (resolvedProxy) {
    const proxyServer = buildProxyServerArgument(proxyForArg);
    if (proxyServer) args.push(`--proxy-server=${proxyServer}`);
  }
  // Per-page authenticate() is only the fallback for an authenticated HTTP(S) proxy with no relay.
  const proxyCreds = (resolvedProxy && !proxyIsSocks && !socksRelay && (resolvedProxy.username || resolvedProxy.password))
    ? { username: resolvedProxy.username || '', password: resolvedProxy.password || '' }
    : null;

  // Binary preference: pinned CfT, else system Chrome (no NTP crash, no "Testing" icon), else newest
  // CfT, else bundled Chromium. Real Chrome's own version feeds the UA and Client Hints.
  const resolvedBrowser = chosenBrowser;
  // Strip puppeteer's --enable-automation: it shows the "controlled by automated test software"
  // infobar and sets navigator.webdriver=true. DevTools control works without it.
  const launchOptions = {
    headless,
    userDataDir,
    defaultViewport: null,
    args,
    // A fresh array each launch: puppeteer-extra's stealth defaultArgs evasion push()es
    // into this list, which would throw on the frozen constant.
    ignoreDefaultArgs: [...PUPPETEER_DEFAULT_ARGS_TO_DROP],
    // Longer CDP timeout: auto-attach (waitForDebuggerOnStart) can hold a new tab or worker briefly,
    // and Network.enable on it timed out at the default on slower machines or proxies.
    protocolTimeout: 120000
  };
  // Fixed free DevTools port, never port 0: Chrome treats an auto-assigned port as automation and sets
  // navigator.webdriver=true even without --enable-automation, so Google serves a CAPTCHA every time.
  launchOptions.debuggingPort = await getFreeLocalPort();
  if (resolvedBrowser && resolvedBrowser.exePath) launchOptions.executablePath = resolvedBrowser.exePath;
  // TZ on the Chrome process sets the ICU/Date/Intl timezone in every context (page, workers,
  // service workers) natively, with no injection race.
  if (timezoneId) launchOptions.env = { ...process.env, TZ: timezoneId };

  // Stock puppeteer by default; the rebrowser engine (no persistent Runtime.enable) when "minimize CDP
  // footprint" is on. Visible profiles never get the stealth plugin, on either engine.
  const stealth = !usingAntidetect && useStealthFor({ headless });
  const engine = browserSettings.minimizeCdpFootprint === true ? getRuntimeFixPuppeteer({ stealth })
    : stealth ? puppeteer
    : getNativeEngine();
  let browser;
  try {
    browser = await engine.launch(launchOptions);
  } catch (launchErr) {
    // Launch itself failed - the SOCKS relay (if any) would otherwise leak.
    if (socksRelay) { try { socksRelay.close(); } catch (e) {} }
    throw launchErr;
  }

  // Until the session is registered in activeSessions nothing else tracks this browser, so a throw
  // in post-launch setup would orphan a live Chrome. On failure, tear it down and rethrow.
  let sessionRegistered = false;
  try {

  // DevTools and extension locks are enforced here per profile from the start;
  // Chromium on Windows ignores the policy file (see browserLocks.js).
  await attachBrowserLocks(browser, {
    disableDevtools: browserSettings.disableDevtools === true,
    lockExtensions: browserSettings.lockExtensions === true
  });

  // Keep puppeteer-extra-stealth's targetcreated listener so its evasions (window.chrome, plugins...)
  // reach every new tab; without them BotGuard serves /sorry on "+"-tab searches. Its occasional
  // TargetCloseError on a transient NTP is swallowed by the unhandledRejection handler in main.js.

  // ---- Cross-channel fingerprint injection ----
  // Real Chrome ignores --load-extension and evaluateOnNewDocument races browser-opened tabs, so a
  // browser-level auto-attach (waitForDebuggerOnStart) pauses each target until the script is set.
  const fpInjectSource = `(${fingerprintScript.toString()})(${JSON.stringify(fpConfig)});`;
  // Values the auto-attach handler needs for new tabs. Declared here for the closure, filled once
  // ua/timezone/geo are known; until then a harmless no-op (applyToPage covers the first page).
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

      // With flatten:true, puppeteer's Connection has already created the child CDPSession when this
      // event fires, so conn.session() resolves it. Sending on the child (not Target.sendMessageToTarget)
      // routes correctly and lets real failures reject, so inject() can report and retry.
      const child = conn ? conn.session(ev.sessionId) : null;
      // Bound every child CDP call so a stalled command can never block the resume below (a new tab
      // must never hang at about:blank). A timeout rejects; inject() catches it and resume still fires.
      const withTimeout = (p, ms) => Promise.race([
        p, new Promise((_, rej) => setTimeout(() => rej(new Error('cdp call timed out')), ms))
      ]);
      const sendMsg = (method, params = {}) => (child
        ? withTimeout(child.send(method, params), 4000)
        : Promise.reject(new Error('no flat child CDP session for ' + ev.sessionId)));

      const inject = async () => {
        try {
          if (isPageish) {
            if (!scriptAdded) {
              await sendMsg('Page.addScriptToEvaluateOnNewDocument', { source: fpInjectSource });
              scriptAdded = true;
            }
            // Native engine sets UA/timezone/cores/metrics from launch flags; a CDP UA disagreeing with the
            // native Sec-CH-UA headers is a tell. Geolocation is not native, so it still runs.
            if (!fpConfig.nativeEngine) {
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
            } // end !nativeEngine
            // Native engine: spoof screen.* to the profile resolution (fingerprint-chromium
            // has no screen flag, so it would leak the real monitor across every profile).
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
            // Native engine already reports the spoofed core count inside workers.
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
        // waitForDebuggerOnStart pauses every new target; it must be resumed or the tab hangs at about:blank.
        try {
          if (child) { await withTimeout(child.send('Runtime.runIfWaitingForDebugger'), 4000); return; }
        } catch (e) { /* fall through to a best-effort resume below */ }
        // No flat child session (detached early or a non-routable type): best-effort legacy resume.
        // Failure here means the target is already gone.
        try {
          await rootCdp.send('Target.sendMessageToTarget', {
            sessionId: ev.sessionId,
            message: JSON.stringify({ id: Math.floor(Math.random() * 1e6), method: 'Runtime.runIfWaitingForDebugger', params: {} })
          });
        } catch (e2) { /* target already gone */ }
      };

      // Arm a resume timer before awaiting injection so a stalled CDP call can never leave a new tab
      // hung at about:blank. Injection normally takes <100ms and clearTimeout cancels the timer.
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
        console.error('[SG][fingerprint] new-tab injection FAILED - this tab may expose the REAL GPU/RAM/WebRTC. profile',
          profileId, title || '', '- target', info.url || info.targetId || info.type);
      }

      // Always resume (idempotent), even if injection failed, so the tab never hangs.
      await resume();
    });
    await rootCdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  } catch (e) { /* fall back to per-page evaluateOnNewDocument in applyToPage */ }

  // Track PID to prevent orphaned processes
  const browserProcess = browser.process();
  if (browserProcess) {
    const pid = browserProcess.pid;
    trackPid(pid, userDataDir);
    // Surface Chrome's stderr crash lines and exit code/signal: otherwise a browser that closes
    // by itself leaves no trace, since every CDP path is caught.
    try {
      if (browserProcess.stderr) {
        browserProcess.stderr.on('data', (d) => {
          const s = String(d);
          // Drop known-harmless stderr noise (GCM registration, new_tab_ui "incorrect profile type",
          // bluetooth probing) so genuine crash lines are not buried.
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
      console.error(`[SG][chrome-exit] pid=${pid} code=${code} signal=${signal} - the profile browser process ended.`);
    });
    browser.on('disconnected', () => {
      console.error(`[SG][browser-disconnected] pid=${pid} - puppeteer lost the connection (browser gone).`);
      untrackPid(pid);
    });
    // Window icon: brand colour for non-Chrome brands; for Chrome only on CfT (hides the "Testing"
    // badge), never over real Chrome's own icon. No-op off Windows.
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
  // Rescue omnibox searches on the first tab; new tabs get the guard in the targetcreated handler.
  attachOmniboxSearchGuard(page, browserSettings && browserSettings.searchUrl);

  const manualLat = profile.locationType === 'Custom' ? Number.parseFloat(profile.locationLat) : NaN;
  const manualLng = profile.locationType === 'Custom' ? Number.parseFloat(profile.locationLng) : NaN;

  // Give the auto-attach handler the UA, Client Hints, Accept-Language and mobile identity before the
  // slow geo lookup, so a tab opened meanwhile can't leak the real UA. Timezone/geolocation follow.
  // Accept-Language follows fpConfig.langs so headers and JS never disagree.
  const acceptLanguage = localeToAcceptLanguage(fpConfig.langs[0] || 'en-US');
  const dnt = fpConfig.dnt; // reused for the DNT request header in applyToPage
  const ua = buildUserAgentBundle(profile, realMajor, realFullVersion, seed);

  // Android profiles also need a small high-DPR viewport and touch: CDP device emulation makes
  // maxTouchPoints, ontouchstart, devicePixelRatio and the viewport match the Android UA.
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

  // Fallback when the pre-launch lookup failed: resolve geo in-page so timezone and geolocation still
  // apply via CDP. Authenticate first, or an authenticated proxy answers 407 and the lookup fails.
  if (geoMatchEnabled && !geo && resolvedProxy && profile.timezoneType !== 'Real') {
    if (proxyCreds) await page.authenticate(proxyCreds).catch(() => {});
    geo = await lookupProxyGeo(page);
    if (geo && geo.timezone && (!timezoneId || tzFromLastKnown)) { timezoneId = geo.timezone; tzFromLastKnown = false; }
    if (geo) rememberProxyGeo(resolvedProxy, geo);
    else geo = lastKnownProxyGeo(resolvedProxy); // lat/lng from the last good lookup
  }
  const geoWarning = (geoApplies && !timezoneId) ? GEO_DEGRADED_WARNING : null;
  if (geoWarning) console.warn('[SG][geo] profile', (title || profileId), '- proxy geo lookup failed and no cached geo; host timezone in use.');

  const geoLat = Number.isFinite(manualLat) ? manualLat : (geo && Number.isFinite(geo.lat) ? geo.lat : null);
  const geoLng = Number.isFinite(manualLng) ? manualLng : (geo && Number.isFinite(geo.lon) ? geo.lon : null);

  // Timezone and geolocation depend on the lookup, so hand them to the auto-attach handler only here.
  fpLate.timezoneId = timezoneId;
  fpLate.geoLat = geoLat;
  fpLate.geoLng = geoLng;
  fpLate.geoAcc = toInt(profile.locationAcc, 100);

  // Apply the full fingerprint to one page: the first tab and every later tab or popup. Idempotent.
  const appliedPages = new WeakSet();
  // Track whether identity setup on the primary tab completed, so a profile never reports
  // "launched" while running with the real identity.
  let injectionDegraded = false;
  const applyToPage = async (targetPage, isNewTab = false) => {
    if (!targetPage || appliedPages.has(targetPage)) return;
    // Attach the omnibox guard before the early returns: a "+" tab is blank at targetcreated and returns
    // early, yet it is the tab users type into. Safe: it only adds a listener (no CDP, auth or
    // interception, which crash transient internal tabs).
    attachOmniboxSearchGuard(targetPage, browserSettings && browserSettings.searchUrl);

    let pageUrl = '';
    try { pageUrl = targetPage.url(); } catch (e) {}
    const isInternal = /^(chrome|chrome-extension|devtools|edge|view-source):/i.test(pageUrl);
    const isBlank = pageUrl === '' || pageUrl === 'about:blank';
    // Skip internal pages and a new tab's transient ''/about:blank state: CDP or proxy-auth work there
    // crashes the browser. The extension already fingerprints new tabs; CDP extras apply on real http(s).
    if (isNewTab && (isInternal || isBlank)) return;
    if (isInternal) return;
    appliedPages.add(targetPage);
    try {
      // Register the init script before any other await: a target=_blank popup navigates immediately
      // and would otherwise commit its first document with the real navigator.
      await targetPage.evaluateOnNewDocument(fingerprintScript, fpConfig).catch(() => {});
      // Proxy auth for HTTP(S) proxies - version-agnostic, no MV2 extension.
      if (proxyCreds) await targetPage.authenticate(proxyCreds).catch(() => {});
      const cdp = await targetPage.target().createCDPSession();
      // Native engine sets UA/timezone/cores/metrics from launch flags; CDP would fight it.
      // Geolocation, DNT and request filtering below are not native, so they still run.
      if (!fpConfig.nativeEngine) {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: ua.userAgent,
        acceptLanguage,
        platform: ua.navPlatform,
        userAgentMetadata: ua.userAgentMetadata
      }).catch(() => {});
      if (timezoneId) await cdp.send('Emulation.setTimezoneOverride', { timezoneId }).catch(() => {});
      // Android: high-DPR viewport, screen size and touch (maxTouchPoints, ontouchstart) to match the UA.
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
      // CDP cores override also covers workers before their script runs; backs up the in-page override.
      if (fpConfig.cores) await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: fpConfig.cores }).catch(() => {});
      } // end !nativeEngine
      // Native engine: spoof screen.* (fingerprint-chromium has no screen flag, so the real monitor leaks).
      // deviceScaleFactor:0 keeps the real DPR; width/height:0 leaves the viewport intact.
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
      // One interception handler, enabled only when needed: disableVideos aborts media (saves proxy
      // traffic), localNetworkAccess blocks LAN/loopback probing, blockAccess applies the host list.
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
      // Smart Autofill on this tab and later navigations; a no-op unless the persona bridge is configured.
      await attachPersonaAutofill(targetPage);
    } catch (e) {
      // Best-effort per page, but record that identity setup did not complete so the UI can warn
      // instead of implying protection that isn't there.
      if (!isNewTab) injectionDegraded = true;
      console.error('[SG][fingerprint] injection error on', (isNewTab ? 'new tab' : 'primary tab'),
        'for profile', profileId, title || '', '-', (e && e.message) || e);
    }
  };

  await applyToPage(page);
  watchPageForBlocks(page, profileId, sessionProxyId);
  if (injectionDegraded) {
    console.error('[SG][fingerprint] WARNING: profile', (title || profileId),
      'launched WITHOUT full fingerprint masking - the real UA/timezone/devices may be exposed.');
  }

  // New tabs/popups already get the JS fingerprint from the CDP auto-attach. This handler adds what
  // injection can't: proxy auth, UA/timezone/geo CDP overrides, request filtering, DNT and captcha.
  browser.on('targetcreated', async (target) => {
   try {
    const targetType = target.type();
    // Workers are separate realms where CreepJS rereads hardwareConcurrency. A service worker script
    // can't be wrapped like dedicated/shared workers, so apply the CDP cores override to its target.
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
      // Authenticate before applyToPage's blank-tab early return: a new tab's first request draws a 407
      // that never fires framenavigated, so the tab would load forever. authenticate() answers it in flight.
      if (proxyCreds) await newPage.authenticate(proxyCreds).catch(() => {});
      await applyToPage(newPage, true).catch(() => {});
      watchPageForBlocks(newPage, profileId, sessionProxyId);
      // A new tab usually starts on the internal NTP (skipped above), so apply once it reaches a real site
      // (idempotent). The .catch keeps a transient CDP error from becoming an unhandledRejection.
      newPage.on('framenavigated', (frame) => {
        try { if (frame === newPage.mainFrame()) applyToPage(newPage, true).catch(() => {}); } catch (e) {}
      });
    } catch (e) { /* ignore transient targets */ }
   } catch (outer) { /* never let a new-tab/worker target tear down the session */ }
  });

  // Start-page check links open in a new tab from the main process, authenticating before goto so an
  // authenticated proxy never stalls the tab on a 407 (a popup would race per-tab auth).
  const hOpenTab = async (url) => {
      try {
        if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
        const np = await browser.newPage();
        if (proxyCreds) await np.authenticate(proxyCreds).catch(() => {});
        await np.bringToFront().catch(() => {});
        await np.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } catch (e) { /* best-effort - a failed open must never affect the session */ }
  };
  // No exposeFunction: its binding would sit on window of every later document in this tab. The bridge
  // lives on the file:// start page only, which calls window.__sgBridge('__sgzOpenTab', href).
  try { await attachPageBridge(page, { __sgzOpenTab: hOpenTab }, { fileOnly: true }); } catch (e) { /* bridge optional */ }

  // On-startup mode: 'detection' shows the SoftGlaze IP/fingerprint start page;
  // 'blank' and 'last' skip it (no proxy-detection page) and open about:blank.
  const startupMode = browserSettings.mode || 'detection';
  let startUrl = 'about:blank';
  if (startupMode === 'detection') {
    startUrl = await generateStartPage(userDataDir, { title, profileId: profileId || 'TEMP-ID', proxyLabel, geo, startPageLinks });
  }
  // One log line naming the engine and binary, to confirm the anti-detect engine engaged rather than
  // falling back to stock Chrome (which happens when its binary isn't downloaded yet).
  console.log(`[SG][launch] antidetect=${usingAntidetect} cft=${usingCft} realChrome=${Boolean(chosenBrowser && chosenBrowser.isReal)} minCdp=${browserSettings.minimizeCdpFootprint === true} binary=${String((chosenBrowser && chosenBrowser.exePath) || '').split(/[\\/]/).pop()}`);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  // A start URL given for this launch then opens in the main tab (Back returns to the start page).
  if (launchUrl) await openLaunchUrl(page, launchUrl, proxyCreds);

  // Open this profile's saved start links through hOpenTab, which authenticates before each
  // navigation; a bare newPage() would stall each tab on a 407.
  if (Array.isArray(startupUrls) && startupUrls.length) {
    let rest = startupUrls;
    // Without the detection page the first tab is a throwaway about:blank, so reuse it for the first
    // link, unless this launch's start URL already holds it.
    if (startupMode !== 'detection' && !launchUrl) {
      const first = startupUrls[0];
      if (typeof first === 'string' && /^https?:/i.test(first)) {
        if (proxyCreds) await page.authenticate(proxyCreds).catch(() => {});
        await page.goto(first, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        rest = startupUrls.slice(1);
      }
    }
    for (const u of rest) await hOpenTab(u);
    // Leave the user looking at the first tab rather than the last one opened.
    try { await page.bringToFront(); } catch (e) { /* best-effort */ }
  }

  const sessionId = String(profileId || crypto.randomUUID());
  // Debugging endpoint for the local REST API, so users can attach Playwright/Puppeteer/Selenium.
  let wsEndpoint = null;
  try { wsEndpoint = browser.wsEndpoint(); } catch (e) { wsEndpoint = null; }
  let sessionPid = null;
  let sessionProcess = null; // the Chrome ChildProcess, to read its exit code on disconnect
  try { sessionProcess = browser.process() || null; sessionPid = sessionProcess ? sessionProcess.pid : null; } catch (e) { sessionPid = null; sessionProcess = null; }
  activeSessions.set(sessionId, {
    browser,
    page,
    userDataDir,
    wsEndpoint,
    pid: sessionPid,
    title: title || `Profile ${sessionId}`,
    proxyLabel,
    injectionOk: !injectionDegraded,
    geoWarning,
    socksRelay, // local auth relay (or null), closed when the session ends
    openTab: hOpenTab, // opens a page in a new tab with proxy auth (retryBlockedPage)
    createdAt: new Date()
  });
  sessionRegistered = true;
  browser.on('disconnected', () => {
    activeSessions.delete(sessionId);
    if (socksRelay) { try { socksRelay.close(); } catch (e) {} }
    // Classify the disconnect: app shutdown and app Stop are clean. Otherwise a process that exits
    // normally (code 0, e.g. the user closed the window) is a close, not a crash.
    const intentional = intentionalClose.has(sessionId);
    if (intentional) intentionalClose.delete(sessionId);
    const emit = (exit) => {
      const reason = classifyBrowserExit({ shuttingDown, intentional, exit });
      emitSessionEvent({ type: reason === 'crash' ? 'crashed' : 'closed', sessionId, reason });
    };
    if (shuttingDown || intentional) { emit(null); return; }
    waitForProcessExit(sessionProcess, 3000).then(emit, () => emit(null));
  });

  // Emit and return inside the guard try: sessionId, wsEndpoint and the rest are block-scoped to it.
  emitSessionEvent({ type: 'launched', sessionId, profileId: (profileId != null ? Number(profileId) : null), engine: 'chrome', pid: sessionPid });
  return { sessionId, userDataDir, wsEndpoint, injectionOk: !injectionDegraded, geoDegraded: Boolean(geoWarning), geoWarning };

  } catch (launchErr) {
    // Setup failed before registration: close the orphaned browser and relay, then rethrow.
    if (!sessionRegistered) {
      try { await browser.close(); } catch (e) { /* already gone */ }
      if (socksRelay) { try { socksRelay.close(); } catch (e) {} }
    }
    throw launchErr;
  }
}

// Navigate a running session's primary page (used by the Cookie Warmer). Returns true on success;
// never throws, so a dead tab or slow site can't crash the warmer or the main process.
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

// ---- Block pages ----
// Watches each tab's main documents for block and challenge pages (blockDetect) and reports a
// confirmed one as a 'blocked' session event; ipcHandlers decides what to do about it.
const blockWatch = new WeakMap(); // page -> { seen, last, cdp }; seen = blocked URLs reported or in their grace period

// The tab title from its navigation entry. No script runs in the page, so this adds no
// Runtime.enable on the minimal-CDP engine.
async function tabTitle(page, state) {
  try {
    if (!state.cdp) state.cdp = await page.target().createCDPSession();
    const history = await state.cdp.send('Page.getNavigationHistory');
    const entry = history && Array.isArray(history.entries) ? history.entries[history.currentIndex] : null;
    return entry && entry.title ? String(entry.title) : '';
  } catch (e) {
    state.cdp = null;
    return '';
  }
}

function watchPageForBlocks(page, profileId, proxyId) {
  if (!page || profileId == null || blockWatch.has(page)) return;
  const sessionId = String(profileId);
  const state = { seen: new Set(), last: null, cdp: null };
  blockWatch.set(page, state);

  const report = async (doc, verdict) => {
    state.seen.add(doc.url);
    if (!verdict.hard) {
      // A good IP often passes a challenge by itself within seconds; only a page still blocked
      // after the grace period counts.
      await sleep(blockDetect.GRACE_MS);
      if (page.isClosed()) return;
      const cur = state.last || doc;
      const again = blockDetect.classifyBlock({ url: page.url(), status: cur.status, headers: cur.headers, title: await tabTitle(page, state) });
      if (!again.blocked) { state.seen.delete(doc.url); return; }
    }
    // A start-up tab can be blocked before the session is registered; a tab of a session that has
    // since closed (or been relaunched under the same id) reports nothing.
    const live = () => { const s = activeSessions.get(sessionId); return Boolean(s && s.browser === page.browser()); };
    for (let i = 0; i < 60 && !live() && !page.isClosed() && page.browser().isConnected(); i += 1) await sleep(1000);
    if (page.isClosed() || !live()) return;
    emitSessionEvent({ type: 'blocked', sessionId, profileId: Number(profileId), proxyId, url: doc.url, kind: verdict.kind });
  };

  const inspect = async (withTitle) => {
    const doc = state.last;
    if (!doc || state.seen.has(doc.url)) return;
    const title = withTitle ? await tabTitle(page, state) : '';
    if (state.last !== doc || state.seen.has(doc.url)) return; // replaced or already claimed meanwhile
    const verdict = blockDetect.classifyBlock({ ...doc, title });
    if (verdict.blocked) await report(doc, verdict);
  };

  // Main-frame documents only: a CAPTCHA iframe inside a normal page is not a block.
  page.on('response', (res) => {
    try {
      const req = res.request();
      if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
      const url = res.url();
      if (!/^https?:/i.test(url)) return;
      state.last = { url, status: res.status(), headers: res.headers() };
      inspect(false).catch(() => {});
    } catch (e) { /* a closing tab */ }
  });
  // Title-based signals need the parsed document.
  page.on('domcontentloaded', () => { inspect(true).catch(() => {}); });
}

// Opens a blocked page again in a running session. With blockedUrl: reloads the tab that showed it
// (re-armed, so a block that persists is reported once more), or nothing if that tab is gone.
// Without (a freshly relaunched session): a blank first tab, else a new tab.
async function retryBlockedPage(sessionId, blockedUrl, retryUrl) {
  const session = activeSessions.get(String(sessionId || '').trim());
  const url = String(retryUrl || '');
  if (!session || !session.browser || !/^https?:\/\//i.test(url)) return false;
  let target = null;
  if (blockedUrl) {
    let pages = [];
    try { pages = await session.browser.pages(); } catch (e) { pages = []; }
    target = pages.find((p) => { const w = blockWatch.get(p); return w && w.seen.has(blockedUrl) && !p.isClosed(); }) || null;
    if (!target) return false;
  } else if (session.page && !session.page.isClosed() && /^(about:blank)?$/.test(session.page.url())) {
    target = session.page;
  }
  if (target) {
    const w = blockWatch.get(target);
    if (w && blockedUrl) w.seen.delete(blockedUrl);
    try {
      await target.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return true;
    } catch (e) {
      return false;
    }
  }
  if (typeof session.openTab === 'function') {
    await session.openTab(url);
    return true;
  }
  return false;
}

// ---- Cookie Robot / Session Warmer (Pro) ----
// Visits real sites on a running session (navigate, dismiss consent, scroll, dwell) to build cookies
// and history with the profile's own proxy and fingerprint. Errors go to `errors`, never thrown.
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

// Click a few random visible links/buttons as browsing noise. Never throws; stops if the page
// navigates away. Returns the click count.
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
    } catch (e) { break; } // page likely navigated - stop clicking
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

// Cookie Warmer interaction on the live page: dismiss consent, scroll, then per-site clicks.
// Best-effort; returns what it did.
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

// ---- Human Paste typing (Premium) ----
// Anti-fraud flags credentials that appear instantly, so type one key at a time via CDP with a
// random 40-150 ms gap. Best-effort: a failed key is skipped and it never throws.
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

// ---- Synchronizer (Premium): Master input is replayed into every Slave profile ----
// Launch, grouping, CDP plumbing and click/key mirroring work; pointer moves, scroll sync,
// viewport coordinate mapping and screenshot diffing are still TODO.
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
          // TODO: normalize x/y across Slave viewports and scroll offsets; raw client coords replay 1:1.
          await slave.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: evt.x, y: evt.y, button: evt.button === 2 ? 'right' : 'left', clickCount: 1 });
          await slave.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: evt.x, y: evt.y, button: evt.button === 2 ? 'right' : 'left', clickCount: 1 });
        } else if (evt.k === 'key') {
          const props = humanKeyProps(evt.text || evt.key || '');
          await slave.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...props });
          await slave.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...props });
        }
        // TODO: handle 'mousemove' (throttled) and 'scroll'.
      } catch (e) { /* a slave may have navigated/closed - ignore and continue */ }
    }
  };

  // Capture Master input in a private isolated world: its listeners see every DOM event, but the
  // page's window gets no binding, __sgBridge or capture function. Torn down with the group.
  const hSyncDispatch = (evt) => { mirror(evt).catch(() => {}); return { ok: true }; };
  let world = null;
  try { world = await attachIsolatedWorld(masterSession.page, { syncDispatch: hSyncDispatch }, syncCaptureClientScript.toString()); } catch (e) { world = null; }
  if (world && !world.ok) world = null; // mirroring is best-effort; the windows still launch

  const dispose = async () => {
    if (world) {
      const w = world;
      world = null;
      try { await w.evaluate(() => { window.__syncStopped = true; }); } catch (e) { /* page may be gone */ }
      try { await w.dispose(); } catch (e) { /* ignore */ }
    }
    for (const slave of slaves) { try { await slave.cdp.detach(); } catch (e) {} }
  };
  const group = { masterSessionId: String(masterSessionId), slaves, dispose };
  syncGroups.set(group.masterSessionId, group);

  // Auto-clean the group when the Master disconnects.
  try { masterSession.browser.on('disconnected', () => { dispose().catch(() => {}); syncGroups.delete(group.masterSessionId); }); } catch (e) {}
  return group;
}

// Runs in the Master's isolated world (see beginSyncGroup). Self-contained.
function syncCaptureClientScript(rpc) {
  var post = function (payload) {
    if (window.__syncStopped) return;
    try { Promise.resolve(rpc('syncDispatch', payload)).catch(function () {}); } catch (e) { /* ignore */ }
  };
  try {
    document.addEventListener('click', function (e) { post({ k: 'click', x: Math.round(e.clientX), y: Math.round(e.clientY), button: e.button }); }, true);
    document.addEventListener('keydown', function (e) { post({ k: 'key', key: e.key, code: e.code, keyCode: e.keyCode, text: e.key && e.key.length === 1 ? e.key : '' }); }, true);
    // TODO: capture 'mousemove' (throttled) and 'scroll' here too.
  } catch (e) { /* ignore */ }
}

// Close a browser without hanging the caller: a wedged Chrome can leave close() pending forever and
// block app quit, so race it against a timeout and SIGKILL the tracked process.
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
    // Windows has no process groups, so killing only the parent PID orphans renderer/GPU children that
    // hold the userDataDir lock. taskkill /T kills the whole tree.
    if (process.platform === 'win32' && pid) {
      try { require('node:child_process').spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); }
      catch (e) { try { process.kill(pid, 'SIGKILL'); } catch (e2) { /* already gone */ } }
    } else {
      try { const p = browser.process(); if (p && !p.killed) p.kill('SIGKILL'); } catch (e) { /* ignore */ }
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (e) { /* already gone */ } }
    }
  }
  // Close the relay too (idempotent): on the force-kill path 'disconnected' might not fire.
  if (session.socksRelay) { try { session.socksRelay.close(); } catch (e) {} }
}

async function closeProfileSession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session) return { closed: false };
  intentionalClose.add(id); // deliberate close - the disconnect must not be read as a crash
  await closeBrowserWithTimeout(session);
  activeSessions.delete(id);
  return { closed: true };
}

async function closeAllProfileSessions() {
  shuttingDown = true; // quitting: not crashes; SessionState rows stay 'running' for restore
  // Close every session concurrently, each with its own timeout+force-kill, so one
  // wedged Chrome can't stall the whole quit sequence behind the others.
  await Promise.all(Array.from(activeSessions.values()).map((s) => closeBrowserWithTimeout(s)));
  activeSessions.clear();
}

// Drop registry entries whose Chromium exited without firing 'disconnected' (kill, crash, OOM),
// keeping the running count honest for the concurrency cap and the UI. Returns the number pruned.
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

// ---- Cookie I/O and leak test over CDP (live session) ----
// Reads real values from the running page: navigator, timezone, screen, WebRTC IPs and the exit IP
// (fetched in-page, through the proxy). Returns { env, webrtcIps, exit }, or null when not running.
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

// Pick a live page target: the stored session.page goes stale after a cross-origin navigation or a
// closed tab, and createCDPSession then fails with "No target with given id found".
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

// Read/write a profile's cookies without a visible session by opening its userDataDir headless.
// The caller must ensure the profile isn't running (a second open on the same userDataDir conflicts).
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

// ---- Macro engine (Pro): runner + visual recorder ----
// Step shapes live in MACRO_STEP_FIELDS. Element steps accept `timeout` (ms) and `optional`; a failed
// optional step is logged as skipped. The recorder emits the same shape the runner replays.

// Field schema per step type, the single source of truth: the renderer's editor mirrors it and
// normalizeMacroSteps enforces it at save time, so a malformed step never reaches the runner.
const MACRO_STEP_FIELDS = {
  goto: { url: 'string', timeout: 'number' },
  click: { selector: 'string', timeout: 'number' },
  type: { selector: 'string', value: 'string', timeout: 'number' },
  keypress: { key: 'string' },
  scroll: { steps: 'number' },
  wait: { ms: 'number' },
  move: { selector: 'string', x: 'number', y: 'number', timeout: 'number' },
  hover: { selector: 'string', ms: 'number', timeout: 'number' },
  select: { selector: 'string', value: 'string', by: 'string', timeout: 'number' },
  waitFor: { selector: 'string', state: 'string', timeout: 'number' },
  submit: { selector: 'string', timeout: 'number' },
  check: { selector: 'string', state: 'string', timeout: 'number' },
  clear: { selector: 'string', timeout: 'number' }
};

// Closed value sets. `state` means different things per type, so it is type-scoped.
const MACRO_STEP_ENUMS = {
  select: { by: ['auto', 'value', 'label', 'index'] },
  waitFor: { state: ['visible', 'hidden'] },
  check: { state: ['checked', 'unchecked'] }
};

const VALID_MACRO_STEPS = new Set(Object.keys(MACRO_STEP_FIELDS));

// Types are matched case-insensitively but stored canonically, so `waitfor`,
// `WaitFor` and `waitFor` are one step and the runner's switch stays exact-match.
const MACRO_STEP_BY_LOWER = new Map(Array.from(VALID_MACRO_STEPS).map((t) => [t.toLowerCase(), t]));

// Steps that wait on a selector get 15s. A bare waitFor is usually gating a slow
// page (a proxied load, a redirect chain), so it gets the longer 30s budget.
const STEP_TIMEOUT_DEFAULT = 15000;
const WAIT_FOR_TIMEOUT_DEFAULT = 30000;

function stepTimeout(step, fallback = STEP_TIMEOUT_DEFAULT) {
  const n = Number(step && step.timeout);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Validate and clean an editor/recorder step list into what the runner reads. Pure, for save-time use
// and tests. Throws a 1-based, human-readable message on the first bad step.
function normalizeMacroSteps(input) {
  const list = Array.isArray(input) ? input : [];
  return list.map((raw, i) => {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const rawType = String(src.type == null ? '' : src.type).trim();
    const type = MACRO_STEP_BY_LOWER.get(rawType.toLowerCase());
    if (!type) throw new Error(`Step ${i + 1}: unknown step type "${rawType || '(empty)'}".`);

    const out = { type };
    const schema = MACRO_STEP_FIELDS[type];
    const enums = MACRO_STEP_ENUMS[type] || {};
    for (const [key, kind] of Object.entries(schema)) {
      const value = src[key];
      if (value === undefined || value === null || value === '') continue;
      if (kind === 'number') {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`Step ${i + 1} (${type}): "${key}" must be a number.`);
        out[key] = n;
        continue;
      }
      const text = String(value);
      const allowed = enums[key];
      if (allowed) {
        const lower = text.trim().toLowerCase();
        if (!allowed.includes(lower)) {
          throw new Error(`Step ${i + 1} (${type}): "${key}" must be one of ${allowed.join(', ')}.`);
        }
        out[key] = lower;
        continue;
      }
      out[key] = text;
    }

    // An element step without a target is useless - catch it at save time rather
    // than 40 steps into a run against 200 profiles.
    const needsSelector = Boolean(schema.selector) && !(type === 'move' && out.x != null && out.y != null);
    if (needsSelector && !out.selector) throw new Error(`Step ${i + 1} (${type}): a CSS selector is required.`);
    if (type === 'goto' && !out.url) throw new Error(`Step ${i + 1} (goto): a URL is required.`);

    if (src.optional === true || src.optional === 'true') out.optional = true;
    return out;
  });
}

// Center point of an element in viewport coordinates (null if not found/visible).
async function elementCenter(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// How often a running macro checks control.aborted while a step waits.
const MACRO_STOP_POLL_MS = 200;

// Sleeps up to ms in short slices and returns early (true) once isAborted() says the run was
// stopped, so Stop never waits out a long wait or hover step.
async function sleepUnlessAborted(ms, isAborted) {
  const end = Date.now() + Math.max(0, Number(ms) || 0);
  for (;;) {
    if (isAborted && isAborted()) return true;
    const left = end - Date.now();
    if (left <= 0) return false;
    await sleep(Math.min(MACRO_STOP_POLL_MS, left));
  }
}

// Run macro steps in a live session. opts: continueOnError; control { paused, aborted }, mutated by
// the caller and checked between steps and during a step's waits; onStep({ index, total, type,
// status, step?, error? }).
async function runMacro(sessionId, steps, opts = {}) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) throw new Error('No active session for that profile - launch it first.');
  const page = session.page;
  const list = Array.isArray(steps) ? steps : [];
  const log = [];

  const control = opts.control || null;
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;
  const isAborted = () => Boolean(control && control.aborted);
  const waitWhilePaused = async () => { while (control && control.paused && !control.aborted) await sleep(150); };

  // A stop during a step ends its wait at once: selector waits get an AbortSignal (puppeteer cancels
  // them, so the click or typing after the wait never runs), a navigation stops being awaited.
  const stopper = control ? new AbortController() : null;
  // Cleared when the run ends (finally below).
  const stopPoll = stopper ? setInterval(() => { if (control.aborted) stopper.abort(); }, MACRO_STOP_POLL_MS) : null;
  const stopped = stopper ? new Promise((resolve) => stopper.signal.addEventListener('abort', resolve, { once: true })) : null;
  const untilStop = (o) => (stopper ? { ...o, signal: stopper.signal } : o);
  const orStop = (p) => (stopped ? Promise.race([p, stopped.then(() => { throw new Error('Stopped.'); })]) : p);

  try {
  for (let i = 0; i < list.length; i += 1) {
    if (isAborted()) break;
    await waitWhilePaused();
    if (isAborted()) break;

    const step = list[i] || {};
    const rawType = String(step.type == null ? '' : step.type).trim();
    const type = MACRO_STEP_BY_LOWER.get(rawType.toLowerCase()) || rawType.toLowerCase();
    if (onStep) onStep({ index: i, total: list.length, type, status: 'running', step });
    try {
      switch (type) {
        case 'goto':
          await orStop(page.goto(String(step.url || step.value || 'about:blank'), {
            waitUntil: 'domcontentloaded',
            timeout: stepTimeout(step, 30000)
          }));
          break;
        case 'click':
          if (!step.selector) throw new Error('click step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          { const c = await elementCenter(page, step.selector); if (c) await page.mouse.move(c.x, c.y, { steps: 10 }); }
          await page.click(step.selector, { delay: 30 });
          break;
        case 'type':
          if (!step.selector) throw new Error('type step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          await page.type(step.selector, String(step.value == null ? '' : step.value), { delay: 40 });
          break;
        case 'keypress':
          await page.keyboard.press(String(step.key || 'Enter'));
          break;
        case 'scroll':
          await humanScroll(page, { steps: Number(step.steps) || 4 });
          break;
        case 'wait':
          await sleepUnlessAborted(Math.max(0, Math.min(60000, Number(step.ms) || 1000)), isAborted);
          break;
        case 'move': {
          let pt = null;
          if (step.selector) {
            await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) })).catch(() => {});
            if (isAborted()) throw new Error('Stopped.');
            pt = await elementCenter(page, step.selector);
          }
          else if (step.x != null && step.y != null) pt = { x: Number(step.x), y: Number(step.y) };
          if (!pt) throw new Error('move step needs a valid selector or x/y');
          await page.mouse.move(pt.x, pt.y, { steps: 12 });
          break;
        }
        case 'hover': {
          if (!step.selector) throw new Error('hover step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          const pt = await elementCenter(page, step.selector);
          if (!pt) throw new Error('hover target is not visible');
          await page.mouse.move(pt.x, pt.y, { steps: 12 });
          await sleepUnlessAborted(Math.max(0, Math.min(60000, Number(step.ms) || 800)), isAborted);
          break;
        }
        // page.select() matches only option values, which are often opaque ids, so resolve the option
        // in-page (value, then label, then index) and pass its value to select(), which fires input/change.
        case 'select': {
          if (!step.selector) throw new Error('select step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          const wanted = String(step.value == null ? '' : step.value);
          const by = String(step.by || 'auto').toLowerCase();
          const resolved = await page.$eval(step.selector, (el, want, mode) => {
            if (!el || el.tagName !== 'SELECT') return { ok: false, reason: 'not-a-select' };
            const options = Array.from(el.options || []);
            const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
            const target = norm(want);
            const byValue = () => options.find((o) => norm(o.value) === target);
            const byLabel = () => options.find((o) => norm(o.textContent) === target || norm(o.label) === target);
            const byIndex = () => {
              const n = Number.parseInt(want, 10);
              return Number.isInteger(n) && n >= 0 && n < options.length ? options[n] : null;
            };
            let hit = null;
            if (mode === 'value') hit = byValue();
            else if (mode === 'label') hit = byLabel();
            else if (mode === 'index') hit = byIndex();
            else hit = byValue() || byLabel() || byIndex();
            if (!hit) {
              return {
                ok: false,
                reason: 'no-option',
                available: options.slice(0, 25).map((o) => String(o.textContent || '').trim() || o.value)
              };
            }
            return { ok: true, value: hit.value };
          }, wanted, by);
          if (!resolved.ok) {
            if (resolved.reason === 'not-a-select') {
              throw new Error(`select: ${step.selector} is not a <select> - use click steps for a custom dropdown`);
            }
            const seen = (resolved.available || []).join(' | ') || 'none';
            throw new Error(`select: no option matching "${wanted}" (options: ${seen})`);
          }
          await page.select(step.selector, resolved.value);
          break;
        }
        // Explicit gate for a slow or async page, instead of guessing a fixed `wait`.
        case 'waitFor': {
          if (!step.selector) throw new Error('waitFor step requires a selector');
          const waitOpts = { timeout: stepTimeout(step, WAIT_FOR_TIMEOUT_DEFAULT) };
          if (String(step.state || 'visible').toLowerCase() === 'hidden') waitOpts.hidden = true;
          else waitOpts.visible = true;
          await page.waitForSelector(step.selector, untilStop(waitOpts));
          break;
        }
        // requestSubmit() fires the submit event AND native validation; the bare
        // form.submit() skips both, which silently breaks React/validated forms.
        case 'submit': {
          if (!step.selector) throw new Error('submit step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          const submitted = await page.$eval(step.selector, (el) => {
            const form = el.tagName === 'FORM' ? el : (el.form || (el.closest ? el.closest('form') : null));
            if (!form) return false;
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
            return true;
          });
          if (!submitted) throw new Error(`submit: no <form> found for ${step.selector}`);
          break;
        }
        // Drives a checkbox/radio to a DEFINITE state. A plain click toggles blindly,
        // so a re-run (or a box the site pre-ticked) would silently invert it.
        case 'check': {
          if (!step.selector) throw new Error('check step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          const want = String(step.state || 'checked').toLowerCase() !== 'unchecked';
          const info = await page.$eval(step.selector, (el) => (
            typeof el.checked === 'boolean'
              ? { checked: el.checked, kind: String(el.type || '').toLowerCase() }
              : null
          ));
          if (!info) throw new Error(`check: ${step.selector} is not a checkbox or radio`);
          if (info.kind === 'radio' && !want) {
            throw new Error('check: a radio cannot be unchecked - select the other radio instead');
          }
          if (info.checked !== want) {
            const c = await elementCenter(page, step.selector);
            if (c) await page.mouse.move(c.x, c.y, { steps: 10 });
            await page.click(step.selector, { delay: 30 });
          }
          break;
        }
        // Empty a field before typing: `type` appends at the caret, so re-running over a pre-filled form
        // would concatenate onto the old value.
        case 'clear': {
          if (!step.selector) throw new Error('clear step requires a selector');
          await page.waitForSelector(step.selector, untilStop({ timeout: stepTimeout(step) }));
          await page.click(step.selector, { clickCount: 3 }); // select the field's text
          await page.keyboard.press('Backspace');
          const left = await page.$eval(step.selector, (el) => String(el.value == null ? '' : el.value));
          if (left !== '') {
            // type=number and some masked inputs ignore triple-click selection. Go
            // through the native value setter so React's onChange still fires.
            await page.$eval(step.selector, (el) => {
              const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
              if (desc && desc.set) desc.set.call(el, ''); else el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }
          break;
        }
        default:
          throw new Error(`Unknown step type: ${type || '(empty)'}`);
      }
      log.push({ index: i, type, ok: true });
      if (onStep) onStep({ index: i, total: list.length, type, status: 'ok' });
    } catch (e) {
      // A step cut short by Stop reads "Stopped.", not puppeteer's AbortError text.
      const msg = isAborted() ? 'Stopped.' : ((e && e.message) || String(e));
      // A failed optional step is logged as skipped and counted as OK; it never aborts the run.
      if (step.optional) {
        log.push({ index: i, type, ok: true, skipped: true, error: msg });
        if (onStep) onStep({ index: i, total: list.length, type, status: 'skipped', error: msg });
        continue;
      }
      log.push({ index: i, type, ok: false, error: msg });
      if (onStep) onStep({ index: i, total: list.length, type, status: 'error', error: msg });
      if (!opts.continueOnError) break;
    }
  }
  } finally {
    if (stopPoll) clearInterval(stopPoll);
  }

  return { ok: log.length > 0 && log.every((l) => l.ok), total: list.length, ran: log.length, log, aborted: isAborted() };
}

// Per-session recorder state. The bridge callback looks up the current recorder at call time,
// so re-recording re-routes cleanly.
const macroRecorders = new Map(); // sessionId -> { steps, stopped, page, navHandler }

// Runs in a private CDP isolated world: it shares the DOM (sees every event) but not page globals,
// so a site sees no bridge, binding or recording flag. Self-contained so it survives .toString().
function macroRecorderClientScript(rpc) {
  var send = function (step) {
    if (window.__recStopped) return;
    try { Promise.resolve(rpc('recordStep', step)).catch(function () {}); } catch (e) { /* ignore */ }
  };
  function cssPath(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let sel = node.nodeName.toLowerCase();
      // Prefer a stable attribute over a positional :nth-of-type when present -
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
      // Record a link click as a 'goto' to its href: a target=_blank link would open a new tab that the
      // runner, which drives the primary tab, never follows.
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && a.href && /^https?:/i.test(a.href)) {
        send({ type: 'goto', url: a.href });
        return;
      }
      const sel = cssPath(e.target);
      if (sel) send({ type: 'click', selector: sel });
    } catch (err) { /* ignore */ }
  }, true);
  document.addEventListener('change', (e) => {
    try {
      const t = e.target;
      if (!t || !t.tagName) return;
      const sel = cssPath(t);
      if (!sel) return;

      // Record a <select> as a 'select' step, preferring the visible label: option values are often
      // opaque ids that change per render.
      if (t.tagName === 'SELECT') {
        const opt = t.options ? t.options[t.selectedIndex] : null;
        const label = opt ? String(opt.textContent || '').trim() : '';
        send(label
          ? { type: 'select', selector: sel, value: label, by: 'label' }
          : { type: 'select', selector: sel, value: String(t.value || ''), by: 'value' });
        return;
      }

      // Checkboxes/radios record as a 'check' step with the state they were left in.
      if (t.tagName === 'INPUT' && (t.type === 'checkbox' || t.type === 'radio')) {
        send({ type: 'check', selector: sel, state: t.checked ? 'checked' : 'unchecked' });
        return;
      }

      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        send({ type: 'type', selector: sel, value: String(t.value || '') });
      }
    } catch (err) { /* ignore */ }
  }, true);
  document.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Enter') send({ type: 'keypress', key: 'Enter' });
    } catch (err) { /* ignore */ }
  }, true);
}

async function startMacroRecording(sessionId) {
  const id = String(sessionId || '').trim();
  const session = activeSessions.get(id);
  if (!session || !session.page) throw new Error('No active session for that profile - launch it first.');
  const existing = macroRecorders.get(id);
  if (existing && !existing.stopped) return { recording: true, already: true };

  const page = session.page;
  const rec = { steps: [], stopped: false, page };
  macroRecorders.set(id, rec);

  // Bridge page -> node; resolves the current recorder via macroRecorders.get(id) on every call.
  const hRecordStep = (step) => {
    const cur = macroRecorders.get(id);
    if (cur && !cur.stopped && step && step.type) cur.steps.push(step);
    return { ok: true };
  };
  // The recorder and its channel live in a private isolated world only while recording: no wrapper,
  // __sgBridge or flag on window. The world carries both transports, so the native engine works too.
  let world = null;
  try { world = await attachIsolatedWorld(page, { recordStep: hRecordStep }, macroRecorderClientScript.toString()); } catch (e) { world = null; }
  if (!world || !world.ok) {
    macroRecorders.delete(id);
    throw new Error('Could not attach the macro recorder to this page.');
  }
  rec.world = world;

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
  // Silence the current document's listeners, then drop the world's script, binding
  // and interception so nothing of the recorder outlives the recording.
  if (rec.world) {
    try { await rec.world.evaluate(() => { window.__recStopped = true; }); } catch (e) { /* page may be gone */ }
    try { await rec.world.dispose(); } catch (e) { /* ignore */ }
    rec.world = null;
  }
  return { recording: false, steps: rec.steps };
}

function isRecordingMacro(sessionId) {
  const rec = macroRecorders.get(String(sessionId || '').trim());
  return Boolean(rec && !rec.stopped);
}

// The live main tab of a running Chromium session, on the connection SoftGlaze already holds (for
// SoftGlaze AI's page tools; no second debugger is attached). When the stored tab was closed, the
// first open tab takes its place, so page tools and macros keep working. Null when not running.
async function getAutomationPage(sessionId) {
  const session = activeSessions.get(String(sessionId || '').trim());
  if (!session || !session.page) return null;
  let closed = false;
  try { closed = session.page.isClosed(); } catch (e) { closed = true; }
  if (closed) {
    let next = null;
    try {
      const pages = await session.browser.pages();
      next = pages.find((p) => { try { return !p.isClosed(); } catch (e) { return false; } }) || null;
    } catch (e) { next = null; }
    if (!next) return null;
    session.page = next;
  }
  return { page: session.page, browser: session.browser, wsEndpoint: session.wsEndpoint || null };
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

// Running sessions with their main-process PID (null without a process handle), for the
// OS-level memory lookup in ipcHandlers (tasklist).
function listSessionPids() {
  return Array.from(activeSessions.entries()).map(([sessionId, s]) => ({
    sessionId,
    pid: s.pid || null,
    title: s.title
  }));
}

module.exports = {
  PUPPETEER_DEFAULT_ARGS_TO_DROP,
  // Shared with the Firefox engine (and tests): how a profile browser ended.
  classifyBrowserExit,
  waitForProcessExit,
  // Exported for tests: the third-party cookie preference written before launch.
  cookieControlsModeFor,
  ensureCookiePolicyPref,
  parseProxyInput,
  formatProxyHost,
  // Exported for tests: proxy type to --proxy-server scheme (SOCKS4 -> socks4://, not http://).
  buildProxyServerArgument,
  // Exported for tests, which run it in a vm sandbox to check overrides don't leak
  // (toString/name integrity, navigator props on the prototype).
  fingerprintScript,
  // exported for tests
  randomGuardName,
  nativeGapScript,
  macroRecorderClientScript,
  syncCaptureClientScript,
  // Reused by the Firefox engine so both engines open the same SoftGlaze start page.
  generateStartPage,
  // Exported for tests: is a navigation a broken "No Search" query to rewrite, or a real destination?
  omniboxSearchUrl,
  // Shared with the Firefox engine: maps the proxy's geo to an IANA timezone and country locale.
  lookupProxyGeoNodeCached,
  // Shared with the Firefox engine's geo fallback.
  lastKnownProxyGeo,
  rememberProxyGeo,
  GEO_DEGRADED_WARNING,
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
  retryBlockedPage,
  isRecordingMacro,
  getAutomationPage,
  runCookieRobot,
  warmInteract,
  runMacro,
  // Macro step contract. normalizeMacroSteps is the save-time validator (ipcHandlers)
  // and is pure, so tests cover the whole schema without a browser.
  normalizeMacroSteps,
  VALID_MACRO_STEPS,
  MACRO_STEP_FIELDS,
  startMacroRecording,
  stopMacroRecording,
  humanType,
  launchSynchronizedSessions,
  exportSessionCookies,
  importSessionCookies,
  liveLeakTest,
  exportStoredCookies,
  importStoredCookies,
  listAvailableBrowsers,
  resolveBrowserExecutable,
  // Exported for tests, which check the reported major is clamped to the launched binary
  // (a reported 149 on a real 150+ is a TLS mismatch).
  buildUserAgentBundle,
  // Test hooks for the autofill password probes.
  __personaPickPasswordTarget: personaPickPasswordTarget,
  __personaPrepareTarget: personaPrepareTarget,
  __personaSetSelect: personaSetSelect,
  __siteKeyOf: siteKeyOf
};