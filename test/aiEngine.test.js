'use strict';
// Unit tests for the SoftGlaze AI engine: registry rules, scopes, permissions and plan clamps, the
// never-exposed list, approvals, tokens, Host/Origin checks, memories, prompts, settings, snippets
// and redaction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { TOOLS } = require('../src/main/ai/tools');
const reg = require('../src/main/ai/toolRegistry');
const { ApprovalManager } = require('../src/main/ai/approvals');
const aiTokens = require('../src/main/ai/aiTokens');
const aiAudit = require('../src/main/ai/aiAudit');
const aiSettings = require('../src/main/ai/aiSettings');
const memories = require('../src/main/ai/memories');
const prompts = require('../src/main/ai/prompts');
const snippets = require('../src/main/ai/snippets');
const actor = require('../src/main/ai/actor');
const { redactArgs, scrubText } = require('../src/main/ai/redact');
const { flattenAx } = require('../src/main/ai/pageTools');
const localApi = require('../src/main/localApi');
const { createFakeApp, makeToken } = require('./helpers/aiFakes');
const { createFakePrisma } = require('./helpers/fakePrisma');

const SPEC_TOOLS = [
  'workspace_summary', 'list_profiles', 'get_profile', 'profile_health', 'create_profile', 'update_profile', 'batch_generate_profiles',
  'list_sessions', 'start_profile', 'stop_profile', 'stop_all_profiles',
  'list_proxies', 'check_proxy', 'get_proxy_health', 'assign_proxy', 'rotate_proxy_ip', 'find_free_proxies',
  'list_groups', 'create_group', 'move_profiles_to_group',
  'list_macros', 'get_macro', 'save_macro', 'run_macro', 'get_run_status', 'stop_run', 'start_warmer',
  'page_navigate', 'page_snapshot', 'page_click', 'page_type', 'page_press_key', 'page_scroll', 'page_screenshot', 'page_extract_text', 'page_wait_for',
  'get_activity', 'read_memory', 'update_memory', 'get_cdp_endpoint'
];

// A registry over fake app functions, with an operate token that acts as the Owner.
function harness(opts = {}) {
  const app = createFakeApp(opts);
  const approvals = new ApprovalManager({ timeoutMs: opts.approvalTimeoutMs || 2000, emit: (c, d) => { if (opts.onEmit) opts.onEmit(c, d); } });
  const audit = [];
  let settings = aiSettings.normalizeStored({ enabled: true, ...(opts.settings || {}) });
  const services = {
    settings: () => settings,
    isEnabled: () => settings.enabled,
    approvals,
    audit: { record: async (e) => { audit.push(e); } },
    memory: memories.createMemoryStore({ read: async (k, f) => (app.settings.has(k) ? app.settings.get(k) : f), write: async (k, v) => app.settings.set(k, v) }),
    tracker: new reg.AiTracker(),
    jobs: new reg.JobStore({ inlineMs: opts.jobInlineMs || 200 }),
    limiter: new reg.RateLimiter()
  };
  const registry = new reg.ToolRegistry({ deps: app.toolDeps, services, inlineWaitMs: opts.inlineWaitMs || 300 });
  const token = (over = {}) => ({ id: 1, name: 'Test token', kind: 'ai', scope: 'operate', groupIds: [], preApproved: null, memberId: 1, ...over });
  const call = (name, args, over = {}, cc = {}) => registry.call(name, args, { token: token(over), clientName: 'Test client', transport: 'mcp', ...cc });
  return { app, approvals, audit, services, registry, call, token, setSettings: (s) => { settings = aiSettings.normalizeStored({ ...settings, ...s }); } };
}

// ---------------------------------------------------------------------------------------------
test('the registry holds exactly the spec\'s tools, each valid', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [...SPEC_TOOLS].sort());
  for (const t of TOOLS) reg.validateTool(t);
});

test('every tool that changes something asks; read tools are read-only and nothing is destructive', () => {
  for (const t of TOOLS) {
    assert.equal(t.annotations.destructiveHint, false, t.name);
    if (t.scope !== 'read') assert.notEqual(t.approval, 'none', `${t.name} must ask`);
    if (t.scope === 'read' && t.name !== 'check_proxy') assert.equal(t.annotations.readOnlyHint, true, t.name);
    if (t.name.startsWith('page_')) { assert.equal(t.approval, 'page'); assert.equal(t.scope, 'operate'); }
  }
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  assert.equal(byName.stop_all_profiles.approval, 'always');
  assert.equal(byName.get_cdp_endpoint.approval, 'always');
  assert.equal(byName.get_cdp_endpoint.scope, 'full');
  assert.equal(byName.get_cdp_endpoint.expert, true);
  assert.equal(byName.update_memory.approval, 'ask');
  assert.equal(byName.read_memory.scope, 'read');
});

