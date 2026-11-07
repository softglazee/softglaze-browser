'use strict';
// Regression tests for the SoftGlaze AI live-test findings (7 Nov): the launch start URL on
// Chromium and Firefox, Stop during long macro waits, stale MCP sessions, the Activity tab
// refresh, small wording and label bugs, the local-network navigate error, and the automation
// token pre-approval list and caps.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const reg = require('../src/main/ai/toolRegistry');
const { ApprovalManager } = require('../src/main/ai/approvals');
const aiTokens = require('../src/main/ai/aiTokens');
const aiAudit = require('../src/main/ai/aiAudit');
const aiSettings = require('../src/main/ai/aiSettings');
const memories = require('../src/main/ai/memories');
const pageTools = require('../src/main/ai/pageTools');
const localApi = require('../src/main/localApi');
const { McpHttpHandler, MAX_SESSIONS, ACTIVE_MS } = require('../src/main/ai/mcpServer');
const { VALID_MACRO_STEPS } = require('../src/main/browserEngine');
const { createFakeApp } = require('./helpers/aiFakes');

const ROOT = path.join(__dirname, '..');
const SRC = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const loadCore = () => import('../src/renderer/lib/aiCore.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// browserEngine internals, evaluated on their own with fakes for what they use.
const ENGINE = SRC('main', 'browserEngine.js');
function engineFns(names, globals = {}) {
  const sandbox = { URL, Promise, Date, Error, Map, Set, Math, Number, String, Boolean, Array, Object, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, ...globals };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(ENGINE, n)).join('\n'), sandbox);
  return sandbox;
}

// ---- 1. Start URL given at launch ----------------------------------------------------------

test('launch start URL: only a valid http(s) URL counts; about:blank and other schemes keep the start page', () => {
  const { launchStartUrl } = engineFns(['launchStartUrl']);
  assert.equal(launchStartUrl('https://example.com'), 'https://example.com/');
  assert.equal(launchStartUrl('  http://127.0.0.1:8080/a?b=1  '), 'http://127.0.0.1:8080/a?b=1');
  for (const none of ['about:blank', '', '   ', null, undefined, 42, 'file:///C:/start.html', 'javascript:alert(1)', 'chrome://settings', 'ftp://example.com/', 'http://', 'https://exa mple.com', 'example.com']) {
    assert.equal(launchStartUrl(none), null, String(none));
  }
});

test('launch start URL: opened in the main tab after proxy auth, and a failing site never fails the launch', async () => {
  const { openLaunchUrl } = engineFns(['openLaunchUrl']);
  const calls = [];
  const page = {
    authenticate: async (c) => { calls.push(['authenticate', c.username]); },
    goto: async (url, opts) => { calls.push(['goto', url, opts.waitUntil, opts.timeout]); }
  };
  assert.equal(await openLaunchUrl(page, 'https://example.com/', { username: 'u', password: 'p' }), true);
  assert.deepEqual(calls, [['authenticate', 'u'], ['goto', 'https://example.com/', 'domcontentloaded', 30000]], 'auth before the navigation, or a proxy 407 stalls it');
  calls.length = 0;
  assert.equal(await openLaunchUrl(page, 'https://example.com/', null), true);
  assert.deepEqual(calls.map((c) => c[0]), ['goto'], 'no proxy credentials, no authenticate');
  const failing = { authenticate: async () => {}, goto: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } };
  assert.equal(await openLaunchUrl(failing, 'https://nope.invalid/', null), false);
  assert.equal(await openLaunchUrl(null, 'https://example.com/', null), false);
});

