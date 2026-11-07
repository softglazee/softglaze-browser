'use strict';
// Live re-test for 1.0.22 (7 Nov 2026, system Chrome 156) found:
//   1. Tabs opened with Ctrl+click, middle click or Shift+click (new window) ran their first page
//      without the page script: deviceMemory 32 (the real value) while workers in the same tab said 8,
//      screen.availHeight unadjusted, CreepJS 0/25/0 instead of 33/19/20. A reload fixed it. Chrome
//      creates these tabs together with their first navigation and has loaded that page by the time the
//      auto-attach reaches the tab (its frame is already on the link's URL and its inline scripts have
//      run), so addScriptToEvaluateOnNewDocument only reached the second page. Holding the tab's own
//      page request until the tab is set up made the script run before the page's scripts (checked on
//      Chrome 156 outside the app: held 2-5 ms).
//   2. An AI page_screenshot with fullPage dropped the CSS screen (device-width/height went back to the
//      real monitor) until the next page.
//   3. profiles.create with startupUrls as a list failed with a database error.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../src/main/browserEngine');
const { PAGE_TOOLS } = require('../src/main/ai/pageTools');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('src/main/browserEngine.js');
const IPC = read('src/main/ipcHandlers.js');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  assert.ok(i >= 0, `marker not found: ${a}`);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j > i, `end marker not found: ${b}`);
  return s.slice(i, j);
};
const tick = () => new Promise((r) => setImmediate(r));

// A flat CDP session double: records sends, answers Target.getTargetInfo from a table.
function fakeSession({ targets = {}, failInfo = false } = {}) {
  const listeners = {};
  const log = [];
  return {
    log,
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { return Promise.all((listeners[evt] || []).map((fn) => fn(data))); },
    send(method, params) {
      log.push([method, params]);
      if (method === 'Target.getTargetInfo') {
        if (failInfo) return Promise.reject(new Error('boom'));
        const t = targets[params.targetId];
        return t ? Promise.resolve({ targetInfo: { targetId: params.targetId, type: t } }) : Promise.reject(new Error('No target with given id found'));
      }
      return Promise.resolve({});
    },
    methods() { return log.map((e) => e[0]); },
    continued() { return log.filter((e) => e[0] === 'Fetch.continueRequest').map((e) => e[1].requestId); }
  };
}

// ---- prepared tabs ----

test('prepared tabs: wait resolves when the tab is marked, or false after the time limit', async () => {
  const p = engine.createPreparedTargets();
  assert.equal(p.has('T1'), false);
  const waiting = p.wait('T1', 1000);
  p.mark('T1');
  assert.equal(await waiting, true);
  assert.equal(p.has('T1'), true);
  assert.equal(await p.wait('T1', 5), true, 'already marked: no wait');
  assert.equal(await p.wait('T2', 20), false, 'never marked: gives up');
  p.forget('T1');
  assert.equal(p.has('T1'), false);
  p.mark(null); p.forget(undefined); // ignored, never throws
});

// ---- the attach handler reports a tab once it is set up ----

function fakeConn() {
  const sessions = new Map();
  const order = [];
  const make = (id) => {
    const listeners = {};
    const s = {
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
      emit(evt, data) { return Promise.all((listeners[evt] || []).map((fn) => fn(data))); },
      send(method) { order.push(`${id}:${method}`); return Promise.resolve({}); }
    };
    sessions.set(id, s);
    return s;
  };
  return { conn: { session: (id) => sessions.get(id) || null }, make, order };
}

test('a tab is reported prepared after its setup and before it is resumed; frames and workers are not', async () => {
  const { conn, make, order } = fakeConn();
  const root = make('root');
  const marked = [];
  engine.attachFingerprintToNewTargets(root, conn, {
    fpConfig: { cores: 6 }, fpLate: {}, injectSource: 'S',
    onPrepared: (id) => { marked.push(id); order.push(`prepared:${id}`); }
  });
  for (const [id, type, url] of [['tab', 'page', ''], ['frame', 'iframe', ''], ['w', 'worker', ''], ['dev', 'page', 'devtools://devtools/x']]) {
    make(id);
    await root.emit('Target.attachedToTarget', { sessionId: id, targetInfo: { type, targetId: `T-${id}`, url }, waitingForDebugger: true });
  }
  assert.deepEqual(marked, ['T-tab', 'T-dev'], 'page targets only (a DevTools window is a page too)');
  const i = (s) => order.indexOf(s);
  assert.ok(i('tab:Page.addScriptToEvaluateOnNewDocument') < i('prepared:T-tab'), 'script registered first');
  assert.ok(i('prepared:T-tab') < i('tab:Runtime.runIfWaitingForDebugger'), 'then reported, then resumed');
});

