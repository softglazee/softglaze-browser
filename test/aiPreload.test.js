'use strict';
// window.softglaze.ai matches the IPC contract (spec §10): each call invokes its listed channel,
// the approval event is wired, and the ai:* channels stay out of the CHANNELS map that
// test/ipcParity.test.js compares with ipcHandlers.js (main registers them from src/main/ai/).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'preload.js');

const CONTRACT = [
  'ai:status', 'ai:set-enabled', 'ai:settings-get', 'ai:settings-set', 'ai:tokens-list', 'ai:tokens-create',
  'ai:tokens-revoke', 'ai:approvals-list', 'ai:approvals-respond', 'ai:approval-requested', 'ai:stop-all',
  'ai:audit-list', 'ai:memory-get', 'ai:memory-set', 'ai:memory-reset', 'ai:prompts-list', 'ai:snippets', 'ai:bridge-info'
];
// Additive channels from the engine (PR #38): two events (approvals changed elsewhere, status
// changed) and the pre-approvable tool list for Automation tokens. Then the Owner-only DevTools card:
// two calls and the event that clears a shown address when its profile stops.
const ENGINE_EVENTS = ['ai:approvals-changed', 'ai:status-changed', 'ai:preapprovable-tools', 'ai:devtools-sessions', 'ai:devtools-endpoint', 'ai:devtools-session-ended'];

// Loads preload.js against a stubbed electron. `reply(channel, payload)` decides what invoke returns.
function loadPreload(reply = () => ({ ok: true, data: { ok: true } })) {
  const calls = [];
  const listeners = new Map();
  let api = null;
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_name, a) => { api = a; } },
        ipcRenderer: {
          invoke: async (channel, payload) => { calls.push({ channel, payload }); return reply(channel, payload); },
          on: (ch, fn) => listeners.set(ch, fn),
          removeListener: (ch, fn) => { if (listeners.get(ch) === fn) listeners.delete(ch); },
          send: () => {}
        }
      };
    }
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(PRELOAD)];
    require(PRELOAD);
  } finally {
    Module._load = orig;
  }
  return { api, calls, listeners };
}

test('every window.softglaze.ai call invokes its spec §10 channel with an object payload', async () => {
  const { api, calls } = loadPreload();
  const ai = api.ai;
  assert.ok(ai, 'window.softglaze.ai exists');
  const run = [
    [() => ai.getStatus(), 'ai:status', undefined],
    [() => ai.setEnabled(1), 'ai:set-enabled', { enabled: true }],
    [() => ai.getSettings(), 'ai:settings-get', undefined],
    [() => ai.setSettings({ port: 47321 }), 'ai:settings-set', { port: 47321 }],
    [() => ai.tokens.list(), 'ai:tokens-list', undefined],
    [() => ai.tokens.create({ name: 'x', memberId: 1, scope: 'read', expiresInDays: 7, groupIds: [] }), 'ai:tokens-create', { name: 'x', memberId: 1, scope: 'read', expiresInDays: 7, groupIds: [] }],
    [() => ai.tokens.revoke(9), 'ai:tokens-revoke', { id: 9 }],
    [() => ai.approvals.list(), 'ai:approvals-list', undefined],
    [() => ai.approvals.respond('a1', 'allow-hour'), 'ai:approvals-respond', { id: 'a1', decision: 'allow-hour' }],
    [() => ai.stopAll(), 'ai:stop-all', undefined],
    [() => ai.audit.list({ limit: 50 }), 'ai:audit-list', { limit: 50 }],
    [() => ai.audit.list(), 'ai:audit-list', {}],
    [() => ai.memories.get(), 'ai:memory-get', undefined],
    [() => ai.memories.set('# Notes'), 'ai:memory-set', { markdown: '# Notes' }],
    [() => ai.memories.reset(), 'ai:memory-reset', undefined],
    [() => ai.prompts.list(), 'ai:prompts-list', undefined],
    [() => ai.snippets(), 'ai:snippets', undefined],
    [() => ai.bridgeInfo(), 'ai:bridge-info', undefined],
    [() => ai.preapprovableTools(), 'ai:preapprovable-tools', undefined],
    [() => ai.devtools.sessions(), 'ai:devtools-sessions', undefined],
    [() => ai.devtools.endpoint({ profileId: 12, tool: 'playwright', client: 'claude-code', extra: 'dropped' }), 'ai:devtools-endpoint', { profileId: 12, tool: 'playwright', client: 'claude-code' }]
  ];
  for (const [call, channel, payload] of run) {
    calls.length = 0;
    await call();
    assert.equal(calls.length, 1, channel);
    assert.equal(calls[0].channel, channel);
    assert.deepEqual(calls[0].payload, payload, `${channel} payload`);
  }
});