test('launch start URL: launchProfileSessionNow reads options.startUrl and opens it in the main tab after the start page', () => {
  const fn = extractFunction(ENGINE, 'launchProfileSessionNow');
  assert.match(fn, /const launchUrl = launchStartUrl\(options\.startUrl\);/);
  const startGoto = fn.indexOf("await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })");
  const open = fn.indexOf('if (launchUrl) await openLaunchUrl(page, launchUrl, proxyCreds);');
  const links = fn.indexOf('if (Array.isArray(startupUrls) && startupUrls.length)');
  assert.ok(startGoto > 0, 'the start page still loads first (no start URL: unchanged behaviour)');
  assert.ok(open > startGoto, 'the start URL opens after the start page');
  assert.ok(links > open, 'saved start links open after it, in new tabs');
  assert.match(fn, /if \(startupMode !== 'detection' && !launchUrl\) \{/, 'a saved link never takes the main tab from the launch start URL');
  // The main tab stays session.page, which page tools, macros and the warmer drive.
  assert.match(fn, /activeSessions\.set\(sessionId, \{\s*browser,\s*page,/);
});

test('launch start URL: the IPC launch path hands startUrl to both engines; Firefox accepts http(s) only', () => {
  const ipc = SRC('main', 'ipcHandlers.js');
  const now = extractFunction(ipc, 'launchProfileNow');
  assert.equal((now.match(/startUrl: input\.startUrl \|\| 'about:blank',/g) || []).length, 2, 'Chromium and Firefox both receive it');
  const ff = SRC('main', 'firefoxEngine.js');
  assert.match(ff, /let openUrl = \(typeof startUrl === 'string' && \/\^https\?:\\\/\\\/\[\^\\s\]\+\$\/i\.test\(startUrl\.trim\(\)\)\) \? startUrl\.trim\(\) : null;/);
  assert.match(ff, /if \(openUrl\) args\.push\('-url', openUrl\);/);
});

// ---- 2. Stop during long macro waits -------------------------------------------------------

const MACRO_STOP_POLL_MS = Number(/const MACRO_STOP_POLL_MS = (\d+);/.exec(ENGINE)[1]);

function macroRunner(page) {
  const activeSessions = new Map([['7', { page }]]);
  return engineFns(['stepTimeout', 'elementCenter', 'sleepUnlessAborted', 'runMacro'], {
    activeSessions,
    sleep,
    MACRO_STOP_POLL_MS,
    STEP_TIMEOUT_DEFAULT: 15000,
    WAIT_FOR_TIMEOUT_DEFAULT: 30000,
    MACRO_STEP_BY_LOWER: new Map(Array.from(VALID_MACRO_STEPS).map((t) => [t.toLowerCase(), t]))
  });
}

// A page whose selector waits behave like puppeteer's: they hang until the timeout, and reject at
// once when their AbortSignal fires.
function hangingPage(calls) {
  return {
    waitForSelector: (sel, opts) => {
      calls.push(['waitForSelector', sel, Boolean(opts && opts.signal)]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Waiting for selector timed out')), (opts && opts.timeout) || 30000);
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
      });
    },
    goto: (url) => { calls.push(['goto', url]); return new Promise(() => {}); },
    click: async (sel) => { calls.push(['click', sel]); },
    type: async (sel) => { calls.push(['type', sel]); },
    $: async () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }) }),
    mouse: { move: async () => { calls.push(['move']); } }
  };
}

test('macro stop: a 60 s wait step ends within a poll interval of Stop', async () => {
  const { runMacro } = macroRunner(hangingPage([]));
  const control = { paused: false, aborted: false };
  setTimeout(() => { control.aborted = true; }, 100);
  const t0 = Date.now();
  const r = await runMacro('7', [{ type: 'wait', ms: 60000 }, { type: 'wait', ms: 60000 }], { control });
  const took = Date.now() - t0;
  assert.ok(took < 100 + MACRO_STOP_POLL_MS + 400, `took ${took} ms`);
  assert.equal(r.aborted, true);
  assert.equal(r.ran, 1, 'the second wait never starts');
});