test('a failing onPrepared callback never keeps a tab paused', async () => {
  const { conn, make, order } = fakeConn();
  const root = make('root');
  engine.attachFingerprintToNewTargets(root, conn, { fpConfig: {}, fpLate: {}, onPrepared: () => { throw new Error('x'); } });
  make('tab');
  await root.emit('Target.attachedToTarget', { sessionId: 'tab', targetInfo: { type: 'page', targetId: 'T-tab', url: '' }, waitingForDebugger: true });
  assert.ok(order.includes('tab:Runtime.runIfWaitingForDebugger'));
});

// ---- the hold on a new tab's first page ----

test('the hold intercepts page loads only, before the request is sent', async () => {
  const s = fakeSession();
  const hold = engine.holdNewTabDocuments(s, engine.createPreparedTargets());
  await hold.enable();
  assert.deepEqual(s.log[0], ['Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] }]);
  assert.equal(s.log.length, 1, 'no auth handling here: proxy auth stays with each tab');
});

test('a Ctrl+click tab: its first page waits until the tab is set up, then continues', async () => {
  const s = fakeSession({ targets: { NEWTAB: 'page' } });
  const prepared = engine.createPreparedTargets();
  const held = [];
  engine.holdNewTabDocuments(s, prepared, { waitMs: 2000, onHeld: (h) => held.push(h) });
  const done = s.emit('Fetch.requestPaused', { requestId: 'r1', frameId: 'NEWTAB', resourceType: 'Document', request: { url: 'https://site.test/next' } });
  await tick(); await tick();
  assert.deepEqual(s.continued(), [], 'held while the tab is not set up');
  prepared.mark('NEWTAB');
  await done;
  assert.deepEqual(s.continued(), ['r1']);
  assert.equal(held.length, 1);
  assert.equal(held[0].ready, true);
  assert.equal(held[0].url, 'https://site.test/next');
});

test('prepared tabs and frames inside tabs are never held', async () => {
  const s = fakeSession({ targets: { OOPIF: 'iframe' } });
  const prepared = engine.createPreparedTargets();
  prepared.mark('MAIN');
  engine.holdNewTabDocuments(s, prepared, { waitMs: 5000 });
  await s.emit('Fetch.requestPaused', { requestId: 'a', frameId: 'MAIN', request: { url: 'https://x.test/' } });
  assert.equal(s.methods().includes('Target.getTargetInfo'), false, 'a prepared tab needs no lookup');
  await s.emit('Fetch.requestPaused', { requestId: 'b', frameId: 'SAME-PROCESS-FRAME', request: { url: 'https://x.test/f' } });
  await s.emit('Fetch.requestPaused', { requestId: 'c', frameId: 'OOPIF', request: { url: 'https://y.test/f' } });
  const lookups = s.methods().filter((m) => m === 'Target.getTargetInfo').length;
  await s.emit('Fetch.requestPaused', { requestId: 'd', frameId: 'OOPIF', request: { url: 'https://y.test/g' } });
  assert.equal(s.methods().filter((m) => m === 'Target.getTargetInfo').length, lookups, 'a known frame target is not looked up again');
  assert.deepEqual(s.continued(), ['a', 'b', 'c', 'd']);
});

test('a tab that is never set up still loads after the time limit; errors never block a page', async () => {
  const s = fakeSession({ targets: { LOST: 'page' } });
  const held = [];
  engine.holdNewTabDocuments(s, engine.createPreparedTargets(), { waitMs: 30, onHeld: (h) => { held.push(h); throw new Error('logging failed'); } });
  const t0 = Date.now();
  await s.emit('Fetch.requestPaused', { requestId: 'r', frameId: 'LOST', request: { url: 'https://z.test/' } });
  assert.ok(Date.now() - t0 >= 25);
  assert.deepEqual(s.continued(), ['r']);
  assert.equal(held[0].ready, false);

  const broken = fakeSession({ failInfo: true });
  engine.holdNewTabDocuments(broken, engine.createPreparedTargets(), { waitMs: 5000 });
  await broken.emit('Fetch.requestPaused', { requestId: 'q', frameId: 'X', request: { url: 'https://z.test/' } });
  assert.deepEqual(broken.continued(), ['q'], 'a failed lookup lets the page load at once');
});

test('the launch marks tabs from the auto-attach and holds new tabs only once auto-attach is on', () => {
  const block = between(SRC, '// ---- Cross-channel fingerprint injection ----', '// Track PID');
  assert.match(block, /const preparedTabs = createPreparedTargets\(\);/);
  assert.match(block, /onPrepared: \(targetId\) => preparedTabs\.mark\(targetId\)/);
  assert.match(block, /Target\.detachedFromTarget[^\n]*preparedTabs\.forget/);
  const autoAttach = block.indexOf("rootCdp.send('Target.setAutoAttach'");
  const enable = block.indexOf('await hold.enable();');
  assert.ok(autoAttach > 0 && enable > autoAttach, 'the hold starts after the auto-attach that releases it');
  // Its own try: a Chrome without browser-level Fetch keeps the auto-attach (and dedicated workers via CDP).
  const inner = between(block, 'cdpAutoAttach = true;', '} catch (e) {\n    // Fall back');
  assert.match(inner, /try \{[\s\S]*await hold\.enable\(\);[\s\S]*\} catch \(e\) \{/);
});

// ---- full-page screenshot keeps the profile's screen ----

const SCREEN = { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: 1280, screenHeight: 1024 };

test('reapplyScreenMetrics sends the screen on the tab\'s own puppeteer session, never a temporary one', async () => {
  const sent = [];
  const client = { send: async (m, p) => { sent.push([m, p]); return {}; } };
  const page = { _client: () => client, createCDPSession: async () => { throw new Error('must not open a temporary session'); } };
  assert.equal(await engine.reapplyScreenMetrics(page, SCREEN), true);
  assert.deepEqual(sent, [['Emulation.setDeviceMetricsOverride', SCREEN]]);
  assert.equal(await engine.reapplyScreenMetrics(page, null), false, '"Real" resolution: nothing to restore');
  assert.equal(await engine.reapplyScreenMetrics({}, SCREEN), false, 'no puppeteer session: skipped');
  const failing = { _client: () => ({ send: async () => { throw new Error('closed'); } }) };
  assert.equal(await engine.reapplyScreenMetrics(failing, SCREEN), false, 'never throws');
});

function screenshotTool(page, restoreCalls, extraDeps = {}) {
  const tool = PAGE_TOOLS.find((t) => t.name === 'page_screenshot');
  const ctx = {
    assertProfiles: async () => {},
    assertDomainAllowed: () => {},
    userError: (m) => new Error(m),
    deps: {
      isFirefoxSession: () => false,
      getAutomationPage: async () => ({ page, screenMetrics: SCREEN }),
      reapplyScreenMetrics: async (p, m) => { restoreCalls.push([p === page, m]); return true; },
      ...extraDeps
    }
  };
  return (args) => tool.handler({ profileId: 1, ...args }, ctx);
}
const fakePage = (screenshot) => ({ url: () => 'https://site.test/', title: async () => 'Site', isClosed: () => false, screenshot });

test('page_screenshot fullPage puts the profile\'s screen back right after the capture', async () => {
  const order = [];
  const restore = [];
  const page = fakePage(async (o) => { order.push(`shot:${o.fullPage}`); return 'aGVsbG8='; });
  const run = screenshotTool(page, restore);
  await run({ fullPage: true });
  assert.deepEqual(restore, [[true, SCREEN]]);
  assert.deepEqual(order, ['shot:true']);
  await run({});
  assert.equal(restore.length, 1, 'a viewport screenshot leaves the metrics alone');
});

test('page_screenshot fullPage restores the screen also when the capture fails', async () => {
  const restore = [];
  const page = fakePage(async () => { throw new Error('Target closed'); });
  await assert.rejects(screenshotTool(page, restore)({ fullPage: true }), /Target closed/);
  assert.deepEqual(restore, [[true, SCREEN]]);
});

test('page_screenshot still works when the engine has no restore helper (older deps)', async () => {
  const page = fakePage(async () => 'aGVsbG8=');
  const tool = PAGE_TOOLS.find((t) => t.name === 'page_screenshot');
  const ctx = { assertProfiles: async () => {}, assertDomainAllowed: () => {}, userError: (m) => new Error(m), deps: { isFirefoxSession: () => false, getAutomationPage: async () => ({ page }) } };
  const r = await tool.handler({ profileId: 1, fullPage: true }, ctx);
  assert.equal(r.content[0].type, 'image');
});

test('each session keeps its screen override for the page tools', () => {
  assert.match(SRC, /screenMetrics: fpLate\.deviceMetrics \|\| null,/);
  const getPage = between(SRC, 'async function getAutomationPage(', '\n}\n');
  assert.match(getPage, /screenMetrics: session\.screenMetrics \|\| null/);
  assert.match(IPC, /getAutomationPage,\n\s+reapplyScreenMetrics\n\s+\};/, 'the AI tools receive the helper');
});

// ---- startupUrls as a list ----

test('create/update store a startupUrls list as newline-joined text; typed text is kept as is', () => {
  const fn = between(IPC, 'function extractFingerprintData(input) {', '\n}\n');
  assert.match(fn, /startupUrls: Array\.isArray\(input\.startupUrls\) \? normalizeStartupUrls\(input\.startupUrls\) : input\.startupUrls,/);
  // normalizeStartupUrls on a list: each entry whole, a scheme added where missing, null for none.
  const src = between(IPC, 'function normalizeStartupUrls(value) {', '\n}\n') + '\n}';
  const normalizeStartupUrls = new Function(`${src}; return normalizeStartupUrls;`)();
  assert.equal(normalizeStartupUrls(['https://bot.sannysoft.com/', 'example.com/a?x=1,2']), 'https://bot.sannysoft.com/\nhttps://example.com/a?x=1,2');
  assert.equal(normalizeStartupUrls([]), null);
  assert.equal(typeof normalizeStartupUrls(['a.test']), 'string', 'the database column is text');
});
