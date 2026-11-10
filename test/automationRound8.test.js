'use strict';
// 1.0.26 round 8, automation and extensions:
//   1. uBlock Origin Lite never installed: the CRX update request said prodversion=114.0, and the store
//      answers 204 (no package) below an extension's minimum_chrome_version (uBO Lite needs 122). The
//      seeded id was also a different extension ("uBlock Origin Scope").
//  83. Macro Record captured only navigation: the isolated world's binding never reached a document
//      (Runtime.addBinding without Runtime.enable only installs into contexts that already exist), so
//      every step went over the sentinel fetch, which a page CSP (connect-src) refuses.
//  84. Parallel run showed "•••• passed": the relay's secret-key rule matched `passed`.
//  85. The starter "Search & open result" (Google) failed on fresh profiles; it now uses Wikipedia.
//  86. Ready Chrome rows kept a stale orange "Interrupted · NN%" bar.
//   5. Smart Autofill: a password below the fold "did not take" on pages with CSS smooth scrolling.
//  87. The autofill panel closed after a fill, so "Mark as used" was out of reach; the Data Vault table
//      was cut off at the right in a 1440 px window.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const importLib = (name) => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', name)).href);

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
function extractConst(source, name) {
  const start = source.indexOf(`\nconst ${name} = `);
  assert.notEqual(start, -1, `could not find const ${name}`);
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return source.slice(start + 1, i + 1);
  }
  throw new Error(`unterminated const ${name}`);
}
function loadMain(names, deps, consts = []) {
  const src = [...consts.map((c) => extractConst(IPC, c)), ...names.map((n) => extractFunction(IPC, n))].join('\n');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

// ---- 1. uBlock Origin Lite and the CRX prodversion ----

const ext = require('../src/main/extensionManager');
const UBO_LITE = 'ddkjiahejlhfcafbddmgiahcphecmpfh';
// A 767-byte CRX3 shaped like uBO Lite's package: manifest "__MSG_extName__" (en: "uBlock Origin Lite"),
// minimum_chrome_version 122.0, plus the _metadata folder Chromium refuses in unpacked extensions.
// Stored as base64 because *.crx is gitignored.
const FIXTURE = Buffer.from(read('test', 'fixtures', 'ublock-lite-fixture.crx.b64').replace(/\s+/g, ''), 'base64');

// The Chrome Web Store update endpoint as observed on 10 Nov 2026 (one request each): prodversion=114.0
// answered "HTTP/1.1 204 No Content" for an extension needing Chrome 122, and a current version
// redirected to the signed .crx.
function fakeUpdateServer(calls) {
  return {
    get: async (url, opts) => {
      calls.push({ url, opts });
      const u = new URL(url);
      assert.equal(u.hostname, 'clients2.google.com');
      const major = Number.parseInt(u.searchParams.get('prodversion'), 10);
      if (!(major >= 122)) return { status: 204, data: Buffer.alloc(0) };
      return { status: 200, data: FIXTURE };
    }
  };
}

test('1: the seeded uBlock is uBlock Origin Lite (Raymond Hill), not "uBlock Origin Scope"', () => {
  const ids = ext.RECOMMENDED_EXTENSIONS.map((r) => r.chromeId);
  assert.ok(ids.includes(UBO_LITE));
  assert.ok(!ids.includes('bbdpgcaljkaaigfcomhidmneffjjjfgp'), 'that id is "uBlock Origin Scope" 1.5.1, another extension');
  const row = ext.RECOMMENDED_EXTENSIONS.find((r) => r.chromeId === UBO_LITE);
  assert.equal(row.name, 'uBlock Origin Lite');
  assert.equal(row.enable, false, 'still opt-in');
});

test('1: prodversion is the newest Chrome profiles run on, with a fallback, never the old 114.0', () => {
  const v = (downloaded, real, fallbackVersions) => ext.chromeProdVersion({
    listAvailableBrowsers: () => downloaded.map((version) => ({ version })),
    findRealChrome: () => (real ? { version: real } : null),
    fallbackVersions
  });
  assert.equal(v(['150.0.7871.46', '157.0.8089.0', '152.0.7933.0'], '156.0.8078.80'), '157.0.8089.0');
  assert.equal(v([], '156.0.8078.80'), '156.0.8078.80');
  assert.equal(v(['151.0.7922.10'], ''), '151.0.7922.10', 'a real Chrome without a version folder is skipped');
  // Nothing installed: the newest version of the fingerprint pool (bumped with each release).
  const pool = require('../src/main/fingerprintGenerator').CHROME_VERSIONS;
  const newest = [...pool].sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10))[0];
  assert.equal(v([], null), newest);
  assert.ok(Number.parseInt(newest, 10) >= 122);
  assert.equal(v([], null, []), '149.0.7827.155', 'a constant only if even the pool is unreadable');
  assert.equal(v(['../../x', '157.0.8089.0'], '1e9'), '157.0.8089.0', 'only plain version strings');
  const url = ext.downloadUrlFor(UBO_LITE, '157.0.8089.0');
  assert.match(url, /^https:\/\/clients2\.google\.com\/service\/update2\/crx\?response=redirect&prodversion=157\.0\.8089\.0&/);
  assert.doesNotMatch(read('src', 'main', 'extensionManager.js'), /prodversion=114/);
});