test('macro stop: a selector wait is cancelled and the click after it never runs', async () => {
  const calls = [];
  const { runMacro } = macroRunner(hangingPage(calls));
  const control = { paused: false, aborted: false };
  setTimeout(() => { control.aborted = true; }, 100);
  const t0 = Date.now();
  const r = await runMacro('7', [{ type: 'click', selector: '#buy', timeout: 30000 }], { control });
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(calls, [['waitForSelector', '#buy', true]], 'no click after Stop');
  assert.equal(r.aborted, true);
  assert.equal(r.log[0].ok, false);
  assert.equal(r.log[0].error, 'Stopped.', 'reads as a stop, not as a failed selector');
});

test('macro stop: waitFor, hover dwell and a hanging navigation all end at Stop', async () => {
  for (const step of [
    { type: 'waitFor', selector: '.ready', timeout: 30000 },
    { type: 'goto', url: 'https://slow.example/' },
    { type: 'move', selector: '#menu', timeout: 30000 }
  ]) {
    const calls = [];
    const { runMacro } = macroRunner(hangingPage(calls));
    const control = { paused: false, aborted: false };
    setTimeout(() => { control.aborted = true; }, 80);
    const t0 = Date.now();
    const r = await runMacro('7', [step], { control });
    assert.ok(Date.now() - t0 < 1000, `${step.type} took ${Date.now() - t0} ms`);
    assert.equal(r.aborted, true, step.type);
    assert.ok(!calls.some((c) => c[0] === 'move'), `${step.type}: nothing moves after Stop`);
  }
  // Hover: the element is there, the dwell is what Stop cuts short.
  const page = { ...hangingPage([]), waitForSelector: async () => ({}) };
  const { runMacro } = macroRunner(page);
  const control = { paused: false, aborted: false };
  setTimeout(() => { control.aborted = true; }, 80);
  const t0 = Date.now();
  const r = await runMacro('7', [{ type: 'hover', selector: '#menu', ms: 60000 }], { control });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.aborted, true);
});

test('macro stop: without a run control (page tools) waits run in full and selector waits get no signal', async () => {
  const calls = [];
  const page = { ...hangingPage(calls), waitForSelector: async (sel, opts) => { calls.push(['waitForSelector', sel, Boolean(opts && opts.signal)]); return {}; } };
  const { runMacro } = macroRunner(page);
  const t0 = Date.now();
  const r = await runMacro('7', [{ type: 'wait', ms: 250 }, { type: 'click', selector: '#go' }], {});
  assert.ok(Date.now() - t0 >= 240);
  assert.equal(r.ok, true);
  assert.equal(r.aborted, false);
  assert.deepEqual(calls.filter((c) => c[0] !== 'move'), [['waitForSelector', '#go', false], ['click', '#go']]);
});

test('macro stop: sleepUnlessAborted reports whether it was cut short', async () => {
  const { sleepUnlessAborted } = engineFns(['sleepUnlessAborted'], { sleep, MACRO_STOP_POLL_MS });
  assert.equal(await sleepUnlessAborted(30, () => false), false);
  assert.equal(await sleepUnlessAborted(60000, () => true), true);
  assert.equal(await sleepUnlessAborted(-5, null), false);
});

// ---- 3. Stale MCP sessions -----------------------------------------------------------------

function fakeSession(id, { lastActive, open = 0 }) {
  const ref = { id, kind: 'mcp', tokenId: 1, tokenName: 'T', clientName: `c${id}`, createdAt: lastActive, lastActive, open, closed: false, server: null };
  ref.transport = { close: async () => { ref.closed = true; } };
  return ref;
}

test('MCP sessions: at the cap the least recently used idle session makes room', async () => {
  const h = new McpHttpHandler({ registry: null, memory: null });
  try {
    const now = Date.now();
    for (let i = 0; i < MAX_SESSIONS; i += 1) h.sessions.set(`s${i}`, fakeSession(`s${i}`, { lastActive: now - 60000 + i, open: i === 0 ? 1 : 0 }));
    assert.equal(await h.makeRoom(), true);
    assert.equal(h.sessions.size, MAX_SESSIONS - 1);
    assert.equal(h.sessions.has('s0'), true, 'a session with an open stream is never evicted');
    assert.equal(h.sessions.has('s1'), false, 'the oldest idle one goes');
    assert.equal(await h.makeRoom(), true, 'below the cap there is room');
    assert.equal(h.sessions.size, MAX_SESSIONS - 1);
  } finally { clearInterval(h.sweeper); }
});

