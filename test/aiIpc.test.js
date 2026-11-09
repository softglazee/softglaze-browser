'use strict';
// The SoftGlaze AI page's IPC contract (spec §10) and who may use it, plus how ipcHandlers wires
// the AI layer in (actor, session events, start-up order).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AI_CHANNELS, registerAiIpc, canAnswerApproval, createWindowEmitter } = require('../src/main/ai/ipc');

const IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

const SPEC_CHANNELS = ['ai:status', 'ai:set-enabled', 'ai:settings-get', 'ai:settings-set', 'ai:tokens-list', 'ai:tokens-create', 'ai:tokens-revoke', 'ai:approvals-list', 'ai:approvals-respond', 'ai:stop-all', 'ai:audit-list', 'ai:memory-get', 'ai:memory-set', 'ai:memory-reset', 'ai:prompts-list', 'ai:snippets', 'ai:bridge-info'];
// Added after §10 for the AI page's automation-token form, and the Owner-only DevTools card
// (test/aiIpcDevtools.test.js).
const EXTRA_CHANNELS = ['ai:preapprovable-tools', 'ai:devtools-sessions', 'ai:devtools-endpoint'];

function wire(windowMember, visible = new Set()) {
  const handlers = new Map();
  const seen = [];
  const approvals = [
    { id: 'a1', memberId: 2, tool: 'start_profile' },
    { id: 'a2', memberId: 1, tool: 'create_profile' }
  ];
  const ai = {
    status: async () => ({ enabled: true }),
    setEnabled: async (on) => { seen.push(['setEnabled', on]); return { enabled: on }; },
    getSettings: async () => ({ port: 8080 }),
    setSettings: async (p, o) => { seen.push(['setSettings', p, o]); return { port: 8080 }; },
    listTokens: async () => [],
    createToken: async (input, o) => { seen.push(['createToken', input, o]); return { id: 1, token: 'sgai_x' }; },
    revokeToken: async (id) => { seen.push(['revokeToken', id]); return { ok: true }; },
    listApprovals: () => approvals,
    getApproval: (id) => approvals.find((a) => a.id === id) || null,
    respondApproval: (id, d) => { seen.push(['respond', id, d]); return { ok: true, decision: d }; },
    stopAll: async () => ({ stoppedRuns: 0, revokedSessions: 0, deniedApprovals: 0 }),
    listAudit: async () => ({ items: [], nextCursor: null }),
    memoryGet: async () => ({ markdown: '', updatedAt: null, defaultMarkdown: '' }),
    memorySet: async (md) => { seen.push(['memorySet', md]); return { markdown: md }; },
    memoryReset: async () => ({}),
    listPrompts: () => [],
    getSnippets: async () => [],
    bridgeInfo: () => ({ command: 'x', args: [], mcpbPath: null }),
    preApprovableTools: () => [{ name: 'start_profile', title: 'Start a profile', scope: 'operate', destructive: false }]
  };
  registerAiIpc((channel, fn) => handlers.set(channel, fn), ai, {
    getWindowMember: async () => windowMember,
    visibleMemberIds: async () => visible
  });
  const call = (channel, payload) => handlers.get(channel)(payload);
  return { handlers, call, seen };
}

test('every channel of the spec\'s IPC contract is registered', () => {
  const { handlers } = wire(null);
  assert.deepEqual([...handlers.keys()].sort(), [...SPEC_CHANNELS, ...EXTRA_CHANNELS].sort());
  for (const c of SPEC_CHANNELS) assert.ok(Object.values(AI_CHANNELS).includes(c));
  assert.equal(AI_CHANNELS.APPROVAL_REQUESTED, 'ai:approval-requested');
});

test('the AI page needs the Owner or an Admin (single-user mode counts as the Owner)', async () => {
  const op = wire({ id: 2, role: 'OPERATOR', status: 'active' });
  for (const c of ['ai:status', 'ai:set-enabled', 'ai:tokens-list', 'ai:tokens-create', 'ai:stop-all', 'ai:audit-list', 'ai:memory-set', 'ai:snippets', 'ai:bridge-info', 'ai:preapprovable-tools']) {
    await assert.rejects(() => op.call(c, {}), /Only the Owner or an Admin/, c);
  }
  const admin = wire({ id: 3, role: 'ADMIN', status: 'active' });
  assert.deepEqual(await admin.call('ai:status'), { enabled: true });
  const banned = wire({ id: 3, role: 'ADMIN', status: 'banned' });
  await assert.rejects(() => banned.call('ai:status'), /banned/);
  const single = wire(null);
  await single.call('ai:set-enabled', true);
  assert.deepEqual(single.seen[0], ['setEnabled', true]);
  await single.call('ai:memory-set', '# notes');
  assert.deepEqual(single.seen[1], ['memorySet', '# notes']);
});