test('1: the download gets a real package for the current Chrome and unpacks uBO Lite (fixture)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-crx-'));
  try {
    const calls = [];
    const http = fakeUpdateServer(calls);
    const out = await ext.downloadAndExtract(UBO_LITE, {
      http, root, listAvailableBrowsers: () => [{ version: '157.0.8089.0' }], findRealChrome: () => null
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /prodversion=157\.0\.8089\.0/);
    assert.equal(out.name, 'uBlock Origin Lite', 'the __MSG_ name resolved from _locales/en');
    assert.equal(out.version, '2026.1103.1743');
    assert.equal(out.localPath, path.join(root, UBO_LITE));
    assert.ok(fs.existsSync(path.join(out.localPath, 'manifest.json')));
    assert.ok(!fs.existsSync(path.join(out.localPath, '_metadata')), 'Chromium refuses unpacked extensions with _metadata');

    // What 1.0.26 sent: the store's 204 left an empty body ("Downloaded package was empty or truncated").
    // The 204 is now reported as what it is.
    const old = await http.get(ext.downloadUrlFor(UBO_LITE, '114.0'));
    assert.equal(old.status, 204);
    await assert.rejects(ext.downloadAndExtract(UBO_LITE, { http, root, listAvailableBrowsers: () => [{ version: '114.0.5735.90' }], findRealChrome: () => null }),
      /no package of this extension for Chrome 114\.0\.5735\.90.*newer Chrome/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- 83. The isolated world's binding reaches every document ----

const { attachIsolatedWorld, isolatedClientScript } = require('../src/main/pageBridge');

// A stand-in for one Chromium tab and one CDP session, modelling the V8 inspector rules the bridge runs
// into (v8-runtime-agent-impl.cc): Runtime.addBinding by context name installs the binding in the
// contexts that exist at that moment; a context created later gets it only while Runtime is enabled on
// the session (never here: Runtime.enable is a detection tell); adding a name that is already added is
// a no-op. Page CSP: the sentinel fetch is refused (connect-src), as on many real sites.
function fakeTab({ cspBlocksFetch = true } = {}) {
  const listeners = new Map();
  const emit = (ev, params) => { for (const fn of [...(listeners.get(ev) || [])]) setImmediate(() => fn(params)); };
  let nextId = 1;
  const contexts = new Map(); // id -> { id, world, win, sandbox }
  let doc = { worlds: new Map() };
  const added = new Map(); // binding name -> context name
  const newDocScripts = [];
  const fetches = [];
  const install = (ctx, name) => {
    ctx.win[name] = (payload) => {
      if (!added.has(name)) return;
      emit('Runtime.bindingCalled', { name, payload, executionContextId: ctx.id });
    };
  };
  const makeContext = (world) => {
    const id = nextId++;
    const win = {};
    const sandbox = vm.createContext({
      window: win, Promise, JSON, Object, Array, Error, String, Date, encodeURIComponent, setTimeout, clearTimeout,
      fetch: (url, opts) => { fetches.push({ url, opts }); return cspBlocksFetch ? Promise.reject(new TypeError('Failed to fetch')) : new Promise(() => {}); }
    });
    const ctx = { id, world, win, sandbox };
    contexts.set(id, ctx);
    doc.worlds.set(world, ctx);
    return ctx;
  };
  const cdp = {
    on: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); },
    off: (ev, fn) => { if (listeners.has(ev)) listeners.get(ev).delete(fn); },
    detach: async () => {},
    send: async (method, p = {}) => {
      switch (method) {
        case 'Runtime.addBinding':
          if (p.executionContextId != null) { install(contexts.get(p.executionContextId), p.name); added.set(p.name, null); return {}; }
          if (added.has(p.name)) return {};
          added.set(p.name, p.executionContextName);
          for (const ctx of doc.worlds.values()) if (ctx.world === p.executionContextName) install(ctx, p.name);
          return {};
        case 'Runtime.removeBinding': added.delete(p.name); return {};
        case 'Page.getFrameTree': return { frameTree: { frame: { id: 'top' } } };
        case 'Page.createIsolatedWorld': return { executionContextId: (doc.worlds.get(p.worldName) || makeContext(p.worldName)).id };
        case 'Page.addScriptToEvaluateOnNewDocument': newDocScripts.push(p); return { identifier: String(newDocScripts.length) };
        case 'Runtime.evaluate': vm.runInContext(p.expression, contexts.get(p.contextId).sandbox); return {};
        case 'Runtime.callFunctionOn': {
          const ctx = contexts.get(p.executionContextId);
          ctx.sandbox.__args = (p.arguments || []).map((a) => a.value);
          return { result: { value: await vm.runInContext(`(${p.functionDeclaration})(...__args)`, ctx.sandbox) } };
        }
        default: return {}; // Page.enable, Fetch.enable/disable, removeScript...
      }
    }
  };
  return {
    page: { target: () => ({ createCDPSession: async () => cdp }) },
    fetches,
    world: (name) => doc.worlds.get(name),
    worlds: () => [...doc.worlds.values()],
    // A navigation: a new document, the new-document scripts run in their worlds, then the events.
    navigate: () => {
      doc = { worlds: new Map() };
      for (const s of newDocScripts) if (s.worldName) vm.runInContext(s.source, makeContext(s.worldName).sandbox);
      emit('Page.frameNavigated', { frame: { id: 'top' } });
      emit('Page.domContentEventFired', {});
    }
  };
}
const RUN_SOURCE = 'function (rpc) { window.__send = function (step) { return rpc(\'recordStep\', step); }; }';
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

test('83: recorded steps reach main in the first and later documents, on a page whose CSP refuses the fetch', async () => {
  const tab = fakeTab({ cspBlocksFetch: true });
  // The document that is already open when Record starts.
  const firstWorlds = () => tab.worlds();
  const steps = [];
  const world = await attachIsolatedWorld(tab.page, { recordStep: (s) => { steps.push(s); return { ok: true }; } }, RUN_SOURCE);
  assert.equal(world.ok, true);
  const ctx1 = firstWorlds()[0];
  await settle();
  await ctx1.win.__send({ type: 'click', selector: '#search' });
  // Two navigations later (a search, then a result), the step still arrives.
  tab.navigate(); await settle();
  tab.navigate(); await settle();
  const ctx3 = tab.worlds()[0];
  assert.notEqual(ctx3.id, ctx1.id);
  await ctx3.win.__send({ type: 'type', selector: '#q', value: 'hello' });
  assert.deepEqual(steps, [{ type: 'click', selector: '#search' }, { type: 'type', selector: '#q', value: 'hello' }]);
  assert.equal(tab.fetches.length, 0, 'the binding carried them; no fetch was needed');
  // The binding lives in the private world only (the page's main world is not a context of that name).
  for (const c of tab.worlds()) assert.equal(Object.keys(c.win).filter((k) => typeof c.win[k] === 'function' && /^b[0-9a-f]{18}$/.test(k)).length, 1);
  await world.dispose();
});

test('83: a call made before main has added the binding waits for it instead of being dropped', () => {
  const src = isolatedClientScript.toString();
  assert.match(src, /if \(typeof window\[B\] !== 'function'\) return Promise\.resolve\('fetch'\);/, 'no lock-in to fetch while the binding is missing');
  assert.match(src, /err\.unsent = true;/, 'only a request that never reached main is re-sent');
  assert.match(src, /waitForBinding\(3000\)/);
  assert.match(src, /waitForBinding\(5000\)\.then\(function \(present\) \{ if \(present\) ensureMode\(\); \}\);/, 'transport settled before the first click');
  const attach = attachIsolatedWorld.toString();
  assert.match(attach, /cdp\.on\('Page\.frameNavigated', onFrameNavigated\)/);
  assert.match(attach, /Runtime\.removeBinding/);
  assert.doesNotMatch(attach, /send\('Runtime\.enable'/, 'never Runtime.enable');
  // The recorder still attaches through this channel only.
  assert.match(read('src', 'main', 'browserEngine.js'), /attachIsolatedWorld\(page, \{ recordStep: hRecordStep \}, macroRecorderClientScript\.toString\(\)\)/);
});

// ---- 84. The parallel run's pass count ----

test('84: the relay masks password-like keys but not the pass count', async () => {
  const { RemoteRelay } = require('../src/main/remoteRelay');
  const { runParallelMacro } = require('../src/main/parallelRunner');
  const relay = new RemoteRelay();
  const frames = [];
  relay.on('frame', (f) => frames.push(f));
  relay.emitFrame('k', 'status', { passed: 4, total: 4, password: 'p', proxyPass: 'q', passphrase: 'r', passwd: 's', sessionToken: 't' });
  const p = frames[0].payload;
  assert.equal(p.passed, 4);
  for (const k of ['password', 'proxyPass', 'passphrase', 'passwd', 'sessionToken']) assert.equal(p[k], '••••', k);

  frames.length = 0;
  const items = [1, 2, 3].map((id) => ({ profileId: id, profileName: `P${id}`, vars: null }));
  await runParallelMacro({ runId: 'r84', items, steps: [{ type: 'goto', url: 'x' }], concurrency: 3 }, {
    isOpen: () => false, launch: async (pid) => ({ sessionId: `s${pid}` }), close: async () => {},
    runMacro: async () => ({ ok: true, ran: 1, total: 1, log: [] }),
    emit: (key, type, payload) => relay.emitFrame(key, type, payload)
  });
  const done = frames.map((f) => f.payload).find((x) => x.state === 'done' && x.profileId == null);
  assert.equal(done.passed, 3, '"Run finished - 3/3 passed", not "••••/3"');
  assert.equal(done.total, 3);
});

// ---- 85. The Wikipedia starter ----

const { normalizeMacroSteps } = require('../src/main/browserEngine');
const starterConst = (name) => new Function(`${extractConst(IPC, name)}\nreturn ${name};`)();

test('85: "Search & open result" searches Wikipedia; every starter is valid for the runner', () => {
  const STARTERS = starterConst('STARTER_MACROS');
  const search = STARTERS.find((m) => m.name === 'Search & open result');
  assert.match(search.description, /Wikipedia/);
  assert.equal(search.steps[0].url, 'https://en.wikipedia.org/wiki/Special:Search');
  assert.ok(!JSON.stringify(search.steps).includes('google.com'));
  assert.deepEqual(search.steps.map((s) => s.type), ['goto', 'wait', 'type', 'keypress', 'waitFor', 'click']);
  for (const m of STARTERS) assert.doesNotThrow(() => normalizeMacroSteps(m.steps), m.name);
});

test('85: a starter seeded by an earlier version is updated once, only while it is exactly as seeded', async () => {
  const STARTERS = starterConst('STARTER_MACROS');
  const old = starterConst('STARTER_MACRO_REPLACED')[0];
  const db = createFakePrisma({
    macro: [
      { id: 1, name: old.name, description: old.description, stepsJson: JSON.stringify(old.steps), ownerMemberId: null },
      { id: 2, name: old.name, description: old.description, stepsJson: JSON.stringify([...old.steps, { type: 'wait', ms: 500 }]), ownerMemberId: null },
      { id: 3, name: old.name, description: old.description, stepsJson: JSON.stringify(old.steps), ownerMemberId: 4 },
      { id: 4, name: 'Warm & scroll', description: 'x', stepsJson: '[]', ownerMemberId: null }
    ]
  });
  const settings = new Map();
  const { refreshSeededStarterMacros } = loadMain(['refreshSeededStarterMacros'], {
    getPrisma: () => db,
    readSetting: async (k, def) => (settings.has(k) ? settings.get(k) : def),
    writeSetting: async (k, v) => { settings.set(k, v); }
  }, ['STARTER_MACROS', 'STARTER_MACRO_REPLACED', 'STARTER_MACROS_REFRESHED_FLAG']);
  assert.deepEqual(await refreshSeededStarterMacros(), { updated: 1 });
  const byId = async (id) => db.macro.findUnique({ where: { id } });
  const next = STARTERS.find((m) => m.name === old.name);
  assert.equal((await byId(1)).stepsJson, JSON.stringify(next.steps), 'the untouched seeded copy');
  assert.equal((await byId(1)).description, next.description);
  assert.match((await byId(2)).stepsJson, /google\.com/, 'an edited copy is left alone');
  assert.match((await byId(3)).stepsJson, /google\.com/, 'a member\'s own copy is left alone');
  assert.equal(settings.get('starterMacrosRefreshed_v1'), true);
  await db.macro.update({ where: { id: 1 }, data: { stepsJson: JSON.stringify(old.steps), description: old.description } });
  assert.deepEqual(await refreshSeededStarterMacros(), { skipped: true }, 'once');
  assert.match(IPC, /try \{ await seedStarters\(\); \} catch \(e\) \{ \/\* best-effort \*\/ \}\s*try \{ await refreshSeededStarterMacros\(\); \}/);
});

// ---- 86. Browsers page rows ----

test('86: a Ready row shows only a running download, never a leftover paused or interrupted one', async () => {
  const { rowDownload, RUNNING_DOWNLOAD_STATES } = await importLib('browserRows.mjs');
  const interrupted = { major: 157, version: '157.0.8103.38', state: 'interrupted', percent: 63 };
  assert.equal(rowDownload(true, interrupted), null, 'Ready 157.0.8089.0 with an interrupted 157.0.8103.38');
  assert.equal(rowDownload(true, { ...interrupted, state: 'paused' }), null);
  assert.equal(rowDownload(true, { ...interrupted, state: 'done' }), null);
  assert.equal(rowDownload(false, interrupted), interrupted, 'a row that is not installed still offers Resume');
  for (const state of RUNNING_DOWNLOAD_STATES) assert.equal(rowDownload(true, { state }).state, state);
  assert.equal(rowDownload(true, null), null);
  assert.match(read('src', 'renderer', 'pages', 'BrowsersPage.jsx'), /const d = rowDownload\(installed, download\);/);
  assert.match(read('src', 'renderer', 'components', 'BrowserManagerModal.jsx'), /const d = rowDownload\(it\.installed, it\.download\);/);
});

// ---- 5. Passwords below the fold on smooth-scrolling pages ----

test('5: the password check scrolls the field into view instantly, so CSS smooth scrolling cannot fail it', () => {
  const { __personaPickPasswordTarget: pick } = require('../src/main/browserEngine');
  const scrolls = [];
  let top = 900; // below a 600 px window
  const el = {
    type: 'password', disabled: false, readOnly: false, nodeType: 1, parentElement: null,
    closest: () => null,
    getBoundingClientRect: () => ({ top, bottom: top + 38, left: 100, right: 400, width: 300, height: 38 }),
    // Smooth scrolling (Bootstrap sets scroll-behavior: smooth on :root) moves the field only later.
    scrollIntoView: (opts) => { scrolls.push(opts); if (opts && opts.behavior === 'instant') top = 280; else setTimeout(() => { top = 280; }, 300); },
    checkVisibility: () => true
  };
  const saved = { window: global.window, document: global.document };
  global.window = { innerWidth: 1280, innerHeight: 600, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  global.document = { querySelectorAll: () => [el] };
  try {
    assert.equal(pick('[data-k="1"]', 'slot'), true);
    assert.equal(scrolls[0].behavior, 'instant');
    assert.equal(global.window.slot, el);
  } finally { global.window = saved.window; global.document = saved.document; }
});

// ---- 87. "Mark as used" in reach, and the Data Vault table at 1440 px ----

test('87: after a fill the autofill list opens again with "Mark as used", and the toast stays above it', () => {
  const widget = read('src', 'main', 'personaAutofill.js');
  assert.match(widget, /isOpen = false; panel\.hidden = true;\s*filling = true;/, 'still closed while typing');
  assert.match(widget, /if \(\(active \|\| selected\) && fab\.isConnected && !fab\.hidden\) \{\s*isOpen = true; panel\.hidden = false; renderList\(\); placeToast\(\);/);
  assert.match(widget, /footer\.hidden = !active && !selected;/, 'the footer (Mark as used, Release) shows for that identity');
  assert.match(widget, /function placeToast\(\) \{\s*var above = panel\.hidden \? 0 : \(panel\.offsetHeight \|\| 0\) \+ 8;\s*toastEl\.style\.bottom = \(60 \+ above\) \+ 'px';/);
  assert.match(extractFunction(widget, 'toast'), /placeToast\(\);/);
  const { buildAutofillBootstrap } = require('../src/main/personaAutofill');
  assert.ok(read('src', 'firefox-extension', 'sg-widget.js').includes(buildAutofillBootstrap()), 'sg-widget.js regenerated');
});

test('87: the Data Vault table fits a 1440 px window; Phone and Created show from 2xl', () => {
  const page = read('src', 'renderer', 'pages', 'PersonasPage.jsx');
  assert.match(page, /<table className="w-full min-w-\[900px\] border-collapse text-left text-sm">/);
  assert.doesNotMatch(page, /min-w-\[1200px\]/);
  assert.match(page, /<th className="px-3 py-4 hidden 2xl:table-cell">\{t\('table\.colPhone'\)\}<\/th>/);
  assert.match(page, /<th className="px-3 py-4 hidden 2xl:table-cell">\{t\('table\.colCreated'\)\}<\/th>/);
  assert.match(page, /whitespace-nowrap hidden 2xl:table-cell">\{p\.phone/);
  assert.match(page, /whitespace-nowrap hidden 2xl:table-cell">\{formatDateTime\(p\.createdAt\)\}/);
  assert.match(page, /<th className="px-3 py-4">\{t\('table\.colTimesUsed'\)\}<\/th>/);
});