test('MCP sessions: refused only when every session is busy', async () => {
  const h = new McpHttpHandler({ registry: null, memory: null });
  try {
    for (let i = 0; i < MAX_SESSIONS; i += 1) h.sessions.set(`s${i}`, fakeSession(`s${i}`, { lastActive: Date.now(), open: 1 }));
    assert.equal(await h.makeRoom(), false);
    assert.equal(h.sessions.size, MAX_SESSIONS);
  } finally { clearInterval(h.sweeper); }
});

test('MCP sessions: "connected apps" counts only sessions active in the last two minutes or holding a stream', () => {
  const h = new McpHttpHandler({ registry: null, memory: null });
  try {
    const now = Date.now();
    h.sessions.set('recent', fakeSession('recent', { lastActive: now - 30000 }));
    h.sessions.set('stale', fakeSession('stale', { lastActive: now - ACTIVE_MS - 1000 }));
    h.sessions.set('streaming', fakeSession('streaming', { lastActive: now - 20 * 60000, open: 1 }));
    assert.equal(ACTIVE_MS, 2 * 60 * 1000);
    assert.deepEqual(h.clients({ now }).map((c) => c.sessionId).sort(), ['recent', 'streaming']);
    assert.deepEqual(h.clients({ activeOnly: false, now }).map((c) => c.sessionId).sort(), ['recent', 'stale', 'streaming']);
  } finally { clearInterval(h.sweeper); }
  assert.match(SRC('main', 'ai', 'index.js'), /clients: state\.mcp \? state\.mcp\.clients\(\{ activeOnly: true \}\)/, 'ai:status uses the active sessions');
  const mcp = SRC('main', 'ai', 'mcpServer.js');
  assert.equal((mcp.match(/if \(!\(await this\.makeRoom\(\)\)\)/g) || []).length, 2, 'Streamable HTTP and SSE both make room instead of refusing');
});

// ---- 4. Activity tab refresh ---------------------------------------------------------------

test('activity tab: a burst of events reloads once, cancel drops a pending reload', async () => {
  const { createDebounced, ACTIVITY_REFRESH_DEBOUNCE_MS } = await loadCore();
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const setTimer = (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimer = (id) => { timers.delete(id); };
  const advance = (ms) => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } };
  let runs = 0;
  const d = createDebounced(() => { runs += 1; }, ACTIVITY_REFRESH_DEBOUNCE_MS, { setTimer, clearTimer });
  d.call(); advance(100); d.call(); advance(100); d.call();
  assert.equal(d.pending(), true);
  advance(ACTIVITY_REFRESH_DEBOUNCE_MS - 1);
  assert.equal(runs, 0);
  advance(1);
  assert.equal(runs, 1, 'one reload for the burst');
  d.call(); d.cancel(); advance(ACTIVITY_REFRESH_DEBOUNCE_MS * 2);
  assert.equal(runs, 1, 'a hidden or unmounted tab does not reload');
});

test('activity tab: reloads when shown again and, while shown, on status and approval changes', () => {
  const page = SRC('renderer', 'pages', 'AiPage.jsx');
  assert.match(page, /<AiActivityTab lang=\{lang\} active=\{tab === 'activity'\}/);
  const tab = SRC('renderer', 'components', 'ai', 'AiActivityTab.jsx');
  assert.match(tab, /export default function AiActivityTab\(\{ lang, clients, active = true \}\)/);
  assert.match(tab, /if \(active && !was\) refreshShown\(\);/, 'shown again: reload');
  assert.match(tab, /if \(!active\) return undefined;\s*const refresh = createDebounced\(refreshShown, ACTIVITY_REFRESH_DEBOUNCE_MS\);/);
  assert.match(tab, /softglazeApi\.ai\.onStatusChanged\(refresh\.call\)/);
  assert.match(tab, /softglazeApi\.ai\.onApprovalsChanged\(refresh\.call\)/);
  assert.match(tab, /refresh\.cancel\(\);/);
  assert.match(tab, /if \(mine !== seq\.current\) return;/, 'a slow older answer never overwrites a newer one');
});

