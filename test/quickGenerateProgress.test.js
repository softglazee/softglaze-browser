'use strict';
// Quick generate looked stuck: the modal sat at "Creating profiles 0/N" for minutes. Every pool proxy
// not verified in the last 30 minutes was live-checked first, in lock-step batches of 8 (each batch
// waited for its slowest proxy, up to ~30 s), with no progress sent and Cancel disabled.
// Now: a worker pool with a shorter per-proxy budget, progress frames for the check and the create
// phases, a clear "N requested, only M working proxies" message, and a Cancel that keeps what exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const gate = require('../src/main/proxyGate');
const proxyScope = require('../src/main/proxyScope');
const loadView = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'quickGenProgress.mjs')).href);

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

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const flush = () => new Promise((r) => setImmediate(r));
// Objects made inside a vm context have that context's prototypes; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- the worker pool -------------------------------------------------------------------

test('the next proxy starts as soon as any check finishes (no lock-step batches)', async () => {
  const pending = new Map();
  const started = [];
  const check = (p) => { started.push(p); const d = deferred(); pending.set(p, d); return d.promise; };
  const run = gate.collectWorkingProxies({ candidates: ['slow', 'a', 'b', 'c'], limit: 10, check, concurrency: 2 });
  await flush();
  assert.deepEqual(started, ['slow', 'a']);
  pending.get('a').resolve(true);
  await flush();
  assert.deepEqual(started, ['slow', 'a', 'b'], 'b starts while the slow proxy is still being checked');
  pending.get('b').resolve(false);
  await flush();
  assert.deepEqual(started, ['slow', 'a', 'b', 'c']);
  pending.get('c').resolve(true);
  pending.get('slow').resolve(true);
  const res = await run;
  assert.deepEqual(res.working, ['a', 'c', 'slow']);
  assert.equal(res.checked, 4);
  assert.equal(res.failed, 1);
  assert.equal(res.cancelled, false);
});

test('the scan stops once enough proxies work, without waiting for slow checks still running', async () => {
  const pending = new Map();
  const check = (p) => { const d = deferred(); pending.set(p, d); return d.promise; };
  const run = gate.collectWorkingProxies({ candidates: ['slow', 'fast', 'never'], limit: 1, check, concurrency: 2 });
  await flush();
  pending.get('fast').resolve(true);
  const res = await run; // 'slow' is still pending
  assert.deepEqual(res.working, ['fast']);
  assert.ok(!pending.has('never'), 'no new check starts after the limit is met');
});

test('Cancel ends the scan at once; late answers are ignored', async () => {
  const pending = new Map();
  const check = (p) => { const d = deferred(); pending.set(p, d); return d.promise; };
  const controller = new AbortController();
  const run = gate.collectWorkingProxies({ candidates: ['a', 'b', 'c'], limit: 3, check, concurrency: 2, signal: controller.signal });
  await flush();
  controller.abort();
  const res = await run;
  assert.equal(res.cancelled, true);
  assert.deepEqual(res.working, []);
  pending.get('a').resolve(true);
  await flush();
  assert.deepEqual(res.working, [], 'an answer after the cancel changes nothing');
  assert.ok(!pending.has('c'), 'nothing new starts after the cancel');
});

test('progress is reported after every finished check; a throwing check counts as failed', async () => {
  const frames = [];
  const check = async (p) => { if (p === 'boom') throw new Error('x'); return p !== 'dead'; };
  const res = await gate.collectWorkingProxies({ candidates: ['ok1', 'dead', 'boom', 'ok2'], limit: 9, check, concurrency: 3, onProgress: (f) => frames.push(f) });
  assert.equal(frames.length, 4);
  assert.deepEqual(frames[frames.length - 1], { checked: 4, total: 4, working: 2, failed: 2 });
  assert.deepEqual(res.working.sort(), ['ok1', 'ok2']);
});

