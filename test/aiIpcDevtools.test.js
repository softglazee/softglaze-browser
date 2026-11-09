'use strict';
// The Owner-only IPC behind the AI page's "Use a profile with Playwright MCP or Chrome DevTools MCP"
// card: ai:devtools-sessions and ai:devtools-endpoint through the real ai/ipc.js and ai/index.js,
// with the fake app from test/helpers/aiFakes.js. Who may call them, which profiles are refused, and
// that the address goes nowhere but the answer (no log row, event or console line carries it).
const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../src/main/ai');
const { registerAiIpc, AI_CHANNELS } = require('../src/main/ai/ipc');
const snippets = require('../src/main/ai/snippets');
const { createFakeApp } = require('./helpers/aiFakes');

const app = createFakeApp();
ai.configure({ toolDeps: app.toolDeps, host: app.host, inlineWaitMs: 1000, approvalTimeoutMs: 8000 });

let windowMember = null;
const handlers = new Map();
registerAiIpc((channel, fn) => handlers.set(channel, fn), ai, {
  getWindowMember: async () => windowMember,
  visibleMemberIds: async () => new Set()
});
const call = (channel, payload) => handlers.get(channel)(payload);
const as = (member) => { windowMember = member; };

const OWNER = { id: 1, role: 'OWNER', status: 'active' };
const firefox = new Set();
app.toolDeps.isFirefoxSession = (sid) => firefox.has(String(sid));

const rows = () => app.db._tables.activityLog;
const marks = () => app.calls.filter((c) => c[0] === 'markAutomationDriven');

// Every console line written while fn runs, to prove the address is never logged.
async function consoleDuring(fn) {
  const lines = [];
  const orig = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[k] = console[k];
    console[k] = (...args) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' ')); };
  }
  try { return { result: await fn().catch((e) => e), lines }; } finally { Object.assign(console, orig); }
}

test.before(async () => {
  await app.toolDeps.launchProfile({ id: 1 }); // US-QA-01, Chromium
  await app.toolDeps.launchProfile({ id: 2 }); // DE-QA-02, made Firefox below
  firefox.add('2');
  app.calls.length = 0;
});

test('the two channels are registered and named in AI_CHANNELS, with the stop event', () => {
  assert.equal(AI_CHANNELS.DEVTOOLS_SESSIONS, 'ai:devtools-sessions');
  assert.equal(AI_CHANNELS.DEVTOOLS_ENDPOINT, 'ai:devtools-endpoint');
  assert.equal(AI_CHANNELS.DEVTOOLS_SESSION_ENDED, 'ai:devtools-session-ended');
  assert.ok(handlers.has('ai:devtools-sessions'));
  assert.ok(handlers.has('ai:devtools-endpoint'));
});

test('Admin, Manager and Operator are refused by main, not just hidden from', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'OPERATOR', 'NONE']) {
    as({ id: 3, role, status: 'active' });
    await assert.rejects(() => call('ai:devtools-sessions'), (e) => e.code === 'FORBIDDEN' && /Only the Owner/.test(e.message), role);
    await assert.rejects(() => call('ai:devtools-endpoint', { profileId: 1, tool: 'playwright', client: 'claude-code' }), (e) => e.code === 'FORBIDDEN', role);
  }
  as({ ...OWNER, status: 'suspended' });
  await assert.rejects(() => call('ai:devtools-endpoint', { profileId: 1 }), /suspended/);
  as({ ...OWNER, status: 'banned' });
  await assert.rejects(() => call('ai:devtools-sessions'), /banned/);
  assert.equal(marks().length, 0, 'nobody refused touched the profile');
  assert.equal(rows().length, 0, 'and nothing was logged as shown');
});

test('the running list has no addresses, and marks Firefox profiles', async () => {
  as(OWNER);
  const list = await call('ai:devtools-sessions');
  assert.deepEqual(list, [
    { profileId: 1, name: 'US-QA-01', engine: 'chromium', running: true },
    { profileId: 2, name: 'DE-QA-02', engine: 'firefox', running: true }
  ]);
  assert.doesNotMatch(JSON.stringify(list), /ws:\/\/|9999|devtools\/browser/);
  as(null); // single-user mode is the Owner
  assert.equal((await call('ai:devtools-sessions')).length, 2);
  as({ id: -1, role: 'SUPER_ADMIN', status: 'active' });
  assert.equal((await call('ai:devtools-sessions')).length, 2);
});