// ---- 5. Small issues -----------------------------------------------------------------------

function harness(opts = {}) {
  const app = createFakeApp(opts);
  const approvals = new ApprovalManager({ timeoutMs: 2000, emit: () => {} });
  const settings = aiSettings.normalizeStored({ enabled: true });
  const services = {
    settings: () => settings,
    isEnabled: () => settings.enabled,
    approvals,
    audit: { record: async () => {} },
    memory: memories.createMemoryStore({ read: async (k, f) => (app.settings.has(k) ? app.settings.get(k) : f), write: async (k, v) => app.settings.set(k, v) }),
    tracker: new reg.AiTracker(),
    jobs: new reg.JobStore({ inlineMs: 200 }),
    limiter: new reg.RateLimiter()
  };
  const registry = new reg.ToolRegistry({ deps: app.toolDeps, services, inlineWaitMs: 300 });
  const token = (over = {}) => ({ id: 1, name: 'Test token', kind: 'ai', scope: 'operate', groupIds: [], preApproved: null, memberId: 1, ...over });
  const call = (name, args, over = {}) => registry.call(name, args, { token: token(over), clientName: 'Test client', transport: 'mcp' });
  const allowAll = () => { approvals.emit = (c, d) => { if (c === 'ai:approval-requested') setTimeout(() => approvals.respond(d.id, 'allow-hour'), 5); }; };
  return { app, approvals, registry, call, allowAll };
}

test('workspace summary: "0 running" / "1 running", never "runnings"', async () => {
  const h = harness();
  const none = await h.call('workspace_summary', {});
  assert.equal(none.ok, true, none.error);
  assert.match(none.summary, /, 0 running, /);
  assert.doesNotMatch(none.summary, /runnings/);
  await h.app.toolDeps.launchProfile({ id: 1, startUrl: 'about:blank' });
  const one = await h.call('workspace_summary', {});
  assert.match(one.summary, /, 1 running, /);
});

test('audit: approval paths are stored whole ("started-by-this-token" was cut to 20 characters)', async () => {
  const rows = [];
  const db = { aiAuditLog: { create: async ({ data }) => { rows.push(data); return data; } } };
  await aiAudit.record(db, { tool: 'stop_profile', outcome: 'ok', approval: 'started-by-this-token' });
  assert.equal(rows[0].approval, 'started-by-this-token');
  await aiAudit.record(db, { tool: 'x', outcome: 'ok', approval: 'y'.repeat(60) });
  assert.equal(rows[1].approval.length, aiAudit.APPROVAL_MAX);
  assert.equal(aiAudit.APPROVAL_MAX, 40);
  const { approvalPath } = await loadCore();
  for (const p of ['started-by-this-token', 'developer-token', 'allow-hour', 'hour-grant']) assert.equal(approvalPath({ approval: p }), p, p);
  for (const lang of ['en', 'es']) {
    const strings = JSON.parse(SRC('renderer', 'i18n', 'locales', lang, 'ai.json'));
    assert.ok(strings.activity.approval['allow-hour'], `${lang} labels "allow-hour"`);
  }
});

test('REST calls name the REST API and the token, never the token\'s last MCP app', () => {
  assert.equal(localApi.restClientName({ kind: 'ai', name: 'smoke', lastClientName: 'smoke-test' }), 'REST API (smoke)');
  assert.equal(localApi.restClientName({ kind: 'api', name: 'Script' }), 'Local API: Script');
  assert.doesNotMatch(SRC('main', 'localApi.js'), /lastClientName/, 'REST never borrows the MCP client name');
});