test('recently verified proxies go first and need no check; the gate budget is shorter than the full check', () => {
  const now = Date.now();
  const fresh = { id: 1, lastStatus: 'ok', lastCheckedAt: new Date(now - 60_000).toISOString() };
  const old = { id: 2, lastStatus: 'ok', lastCheckedAt: new Date(now - gate.FRESH_MS - 1).toISOString() };
  const failed = { id: 3, lastStatus: 'fail', lastCheckedAt: new Date(now).toISOString() };
  const never = { id: 4, lastStatus: null, lastCheckedAt: null };
  assert.deepEqual(gate.orderForCheck([old, failed, fresh, never], now).map((p) => p.id), [1, 2, 3, 4]);
  assert.equal(gate.isFreshlyVerified(fresh, now), true);
  assert.equal(gate.isFreshlyVerified(old, now), false);
  assert.equal(gate.isFreshlyVerified(failed, now), false);
  const t = gate.QUICK_CHECK_TIMEOUTS;
  assert.ok(t.timeoutMs < 15000 && t.fallbackTimeoutMs < 15000, 'each stage is shorter than the 15 s full check');
  assert.ok(t.timeoutMs + t.fallbackTimeoutMs <= 15000, 'worst case per proxy is at most half the old ~30 s');
  assert.ok(gate.QUICK_CHECK_CONCURRENCY >= 8);
  assert.equal(gate.isGateTimeout({ success: false, error: 'Proxy connection timed out.' }), true);
  assert.equal(gate.isGateTimeout({ success: false, error: 'HTTP 407' }), false);
  assert.equal(gate.isGateTimeout({ success: true }), false);
});

test('progress frames are throttled except forced ones', () => {
  const sent = [];
  let clock = 1000;
  const emit = gate.createThrottledEmitter((f) => sent.push(f), 100, () => clock);
  emit({ n: 1 }); clock += 10; emit({ n: 2 }); clock += 10; emit({ n: 3 }, true); clock += 150; emit({ n: 4 });
  assert.deepEqual(sent.map((f) => f.n), [1, 3, 4]);
  const boom = gate.createThrottledEmitter(() => { throw new Error('window gone'); });
  assert.doesNotThrow(() => boom({}, true));
});

// ---- batchGenerateProfiles, run for real against stubs --------------------------------------

function loadBatchGenerate(stubs) {
  const chromium = /const CHROMIUM_PROXY_TYPES = [^\n]+\n/.exec(IPC);
  assert.ok(chromium, 'CHROMIUM_PROXY_TYPES must exist');
  const ctx = {
    proxyGate: gate,
    proxyScope,
    requireObject: (v) => { if (!v || typeof v !== 'object') throw new TypeError('payload'); return v; },
    requirePermission: async () => {},
    optionalString: (v) => { if (v == null) return null; const s = String(v).trim(); return s || null; },
    parseId: (v) => Number(v),
    normCountryCode: (v) => (v ? String(v).toUpperCase() : null),
    scopedProxyWhere: async (w) => w,
    shuffleInPlace: (a) => a,
    normalizeStartupUrls: () => '',
    CHROME_VERSIONS: ['130', '131'],
    generateFingerprint: () => ({ userAgent: 'UA' }),
    fingerprintSignature: () => String(Math.random()),
    persistProxyHealth: async () => {},
    ...stubs
  };
  vm.createContext(ctx);
  vm.runInContext(`${chromium[0]}${extractFunction(IPC, 'batchGenerateProfiles')}\nthis.run = batchGenerateProfiles;`, ctx);
  return ctx.run;
}

