'use strict';
// Regression tests for audit E1 / E2 / E3 (7 Oct): the Data-Vault autofill must not
// be reachable or visible from a visited page's own JavaScript.
//
//   E1  the persona list / fill plan used to be exposeFunction bindings in the page
//       MAIN world, so any site could list personas and aim a password fill at a
//       hidden #trap input. They now live in a private CDP isolated world, and the
//       password path re-validates its target there before every keystroke.
//   E2  window.__sgBridge / __sgPersona* / __sgzOpenTab / a random-id host div were
//       detection tells. Nothing is added to the main world any more; the start-page
//       bridge exists on the file:// start page only.
//   E3  the Firefox loopback bridge used a static token shipped in the .xpi, ran from
//       boot, and trusted a caller-chosen url. The token is now per run (managed
//       storage), the server runs only with a Firefox autofill session, and the
//       origin comes from sender.url.
//
// The isolated-world path was also exercised end to end in real Chromium (stock
// puppeteer, rebrowser enableDisable, fingerprint-chromium 148) with a signup, a
// honeypot checkout, an aria-labelled SPA, a multi-step wizard and a hostile page
// that re-tags a hidden password trap; those runs need a browser, so they live in
// the fix-sprint harness rather than here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// --- E1/E2: the isolated-world client -----------------------------------------------

const { isolatedClientScript, bridgeClientScript } = require('../src/main/pageBridge');

const CFG = {
  binding: 'b0123456789abcdef01',
  resolver: 'r0123456789abcdef01',
  guard: 'g0123456789abcdef01',
  key: 'k'.repeat(32),
  endpoint: 'https://sg-bridge.invalid/' + 'e'.repeat(32)
};

function runIsolated({ binding } = {}) {
  const calls = { fetch: [] };
  const win = {};
  const sandbox = {
    window: win, Promise, Object, Array, Error, JSON, String, setTimeout, clearTimeout, encodeURIComponent,
    fetch: (url, opts) => {
      calls.fetch.push({ url, opts });
      return Promise.resolve({ json: () => Promise.resolve({ result: 'via-fetch' }) });
    }
  };
  if (binding) win[CFG.binding] = (payload) => binding(payload, win);
  vm.createContext(sandbox);
  let rpc = null;
  sandbox.__capture = (fn) => { rpc = fn; };
  vm.runInContext(`(${isolatedClientScript.toString()})(${JSON.stringify(CFG)}, function (r) { __capture(r); });`, sandbox);
  return { win, calls, rpc: (...a) => rpc(...a) };
}

test('E1: with no world binding the rpc falls back to fetch AND carries the body secret', async () => {
  const { rpc, calls } = runIsolated();
  const out = await rpc('__sgPersonaList');
  assert.equal(out, 'via-fetch');
  assert.equal(calls.fetch.length, 1);
  assert.ok(calls.fetch[0].url.startsWith(CFG.endpoint + '/'));
  const body = JSON.parse(calls.fetch[0].opts.body);
  assert.equal(body.key, CFG.key, 'the URL can leak via Resource Timing, so the secret must ride in the body');
  assert.equal(calls.fetch[0].opts.headers, undefined, 'stay a CORS simple request');
});

test('E1: a working world binding is used, every payload carries the secret, no fetch happens', async () => {
  const seen = [];
  const { rpc, calls } = runIsolated({
    binding: (payload, win) => {
      const m = JSON.parse(payload);
      seen.push(m);
      setTimeout(() => win[CFG.resolver](m.id, true, 'pong:' + m.name), 0);
    }
  });
  assert.equal(await rpc('__sgPersonaFillPlan', [{ sel: '#a' }], { gesture: true }), 'pong:__sgPersonaFillPlan');
  assert.equal(calls.fetch.length, 0);
  assert.ok(seen.length >= 2, 'a transport probe, then the call');
  for (const m of seen) assert.equal(m.key, CFG.key);
  assert.deepEqual(seen[seen.length - 1].args.length, 2);
});

test('E1: a binding error comes back as a rejection, not a silent success', async () => {
  const { rpc } = runIsolated({
    binding: (payload, win) => {
      const m = JSON.parse(payload);
      setTimeout(() => win[CFG.resolver](m.id, m.name === '__ping', m.name === '__ping' ? true : 'vault locked'), 0);
    }
  });
  await assert.rejects(() => rpc('__sgPersonaList'), /vault locked/);
});