test('page_navigate: a local address blocked by the default setting gets a plain explanation', async () => {
  const { friendlyStepError, LOCAL_NETWORK_BLOCKED } = pageTools;
  assert.equal(LOCAL_NETWORK_BLOCKED, 'This address is on your local network, which profiles block by default. Turn on Local network access in Settings if you need it.');
  const goto = (url) => ({ type: 'goto', url });
  for (const url of ['http://127.0.0.1:8080/', 'http://localhost:3000/x', 'http://192.168.1.20/', 'http://10.0.0.5/', 'http://172.20.1.1/', 'http://printer.local/', 'http://[::1]:8000/']) {
    assert.equal(friendlyStepError(goto(url), `net::ERR_FAILED at ${url}`), LOCAL_NETWORK_BLOCKED, url);
  }
  assert.match(friendlyStepError(goto('https://example.com/'), 'net::ERR_FAILED at https://example.com/'), /^The page did not load: net::ERR_FAILED/);
  assert.match(friendlyStepError(goto('http://127.0.0.1:9/'), 'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9/'), /^The page did not load/, 'a server that is down is not "blocked"');

  const h = harness();
  h.allowAll();
  await h.app.toolDeps.launchProfile({ id: 1, startUrl: 'about:blank' });
  h.app.toolDeps.runMacro = async (sid, steps) => ({ ok: false, total: 1, ran: 1, log: [{ index: 0, type: steps[0].type, ok: false, error: `net::ERR_FAILED at ${steps[0].url}` }] });
  const r = await h.call('page_navigate', { profileId: 1, url: 'http://127.0.0.1:8123/' });
  assert.equal(r.ok, false);
  assert.equal(r.error, LOCAL_NETWORK_BLOCKED);
});

test('page_navigate: the local-network rule matches the one the profile request filter uses', () => {
  const { isPrivateHost } = engineFns(['isPrivateHost']);
  const hosts = ['localhost', 'a.localhost', 'nas.local', '127.0.0.1', '0.0.0.0', '10.1.2.3', '169.254.1.1', '172.15.0.1', '172.16.0.1', '172.31.255.255', '172.32.0.1', '192.168.0.1', '192.169.0.1', '8.8.8.8', '[::1]', '::1', 'fd00::1', 'fe80::1', '2001:db8::1', 'example.com', ''];
  for (const host of hosts) assert.equal(pageTools.isLocalNetworkHost(host), isPrivateHost(host), host);
});

test('page_navigate: reports how long the navigation itself took', async () => {
  const h = harness();
  h.allowAll();
  await h.app.toolDeps.launchProfile({ id: 1, startUrl: 'about:blank' });
  const r = await h.call('page_navigate', { profileId: 1, url: 'https://example.com/' });
  assert.equal(r.ok, true, r.error);
  assert.equal(typeof r.data.loadMs, 'number');
  assert.ok(r.data.loadMs >= 0);
  assert.equal(r.data.url, 'https://example.com/');
});

// ---- Automation tokens: pre-approval list and caps -----------------------------------------

test('pre-approval: stop_all_profiles and update_memory are never pre-approvable; the UI list is the engine list', async () => {
  const h = harness();
  const names = h.registry.preApprovableNames();
  assert.ok(!names.includes('stop_all_profiles'));
  assert.ok(!names.includes('update_memory'));
  assert.ok(!names.includes('get_cdp_endpoint'));
  assert.ok(names.includes('find_free_proxies') && names.includes('run_macro') && names.includes('page_click'));
  const { PREAPPROVABLE_SET, groupPreapprovable } = await loadCore();
  assert.deepEqual([...PREAPPROVABLE_SET].sort(), [...names].sort(), 'the built-in UI list and the engine list agree');
  const engineList = names.map((name) => ({ name, title: name, scope: 'operate', destructive: false }));
  assert.ok(!groupPreapprovable(engineList).some((g) => g.group === 'other'), 'no engine tool lands under "Other"');
  for (const bad of ['stop_all_profiles', 'update_memory']) {
    assert.throws(() => aiTokens.normalizeCreateInput({ name: 'n8n', scope: 'operate', groupIds: [1], preApprovedTools: [bad] }, { allowedPreApprovedTools: names, callerIsOwner: true }), /cannot be pre-approved/, bad);
  }
});