// Pulls the `type` constraint out of a nested Prisma where.
function typeRule(where) {
  if (!where || typeof where !== 'object') return null;
  if (where.type !== undefined) return where.type;
  for (const part of where.AND || []) { const r = typeRule(part); if (r) return r; }
  return null;
}
function fakeDb(pool, log) {
  const matches = (p, where) => {
    const rule = typeRule(where);
    if (!rule) return true;
    if (typeof rule === 'string') return p.type === rule;
    if (rule.in) return rule.in.includes(p.type);
    return true;
  };
  return {
    proxy: {
      count: async ({ where }) => pool.filter((p) => matches(p, where)).length,
      findMany: async ({ where }) => { log.findWhere = where; return pool.filter((p) => matches(p, where)); }
    },
    group: {
      create: async ({ data }) => { log.groupsCreated.push(data.name); return { id: 77 }; },
      delete: async ({ where }) => { log.groupsDeleted.push(where.id); }
    }
  };
}
const stale = (id, type = 'HTTP') => ({ id, type, host: `10.0.0.${id}`, port: 8000 + id, username: null, password: null, lastStatus: null, lastCheckedAt: null });
const fresh = (id, type = 'HTTP') => ({ ...stale(id, type), lastStatus: 'ok', lastCheckedAt: new Date().toISOString() });

test('fewer working proxies than requested: the result says "N requested, only M working proxies"', async () => {
  const log = { groupsCreated: [], groupsDeleted: [] };
  const pool = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => stale(i));
  const working = new Set([2, 5, 7]);
  const checkOpts = [];
  const created = [];
  const frames = [];
  const run = loadBatchGenerate({
    getPrisma: () => fakeDb(pool, log),
    testProxyConnectivity: async (p, opts) => { checkOpts.push(opts); return { success: working.has(Number(p.host.split('.').pop())) }; },
    createProfile: async (payload) => { created.push(payload); return { id: created.length, title: payload.title }; }
  });
  const res = await run({ count: 5, proxyMode: 'unique', prefix: 'P' }, { progress: (f) => frames.push(f) });
  assert.equal(res.createdCount, 3);
  assert.equal(res.proxyLimited, true);
  assert.equal(res.availableProxies, 3);
  assert.equal(res.proxyChecked, 8);
  assert.match(res.message, /^5 requested, only 3 working proxies: created 3 profiles\. 5 of the 8 proxies checked did not work and were skipped\. Add 2 more working proxies to create the rest\.$/);
  assert.ok(checkOpts.every((o) => o === gate.QUICK_CHECK_TIMEOUTS), 'the gate passes its shorter budget');
  assert.deepEqual(created.map((c) => c.proxyId).sort(), [2, 5, 7]);

  const phases = frames.map((f) => f.phase);
  assert.equal(phases[0], 'check', 'progress starts with the check phase');
  assert.ok(phases.includes('create'));
  assert.equal(phases[phases.length - 1], 'done');
  const lastCheck = frames.filter((f) => f.phase === 'check').pop();
  assert.deepEqual({ checked: lastCheck.checked, total: lastCheck.total, working: lastCheck.working }, { checked: 8, total: 8, working: 3 });
  const firstCreate = frames.find((f) => f.phase === 'create');
  assert.deepEqual({ toCreate: firstCreate.toCreate, requested: firstCreate.requested }, { toCreate: 3, requested: 5 }, 'the shortfall is known before profiles are made');
  const lastCreate = frames.filter((f) => f.phase === 'create').pop();
  assert.equal(lastCreate.done, 3);
});

test('Cancel during creation stops before the next profile and keeps the ones already made', async () => {
  const log = { groupsCreated: [], groupsDeleted: [] };
  const pool = [1, 2, 3, 4, 5].map((i) => fresh(i));
  const controller = new AbortController();
  const created = [];
  let checks = 0;
  const run = loadBatchGenerate({
    getPrisma: () => fakeDb(pool, log),
    testProxyConnectivity: async () => { checks += 1; return { success: true }; },
    createProfile: async (payload) => {
      created.push(payload);
      if (created.length === 2) controller.abort();
      return { id: created.length, title: payload.title };
    }
  });
  const res = await run({ count: 5, proxyMode: 'unique', newGroupName: 'Batch' }, { signal: controller.signal });
  assert.equal(checks, 0, 'proxies verified in the last 30 minutes are not checked again');
  assert.equal(res.cancelled, true);
  assert.equal(res.createdCount, 2);
  assert.equal(created.length, 2, 'no profile is created after the cancel');
  assert.match(res.message, /^Stopped: created 2 of 5 profiles before you cancelled\. The ones already created were kept\.$/);
  assert.deepEqual(log.groupsDeleted, [], 'the group holding the kept profiles stays');
});