test('never-exposed capabilities cannot be registered or wired in', () => {
  for (const t of TOOLS) assert.ok(!reg.NEVER_EXPOSED_NAME.test(t.name), t.name);
  for (const bad of ['export_cookies', 'get_2fa_code', 'delete_profile', 'purge_trash', 'reveal_proxy_password', 'update_member_role', 'change_settings', 'evaluate_javascript', 'read_vault']) {
    assert.throws(() => reg.validateTool({ ...TOOLS[0], name: bad }), /never-exposed/, bad);
  }
  assert.throws(() => reg.validateTool({ ...TOOLS.find((t) => t.name === 'create_profile'), annotations: { ...TOOLS[0].annotations, destructiveHint: true } }), /destructive/);
  for (const dep of reg.ALLOWED_DEPS) assert.ok(!reg.FORBIDDEN_DEP.test(dep), dep);
  const app = createFakeApp();
  for (const extra of ['exportProfileCookies', 'deleteProfile', 'purgeProfile', 'getProfile2faToken', 'setGlobalSettings', 'updateMember', 'vaultUnlock']) {
    assert.throws(() => reg.validateDeps({ ...app.toolDeps, [extra]: () => {} }), /may not hold/, extra);
  }
  // Every app function the tools reach for is on the whitelist.
  const src = ['tools.js', 'pageTools.js', 'toolRegistry.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai', f), 'utf8')).join('\n');
  const used = new Set([...src.matchAll(/\bdeps\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  for (const name of used) assert.ok(reg.ALLOWED_DEPS.includes(name), `tools use ${name}, which is not whitelisted`);
});

test('ipcHandlers hands the AI layer only whitelisted, safe functions', () => {
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');
  const body = /function buildAiToolDeps\(\) \{[\s\S]*?\n\}/.exec(ipc)[0];
  const keys = [...body.matchAll(/^\s{4}([A-Za-z0-9_]+)(?=[,:\n])/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 40, keys.join(','));
  for (const k of keys) assert.ok(reg.ALLOWED_DEPS.includes(k), `buildAiToolDeps passes ${k}`);
  assert.ok(!/exportProfileCookies|deleteProfile|purgeProfile|getProfile2faToken|vaultUnlock|setGlobalSettings/.test(body));
});

test('scope: a read token cannot call operate tools; the refusal is audited', async () => {
  const h = harness();
  const r = await h.call('create_profile', { name: 'X' }, { scope: 'read' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SCOPE');
  assert.match(r.error, /read scope; create_profile needs operate/);
  assert.equal(h.audit[0].outcome, 'denied');
  assert.equal(h.app.calls.filter((c) => c[0] === 'createProfile').length, 0);
  const ok = await h.call('list_groups', {}, { scope: 'read' });
  assert.equal(ok.ok, true);
});

test('permission: the member\'s role must allow the tool\'s action', async () => {
  const h = harness({ deniedPermissions: ['profiles.create'] });
  const r = await h.call('create_profile', { name: 'X' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FORBIDDEN');
  assert.equal(h.audit[0].outcome, 'denied');
  assert.equal(h.approvals.pendingCount(), 0, 'no dialog for a call the role cannot make');
});

test('calls run as the token\'s member (actor), never as the window member', async () => {
  const h = harness();
  let seen = 'unset';
  h.app.toolDeps.requirePermission = async () => { seen = actor.current(); };
  await h.call('list_macros', {}, { memberId: 2, id: 9, name: 'Operator token' });
  assert.equal(seen.memberId, 2);
  assert.equal(seen.tokenId, 9);
  assert.equal(seen.via, 'ai');
  assert.equal(actor.current(), null, 'nothing leaks outside the call');
});

test('plan limits: warm-up and macro concurrency are clamped to the plan', async () => {
  const h = harness({ settings: { approvalMode: { operate: 'ask-hour' } } });
  h.approvals.emit = (c, d) => { if (c === 'ai:approval-requested') setTimeout(() => h.approvals.respond(d.id, 'allow-once'), 10); };
  const w = await h.call('start_warmer', { profileIds: [1], concurrency: 8 });
  assert.equal(w.ok, true, w.error);
  assert.equal(h.app.calls.find((c) => c[0] === 'startWarmer')[1].concurrency, 3);
  const m = await h.call('run_macro', { macroId: 1, profileIds: [1], concurrency: 9 });
  assert.equal(m.ok, true, m.error);
  assert.equal(m.data.concurrency, 3);
  assert.equal(m.data.planLimit, 3);
  assert.match(m.summary, /your plan allows 3/);
});

test('token groups limit every profile a call touches', async () => {
  const h = harness();
  h.approvals.emit = (c, d) => { if (c === 'ai:approval-requested') setTimeout(() => h.approvals.respond(d.id, 'allow-once'), 10); };
  const list = await h.call('list_profiles', {}, { groupIds: [2] });
  assert.equal(list.data.total, 1);
  assert.equal(list.data.profiles[0].name, 'ACME-01');
  const denied = await h.call('get_profile', { id: 1 }, { groupIds: [2] });
  assert.equal(denied.code, 'DENIED');
  const create = await h.call('create_profile', { name: 'N', group: 'QA' }, { groupIds: [2] });
  assert.equal(create.code, 'DENIED');
  const newGroup = await h.call('create_group', { name: 'X' }, { groupIds: [2] });
  assert.equal(newGroup.code, 'DENIED');
});

test('the page-domain allow list limits page tools when it is set', async () => {
  const h = harness({ settings: { pageDomainAllowList: ['example.com'] } });
  h.approvals.emit = (c, d) => { if (c === 'ai:approval-requested') setTimeout(() => h.approvals.respond(d.id, 'allow-hour'), 10); };
  await h.app.toolDeps.launchProfile({ id: 1, startUrl: 'about:blank' });
  const ok = await h.call('page_navigate', { profileId: 1, url: 'https://shop.example.com/x' });
  assert.equal(ok.ok, true, ok.error);
  const bad = await h.call('page_navigate', { profileId: 1, url: 'https://other.test/' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not in the page-domain allow list/);
  assert.equal(reg.domainAllowed('https://a.b.example.com', ['*.example.com']), true);
  assert.equal(reg.domainAllowed('https://example.com.evil.test', ['example.com']), false);
  assert.equal(reg.domainAllowed('https://anything.test', []), true);
});

test('save_macro validates steps with the app\'s normalizer and refuses hidden values', async () => {
  const h = harness();
  h.approvals.emit = (c, d) => { if (c === 'ai:approval-requested') setTimeout(() => h.approvals.respond(d.id, 'allow-once'), 10); };
  const bad = await h.call('save_macro', { name: 'M', steps: [{ type: 'teleport' }] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Step 1: unknown step type "teleport"/);
  const hidden = await h.call('save_macro', { name: 'M', steps: [{ type: 'type', selector: '#pw', value: '[hidden value]' }] });
  assert.match(hidden.error, /hidden value/);
});

test('a job that outlasts the request returns a runId and finishes in the background', async () => {
  const jobs = new reg.JobStore({ inlineMs: 20 });
  const r = await jobs.start(7, 'demo', 'Demo job', () => new Promise((res) => setTimeout(() => res({ summary: 'done', data: { n: 1 } }), 80)));
  assert.match(r.data.runId, /^job-/);
  assert.equal(jobs.get(r.data.runId, 8), null, 'another token cannot read it');
  for (let i = 0; i < 100 && jobs.get(r.data.runId, 7).running; i += 1) await new Promise((res) => setTimeout(res, 20));
  const v = jobs.get(r.data.runId, 7);
  assert.equal(v.running, false);
  assert.deepEqual(v.result, { n: 1 });
});

// ---- approvals ----
function fakeTimers() {
  let now = 1000;
  const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, done: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.done = true; },
    advance: (ms) => { now += ms; for (const t of timers) if (!t.done && t.at <= now) { t.done = true; t.fn(); } }
  };
}

test('approvals: no answer within 2 minutes is a deny (timeout)', async () => {
  const t = fakeTimers();
  const events = [];
  const m = new ApprovalManager({ now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer, emit: (c, d) => events.push([c, d]) });
  const a = m.request({ tokenId: 1, tool: 'start_profile', summary: 'Start profile #1' });
  assert.equal(events[0][0], 'ai:approval-requested');
  assert.equal(events[0][1].expiresAt, new Date(1000 + 120000).toISOString());
  t.advance(119999);
  assert.equal(m.pendingCount(), 1);
  t.advance(1);
  assert.deepEqual(await a.promise, { decision: 'timeout' });
  assert.equal(m.pendingCount(), 0);
  assert.deepEqual(m.respond(a.id, 'allow-once'), { ok: false, reason: 'not-pending' });
});

test('approvals: allow for 1 hour grants that key for an hour; deny grants nothing', async () => {
  const t = fakeTimers();
  const m = new ApprovalManager({ now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer });
  const a = m.request({ tokenId: 1, tool: 'page_click', grantKey: 'page:5' });
  m.respond(a.id, 'allow-hour');
  assert.deepEqual(await a.promise, { decision: 'allow-hour' });
  assert.equal(m.hasHourGrant(1, 'page:5'), true);
  assert.equal(m.hasHourGrant(2, 'page:5'), false, 'per token');
  assert.equal(m.hasHourGrant(1, 'page:6'), false, 'per profile');
  t.advance(60 * 60 * 1000);
  assert.equal(m.hasHourGrant(1, 'page:5'), false, 'expires after an hour');
  const d = m.request({ tokenId: 1, tool: 'create_profile' });
  m.respond(d.id, 'deny');
  assert.deepEqual(await d.promise, { decision: 'deny' });
  assert.equal(m.hasHourGrant(1, 'create_profile'), false);
  assert.throws(() => m.respond(m.request({ tokenId: 1, tool: 'x' }).id, 'allow-forever'), /Decision must be/);
});

test('approvals: ask-every-time downgrades allow-hour; Stop all AI cancels and forgets', async () => {
  const m = new ApprovalManager({});
  const a = m.request({ tokenId: 1, tool: 'stop_all_profiles', allowHour: false });
  assert.deepEqual(m.respond(a.id, 'allow-hour'), { ok: true, decision: 'allow-once' });
  assert.equal(m.hasHourGrant(1, 'stop_all_profiles'), false);
  const b = m.request({ tokenId: 1, tool: 'x' });
  const c = m.request({ tokenId: 2, tool: 'y' });
  assert.equal(m.cancelAll(), 2);
  assert.deepEqual(await b.promise, { decision: 'cancelled' });
  assert.deepEqual(await c.promise, { decision: 'cancelled' });
});

test('approvals: a late answer is a one-time grant for the identical call only', async () => {
  const m = new ApprovalManager({});
  const fp = ApprovalManager.fingerprint('save_macro', { name: 'a', steps: [1] });
  assert.equal(fp, ApprovalManager.fingerprint('save_macro', { steps: [1], name: 'a' }), 'key order does not matter');
  const a = m.request({ tokenId: 1, tool: 'save_macro', fingerprint: fp });
  a.detached = true;
  m.respond(a.id, 'allow-once');
  assert.equal(m.consumeLateGrant(1, ApprovalManager.fingerprint('save_macro', { name: 'b', steps: [1] })), false);
  assert.equal(m.consumeLateGrant(1, fp), true);
  assert.equal(m.consumeLateGrant(1, fp), false, 'used once');
});

test('registry: deny and timeout are reported as denied and audited', async () => {
  const h = harness({ approvalTimeoutMs: 150, inlineWaitMs: 2000 });
  const timeout = await h.call('create_group', { name: 'G' });
  assert.equal(timeout.code, 'APPROVAL_TIMEOUT');
  assert.match(timeout.error, /within 2 minutes, so it was denied/);
  assert.equal(h.audit.at(-1).outcome, 'denied');
  assert.equal(h.audit.at(-1).approval, 'timeout');
  h.approvals.emit = (c, d) => { if (c === 'ai:approval-requested') setTimeout(() => h.approvals.respond(d.id, 'deny'), 10); };
  const denied = await h.call('create_group', { name: 'G' });
  assert.equal(denied.code, 'DENIED_BY_USER');
});

test('registry: read approval mode can require asking even for reads; never is read-only', () => {
  assert.equal(reg.modeFor({ read: 'never' }, 'read'), 'never');
  assert.equal(reg.modeFor({ operate: 'never' }, 'operate'), 'ask-hour', 'never is not allowed for changes');
  assert.equal(reg.modeFor({}, 'full'), 'ask-always');
});

test('registry: SoftGlaze AI switched off refuses every call', async () => {
  const h = harness({ settings: { enabled: false } });
  const r = await h.call('workspace_summary', {});
  assert.equal(r.code, 'AI_OFF');
});

test('registry: with SoftGlaze AI off, a Developer API key on REST still works; AI tokens and MCP do not', async () => {
  const h = harness({ settings: { enabled: false } });
  const devRest = await h.call('list_profiles', {}, { kind: 'api', name: 'Script key' }, { transport: 'rest', clientName: 'Local API: Script key' });
  assert.equal(devRest.ok, true, `Developer API key over REST: ${devRest.code} ${devRest.error}`);
  const aiRest = await h.call('list_profiles', {}, { kind: 'ai' }, { transport: 'rest' });
  assert.equal(aiRest.code, 'AI_OFF');
  const devMcp = await h.call('list_profiles', {}, { kind: 'api' }, { transport: 'mcp' });
  assert.equal(devMcp.code, 'AI_OFF');
  const aiMcp = await h.call('list_profiles', {}, { kind: 'ai' }, { transport: 'mcp' });
  assert.equal(aiMcp.code, 'AI_OFF');
});

test('registry: Expert tools need Expert mode and an Owner token', async () => {
  const h = harness();
  const off = await h.call('get_cdp_endpoint', { profileId: 1 }, { scope: 'full' });
  assert.equal(off.code, 'EXPERT_OFF');
  h.setSettings({ expertMode: true });
  const operator = await h.call('get_cdp_endpoint', { profileId: 1 }, { scope: 'full', memberId: 2 });
  assert.equal(operator.code, 'DENIED');
  assert.match(operator.error, /Owner/);
  assert.ok(h.registry.forToken(h.token({ scope: 'full' })).some((t) => t.name === 'get_cdp_endpoint'));
  assert.ok(!h.registry.forToken(h.token({ scope: 'operate' })).some((t) => t.name === 'get_cdp_endpoint'));
  assert.ok(!h.registry.preApprovableNames().includes('get_cdp_endpoint'));
});

// ---- tokens ----
test('tokens: sgai_ + 40 random characters, stored only as a SHA-256 hash', async () => {
  const db = createFakePrisma({ member: [{ id: 1, name: 'Owner', role: 'OWNER', status: 'active' }] });
  const { id, token } = await aiTokens.createToken(db, { name: 'Claude Desktop on my PC', memberId: 1, scope: 'operate', expiresInDays: 30 }, { now: Date.UTC(2026, 10, 7) });
  assert.match(token, /^sgai_[A-Za-z0-9]{40}$/);
  assert.equal(aiTokens.looksLikeToken(token), true);
  const row = db._tables.apiToken.find((r) => r.id === id);
  assert.equal(row.tokenHash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(row).includes(token), 'the plain token is never stored');
  assert.equal(row.expiresAt.toISOString(), new Date(Date.UTC(2026, 10, 7) + 30 * 86400000).toISOString());
  const listed = await aiTokens.listTokens(db);
  assert.equal(listed[0].memberName, 'Owner');
  assert.ok(!('tokenHash' in listed[0]));
  assert.deepEqual(Object.keys(listed[0]).filter((k) => ['id', 'name', 'memberId', 'memberName', 'scope', 'groupIds', 'createdAt', 'expiresAt', 'lastUsedAt', 'lastClientName', 'revoked'].includes(k)).length, 11);
});

test('tokens: verify refuses wrong, expired, revoked and wrong-kind tokens', async () => {
  const db = createFakePrisma();
  const { id, token } = await aiTokens.createToken(db, { name: 'T', scope: 'read', expiresInDays: 7 }, { now: Date.now() });
  assert.equal((await aiTokens.verifyToken(db, token)).ok, true);
  assert.equal((await aiTokens.verifyToken(db, 'sgai_nope')).code, 'BAD_TOKEN');
  assert.equal((await aiTokens.verifyToken(db, '')).code, 'NO_TOKEN');
  assert.equal((await aiTokens.verifyToken(db, token, { now: Date.now() + 8 * 86400000 })).code, 'EXPIRED');
  const api = await aiTokens.createToken(db, { name: 'Script', scope: 'operate' }, { kind: 'api' });
  assert.match(api.token, /^sg_/);
  assert.equal((await aiTokens.verifyToken(db, api.token, { kinds: ['ai'] })).code, 'WRONG_KIND');
  await aiTokens.revokeToken(db, id);
  const r = await aiTokens.verifyToken(db, token);
  assert.equal(r.code, 'REVOKED');
  assert.equal(r.status, 401);
});

test('tokens: pre-approved tools need the Owner, the operate scope, groups and an allowed tool', () => {
  const allowed = ['start_profile', 'page_navigate'];
  const base = { name: 'n8n', scope: 'operate', groupIds: [1], preApprovedTools: ['start_profile'] };
  const ok = aiTokens.normalizeCreateInput(base, { allowedPreApprovedTools: allowed, callerIsOwner: true });
  assert.deepEqual(ok.preApproved, { tools: ['start_profile'], maxProfilesPerCall: 5, maxCallsPerHour: 60 });
  assert.throws(() => aiTokens.normalizeCreateInput(base, { allowedPreApprovedTools: allowed, callerIsOwner: false }), /Only the Owner/);
  assert.throws(() => aiTokens.normalizeCreateInput({ ...base, groupIds: [] }, { allowedPreApprovedTools: allowed, callerIsOwner: true }), /limited to one or more groups/);
  assert.throws(() => aiTokens.normalizeCreateInput({ ...base, scope: 'read' }, { allowedPreApprovedTools: allowed, callerIsOwner: true }), /operate scope/);
  assert.throws(() => aiTokens.normalizeCreateInput({ ...base, preApprovedTools: ['get_cdp_endpoint'] }, { allowedPreApprovedTools: allowed, callerIsOwner: true }), /cannot be pre-approved/);
  assert.throws(() => aiTokens.normalizeCreateInput({ name: '', scope: 'read' }), /Give the token a name/);
  assert.throws(() => aiTokens.normalizeCreateInput({ name: 'x', scope: 'admin' }), /read, operate or full/);
  assert.equal(aiTokens.scopeAllows('operate', 'read'), true);
  assert.equal(aiTokens.scopeAllows('operate', 'full'), false);
});

test('tokens: the service resolves the member a token acts as and refuses blocked members', async () => {
  const ai = require('../src/main/ai');
  const db = createFakePrisma({ member: [{ id: 1, name: 'O', role: 'OWNER', status: 'active' }, { id: 2, name: 'S', role: 'OPERATOR', status: 'suspended' }] });
  assert.deepEqual(await ai.resolveTokenMember(db, { memberId: null }), { ok: true, memberId: 1, role: 'OWNER', memberName: 'O' });
  assert.equal((await ai.resolveTokenMember(db, { memberId: 2 })).code, 'MEMBER_BLOCKED');
  assert.equal((await ai.resolveTokenMember(db, { memberId: 9 })).code, 'MEMBER_GONE');
  assert.deepEqual(await ai.resolveTokenMember(createFakePrisma(), { memberId: null }), { ok: true, memberId: null, role: 'OWNER', memberName: 'Workspace owner' }, 'single-user mode');
});

// ---- Host / Origin ----
test('Host and Origin checks stop DNS rebinding and web pages', () => {
  localApi.configure({ ai: { settings: () => ({ extraAllowedHosts: [] }), isEnabled: () => true } });
  assert.equal(localApi.hostAllowed('127.0.0.1:8080', 8080), true);
  assert.equal(localApi.hostAllowed('localhost:8080', 8080), true);
  assert.equal(localApi.hostAllowed('[::1]:8080', 8080), true);
  assert.equal(localApi.hostAllowed('127.0.0.1:8081', 8080), false);
  assert.equal(localApi.hostAllowed('evil.example:8080', 8080), false);
  assert.equal(localApi.hostAllowed('host.docker.internal:8080', 8080), false);
  assert.equal(localApi.hostAllowed('', 8080), false);
  assert.equal(localApi.originAllowed(undefined, 8080), true, 'native clients send no Origin');
  assert.equal(localApi.originAllowed('null', 8080), false);
  assert.equal(localApi.originAllowed('https://evil.example', 8080), false);
  assert.equal(localApi.originAllowed('http://127.0.0.1:8080', 8080), true);
  localApi.configure({ ai: { settings: () => ({ extraAllowedHosts: ['host.docker.internal'] }), isEnabled: () => true } });
  assert.equal(localApi.hostAllowed('host.docker.internal:8080', 8080), true);
  assert.equal(localApi.originAllowed('http://host.docker.internal:8080', 8080), true);
});

test('settings: never is for reads only; extra hosts and Expert mode are Owner-only and validated', () => {
  const s = aiSettings.normalizeStored(null);
  assert.deepEqual(s.approvalMode, { read: 'never', operate: 'ask-hour', full: 'ask-always' });
  assert.equal(s.enabled, false);
  assert.throws(() => aiSettings.applyPatch(s, { approvalMode: { operate: 'never' } }), /only for read-only tools/);
  assert.equal(aiSettings.applyPatch(s, { approvalMode: { read: 'ask-always' } }).approvalMode.read, 'ask-always');
  assert.throws(() => aiSettings.applyPatch(s, { expertMode: true }, { isOwner: false }), /Only the Owner/);
  assert.throws(() => aiSettings.applyPatch(s, { extraAllowedHosts: ['*'] }, { isOwner: true }), /Wildcards/);
  assert.throws(() => aiSettings.applyPatch(s, { extraAllowedHosts: ['bad host'] }, { isOwner: true }), /not a host name/);
  assert.deepEqual(aiSettings.applyPatch(s, { extraAllowedHosts: ['Host.Docker.Internal:8080', 'localhost'] }, { isOwner: true }).extraAllowedHosts, ['host.docker.internal']);
  assert.deepEqual(aiSettings.applyPatch(s, { pageDomainAllowList: ['https://Example.com/path', '*.shop.test'] }).pageDomainAllowList, ['example.com', 'shop.test']);
  assert.throws(() => aiSettings.parsePort(80), /1024 to 65535/);
});

// ---- memories ----
test('memory: 20 KB limit, sections append and replace, default template fits', async () => {
  assert.ok(memories.byteLength(memories.DEFAULT_WORKSPACE_MEMORY) < memories.MAX_MEMORY_BYTES);
  const store = new Map();
  const mem = memories.createMemoryStore({ read: async (k, f) => (store.has(k) ? store.get(k) : f), write: async (k, v) => store.set(k, v) });
  const first = await mem.get();
  assert.equal(first.isDefault, true);
  await assert.rejects(() => mem.set('x'.repeat(20 * 1024 + 1)), /limited to 20 KB/);
  const saved = await mem.set('# Notes\n\n## Proxy rules\n- US only\n\n## Never do\n- delete\n');
  assert.equal(saved.isDefault, false);
  const appended = memories.applyMemoryUpdate(saved.markdown, { mode: 'append', section: 'Proxy rules', text: '- check daily' });
  assert.match(appended, /## Proxy rules\n- US only\n- check daily\n/);
  const replaced = memories.applyMemoryUpdate(appended, { mode: 'replace_section', section: 'never do', text: '- never post' });
  assert.match(replaced, /## Never do\n- never post/);
  assert.ok(!replaced.includes('- delete'));
  const created = memories.applyMemoryUpdate(saved.markdown, { mode: 'append', section: 'Working hours', text: '- 9 to 5' });
  assert.match(created, /## Working hours\n- 9 to 5\n$/);
  assert.throws(() => memories.applyMemoryUpdate(saved.markdown, { mode: 'append', text: 'y'.repeat(21 * 1024) }), /limited to 20 KB/);
  assert.throws(() => memories.applyMemoryUpdate(saved.markdown, { mode: 'replace_section', text: 'z' }), /needs the section heading/);
  const reset = await mem.reset();
  assert.equal(reset.markdown, memories.DEFAULT_WORKSPACE_MEMORY);
});

test('guides describe the real app and the acceptable use policy', () => {
  for (const s of ['Chromium refuses SOCKS4', 'Pro 3', 'Enterprise and the trial 10', 'Allow for', 'Stop all AI', 'untrusted', '"undetectable"']) {
    assert.ok(memories.HOW_SOFTGLAZE_WORKS.includes(s), s);
  }
  for (const s of ['Fraud', 'Breaking into accounts', 'Evading enforcement', 'Spam', 'Trading in accounts', 'browser.softglaze.com/acceptable-use']) {
    assert.ok(memories.ACCEPTABLE_USE.includes(s), s);
  }
  assert.ok(!/undetectable profile|guaranteed undetect/i.test(memories.HOW_SOFTGLAZE_WORKS));
});

// ---- prompts ----
test('prompts: the 12 launch prompts, with arguments enforced', () => {
  const names = prompts.listPrompts().map((p) => p.name);
  assert.deepEqual(names, ['daily_health_check', 'diagnose_captcha', 'create_geo_profiles', 'fix_proxy_mismatches', 'rotate_bad_proxies', 'warm_up_profiles', 'write_macro', 'run_macro_on_group', 'qa_test_site', 'price_check', 'team_access_review', 'weekly_report']);
  for (const p of prompts.listPrompts()) {
    assert.ok(p.title && p.description && p.text.includes('softglaze://memory/workspace'), p.name);
    for (const a of p.arguments) assert.equal(typeof a.required, 'boolean');
  }
  assert.throws(() => prompts.renderPrompt('diagnose_captcha', {}), /needs "profile"/);
  assert.match(prompts.renderPrompt('diagnose_captcha', { profile: 'US-01' }), /"US-01" keeps getting CAPTCHAs/);
  assert.match(prompts.renderPrompt('daily_health_check', {}), /Run a daily health check of my SoftGlaze workspace\./);
  assert.match(prompts.renderPrompt('daily_health_check', { group: 'QA' }), /for the group "QA"/);
  assert.match(prompts.renderPrompt('qa_test_site', { url: 'https://my.site', countries: 'US,DE' }), /read only/);
  assert.throws(() => prompts.renderPrompt('nope'), /Unknown prompt/);
  const all = prompts.PROMPTS.map((p) => p.build({ profile: 'p', count: '1', country: 'us', group: 'g', goal: 'x', site: 'y', macro: 'm', url: 'u', countries: 'c' })).join('\n');
  assert.ok(!/create (new )?accounts at scale|bypass captcha|solve captcha/i.test(all), 'legitimate uses only');
});

// ---- snippets ----
test('snippets carry the real port, the token placeholder and each client\'s current format', () => {
  const list = snippets.buildSnippets({ port: 18080, bridge: { command: 'C:\\SG\\SoftGlaze Browser.exe', args: ['C:\\SG\\bridge.js'], env: { ELECTRON_RUN_AS_NODE: '1' } } });
  const by = Object.fromEntries(list.map((s) => [s.client, s]));
  for (const s of list) {
    assert.ok(['command', 'json', 'toml'].includes(s.kind), s.client);
    assert.ok(s.text.includes('18080'), s.client);
    assert.ok(s.where && /^https:\/\//.test(s.docsUrl), s.client);
  }
  assert.equal(by['claude-code'].text, 'claude mcp add --transport http softglaze http://127.0.0.1:18080/mcp --header "Authorization: Bearer <YOUR_TOKEN>"');
  assert.deepEqual(JSON.parse(by.cursor.text), { mcpServers: { softglaze: { url: 'http://127.0.0.1:18080/mcp', headers: { Authorization: 'Bearer <YOUR_TOKEN>' } } } });
  const vs = JSON.parse(by.vscode.text);
  assert.equal(vs.servers.softglaze.type, 'http');
  assert.equal(vs.servers.softglaze.headers.Authorization, 'Bearer ${input:softglaze-token}');
  assert.equal(vs.inputs[0].password, true);
  assert.equal(JSON.parse(by['gemini-cli'].text).mcpServers.softglaze.httpUrl, 'http://127.0.0.1:18080/mcp');
  assert.match(by.codex.text, /^\[mcp_servers\.softglaze\]\nurl = "http:\/\/127\.0\.0\.1:18080\/mcp"\nbearer_token_env_var = "SOFTGLAZE_TOKEN"/);
  assert.equal(JSON.parse(by.windsurf.text).mcpServers.softglaze.serverUrl, 'http://127.0.0.1:18080/mcp');
  assert.equal(JSON.parse(by.cline.text).mcpServers.softglaze.type, 'streamableHttp');
  assert.equal(JSON.parse(by.n8n.text).sseEndpoint, 'http://127.0.0.1:18080/mcp/sse');
  const desktop = JSON.parse(by['claude-desktop'].text).mcpServers.softglaze;
  assert.equal(desktop.command, 'C:\\SG\\SoftGlaze Browser.exe');
  assert.equal(desktop.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(desktop.env.SOFTGLAZE_TOKEN, '<YOUR_TOKEN>');
});

// ---- redaction, actor, page snapshot ----
test('redaction keeps ids and names but hides secrets, typed text and tokens', () => {
  const r = redactArgs({ id: 4, name: 'US-01', text: 'my password 123', password: 'x', steps: [{ type: 'type', selector: '#pw', value: 'secret' }], proxyId: 3 });
  assert.equal(r.id, 4);
  assert.equal(r.name, 'US-01');
  assert.equal(r.text, '[15 characters hidden]');
  assert.equal(r.password, '[hidden]');
  assert.equal(r.steps[0].selector, '#pw');
  assert.equal(r.steps[0].value, '[6 characters hidden]');
  assert.equal(scrubText('failed http://user:pass@1.2.3.4:80 with sgai_abcdefghijklmnop and Bearer abc.def'), 'failed http://[credentials]@1.2.3.4:80 with [token] and Bearer [token]');
});

test('actor: API and AI actions are marked in the activity log', () => {
  assert.equal(actor.tagDetail('edited "x"'), 'edited "x"');
  actor.run({ memberId: 1, tokenName: 'T', clientName: 'Cursor', via: 'ai' }, () => {
    assert.equal(actor.tagDetail('edited "x"'), '[via AI: Cursor] edited "x"');
    assert.deepEqual(actor.tagDetail({ a: 1 }), { a: 1, via: '[via AI: Cursor]' });
  });
  actor.run({ memberId: 1, tokenName: 'Script', via: 'api' }, () => assert.equal(actor.tagDetail(null), '[via Local API: Script]'));
});

test('page snapshot lines hide password-like values and give aria selector hints', () => {
  const { lines } = flattenAx({ role: 'RootWebArea', children: [
    { role: 'textbox', name: 'One-time code', value: '123456' },
    { role: 'textbox', name: 'City', value: 'Lahore' },
    { role: 'button', name: 'Pay "now"' },
    { role: 'link', name: 'Home' }
  ] }, 50);
  assert.match(lines[0], /value="\[hidden\]"/);
  assert.match(lines[1], /value="Lahore"/);
  assert.ok(!lines[2].includes('{aria/'), 'names with quotes get no selector hint');
  assert.match(lines[3], /\{aria\/Home\[role="link"\]\}/);
});

test('audit: rows are redacted and paged newest first with a cursor', async () => {
  const db = createFakePrisma();
  for (let i = 1; i <= 5; i += 1) await aiAudit.record(db, { tokenId: 1, tokenName: 'T', tool: 'list_profiles', outcome: 'ok', args: { text: 'secret text', id: i }, summary: `call ${i}` });
  const p1 = await aiAudit.list(db, { limit: 2 });
  assert.deepEqual(p1.items.map((x) => x.summary), ['call 5', 'call 4']);
  assert.ok(p1.nextCursor);
  const p3 = await aiAudit.list(db, { limit: 2, cursor: (await aiAudit.list(db, { limit: 2, cursor: p1.nextCursor })).nextCursor });
  assert.deepEqual(p3.items.map((x) => x.summary), ['call 1']);
  assert.equal(p3.nextCursor, null);
  assert.equal(p1.items[0].args.text, '[11 characters hidden]');
  assert.equal(p1.items[0].args.id, 5);
});

test('audit: clientName and search filter before paging', async () => {
  const db = createFakePrisma();
  const rows = [
    { tool: 'start_profile', clientName: 'Claude Code', tokenName: 'Laptop', summary: 'Start profile #1 (US-01)' },
    { tool: 'list_profiles', clientName: 'Cursor', tokenName: 'Laptop', summary: 'List profiles' },
    { tool: 'start_profile', clientName: 'Cursor', tokenName: 'n8n nightly', summary: 'Start profile #2 (DE-02)' },
    { tool: 'page_click', clientName: 'Claude Code', tokenName: 'Laptop', summary: 'Click #buy in profile #1' }
  ];
  for (const r of rows) await aiAudit.record(db, { ...r, outcome: 'ok' });
  const byClient = await aiAudit.list(db, { clientName: 'Cursor' });
  assert.deepEqual(byClient.items.map((x) => x.tool), ['start_profile', 'list_profiles']);
  const bySearch = await aiAudit.list(db, { search: 'start' });
  assert.deepEqual(bySearch.items.map((x) => x.summary), ['Start profile #2 (DE-02)', 'Start profile #1 (US-01)']);
  assert.deepEqual((await aiAudit.list(db, { search: 'nightly' })).items.map((x) => x.tokenName), ['n8n nightly'], 'searches token names');
  assert.deepEqual((await aiAudit.list(db, { search: 'US-01' })).items.map((x) => x.tool), ['start_profile'], 'searches summaries');
  const paged = await aiAudit.list(db, { clientName: 'Claude Code', limit: 1 });
  assert.equal(paged.items[0].tool, 'page_click');
  const next = await aiAudit.list(db, { clientName: 'Claude Code', limit: 1, cursor: paged.nextCursor });
  assert.deepEqual(next.items.map((x) => x.tool), ['start_profile'], 'the filter holds on the next page');
  assert.equal(next.nextCursor, null);
  assert.equal((await aiAudit.list(db, { search: '   ' })).items.length, 4, 'blank search filters nothing');
});

test('approvals name the member the token acts as', async () => {
  const seen = [];
  const h = harness({ onEmit: (c, d) => { if (c === 'ai:approval-requested') seen.push(d); } });
  h.approvals.emit = (c, d) => { if (c === 'ai:approval-requested') { seen.push(d); setTimeout(() => h.approvals.respond(d.id, 'deny'), 10); } };
  await h.call('create_group', { name: 'G' }, { memberId: 2, memberName: 'Operator Omar' });
  assert.equal(seen[0].memberId, 2);
  assert.equal(seen[0].memberName, 'Operator Omar');
});

test('makeToken helper produces working AI tokens for the fake workspace', async () => {
  const app = createFakeApp();
  const { token } = await makeToken(app.db, { name: 'x', memberId: 1, scope: 'read' });
  assert.equal((await aiTokens.verifyToken(app.db, token)).ok, true);
});