test('members answer only approvals from tokens that act as themselves', async () => {
  const op = wire({ id: 2, role: 'OPERATOR', status: 'active' });
  assert.deepEqual((await op.call('ai:approvals-list')).map((a) => a.id), ['a1']);
  assert.deepEqual(await op.call('ai:approvals-respond', { id: 'a1', decision: 'allow-once' }), { ok: true, decision: 'allow-once' });
  await assert.rejects(() => op.call('ai:approvals-respond', { id: 'a2', decision: 'allow-once' }), /act as you/);
  const admin = wire({ id: 3, role: 'ADMIN', status: 'active' });
  assert.equal((await admin.call('ai:approvals-list')).length, 2);
  assert.deepEqual(await admin.call('ai:approvals-respond', { id: 'a2', decision: 'deny' }), { ok: true, decision: 'deny' });
  assert.deepEqual(await admin.call('ai:approvals-respond', { id: 'gone', decision: 'deny' }), { ok: false });
});

test('one rule decides who may answer an approval, for the list, the answer and the event', async () => {
  const approval = { id: 'a', memberId: 2 };
  assert.equal(canAnswerApproval(null, approval), true, 'single-user mode');
  assert.equal(canAnswerApproval({ id: 1, role: 'OWNER', status: 'active' }, approval), true);
  assert.equal(canAnswerApproval({ id: 3, role: 'ADMIN', status: 'active' }, approval), true);
  assert.equal(canAnswerApproval({ id: -1, role: 'SUPER_ADMIN', status: 'active' }, approval), true);
  assert.equal(canAnswerApproval({ id: 2, role: 'OPERATOR', status: 'active' }, approval), true, 'the member the token acts as');
  assert.equal(canAnswerApproval({ id: 4, role: 'OPERATOR', status: 'active' }, approval), false);
  assert.equal(canAnswerApproval({ id: 5, role: 'MANAGER', status: 'active' }, approval), false);
  assert.equal(canAnswerApproval({ id: 3, role: 'ADMIN', status: 'suspended' }, approval), false);
  assert.equal(canAnswerApproval({ id: 9, role: 'NONE', status: 'missing' }, approval), false, 'a removed member');
  assert.equal(canAnswerApproval({ id: 4, role: 'OPERATOR', status: 'active' }, { id: 'b', memberId: null }), false, 'owner-token approvals go to Owner/Admin only');
});

test('the ai:approval-requested event reaches only a window whose member may answer it', async () => {
  const flush = () => new Promise((r) => setTimeout(r, 10));
  const run = async (member, approval) => {
    const sent = [];
    const emit = createWindowEmitter({ getWindowMember: async () => member, send: (c, d) => sent.push([c, d]) });
    emit('ai:approval-requested', approval);
    emit('ai:approvals-changed', { pending: 1 });
    await flush();
    return sent;
  };
  const own = { id: 'x', memberId: 2 };
  const other = { id: 'y', memberId: 7 };
  const operator = { id: 2, role: 'OPERATOR', status: 'active' };
  assert.deepEqual((await run(operator, own)).map((s) => s[0]), ['ai:approvals-changed', 'ai:approval-requested']);
  assert.deepEqual((await run(operator, other)).map((s) => s[0]), ['ai:approvals-changed'], 'not another member\'s approval; other events still flow');
  assert.equal((await run({ id: 3, role: 'ADMIN', status: 'active' }, other)).length, 2);
  assert.equal((await run(null, other)).length, 2, 'single-user mode');
  assert.equal((await run({ id: 9, role: 'NONE', status: 'missing' }, other)).length, 1);
  const failing = [];
  createWindowEmitter({ getWindowMember: async () => { throw new Error('db locked'); }, send: (c) => failing.push(c) })('ai:approval-requested', own);
  await flush();
  assert.deepEqual(failing, [], 'a lookup failure sends nothing');
  // ipcHandlers routes AI events through this filter with the window's member, not the AI actor.
  assert.match(IPC, /const emitAiEvent = createWindowEmitter\(\{ getWindowMember: windowMemberForAiEvents, send: emitToAllWindows \}\);/);
  const wm = fnBody('windowMemberForAiEvents');
  assert.match(wm, /const id = currentMemberId;/);
  assert.ok(!/getActiveMember/.test(wm), 'must not resolve the AI actor');
  assert.match(fnBody('buildAiHost'), /emit: emitAiEvent,/);
});

test('ai:preapprovable-tools needs the Owner or an Admin', async () => {
  const admin = wire({ id: 3, role: 'ADMIN', status: 'active' });
  assert.deepEqual(await admin.call('ai:preapprovable-tools'), [{ name: 'start_profile', title: 'Start a profile', scope: 'operate', destructive: false }]);
  assert.equal(AI_CHANNELS.PREAPPROVABLE_TOOLS, 'ai:preapprovable-tools');
});