test('Cancel during the proxy check creates nothing and leaves no new group', async () => {
  const log = { groupsCreated: [], groupsDeleted: [] };
  const pool = [1, 2, 3].map((i) => stale(i));
  const controller = new AbortController();
  let createCalls = 0;
  const run = loadBatchGenerate({
    getPrisma: () => fakeDb(pool, log),
    testProxyConnectivity: () => new Promise(() => {}), // every check hangs
    createProfile: async () => { createCalls += 1; return {}; }
  });
  const pending = run({ count: 3, proxyMode: 'unique', newGroupName: 'Batch' }, { signal: controller.signal });
  await flush();
  controller.abort();
  const res = await pending;
  assert.equal(res.cancelled, true);
  assert.equal(res.createdCount, 0);
  assert.equal(createCalls, 0);
  assert.deepEqual(log.groupsCreated, []);
  assert.match(res.message, /^Cancelled while checking proxies \(0 of 3 checked\)\. Nothing was created\.$/);
});

test('a cancel that empties a group made for this run removes the group again', async () => {
  const log = { groupsCreated: [], groupsDeleted: [] };
  const controller = new AbortController();
  const db = fakeDb([], log);
  const create = db.group.create;
  db.group.create = async (args) => { const g = await create(args); controller.abort(); return g; };
  const run = loadBatchGenerate({ getPrisma: () => db, testProxyConnectivity: async () => ({ success: true }), createProfile: async () => ({}) });
  const res = await run({ count: 2, proxyMode: 'direct', newGroupName: 'Batch' }, { signal: controller.signal });
  assert.equal(res.createdCount, 0);
  assert.deepEqual(log.groupsDeleted, [77]);
  assert.equal(res.groupId, null);
});

test('Quick generate never gives its Chromium profiles a SOCKS4 proxy, and says so when it cost profiles', async () => {
  const log = { groupsCreated: [], groupsDeleted: [] };
  const pool = [fresh(1), fresh(2, 'SOCKS4'), fresh(3, 'SOCKS5'), fresh(4, 'SOCKS4')];
  const created = [];
  const run = loadBatchGenerate({
    getPrisma: () => fakeDb(pool, log),
    testProxyConnectivity: async () => ({ success: true }),
    createProfile: async (payload) => { created.push(payload); return { id: created.length }; }
  });
  const res = await run({ count: 4, proxyMode: 'unique' }, {});
  assert.deepEqual(plain(typeRule(log.findWhere)), { in: ['HTTP', 'SOCKS5'] });
  assert.deepEqual(created.map((c) => c.proxyId).sort(), [1, 3]);
  assert.equal(res.socks4Skipped, 2);
  assert.match(res.message, /2 SOCKS4 proxies were left out: Chromium profiles cannot send DNS lookups through SOCKS4\./);
});

test('pasted socks4:// lines are not assigned to Chromium profiles', async () => {
  const log = { groupsCreated: [], groupsDeleted: [] };
  const created = [];
  const run = loadBatchGenerate({
    getPrisma: () => fakeDb([], log),
    testProxyConnectivity: async () => ({ success: true }),
    createProfile: async (payload) => { created.push(payload); return { id: created.length }; }
  });
  const res = await run({ count: 3, proxyMode: 'paste', proxyList: '1.1.1.1:80\nsocks4://2.2.2.2:1080\nsocks5://3.3.3.3:1080' }, {});
  assert.deepEqual(created.map((c) => c.proxyRaw), ['1.1.1.1:80', 'socks5://3.3.3.3:1080']);
  assert.equal(res.socks4Skipped, 1);
});

// ---- the IPC handler, cancel and progress channel --------------------------------------------