test('pre-approval: a token stored with stop_all_profiles still asks for it', async () => {
  const h = harness();
  await h.app.toolDeps.launchProfile({ id: 1, startUrl: 'about:blank' });
  const pre = { tools: ['stop_all_profiles', 'update_memory'], maxProfilesPerCall: 5, maxCallsPerHour: 60 };
  const stopAll = await h.call('stop_all_profiles', {}, { groupIds: [1], preApproved: pre });
  assert.equal(stopAll.code, 'APPROVAL_PENDING', 'asked, not pre-approved');
  assert.equal(h.app.sessions.size, 1, 'nothing was stopped');
  const memory = await h.call('update_memory', { mode: 'append', text: 'Be nice.' }, { groupIds: [1], preApproved: pre });
  assert.equal(memory.code, 'APPROVAL_PENDING');
});

test('pre-approval: a multi-profile call is pre-approved only up to maxProfilesPerCall', async () => {
  const h = harness();
  const pre = { tools: ['run_macro'], maxProfilesPerCall: 2, maxCallsPerHour: 60 };
  const within = await h.call('run_macro', { macroId: 1, profileIds: [1, 2] }, { groupIds: [1, 2], preApproved: pre });
  assert.equal(within.ok, true, within.error);
  assert.equal(within.approval, 'pre-approved');
  const over = await h.call('run_macro', { macroId: 1, profileIds: [1, 2, 3] }, { groupIds: [1, 2], preApproved: pre });
  assert.equal(over.code, 'APPROVAL_PENDING', 'over the cap: the user is asked');
});

test('pre-approval: caps above the engine limits are clamped; the token form allows 1 to 50 profiles per call', async () => {
  assert.equal(aiTokens.MAX_PROFILES_PER_CALL, 50);
  const legacy = aiTokens.preApprovedOf({ preApprovedJson: JSON.stringify({ tools: ['run_macro'], maxProfilesPerCall: 100, maxCallsPerHour: 5000 }) });
  assert.equal(legacy.maxProfilesPerCall, 50);
  assert.equal(legacy.maxCallsPerHour, aiTokens.MAX_CALLS_PER_HOUR);
  assert.throws(() => aiTokens.normalizeCreateInput({ name: 'n8n', scope: 'operate', groupIds: [1], preApprovedTools: ['run_macro'], maxProfilesPerCall: 51 }, { allowedPreApprovedTools: ['run_macro'], callerIsOwner: true }), /from 1 to 50/);
  const { AUTOMATION_LIMITS, validateTokenForm } = await loadCore();
  assert.deepEqual(AUTOMATION_LIMITS.maxProfilesPerCall, [1, aiTokens.MAX_PROFILES_PER_CALL]);
  assert.deepEqual(AUTOMATION_LIMITS.maxCallsPerHour, [1, aiTokens.MAX_CALLS_PER_HOUR]);
  const form = { name: 'n8n', memberId: 1, scope: 'operate', expiresInDays: 30, groupMode: 'some', groupIds: [1], automation: true, preApprovedTools: ['run_macro'], maxProfilesPerCall: 50, maxCallsPerHour: 60 };
  assert.deepEqual(validateTokenForm(form, { isOwner: true }), {});
  assert.equal(validateTokenForm({ ...form, maxProfilesPerCall: 51 }, { isOwner: true }).maxProfilesPerCall, 'errors.limitRange');
});