test('token creation: no Admin token that acts as the Owner, only managed members, full scope for the Owner', async () => {
  const admin = wire({ id: 3, role: 'ADMIN', status: 'active' }, new Set([3, 4]));
  await admin.call('ai:tokens-create', { name: 'Mine', scope: 'operate' });
  assert.equal(admin.seen[0][1].memberId, 3, 'defaults to the creator');
  assert.equal(admin.seen[0][2].callerIsOwner, false);
  await admin.call('ai:tokens-create', { name: 'Operator', scope: 'read', memberId: 4 });
  await assert.rejects(() => admin.call('ai:tokens-create', { name: 'Owner', scope: 'read', memberId: 1 }), /members you manage/);
  await assert.rejects(() => admin.call('ai:tokens-create', { name: 'Full', scope: 'full' }), /Only the Owner can create full-scope/);
  await assert.rejects(() => admin.call('ai:settings-set', { port: 9000 }), /Only the Owner can change the port/);
  const owner = wire({ id: 1, role: 'OWNER', status: 'active' }, new Set([1, 3, 4]));
  await owner.call('ai:tokens-create', { name: 'Full', scope: 'full', memberId: 4 });
  assert.equal(owner.seen[0][2].callerIsOwner, true);
  await owner.call('ai:settings-set', { port: 9000 });
  assert.equal(owner.seen[1][2].isOwner, true);
});

test('ipcHandlers wires SoftGlaze AI in without changing the CHANNELS map', () => {
  assert.match(IPC, /registerAiIpc\(registerHandler, ai, \{/);
  assert.ok(!/'ai:/.test(/const CHANNELS = Object\.freeze\(\{[\s\S]*?\}\)/.exec(IPC)[0]), 'ai:* channels stay out of CHANNELS (preload parity)');
  const ready = fnBody('afterDbReady');
  assert.ok(ready.indexOf('ai.load()') > -1 && ready.indexOf('ai.load()') < ready.indexOf('localApi.startIfEnabled()'), 'AI settings load before the server starts');
  assert.match(fnBody('shutdownIpcHandlers'), /mcp\.dispose\(\)/);
});

test('every permission check acts as the token\'s member inside an AI or API call', () => {
  assert.match(IPC, /function actingMemberId\(\) \{\r?\n  const a = aiActor\.current\(\);\r?\n  return a \? a\.memberId : currentMemberId;\r?\n\}/);
  const gam = fnBody('getActiveMember');
  assert.match(gam, /const id = actingMemberId\(\);/);
  assert.match(gam, /if \(viaToken\) throw e;/, 'a token member that cannot be read fails closed');
  assert.match(gam, /if \(!viaToken\) currentMemberCanRevealProxy = true;/, 'the window redaction cache is left alone');
  assert.match(fnBody('ownerStampId'), /actingMemberId\(\)/);
  assert.match(fnBody('logActivity'), /aiActor\.tagDetail\(detail\), memberId: actingMemberId\(\)/);
  assert.match(fnBody('logAudit'), /aiActor\.tagDetail\(opts && opts\.detail\)/);
});

test('a profile closed by an API or AI client is a close, not a crash', () => {
  const ev = fnBody('handleSessionEvent');
  assert.match(ev, /if \(evt\.type === 'crashed' && pid != null && apiDrivenProfiles\.has\(pid\)\) evt = \{ \.\.\.evt, type: 'closed', reason: 'api-client' \};/);
  assert.ok(ev.indexOf("type: 'closed', reason: 'api-client'") < ev.indexOf('apiDrivenProfiles.delete(pid)'), 'checked before the profile is forgotten');
  assert.match(ev, /ai\.onProfileClosed\(pid\)/);
});

test('parallel runs can be stopped (stop_run and Stop all AI)', () => {
  const h = fnBody('runParallelMacroHandler');
  assert.match(h, /const control = \{ paused: false, aborted: false \};/);
  assert.match(h, /runMacro: \(sid, s, opts\) => runMacro\(sid, s, \{ \.\.\.opts, control \}\)/);
  assert.match(h, /if \(control\.aborted\) throw new Error\('Run stopped\.'\);/);
  const stop = fnBody('stopParallelRun');
  assert.match(stop, /await requirePermission\('automation\.run'\)/);
  assert.match(stop, /await assertCanControlRun\(r\.ownerMemberId\)/);
});

test('Developer API tokens keep working and act as their creator', () => {
  const create = fnBody('createApiToken');
  assert.match(create, /kind: 'api', scope: 'operate', memberId: ownerStampId\(\)/);
  assert.match(fnBody('listApiTokens'), /where: \{ kind: 'api' \}/);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261108000000_ai_tokens_audit', 'migration.sql'), 'utf8');
  assert.match(migration, /UPDATE "ApiToken" SET "scope" = 'operate' WHERE "kind" = 'api';/);
  assert.match(migration, /CREATE TABLE "AiAuditLog"/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  for (const col of ['memberId', 'scope', 'groupIdsJson', 'expiresAt', 'revokedAt', 'lastClientName', 'preApprovedJson']) {
    assert.match(/model ApiToken \{[\s\S]*?\n\}/.exec(schema)[0], new RegExp(`\\b${col}\\b`), col);
  }
});

test('the bridge ships unpacked from the app archive', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.asarUnpack.includes('src/main/ai/bridge/**/*'));
  assert.ok(pkg.dependencies['@modelcontextprotocol/sdk']);
  assert.ok(pkg.dependencies.zod);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'mcpb', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.server.entry_point, 'server/softglaze-mcp-bridge.js');
  assert.equal(manifest.user_config.token.sensitive, true);
  assert.equal(manifest.server.mcp_config.env.SOFTGLAZE_TOKEN, '${user_config.token}');
});