test('the approval event reaches the renderer and unsubscribes cleanly', () => {
  const { api, listeners } = loadPreload();
  const got = [];
  const off = api.ai.onApprovalRequested((a) => got.push(a));
  const fn = listeners.get('ai:approval-requested');
  assert.equal(typeof fn, 'function');
  fn({}, { id: 'x', summary: 'Start 2 profiles' });
  assert.deepEqual(got, [{ id: 'x', summary: 'Start 2 profiles' }]);
  const boom = api.ai.onApprovalRequested(() => { throw new Error('ui bug'); });
  assert.doesNotThrow(() => listeners.get('ai:approval-requested')({}, { id: 'y' }), 'a renderer error never breaks the IPC listener');
  boom();
  off();
  assert.equal(listeners.has('ai:approval-requested'), false);
});

test('the engine events "approvals changed" and "status changed" reach the renderer', () => {
  const { api, listeners } = loadPreload();
  const seen = [];
  const offA = api.ai.onApprovalsChanged((d) => seen.push(['a', d]));
  const offS = api.ai.onStatusChanged((d) => seen.push(['s', d]));
  listeners.get('ai:approvals-changed')({}, { pending: 2 });
  listeners.get('ai:status-changed')({}, { at: 1 });
  assert.deepEqual(seen, [['a', { pending: 2 }], ['s', { at: 1 }]]);
  offA(); offS();
  assert.equal(listeners.has('ai:approvals-changed'), false);
  assert.equal(listeners.has('ai:status-changed'), false);
});

test('the DevTools card hears when a profile stops, and unsubscribes cleanly', () => {
  const { api, listeners } = loadPreload();
  const seen = [];
  const off = api.ai.devtools.onSessionEnded((d) => seen.push(d));
  listeners.get('ai:devtools-session-ended')({}, { profileId: 12 });
  assert.deepEqual(seen, [{ profileId: 12 }]);
  off();
  assert.equal(listeners.has('ai:devtools-session-ended'), false);
});

test('a build without the engine rejects with AI_UNAVAILABLE; main errors keep their code', async () => {
  const noEngine = loadPreload(async (ch) => { throw new Error(`Error invoking remote method '${ch}': Error: No handler registered for '${ch}'`); });
  await assert.rejects(noEngine.api.ai.getStatus(), (e) => e.code === 'AI_UNAVAILABLE');
  await assert.rejects(noEngine.api.ai.tokens.list(), (e) => e.code === 'AI_UNAVAILABLE');
  const forbidden = loadPreload(() => ({ ok: false, error: { code: 'FORBIDDEN', message: 'Owner or Admin only.' } }));
  await assert.rejects(forbidden.api.ai.getStatus(), (e) => e.code === 'FORBIDDEN' && e.message === 'Owner or Admin only.');
  const ok = loadPreload(() => ({ ok: true, data: { enabled: true, running: true, port: 47321 } }));
  assert.deepEqual(await ok.api.ai.getStatus(), { enabled: true, running: true, port: 47321 });
});

test('ai:* channels live in AI_CHANNELS, not in the CHANNELS map that ipcParity compares', () => {
  const src = fs.readFileSync(PRELOAD, 'utf8');
  const main = src.match(/const CHANNELS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert.ok(main);
  assert.doesNotMatch(main[1], /'ai:/, 'an ai: channel in CHANNELS breaks test/ipcParity.test.js');
  const ai = src.match(/const AI_CHANNELS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert.ok(ai, 'AI_CHANNELS map');
  const values = [...ai[1].matchAll(/'(ai:[^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(values, [...CONTRACT, ...ENGINE_EVENTS].sort(), 'the spec §10 channels plus the engine additions');
  assert.match(src, /const ALLOWED_CHANNELS = new Set\(\[\.\.\.Object\.values\(CHANNELS\), \.\.\.Object\.values\(AI_CHANNELS\)\]\);/);
});

test('once the engine is merged, main knows every channel the page calls', (t) => {
  const dir = path.join(ROOT, 'src', 'main', 'ai');
  if (!fs.existsSync(dir)) { t.skip('src/main/ai is not in this branch yet (engine PR)'); return; }
  const mainText = [
    ...fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')),
    fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8')
  ].join('\n');
  const missing = [...CONTRACT, ...ENGINE_EVENTS].filter((ch) => !mainText.includes(`'${ch}'`) && !mainText.includes(`"${ch}"`));
  assert.deepEqual(missing, [], 'channels the preload calls but main never names');
});