test('E2: the isolated client defines nothing beyond its own random-named slots', () => {
  const { win } = runIsolated();
  const keys = Object.keys(win).sort();
  assert.deepEqual(keys, [CFG.guard, CFG.resolver].sort());
  assert.ok(keys.every((k) => !/sg/i.test(k)), 'no SoftGlaze-looking names');
});

test('E2: the start-page bridge helper is installed on file:// only', () => {
  const run = (protocol) => {
    const win = {};
    const sandbox = { window: win, location: { protocol }, Object, Array, Promise, JSON, encodeURIComponent, fetch: () => Promise.resolve() };
    vm.createContext(sandbox);
    vm.runInContext(`(${bridgeClientScript.toString()})("https://sg-bridge.invalid/x", true);`, sandbox);
    return typeof win.__sgBridge;
  };
  assert.equal(run('file:'), 'function');
  assert.equal(run('https:'), 'undefined', 'a visited site must never see __sgBridge on the first tab');
});

test('E1/E2: the Chromium autofill attach adds nothing to the main world', () => {
  const src = SRC('main/browserEngine.js');
  const attach = extractFunction(src, 'attachPersonaAutofill');
  assert.doesNotMatch(attach, /exposeFunction/, 'no main-world bindings for the vault');
  assert.doesNotMatch(attach, /attachPageBridge/, 'no main-world __sgBridge for the vault');
  assert.doesNotMatch(attach, /evaluateOnNewDocument/, 'the widget must not run in the main world');
  assert.match(attach, /attachIsolatedWorld\(targetPage, personaHandlers, PERSONA_AUTOFILL_RUN_SOURCE\)/);
  // The start page: no exposeFunction binding, bridge scoped to file://.
  assert.doesNotMatch(src, /exposeFunction\('__sgzOpenTab'/);
  assert.match(src, /attachPageBridge\(page, \{ __sgzOpenTab: hOpenTab \}, \{ fileOnly: true \}\)/);
});

test('E1: the password gate needs a widget gesture plus TRANSIENT activation, read in the isolated world', () => {
  const src = SRC('main/browserEngine.js');
  const attach = extractFunction(src, 'attachPersonaAutofill');
  assert.match(attach, /meta && meta\.gesture === true && world/);
  assert.match(attach, /world\.evaluate\(personaActivationProbe\)/);
  assert.doesNotMatch(attach, /userActivation.hasBeenActive/, 'sticky activation (any earlier click) must not unlock passwords');
  assert.match(extractFunction(src, 'personaActivationProbe'), /userActivation\.isActive/);
  // Re-validated before typing and focus re-checked before EVERY password keystroke.
  assert.match(attach, /world\.evaluate\(personaPickPasswordTarget, sel, pwSlot\)/);
  assert.match(attach, /if \(isSecret && !\(await onTarget\(\)\)\) \{ aborted = true; break; \}/);
  // The widget only sets gesture from a trusted row click.
  const widget = SRC('main/personaAutofill.js');
  assert.match(widget, /if \(!e\.isTrusted\) return;[^\n]*\n(?:[^\n]*\n){0,12}?\s*fillWith\(p, \{ gesture: true \}\)/);
  assert.match(widget, /gesture: !opts\.onlyEmpty && opts\.gesture === true/);
  assert.doesNotMatch(widget, /__sgPersonaBeginFill/);
});

// personaPickPasswordTarget runs in the isolated world; drive it against stub DOM.
const { __personaPickPasswordTarget: pick } = require('../src/main/browserEngine');

function pickWith(fields, sel = '[data-k1="0"]') {
  const styles = new Map();
  const mk = (o) => {
    const el = {
      nodeType: 1, type: 'password', disabled: false, readOnly: false, parentElement: null,
      _rect: { top: 100, left: 10, bottom: 130, right: 270, width: 260, height: 30 },
      getBoundingClientRect() { return this._rect; },
      closest() { return o.ariaHidden ? this : null; },
      scrollIntoView() { if (o.scrollTo) this._rect = o.scrollTo; },
      ...o
    };
    styles.set(el, { display: 'block', visibility: 'visible', opacity: '1', ...(o.style || {}) });
    return el;
  };
  const els = fields.map(mk);
  const ctx = {
    innerWidth: 1280, innerHeight: 800,
    getComputedStyle: (n) => styles.get(n) || { display: 'block', visibility: 'visible', opacity: '1' },
    document: { querySelectorAll: () => els }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const fn = vm.runInContext(`(${pick.toString()})`, ctx);
  const ok = fn(sel, 'slot');
  return { ok, stashed: ctx.slot };
}

test('E1: a real visible password field passes and is stashed for the focus check', () => {
  const r = pickWith([{}]);
  assert.equal(r.ok, true);
  assert.ok(r.stashed);
});

test('E1: hidden, off-screen, transparent, tiny, aria-hidden or duplicated targets are refused', () => {
  const off = { top: 100, left: -9999, bottom: 130, right: -9739, width: 260, height: 30 };
  assert.equal(pickWith([{ _rect: off }]).ok, false, 'parked off-screen');
  assert.equal(pickWith([{ style: { opacity: '0' } }]).ok, false, 'opacity 0');
  assert.equal(pickWith([{ style: { visibility: 'hidden' } }]).ok, false, 'visibility hidden');
  assert.equal(pickWith([{ _rect: { top: 100, left: 10, bottom: 101, right: 11, width: 1, height: 1 } }]).ok, false, '< 2px');
  assert.equal(pickWith([{ ariaHidden: true }]).ok, false, 'aria-hidden');
  assert.equal(pickWith([{ type: 'text' }]).ok, false, 'not a password input');
  assert.equal(pickWith([{}, {}]).ok, false, 'the page cloned our tag onto a second node');
  assert.equal(pickWith([]).ok, false, 'tag removed');
});

test('E1: a real field below the fold is scrolled into view, then accepted', () => {
  const below = { top: 1500, left: 10, bottom: 1530, right: 270, width: 260, height: 30 };
  const r = pickWith([{ _rect: below, scrollTo: { top: 380, left: 10, bottom: 410, right: 270, width: 260, height: 30 } }]);
  assert.equal(r.ok, true);
});

test('E2: the widget host has no id and mounts only while the button is showing', () => {
  const src = SRC('main/personaAutofill.js');
  assert.doesNotMatch(src, /host\.id\s*=/);
  assert.match(src, /if \(show\) mount\(\); else if \(toastEl\.hidden\) unmount\(\);/);
  assert.doesNotMatch(src, /data-sgfill/, 'the fill tag is a per-document random attribute now');
  assert.match(src, /var FILL_ATTR = 'data-' \+ 'k' \+ Math\.random\(\)/);
});

test('E2: the run source is a bare function expression; the Firefox build still self-runs', () => {
  const { buildAutofillRunSource, buildAutofillBootstrap } = require('../src/main/personaAutofill');
  const run = buildAutofillRunSource();
  assert.ok(/^\(function personaAutofillMain\(sgRpc\)/.test(run));
  assert.ok(run.endsWith(')'));
  assert.doesNotThrow(() => new Function(`return ${run};`));
  assert.ok(buildAutofillBootstrap().endsWith(')();'));
  assert.equal(SRC('firefox-extension/sg-widget.js').includes('function personaAutofillMain(sgRpc)'), true,
    'sg-widget.js must be regenerated from personaAutofill.js');
});

// --- E3: Firefox loopback bridge ----------------------------------------------------

const bridge = require('../src/main/autofillBridge');

test('E3: the bridge token is random per run, not the static string shipped in the .xpi', () => {
  assert.notEqual(bridge.TOKEN, 'sg-ff-autofill-9f3c1a7b2e6d4058');
  assert.match(bridge.TOKEN, /^[0-9a-f]{48}$/);
  assert.equal(bridge.getToken(), bridge.TOKEN);
  for (const rel of ['main/autofillBridge.js', 'firefox-extension/sg-background.js']) {
    assert.doesNotMatch(SRC(rel), /sg-ff-autofill-9f3c1a7b2e6d4058/, rel);
  }
});

test('E3: the bridge is not started at boot; it listens only between acquire and release', async () => {
  assert.doesNotMatch(SRC('main/ipcHandlers.js'), /autofillBridge\.start\(\)/);
  assert.equal(bridge.getStatus().running, false);
  await bridge.acquire();
  await bridge.acquire();
  assert.equal(bridge.getStatus().running, true);
  await bridge.release();
  assert.equal(bridge.getStatus().running, true, 'still one Firefox autofill session');
  await bridge.release();
  assert.equal(bridge.getStatus().running, false, 'closes with the last session');
});

test('E3: vault calls are refused (423) while the app is locked or signed out', async () => {
  let open = false;
  let listed = 0;
  bridge.configure({ listForUrl: async () => { listed++; return { personas: [{ id: 'p1' }] }; }, isAvailable: async () => open });
  const st = await bridge.acquire();
  const get = (p) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: st.port, method: 'GET', path: p, headers: { 'X-SG-Autofill-Token': bridge.TOKEN } },
      (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
  try {
    const locked = await get('/sg-autofill/list?url=' + encodeURIComponent('https://a.test/'));
    assert.equal(locked.status, 423);
    assert.equal(listed, 0, 'the vault must not even be queried');
    open = true;
    const ok = await get('/sg-autofill/list?url=' + encodeURIComponent('https://a.test/'));
    assert.equal(ok.status, 200);
    assert.equal(listed, 1);
  } finally {
    bridge.configure({ isAvailable: async () => true });
    await bridge.release();
  }
});

test('E3: the Firefox background takes the token from managed storage and the origin from sender.url', async () => {
  const manifest = JSON.parse(SRC('firefox-extension/manifest.json'));
  assert.ok(manifest.permissions.includes('storage'), 'storage.managed needs the storage permission');

  let listener = null;
  const fetched = [];
  const sandbox = {
    Promise, Object, Array, JSON, String, encodeURIComponent,
    browser: {
      runtime: { id: 'autofill@softglaze.app', onMessage: { addListener: (fn) => { listener = fn; } } },
      storage: { managed: { get: async () => ({ token: 'RUN-TOKEN' }) } }
    },
    fetch: async (url, init) => {
      fetched.push({ url, token: init && init.headers && init.headers['X-SG-Autofill-Token'] });
      if (/\/ping$/.test(url)) return { ok: true, json: async () => ({ service: 'softglaze-autofill' }) };
      return { ok: true, json: async () => ({ ok: true, personas: [{ id: 'p1' }] }) };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC('firefox-extension/sg-background.js'), sandbox);
  assert.equal(typeof listener, 'function');

  const sender = { id: 'autofill@softglaze.app', frameId: 0, url: 'https://real.example/signup' };
  const out = await listener({ type: 'list', url: 'https://victim.example/' }, sender);
  assert.equal(out.length, 1);
  const listCall = fetched.find((f) => /\/sg-autofill\/list/.test(f.url));
  assert.ok(listCall.url.includes(encodeURIComponent('https://real.example/signup')), 'origin from sender.url');
  assert.ok(!listCall.url.includes('victim'), 'the message body url is ignored');
  assert.ok(fetched.every((f) => f.token === 'RUN-TOKEN'));

  // Subframes, other extensions and non-http senders get nothing.
  assert.equal(listener({ type: 'list' }, { ...sender, frameId: 3 }), undefined);
  assert.equal(listener({ type: 'list' }, { ...sender, id: 'other@ext' }), undefined);
  assert.equal(listener({ type: 'list' }, { ...sender, url: 'file:///C:/x.html' }), undefined);
});

test('E3: firefoxEngine hands the token over through a managed-storage manifest for our id', () => {
  const ff = require('../src/main/firefoxEngine');
  const m = JSON.parse(ff.buildManagedStorageManifest('abc123'));
  assert.equal(m.name, 'autofill@softglaze.app');
  assert.equal(m.type, 'storage');
  assert.deepEqual(m.data, { token: 'abc123' });
  assert.ok(ff.managedStoragePath().includes('autofill@softglaze.app'));
  const src = SRC('main/firefoxEngine.js');
  assert.match(src, /await writeAutofillManagedToken\(autofillBridge\.getToken\(\)\);\s*await autofillBridge\.acquire\(\);/);
  assert.match(src, /session\.releaseAutofill\(\);/);
});