test('the Owner gets the address and eight setups; one mark and one activity row per call, no address in the row', async () => {
  as(OWNER);
  const before = rows().length;
  const { result: r, lines } = await consoleDuring(() => call('ai:devtools-endpoint', { profileId: 1, tool: 'playwright', client: 'claude-code' }));
  assert.equal(r.wsEndpoint, 'ws://127.0.0.1:9999/devtools/browser/1');
  assert.equal(r.profileId, 1);
  assert.equal(r.snippets.length, 8);
  assert.equal(r.snippetsWithUsageStats.length, 8);
  assert.ok(r.snippets.every((s) => s.text.includes(r.wsEndpoint)));
  assert.match(r.snippets.find((s) => s.tool === 'chrome-devtools' && s.client === 'vscode').text, /--no-usage-statistics/);
  assert.doesNotMatch(r.snippetsWithUsageStats.find((s) => s.tool === 'chrome-devtools' && s.client === 'vscode').text, /usage-statistics/);

  assert.deepEqual(marks(), [['markAutomationDriven', 1]], 'driven from outside, like get_cdp_endpoint');
  assert.equal(rows().length, before + 1);
  const row = rows()[rows().length - 1];
  assert.equal(row.profileId, 1);
  assert.equal(row.memberId, 1);
  assert.equal(row.action, 'devtools');
  assert.equal(row.detail, 'DevTools address shown for profile #1 (Playwright MCP)');
  assert.doesNotMatch(JSON.stringify(row), /ws:\/\/|9999|devtools\/browser/);
  assert.deepEqual(lines.filter((l) => /ws:\/\/|9999/.test(l)), [], 'never logged');

  await call('ai:devtools-endpoint', { profileId: 1, tool: 'chrome-devtools', client: 'vscode' });
  assert.equal(marks().length, 2);
  assert.equal(rows().length, before + 2, 'a second Show is a second row');
  assert.equal(rows()[rows().length - 1].detail, 'DevTools address shown for profile #1 (Chrome DevTools MCP)');

  as(null);
  await call('ai:devtools-endpoint', { profileId: 1, tool: 'nonsense' });
  assert.equal(rows()[rows().length - 1].memberId, null, 'single-user mode has no member id');
  assert.match(rows()[rows().length - 1].detail, /\(Playwright MCP\)$/, 'an unknown tool reads as Playwright MCP');
  assert.equal(app.db._tables.aiAuditLog.length, 0, 'nothing goes into the AI audit');
});

test('Firefox, stopped and unknown profiles are refused with the right message, and nothing is marked or logged', async () => {
  as(OWNER);
  const m0 = marks().length;
  const r0 = rows().length;
  await assert.rejects(() => call('ai:devtools-endpoint', { profileId: 2, tool: 'playwright' }), (e) => e.code === 'FIREFOX' && e.message === 'Firefox profiles have no DevTools endpoint.');
  await assert.rejects(() => call('ai:devtools-endpoint', { profileId: 3, tool: 'playwright' }), (e) => e.code === 'NOT_RUNNING' && e.message === 'Profile #3 is not running. Start it first.');
  for (const bad of [undefined, null, 'abc', 0, -4, 1.5, {}]) {
    await assert.rejects(() => call('ai:devtools-endpoint', { profileId: bad }), (e) => e.code === 'BAD_INPUT' && /Choose a running profile/.test(e.message), String(bad));
  }
  await assert.rejects(() => call('ai:devtools-endpoint', null), (e) => e.code === 'BAD_INPUT');
  assert.equal(marks().length, m0);
  assert.equal(rows().length, r0);
});

test('an address that is not on this computer is refused without repeating it', async () => {
  as(OWNER);
  const orig = app.toolDeps.getAutomationPage;
  app.toolDeps.getAutomationPage = async () => ({ page: {}, browser: {}, wsEndpoint: 'ws://10.0.0.8:4444/devtools/browser/zz' });
  const m0 = marks().length;
  const r0 = rows().length;
  try {
    const { result: e, lines } = await consoleDuring(() => call('ai:devtools-endpoint', { profileId: 1 }));
    assert.ok(e instanceof Error);
    assert.equal(e.code, 'DEVTOOLS_ADDRESS');
    assert.doesNotMatch(e.message, /10\.0\.0\.8|4444/);
    assert.deepEqual(lines, []);
    app.toolDeps.getAutomationPage = async () => ({ page: {}, browser: {}, wsEndpoint: null });
    await assert.rejects(() => call('ai:devtools-endpoint', { profileId: 1 }), (err) => err.code === 'NO_ENDPOINT');
  } finally {
    app.toolDeps.getAutomationPage = orig;
  }
  assert.equal(marks().length, m0);
  assert.equal(rows().length, r0);
});

test('a locked workspace shows nothing', async () => {
  as(OWNER);
  const orig = app.host.isWorkspaceLocked;
  app.host.isWorkspaceLocked = () => true;
  try {
    await assert.rejects(() => call('ai:devtools-endpoint', { profileId: 1 }), (e) => e.code === 'LOCKED');
  } finally {
    app.host.isWorkspaceLocked = orig;
  }
});

test('a profile stopping sends ai:devtools-session-ended with its id only', () => {
  app.calls.length = 0;
  ai.onProfileClosed(1);
  const ev = app.calls.filter((c) => c[0] === 'emit' && c[1] === 'ai:devtools-session-ended');
  assert.deepEqual(ev, [['emit', 'ai:devtools-session-ended', { profileId: 1 }]]);
  ai.onProfileClosed('not-a-profile');
  assert.equal(app.calls.filter((c) => c[1] === 'ai:devtools-session-ended').length, 1, 'no event for a session that is not a profile');
});

test('bridge info names the live Claude Desktop extension; the Claude Desktop setup points to it', async () => {
  as(OWNER);
  const info = await call('ai:bridge-info');
  assert.equal(info.mcpbUrl, 'https://browser.softglaze.com/downloads/softglaze-browser.mcpb');
  assert.equal(snippets.MCPB_URL, info.mcpbUrl);
  const list = snippets.buildSnippets({ port: 8080, bridge: info });
  const desktop = list.find((s) => s.client === 'claude-desktop');
  assert.ok(desktop.where.includes(snippets.MCPB_URL));
  assert.match(desktop.where, /softglaze-browser\.mcpb/);
  const all = JSON.stringify(list);
  assert.doesNotMatch(all, /SoftGlaze\.mcpb|planned|coming soon/i, 'no old file name, no "planned" wording');
  const code = list.find((s) => s.client === 'claude-code');
  assert.equal(code.text, 'claude mcp add --transport http softglaze http://127.0.0.1:8080/mcp --header "Authorization: Bearer <YOUR_TOKEN>"', 'the manual command stays');
  assert.match(code.where, /^Without the plugins: run in a terminal\./);
});