function loadHandler(batchGenerateProfiles) {
  const ctx = {
    CHANNELS: { PROFILE_BATCH_GENERATE_PROGRESS: 'profile:batch-generate-progress' },
    crypto: require('node:crypto'),
    AbortController,
    proxyGate: gate,
    requireObject: (v) => v,
    optionalString: (v) => (v == null || String(v).trim() === '' ? null : String(v).trim()),
    batchGenerateProfiles,
    Date
  };
  vm.createContext(ctx);
  vm.runInContext(`const batchGenerateRuns = new Map();\nconst batchGenerateEarlyCancels = new Set();\n${extractFunction(IPC, 'batchGenerateHandler')}\n${extractFunction(IPC, 'cancelBatchGenerate')}\nthis.handler = batchGenerateHandler; this.cancel = cancelBatchGenerate; this.runs = batchGenerateRuns;`, ctx);
  return ctx;
}

test('the handler streams frames tagged with the run id, and Cancel stops that run', async () => {
  const gen = async (input, run) => {
    run.progress({ phase: 'check', checked: 0, total: 3 }, true);
    await new Promise((resolve) => { if (run.signal.aborted) resolve(); run.signal.addEventListener('abort', resolve); });
    run.progress({ phase: 'done', cancelled: true }, true);
    return { cancelled: run.signal.aborted };
  };
  const ctx = loadHandler(gen);
  const sent = [];
  const event = { sender: { send: (channel, frame) => sent.push({ channel, frame }), isDestroyed: () => false } };
  const pending = ctx.handler({ runId: 'run-a' }, event);
  await flush();
  assert.ok(ctx.runs.has('run-a'), 'the run is registered while it works');
  assert.deepEqual(plain(await ctx.cancel({ runId: 'run-a' })), { cancelled: 1 });
  const res = await pending;
  assert.equal(res.cancelled, true);
  assert.equal(res.runId, 'run-a');
  assert.ok(!ctx.runs.has('run-a'), 'a finished run is forgotten');
  assert.ok(sent.length >= 2);
  assert.ok(sent.every((s) => s.channel === 'profile:batch-generate-progress' && s.frame.runId === 'run-a'));
});

test('a Cancel that arrives before its run starts is applied when it does', async () => {
  let sawAborted = null;
  const ctx = loadHandler(async (input, run) => { sawAborted = run.signal.aborted; return {}; });
  assert.deepEqual(plain(await ctx.cancel({ runId: 'early' })), { cancelled: 0, pending: true });
  await ctx.handler({ runId: 'early' }, null);
  assert.equal(sawAborted, true);
});

test('frames to a closed window are dropped without breaking the run', async () => {
  const ctx = loadHandler(async (input, run) => { run.progress({ phase: 'done' }, true); return { ok: 1 }; });
  const event = { sender: { send: () => { throw new Error('must not send'); }, isDestroyed: () => true } };
  const res = await ctx.handler({ runId: 'x' }, event);
  assert.equal(res.ok, 1);
});

// ---- the wiring --------------------------------------------------------------------------

function loadPreload() {
  const calls = { invoke: [], on: [], off: [] };
  const orig = Module._load;
  let api = null;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_n, a) => { api = a; } },
        ipcRenderer: {
          invoke: async (channel, payload) => { calls.invoke.push({ channel, payload }); return { ok: true, data: { cancelled: 1 } }; },
          on: (channel, fn) => calls.on.push({ channel, fn }),
          removeListener: (channel, fn) => calls.off.push({ channel, fn }),
          send: () => {}
        }
      };
    }
    return orig.apply(this, arguments);
  };
  try {
    const file = path.join(ROOT, 'src', 'preload', 'preload.js');
    delete require.cache[require.resolve(file)];
    require(file);
  } finally { Module._load = orig; }
  return { api, calls };
}

test('the preload exposes Cancel and the progress stream, and unsubscribing removes the listener', async () => {
  const { api, calls } = loadPreload();
  assert.equal(typeof api.profiles.cancelBatchGenerate, 'function');
  assert.equal(typeof api.profiles.onBatchGenerateProgress, 'function');
  await api.profiles.cancelBatchGenerate('run-9');
  assert.deepEqual(calls.invoke.pop(), { channel: 'profile:batch-generate-cancel', payload: { runId: 'run-9' } });
  const got = [];
  const off = api.profiles.onBatchGenerateProgress((f) => got.push(f));
  assert.equal(calls.on[0].channel, 'profile:batch-generate-progress');
  calls.on[0].fn({}, { runId: 'r', phase: 'check' });
  assert.deepEqual(got, [{ runId: 'r', phase: 'check' }]);
  off();
  assert.equal(calls.off[0].fn, calls.on[0].fn);
});

test('main registers Cancel, emits the progress channel, and no longer checks in lock-step', () => {
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_BATCH_GENERATE, batchGenerateHandler\);/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_BATCH_GENERATE_CANCEL, cancelBatchGenerate\);/);
  assert.match(IPC, /sender\.send\(CHANNELS\.PROFILE_BATCH_GENERATE_PROGRESS,/);
  const body = extractFunction(IPC, 'batchGenerateProfiles');
  assert.doesNotMatch(body, /Promise\.all\(slice\.map/, 'the lock-step batches are gone');
  assert.match(body, /proxyGate\.collectWorkingProxies\(\{/);
  assert.match(body, /testProxyConnectivity\(\{[^}]*\}, proxyGate\.QUICK_CHECK_TIMEOUTS\)/);
});

test('the modal shows live progress, a working Stop, and passes its run id through both pages', () => {
  const modal = read('src', 'renderer', 'components', 'QuickGenerateModal.jsx');
  assert.match(modal, /softglazeApi\.profiles\.onBatchGenerateProgress\(/);
  assert.match(modal, /softglazeApi\.profiles\.cancelBatchGenerate\(runIdRef\.current\)/);
  assert.match(modal, /\{busy \? \(\s*<button onClick=\{stop\} disabled=\{stopping\}/, 'Stop stays enabled while the run works');
  assert.doesNotMatch(modal, /disabled=\{busy\} className="h-9 px-3/, 'the old disabled Cancel is gone');
  assert.match(modal, /t\('quickGenerate\.checkingProxies'\)/);
  assert.match(modal, /t\('quickGenerate\.shortfall'/);
  for (const page of ['ProfilesPage', 'BatchImportPage']) {
    const src = read('src', 'renderer', 'pages', `${page}.jsx`);
    assert.match(src, /const \{ runId, count, baseName/, page);
    assert.match(src, /batchGenerate\(\{\s*runId,/, page);
  }
  for (const lang of ['en', 'es']) {
    const q = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'cmpModalsC.json')).quickGenerate;
    for (const k of ['checkingProxies', 'checkCounter', 'shortfall', 'stop', 'stopping']) assert.ok(q[k], `${lang} quickGenerate.${k}`);
  }
});

test('progress view: counts while checking, the shortfall while creating', async () => {
  const { quickGenProgressView } = await loadView();
  assert.deepEqual(quickGenProgressView(null, { requested: 80 }), { phase: 'start', checked: 0, total: 80, working: 0, done: 0, percent: 0, shortfall: null });
  const checking = quickGenProgressView({ phase: 'check', checked: 37, total: 92, working: 24, needed: 80 }, { requested: 80, uniqueProxies: true });
  assert.equal(checking.phase, 'check');
  assert.deepEqual([checking.checked, checking.total, checking.working], [37, 92, 24]);
  assert.equal(checking.percent, 40);
  const creating = quickGenProgressView({ phase: 'create', done: 12, toCreate: 61, requested: 80 }, { requested: 80, uniqueProxies: true });
  assert.deepEqual(creating.shortfall, { requested: 80, available: 61 });
  assert.equal(creating.percent, 20);
  assert.equal(quickGenProgressView({ phase: 'create', done: 1, toCreate: 61, requested: 80 }, { uniqueProxies: false }).shortfall, null, 'reuse mode has no shortfall');
  assert.equal(quickGenProgressView({ phase: 'create', done: 80, toCreate: 80, requested: 80 }, { uniqueProxies: true }).shortfall, null);
  assert.equal(quickGenProgressView({ phase: 'done', created: 5, requested: 5 }).percent, 100);
});
