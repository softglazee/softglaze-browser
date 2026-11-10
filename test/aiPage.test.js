'use strict';
// SoftGlaze AI page (renderer side of spec §10/§11): snippets, the token-once flow, the approvals
// queue and its countdown, the "not available in this build" state, permission gating, wiring and
// the en/es strings. Pure logic lives in src/renderer/lib/aiCore.mjs and aiApprovals.mjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const loadCore = () => import('../src/renderer/lib/aiCore.mjs');
const loadQueue = () => import('../src/renderer/lib/aiApprovals.mjs');

const AI_DIR = path.join(ROOT, 'src', 'renderer', 'components', 'ai');
const AI_SOURCES = [
  ...fs.readdirSync(AI_DIR).filter((f) => f.endsWith('.jsx')).map((f) => path.join('src', 'renderer', 'components', 'ai', f)),
  path.join('src', 'renderer', 'pages', 'AiPage.jsx')
];

// ---- snippets ---------------------------------------------------------------------------

test('snippets: the token placeholder is split out for highlighting and filled only with a real token', async () => {
  const { splitSnippet, fillToken, hasPlaceholder, TOKEN_PLACEHOLDER } = await loadCore();
  const cmd = 'claude mcp add --transport http softglaze http://127.0.0.1:47321/mcp --header "Authorization: Bearer <YOUR_TOKEN>"';
  const segs = splitSnippet(cmd);
  assert.equal(segs.map((s) => s.text).join(''), cmd, 'nothing is lost');
  assert.deepEqual(segs.filter((s) => s.placeholder).map((s) => s.text), [TOKEN_PLACEHOLDER]);
  assert.deepEqual(splitSnippet('no token here'), [{ text: 'no token here', placeholder: false }]);
  assert.deepEqual(splitSnippet(''), []);
  const two = '{"a":"<YOUR_TOKEN>","b":"<YOUR_TOKEN>"}';
  assert.equal(splitSnippet(two).filter((s) => s.placeholder).length, 2);
  assert.equal(fillToken(two, 'sgai_abc'), '{"a":"sgai_abc","b":"sgai_abc"}');
  assert.equal(fillToken(two, ''), two, 'an empty token leaves the placeholder');
  assert.equal(fillToken(two, null), two);
  assert.equal(hasPlaceholder(cmd), true);
  assert.equal(hasPlaceholder('[mcp_servers.softglaze]\nbearer_token_env_var = "SOFTGLAZE_TOKEN"'), false);
});

test('snippets: clients come in a fixed order, n8n is added, unknown ones keep their title before "Other apps"', async () => {
  const { buildClientList, normalizeClientKey, docsUrlFor, appDocsUrl, DOCS_BASE } = await loadCore();
  const status = { enabled: true, running: true, port: 47321, url: 'http://127.0.0.1:47321/mcp' };
  const snippets = [
    { client: 'others', title: 'Windsurf, Cline, others', kind: 'json', where: 'MCP settings', text: '{}', docsUrl: '' },
    { client: 'cursor', title: 'Cursor', kind: 'json', where: '~/.cursor/mcp.json', text: '{"url":"<YOUR_TOKEN>"}', docsUrl: 'https://cursor.com/docs/context/mcp' },
    { client: 'Claude Code', title: 'Claude Code', kind: 'command', where: 'Terminal', text: 'claude mcp add', docsUrl: null },
    { client: 'zed', title: 'Zed', kind: 'json', where: 'settings.json', text: '{}' },
    { client: 'claude_desktop', title: 'Claude Desktop', kind: 'json', where: 'claude_desktop_config.json', text: '{}' },
    { client: 'chatgpt-desktop', title: 'ChatGPT desktop / Codex', kind: 'toml', where: '~/.codex/config.toml', text: '[mcp_servers.softglaze]' },
    null,
    { client: 'cursor', title: 'duplicate', kind: 'json', text: 'x' }
  ];
  const list = buildClientList(snippets, status);
  assert.deepEqual(list.map((c) => c.key), ['claude-desktop', 'claude-code', 'cursor', 'codex', 'n8n', 'custom:zed', 'other']);
  assert.equal(list.find((c) => c.key === 'cursor').title, 'Cursor', 'the first snippet for a client wins');
  const cursor = list.find((c) => c.key === 'cursor');
  assert.equal(cursor.docsUrl, `${DOCS_BASE}#cursor`, 'the guide button is always our own page, with the client anchor');
  assert.equal(cursor.appDocsUrl, 'https://cursor.com/docs/context/mcp', "the app's own docs are a separate link");
  assert.equal(list.find((c) => c.key === 'claude-code').docsUrl, `${DOCS_BASE}#claude-code`);
  assert.equal(list.find((c) => c.key === 'claude-code').appDocsUrl, null);
  assert.equal(list.find((c) => c.key === 'n8n').docsUrl, `${DOCS_BASE}#n8n`);
  assert.equal(list.find((c) => c.key === 'custom:zed').known, false);
  assert.equal(docsUrlFor('custom:zed'), DOCS_BASE);
  assert.equal(appDocsUrl('javascript:alert(1)'), null, 'only https links');
  assert.equal(appDocsUrl('https://browser.softglaze.com/docs/ai-agents#x'), null, 'never our own site twice');
  for (const [raw, key] of [['VS Code', 'vscode'], ['vscode-copilot', 'vscode'], ['gemini', 'gemini-cli'], ['Codex', 'codex'], ['n8n', 'n8n'], ['Windsurf', 'windsurf'], ['cline', 'cline'], ['generic', 'other'], ['nope', null]]) {
    assert.equal(normalizeClientKey(raw), key, raw);
  }
  assert.deepEqual(buildClientList([], { enabled: false }), [], 'no port, no n8n card, no crash');
  // The engine's own client ids (src/main/ai/snippets.js) all get a card, in the page's order.
  const engineIds = ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'gemini-cli', 'codex', 'windsurf', 'cline', 'n8n', 'generic'];
  assert.deepEqual(buildClientList(engineIds.map((client) => ({ client, title: client, kind: 'json', text: '{}' })), status).map((c) => c.key),
    ['claude-desktop', 'claude-code', 'cursor', 'vscode', 'gemini-cli', 'codex', 'windsurf', 'cline', 'n8n', 'other']);
  assert.deepEqual(buildClientList(undefined, null), []);
});

test('snippets: n8n uses the engine sseUrl when given, a Docker variant, and the Local API base', async () => {
  const { n8nEndpoints, envVarCommand, serverAddress, serverState, mcpUrl } = await loadCore();
  const a = n8nEndpoints({ port: 47321, url: 'http://127.0.0.1:47321/mcp' });
  assert.equal(a.sse, 'http://127.0.0.1:47321/mcp/sse');
  assert.equal(a.sseDocker, 'http://host.docker.internal:47321/mcp/sse');
  assert.equal(a.apiStart, 'POST http://127.0.0.1:47321/api/v1/profiles/<PROFILE_ID>/start');
  assert.match(a.authHeader, /^Authorization: Bearer <YOUR_TOKEN>$/);
  const b = n8nEndpoints({ port: 47321, sseUrl: 'http://127.0.0.1:47321/sse' });
  assert.equal(b.sse, 'http://127.0.0.1:47321/sse');
  assert.equal(b.sseDocker, 'http://host.docker.internal:47321/sse');
  assert.equal(n8nEndpoints({}), null);
  assert.equal(envVarCommand('Windows', 'sgai_x'), 'setx SOFTGLAZE_TOKEN "sgai_x"');
  assert.equal(envVarCommand('macOS', 'sgai_x'), 'export SOFTGLAZE_TOKEN="sgai_x"');
  assert.equal(serverAddress({ port: 47321 }), '127.0.0.1:47321');
  assert.equal(mcpUrl({ port: 9 }), 'http://127.0.0.1:9/mcp');
  assert.equal(serverState({ enabled: true, running: true }), 'running');
  assert.equal(serverState({ enabled: true, running: false }), 'error');
  assert.equal(serverState({ enabled: false, running: false }), 'off');
  assert.equal(serverState(null), 'unknown');
});

// ---- token-once flow --------------------------------------------------------------------

test('token flow: the plain token exists only in the reveal step and is wiped on close', async () => {
  const { tokenFlowReducer: r, initialTokenFlow, canFinishReveal } = await loadCore();
  let s = r(initialTokenFlow, { type: 'open', form: { name: 'Claude Code on this PC' }, client: { key: 'claude-code' } });
  assert.equal(s.step, 'form');
  s = r(s, { type: 'edit', patch: { name: 'CC' } });
  assert.equal(s.form.name, 'CC');
  s = r(s, { type: 'submit' });
  assert.equal(s.step, 'saving');
  assert.equal(r(s, { type: 'close' }), s, 'cannot close while the token is being created');
  assert.equal(r(s, { type: 'edit', patch: { name: 'x' } }), s, 'no edits while saving');
  s = r(s, { type: 'created', token: 'sgai_0123456789012345678901234567890123456789', id: 7 });
  assert.equal(s.step, 'reveal');
  assert.equal(s.tokenId, 7);
  assert.equal(canFinishReveal(s), false);

  const warned = r(s, { type: 'close' });
  assert.equal(warned.step, 'reveal', 'closing before copying only warns');
  assert.equal(warned.closeWarning, true);
  assert.equal(warned.token, s.token);

  const copied = r(warned, { type: 'copied' });
  assert.equal(copied.closeWarning, false);
  assert.equal(canFinishReveal(copied), true);
  const closed = r(copied, { type: 'close' });
  assert.deepEqual(closed, { ...initialTokenFlow });
  assert.equal(closed.token, '', 'the token is gone once the dialog closes');

  const acked = r(s, { type: 'acknowledge', value: true });
  assert.equal(canFinishReveal(acked), true, 'ticking "I saved it" also allows Done');
  assert.equal(r(acked, { type: 'close' }).token, '');
  assert.equal(r(s, { type: 'close', force: true }).step, 'closed');
});

test('token flow: failures go back to the form and a reply without a token is an error', async () => {
  const { tokenFlowReducer: r, initialTokenFlow } = await loadCore();
  const saving = r(r(initialTokenFlow, { type: 'open', form: { name: 'a' } }), { type: 'submit' });
  const failed = r(saving, { type: 'failed', error: 'Token limit reached' });
  assert.equal(failed.step, 'form');
  assert.equal(failed.error, 'Token limit reached');
  const empty = r(saving, { type: 'created', token: '' });
  assert.equal(empty.step, 'form');
  assert.equal(empty.error, 'errors.noToken');
  assert.equal(r(initialTokenFlow, { type: 'created', token: 'x' }), initialTokenFlow, 'a stray reply is ignored');
  assert.equal(r(initialTokenFlow, { type: 'copied' }), initialTokenFlow);
});

test('token form: validation and the create input (spec §10), automation only for the Owner (spec §11)', async () => {
  const { defaultTokenForm, validateTokenForm, buildTokenInput, automationActive } = await loadCore();
  const members = [{ id: 1, name: 'Azhar', role: 'OWNER' }, { id: 2, name: 'Sam', role: 'ADMIN' }, { id: 3, name: 'Old', role: 'OPERATOR', status: 'banned' }];
  const f = defaultTokenForm({ me: { id: 2, role: 'ADMIN' }, members, clientTitle: 'Cursor' });
  assert.equal(f.name, 'Cursor on this PC');
  assert.equal(f.memberId, 2, 'defaults to the signed-in member');
  assert.equal(f.scope, 'read', 'Read only by default; Operate is picked on purpose');
  assert.equal(defaultTokenForm({ members, automation: true }).scope, 'operate', 'an Automation token starts at Operate');
  assert.equal(f.expiresInDays, 30);
  assert.deepEqual(validateTokenForm(f), {});
  assert.deepEqual(buildTokenInput(f), { name: 'Cursor on this PC', memberId: 2, scope: 'read', expiresInDays: 30, groupIds: [] });

  assert.equal(validateTokenForm({ ...f, name: '  ' }).name, 'errors.nameRequired');
  assert.equal(validateTokenForm({ ...f, name: 'x'.repeat(61) }).name, 'errors.nameTooLong');
  assert.equal(validateTokenForm({ ...f, memberId: null }).memberId, 'errors.memberRequired');
  assert.equal(validateTokenForm({ ...f, memberId: null }, { hasMembers: false }).memberId, undefined, 'single-user mode has no member to pick');
  assert.equal(validateTokenForm({ ...f, groupMode: 'some', groupIds: [] }).groupIds, 'errors.groupsRequired');
  assert.deepEqual(buildTokenInput({ ...f, expiresInDays: null, groupMode: 'some', groupIds: [4, 5] }).groupIds, [4, 5]);
  assert.equal(buildTokenInput({ ...f, expiresInDays: null }).expiresInDays, null, 'never expires');
  assert.deepEqual(buildTokenInput({ ...f, groupMode: 'all', groupIds: [4] }).groupIds, [], '"All" sends no group limit');

  const auto = { ...f, scope: 'operate', automation: true, preApprovedTools: ['start_profile', 'run_macro'], groupMode: 'all' };
  assert.equal(automationActive(auto, { isOwner: true }), true);
  assert.equal(validateTokenForm(auto, { isOwner: true }).groupIds, 'errors.groupsRequiredAutomation', 'automation needs groups');
  const ok = { ...auto, groupMode: 'some', groupIds: [9] };
  assert.deepEqual(validateTokenForm(ok, { isOwner: true }), {});
  assert.deepEqual(buildTokenInput(ok, { isOwner: true }), {
    name: 'Cursor on this PC', memberId: 2, scope: 'operate', expiresInDays: 30, groupIds: [9],
    preApprovedTools: ['start_profile', 'run_macro'], maxProfilesPerCall: 5, maxCallsPerHour: 60
  });
  assert.equal('preApprovedTools' in buildTokenInput(ok, { isOwner: false }), false, 'an Admin never sends automation fields');
  assert.equal(automationActive({ ...ok, scope: 'read' }, { isOwner: true }), false, 'read-only tokens cannot pre-approve');
  assert.equal(validateTokenForm({ ...ok, preApprovedTools: ['get_cdp_endpoint'] }, { isOwner: true }).preApprovedTools, 'errors.toolNotAllowed');
  assert.equal(validateTokenForm({ ...ok, maxCallsPerHour: 0 }, { isOwner: true }).maxCallsPerHour, 'errors.limitRange');
  assert.equal(validateTokenForm({ ...ok, maxProfilesPerCall: 101 }, { isOwner: true }).maxProfilesPerCall, 'errors.limitRange');
});

test('token form: the pre-approvable list comes from ai:preapprovable-tools, with the built-in list as fallback', async () => {
  const { groupPreapprovable, preapprovableNames, validateTokenForm, buildTokenInput, PREAPPROVABLE_SET } = await loadCore();
  const fallback = groupPreapprovable(null);
  assert.deepEqual([...preapprovableNames(fallback)].sort(), [...PREAPPROVABLE_SET].sort(), 'no list from the engine: the built-in one');
  assert.deepEqual(groupPreapprovable([]).map((g) => g.group), fallback.map((g) => g.group), 'an empty list also falls back');
  const engine = [
    { name: 'start_profile', title: 'Start a profile', scope: 'operate', destructive: false },
    { name: 'bulk_tag_profiles', title: 'Tag profiles', scope: 'operate', destructive: false },
    { name: 'stop_profile', title: 'Stop a profile', scope: 'operate', destructive: true },
    { name: 'get_cdp_endpoint', title: 'CDP', scope: 'full', destructive: false },
    { name: 'start_profile', title: 'dup', scope: 'operate' },
    null
  ];
  const groups = groupPreapprovable(engine);
  assert.deepEqual(groups.map((g) => [g.group, g.tools.map((x) => x.name)]), [['sessions', ['start_profile', 'stop_profile']], ['other', ['bulk_tag_profiles']]], 'grouped, deduped, operate only');
  assert.equal(groups[0].tools[1].destructive, true);
  assert.equal(groups[1].tools[0].title, 'Tag profiles');
  const allowedTools = preapprovableNames(groups);
  const form = { name: 'n8n', memberId: 1, scope: 'operate', expiresInDays: 30, groupMode: 'some', groupIds: [1], automation: true, preApprovedTools: ['bulk_tag_profiles'], maxProfilesPerCall: 5, maxCallsPerHour: 60 };
  assert.deepEqual(validateTokenForm(form, { isOwner: true, allowedTools }), {}, 'a tool the engine offers is accepted');
  assert.deepEqual(buildTokenInput(form, { isOwner: true, allowedTools }).preApprovedTools, ['bulk_tag_profiles']);
  assert.equal(validateTokenForm({ ...form, preApprovedTools: ['run_macro'] }, { isOwner: true, allowedTools }).preApprovedTools, 'errors.toolNotAllowed', 'one it does not offer is refused');
  const page = read('src', 'renderer', 'pages', 'AiPage.jsx');
  assert.match(page, /softglazeApi\.ai\.preapprovableTools\(\)\.then\(\(l\) => \{ if \(live\) setPreTools\(Array\.isArray\(l\) \? l : null\); \}\)\.catch\(\(\) => \{ if \(live\) setPreTools\(null\); \}\)/, 'a rejected channel keeps the built-in list');
});

test('token form: pre-approvable tools are operate tools only, never expert or never-exposed ones', async () => {
  const { PREAPPROVABLE_SET } = await loadCore();
  for (const bad of ['get_cdp_endpoint', 'list_profiles', 'workspace_summary', 'read_memory', 'update_memory', 'stop_all_profiles', 'export_cookies', 'delete_profile']) {
    assert.equal(PREAPPROVABLE_SET.has(bad), false, bad);
  }
  for (const good of ['start_profile', 'stop_profile', 'run_macro', 'page_click']) assert.equal(PREAPPROVABLE_SET.has(good), true, good);
});

test('tokens table: state, order and filters', async () => {
  const { tokenState, sortTokens, filterTokens, isAutomationToken } = await loadCore();
  const now = Date.parse('2026-11-07T12:00:00Z');
  const day = 86400000;
  const toks = [
    { id: 1, name: 'old', createdAt: '2026-10-01T00:00:00Z', revoked: true },
    { id: 2, name: 'gone', createdAt: '2026-10-02T00:00:00Z', expiresAt: new Date(now - day).toISOString() },
    { id: 3, name: 'soon', createdAt: '2026-10-03T00:00:00Z', expiresAt: new Date(now + day).toISOString(), memberName: 'Sam' },
    { id: 4, name: 'Cursor', createdAt: '2026-11-01T00:00:00Z', expiresAt: null, lastClientName: 'cursor', preApprovedTools: ['start_profile'] }
  ];
  assert.deepEqual(toks.map((t) => tokenState(t, now)), ['revoked', 'expired', 'expiring', 'active']);
  assert.deepEqual(sortTokens(toks, now).map((t) => t.id), [4, 3, 2, 1]);
  assert.deepEqual(filterTokens(toks, {}, now).map((t) => t.id), [2, 3, 4], 'revoked are hidden by default');
  assert.deepEqual(filterTokens(toks, { showRevoked: true }, now).map((t) => t.id), [1, 2, 3, 4]);
  assert.deepEqual(filterTokens(toks, { query: 'sam' }, now).map((t) => t.id), [3], 'search covers the member');
  assert.deepEqual(filterTokens(toks, { query: 'CURSOR' }, now).map((t) => t.id), [4]);
  assert.equal(isAutomationToken(toks[3]), true);
  assert.equal(isAutomationToken(toks[2]), false);
});

// ---- approvals queue + countdown -------------------------------------------------------

const T0 = Date.parse('2026-11-07T12:00:00Z');
const appr = (id, offsetMs = 0, extra = {}) => ({
  id, tokenName: 'Claude Code on my PC', clientName: 'Claude Code', tool: 'start_profile',
  summary: `request ${id}`, args: { ids: [1, 2] }, createdAt: new Date(T0 + offsetMs).toISOString(),
  expiresAt: new Date(T0 + offsetMs + 120000).toISOString(), ...extra
});

test('approvals queue: oldest first, duplicates merge, one current at a time', async () => {
  const { enqueue, removeApproval, currentApproval } = await loadQueue();
  let q = [];
  q = enqueue(q, appr('b', 2000), T0 + 2000);
  q = enqueue(q, appr('a', 0), T0 + 2500);
  q = enqueue(q, appr('c', 4000), T0 + 4000);
  assert.deepEqual(q.map((a) => a.id), ['a', 'b', 'c'], 'oldest first, whatever order they arrived in');
  q = enqueue(q, appr('b', 2000, { summary: 'updated' }), T0 + 5000);
  assert.equal(q.length, 3, 'the event and the list carry the same request: no second dialog');
  assert.equal(q[1].summary, 'updated');
  assert.equal(q[1]._receivedMs, T0 + 2000, 'keeps when it first arrived');
  assert.equal(currentApproval(q).id, 'a', 'the dialog shows one request: the oldest');
  assert.equal(currentApproval(q, new Set(['a'])).id, 'b', '"Decide later" moves on to the next');
  assert.equal(currentApproval(q, new Set(['a', 'b', 'c'])), null);
  q = removeApproval(q, 'a');
  assert.equal(currentApproval(q).id, 'b', 'answering shows the next one');
  assert.equal(removeApproval(q, 'zzz'), q, 'unknown id: same array');
  assert.deepEqual(enqueue([], { summary: 'no id' }, T0), [], 'an approval without an id is ignored');
  assert.deepEqual(enqueue([], null, T0), []);
  assert.equal(enqueue([], appr(5), T0).find((a) => a.id === 5)._key, '5', 'numeric ids work');
});

test('approvals queue: server sync drops answered requests but keeps ones that arrived during the call', async () => {
  const { enqueue, syncFromServer } = await loadQueue();
  let q = [];
  q = enqueue(q, appr('a', 0), T0);
  q = enqueue(q, appr('b', 1000), T0 + 1000);
  const requestedAt = T0 + 2000;
  q = enqueue(q, appr('c', 3000), T0 + 3000); // pushed while list() was in flight
  const next = syncFromServer(q, [appr('b', 1000), appr('d', 2500)], requestedAt, T0 + 4000);
  assert.deepEqual(next.map((a) => a.id), ['b', 'd', 'c'], "'a' was answered elsewhere; 'c' is newer than the reply");
  assert.deepEqual(syncFromServer(q, 'garbage', requestedAt, T0 + 4000).map((a) => a.id), ['c']);
});

test('countdown: two minutes by default, ticks down, and expired requests leave the queue', async () => {
  const { enqueue, pruneExpired, secondsLeft, fractionLeft, formatCountdown, urgency, crossedThreshold, normalizeApproval, APPROVAL_TIMEOUT_MS } = await loadQueue();
  assert.equal(APPROVAL_TIMEOUT_MS, 120000);
  const a = normalizeApproval(appr('a'), T0);
  assert.equal(secondsLeft(a, T0), 120);
  assert.equal(secondsLeft(a, T0 + 30500), 90, 'rounds up so it never shows 0 early');
  assert.equal(secondsLeft(a, T0 + 120000), 0);
  assert.equal(secondsLeft(a, T0 + 999999), 0, 'never negative');
  assert.equal(fractionLeft(a, T0), 1);
  assert.equal(fractionLeft(a, T0 + 60000), 0.5);
  assert.equal(fractionLeft(a, T0 + 500000), 0);
  assert.equal(formatCountdown(120), '2:00');
  assert.equal(formatCountdown(65), '1:05');
  assert.equal(formatCountdown(-3), '0:00');
  assert.deepEqual([urgency(90), urgency(30), urgency(10)], ['calm', 'soon', 'urgent']);
  assert.equal(crossedThreshold(31, 30), 30);
  assert.equal(crossedThreshold(11, 9), 10);
  assert.equal(crossedThreshold(50, 49), null, 'screen readers are not told every second');

  const noExpiry = normalizeApproval({ id: 'x', createdAt: new Date(T0).toISOString() }, T0 + 5);
  assert.equal(noExpiry._deadline, T0 + APPROVAL_TIMEOUT_MS, 'missing expiresAt: createdAt + 2 minutes');
  const noDates = normalizeApproval({ id: 'y' }, T0);
  assert.equal(noDates._deadline, T0 + APPROVAL_TIMEOUT_MS, 'no dates at all: received + 2 minutes');

  let q = enqueue(enqueue([], appr('a', 0), T0), appr('b', 60000), T0 + 60000);
  const mid = pruneExpired(q, T0 + 119999);
  assert.equal(mid.queue, q, 'nothing expired: same array, no re-render');
  assert.deepEqual(mid.expired, []);
  const after = pruneExpired(q, T0 + 120000);
  assert.deepEqual(after.queue.map((x) => x.id), ['b']);
  assert.deepEqual(after.expired.map((x) => x.id), ['a'], 'the timed-out one is reported so the user is told');
  assert.deepEqual(enqueue([], appr('late', -200000), T0), [], 'an already-expired request never opens a dialog');
});

test('approvals: decisions and "already gone" errors', async () => {
  const { isDecision, isGoneError, DECISIONS } = await loadQueue();
  assert.deepEqual(DECISIONS, ['allow-once', 'allow-hour', 'deny']);
  assert.equal(isDecision('allow-hour'), true);
  assert.equal(isDecision('allow-forever'), false);
  assert.equal(isGoneError({ code: 'NOT_FOUND' }), true);
  assert.equal(isGoneError({ message: 'This approval has expired.' }), true);
  assert.equal(isGoneError({ message: 'Approval was already answered' }), true);
  assert.equal(isGoneError({ code: 'FORBIDDEN', message: 'You may only answer your own requests.' }), false);
  assert.equal(isGoneError(null), false);
});

test('engine shapes (PR #38): allowHour, expired flag, pending outcome, run ids, Stop all switches AI off', async () => {
  const core = await loadCore();
  assert.equal(core.canAllowHour({ id: 1 }), true, 'shown unless the engine says no');
  assert.equal(core.canAllowHour({ id: 1, allowHour: true }), true);
  assert.equal(core.canAllowHour({ id: 1, allowHour: false }), false);
  const dialog = read('src', 'renderer', 'components', 'ai', 'AiApprovalDialog.jsx');
  assert.match(dialog, /\{canAllowHour\(approval\) && \(\s*<Button variant="secondary"[^\n]*onDecide\('allow-hour'\)/, '"Allow for 1 hour" is hidden when allowHour is false');

  assert.equal(core.tokenState({ expired: true, expiresAt: null }), 'expired', 'the engine flag wins');
  assert.equal(core.tokenState({ revoked: true, expired: true }), 'revoked');

  assert.deepEqual(core.buildAuditQuery({ outcome: 'pending' }), { limit: 50, outcome: 'pending' });
  assert.deepEqual(core.filterAuditItems([{ outcome: 'pending' }, { outcome: 'ok' }], { outcome: 'pending' }).length, 1);
  assert.equal(core.extractRunId({ summary: 'Started a run of "Login" on 5 profiles (job-7f3a_b2).' }), 'job-7f3a_b2');
  assert.equal(core.extractRunId({ runId: 'job-x1' }), 'job-x1');
  assert.equal(core.extractRunId({ args: { runId: 'job-9' } }), 'job-9');
  assert.equal(core.extractRunId({ summary: 'Listed 40 profiles' }), null);
  const activity = read('src', 'renderer', 'components', 'ai', 'AiActivityTab.jsx');
  assert.match(activity, /\{ value: 'pending', label: t\('activity\.outcomes\.pending'\) \}/);
  assert.match(activity, /pending: 'info'/, 'its own badge colour');

  const page = read('src', 'renderer', 'pages', 'AiPage.jsx');
  assert.doesNotMatch(page, /alsoOff/, 'no "also turn off" choice: the engine always switches AI off');
  assert.match(page, /stoppedProfiles/);
  assert.match(page, /abortedCalls/);
  assert.match(page, /t\('stop\.nowOff'\)/);
  assert.match(page, /onClick=\{async \(\) => \{ await toggleServer\(true\);/, '"Turn on" right after Stop all AI');

  const connect = read('src', 'renderer', 'components', 'ai', 'AiConnectTab.jsx');
  assert.match(connect, /\{hasPlaceholder\(entry\.text\) && <p/, 'no "<YOUR_TOKEN>" hint for snippets without it (VS Code prompts for the token)');
  assert.match(connect, /const mcpbUrl = entry\.key === 'claude-desktop' \? mcpbUrlOf\(bridge\) : null;/);
  assert.match(connect, /&& !mcpbUrl \? `\$\{base\}\.step2NoMcpb`/, 'the .mcpb is only mentioned when the engine names where to get it');
  assert.match(read('src', 'renderer', 'components', 'ai', 'AiApprovalsTab.jsx'), /a\.memberName \? ` · \$\{t\('approvals\.actsAs', \{ member: a\.memberName \}\)\}` : ''/, '"acts as" in the list too');
  assert.match(dialog, /current\.memberName\s*\? t\('approval\.tokenAndMember'/, '"acts as" in the dialog');
  assert.match(page, /status && status\.error \? t\('status\.errorHint', \{ message: status\.error \}\)/, 'the engine status error is shown');
  const memory = read('src', 'renderer', 'components', 'ai', 'AiMemoryTab.jsx');
  assert.match(memory, /const guides = mem && Array\.isArray\(mem\.guides\) && mem\.guides\.length \? mem\.guides : null;/, 'the guides from ai:memory-get are shown');
  assert.match(memory, /typeof guide\.markdown === 'string' \? guide\.markdown/, 'with their Markdown text');
});

// ---- not available / permissions ---------------------------------------------------------

test('not available: a build without the engine reads as "unavailable", never as a crash', async () => {
  const { classifyAiError } = await loadCore();
  assert.equal(classifyAiError({ code: 'AI_UNAVAILABLE', message: 'x' }), 'unavailable');
  assert.equal(classifyAiError(new Error("Error invoking remote method 'ai:status': Error: No handler registered for 'ai:status'")), 'unavailable');
  assert.equal(classifyAiError(new Error('SoftGlaze preload API is unavailable. Check preload.js')), 'unavailable');
  assert.equal(classifyAiError(new Error('Blocked IPC channel: ai:status')), 'unavailable');
  assert.equal(classifyAiError({ code: 'FORBIDDEN', message: 'Owner or Admin only.' }), 'forbidden');
  assert.equal(classifyAiError(new Error('Port 47321 is already in use.')), 'error');
  assert.equal(classifyAiError(null), 'error');

  const api = read('src', 'renderer', 'lib', 'softglazeApi.js');
  assert.match(api, /function aiCall\(run\) \{\s*const ai = window\.softglaze && window\.softglaze\.ai;\s*if \(!ai\) return aiUnavailable\(\);/, 'old preload: reject, not a sync TypeError');
  assert.match(api, /e instanceof TypeError \? aiUnavailable\(\)/, 'a partial ai namespace also rejects');
  assert.match(api, /onApprovalRequested: \(cb\) => \{[\s\S]*?return \(\) => \{\};/, 'no event source: a no-op unsubscribe');

  const page = read('src', 'renderer', 'pages', 'AiPage.jsx');
  assert.match(page, /if \(kind === 'unavailable'\) setPhase\('unavailable'\);/);
  assert.match(page, /phase === 'unavailable' && \(\s*<StatePanel/);
  assert.match(page, /t\('states\.unavailableTitle'\)/);
  const provider = read('src', 'renderer', 'components', 'ai', 'AiApprovalsProvider.jsx');
  assert.match(provider, /if \(kind === 'unavailable'\) setAvailable\(false\);/, 'the app-wide provider stays silent without the engine');
});

test('permissions: the page is Owner/Admin only, Owner-only parts stay with the Owner', async () => {
  const { canManageAi, isAiOwner } = await loadCore();
  const cases = [
    [undefined, false, false],
    [null, true, true], // single-user mode is the owner
    [{ role: 'OWNER' }, true, true],
    [{ role: 'SUPER_ADMIN' }, true, true],
    [{ role: 'ADMIN' }, true, false],
    [{ role: 'MANAGER' }, false, false],
    [{ role: 'OPERATOR' }, false, false]
  ];
  for (const [me, manage, owner] of cases) {
    assert.equal(canManageAi(me), manage, `canManageAi ${JSON.stringify(me)}`);
    assert.equal(isAiOwner(me), owner, `isAiOwner ${JSON.stringify(me)}`);
  }

  const shell = read('src', 'renderer', 'components', 'AppShell.jsx');
  assert.match(shell, /\{ path: '\/ai', labelKey: 'nav\.ai', icon: Sparkles, aiOnly: true, pillKey: 'nav\.beta', badgeKey: 'aiApprovals', badgeTone: 'warning' \}/);
  assert.match(shell, /\.filter\(\(item\) => !item\.aiOnly \|\| !meLoaded \|\| canManageAi\(me\)\)/, 'Owner/Admin only once the member is known');
  // (1.0.26: the Owner-only Data Vault item is reserved the same way; test/permissionsFollowup.test.js.)
  assert.match(shell, /reserved=\{\(item\.aiOnly \|\| item\.vaultOnly\) && !meLoaded\}/, 'until then its slot is kept but invisible (no layout shift for owners)');
  assert.match(shell, /className=\{reserved \? 'block invisible' : 'block'\} aria-hidden=\{reserved \|\| undefined\} tabIndex=\{reserved \? -1 : undefined\}/, 'a reserved item is not visible, read or focusable');
  assert.match(shell, /<AiApprovalDialog \/>/, 'every member gets the approval dialog, on every page');

  const page = read('src', 'renderer', 'pages', 'AiPage.jsx');
  assert.match(page, /if \(!allowed\) \{ setPhase\('forbidden'\); return; \}/, 'the page itself also refuses other roles');
  assert.match(page, /else if \(kind === 'forbidden'\) setPhase\('forbidden'\);/, 'and follows main when it says no');

  const palette = read('src', 'renderer', 'components', 'CommandPalette.jsx');
  assert.match(palette, /if \(n\.aiOnly && !ai\) continue;/);
  assert.match(palette, /navigate\('\/ai\?confirmStop=1'\)/, 'the palette never stops AI without the confirm dialog');

  const settings = read('src', 'renderer', 'components', 'ai', 'AiSettingsTab.jsx');
  assert.match(settings, /disabled=\{!isOwner\}\s*disabledText=\{t\('settings\.ownerOnlyHint'\)\}/, 'extra host names: Owner only');
  assert.match(settings, /checked=\{on\}\s*disabled=\{!isOwner\}/, 'expert mode: Owner only');
  const create = read('src', 'renderer', 'components', 'ai', 'CreateTokenDialog.jsx');
  assert.match(create, /\{isOwner && <AutomationSection/, 'automation tokens: Owner only');
});

// ---- settings helpers --------------------------------------------------------------------

test('settings: "never ask" only for read-only tools; site and host names are cleaned up', async () => {
  const { approvalModeOptions, coerceApprovalMode, normalizeDomain, normalizeHostName, validPort, addToList } = await loadCore();
  assert.deepEqual(approvalModeOptions('read'), ['never', 'ask-hour', 'ask-always']);
  assert.deepEqual(approvalModeOptions('operate'), ['ask-hour', 'ask-always']);
  assert.equal(coerceApprovalMode('full', 'never'), 'ask-always');
  assert.equal(coerceApprovalMode('operate', 'ask-hour'), 'ask-hour');
  assert.equal(normalizeDomain('https://WWW.Example.com/path?q=1'), 'www.example.com');
  assert.equal(normalizeDomain('*.shop.example.co.uk'), '*.shop.example.co.uk');
  assert.equal(normalizeDomain('user:pw@example.com:8443'), 'example.com');
  assert.equal(normalizeDomain('localhost'), null, 'a site needs a dot');
  assert.equal(normalizeDomain('192.168.1.1'), null);
  assert.equal(normalizeDomain('exa mple.com'), null);
  assert.equal(normalizeDomain(''), null);
  assert.equal(normalizeHostName('host.docker.internal'), 'host.docker.internal');
  assert.equal(normalizeHostName('My-N8N'), 'my-n8n');
  assert.equal(normalizeHostName('10.0.0.5'), '10.0.0.5');
  assert.equal(normalizeHostName('*.evil.com'), null);
  assert.equal(normalizeHostName('bad host'), null);
  assert.deepEqual([1024, 65535, 80, 70000, 1.5, 'x'].map(validPort), [true, true, false, false, false, false]);
  const list = ['a.com'];
  assert.equal(addToList(list, 'a.com'), list, 'no duplicates');
  assert.deepEqual(addToList(list, 'b.com'), ['a.com', 'b.com']);
});

test('memory and activity helpers: 20 KB counted in bytes, audit query, durations, relative time', async () => {
  const core = await loadCore();
  assert.equal(core.MEMORY_LIMIT_BYTES, 20480);
  assert.equal(core.utf8Bytes('abc'), 3);
  assert.equal(core.utf8Bytes('ñ'), 2, 'bytes, not characters');
  assert.equal(core.memoryUsage('x'.repeat(20480)).over, false);
  assert.equal(core.memoryUsage('x'.repeat(20481)).over, true);
  assert.equal(core.formatKb(20480), '20');
  assert.equal(core.formatKb(1536), '1.5');
  assert.deepEqual(core.buildAuditQuery({ outcome: 'denied', client: 'Cursor', search: '  start ' }, 'c2'), { limit: 50, cursor: 'c2', outcome: 'denied', clientName: 'Cursor', search: 'start' });
  assert.deepEqual(core.buildAuditQuery({ outcome: 'all' }), { limit: 50 });
  const items = [
    { id: 1, tool: 'start_profile', summary: 'Start US-01', outcome: 'ok', clientName: 'Cursor' },
    { id: 2, tool: 'run_macro', summary: 'Run login', outcome: 'denied', clientName: 'Claude Code' },
    null
  ];
  assert.deepEqual(core.filterAuditItems(items, { outcome: 'denied' }).map((i) => i.id), [2]);
  assert.deepEqual(core.filterAuditItems(items, { search: 'us-01' }).map((i) => i.id), [1]);
  assert.deepEqual(core.filterAuditItems(items, { client: 'Cursor' }).map((i) => i.id), [1]);
  assert.deepEqual([core.formatDuration(250), core.formatDuration(1500), core.formatDuration(65000), core.formatDuration(-1)], ['250 ms', '1.5 s', '1 min 5 s', '']);
  const now = Date.parse('2026-11-07T12:00:00Z');
  assert.equal(core.relativeTime(new Date(now - 120000).toISOString(), now, 'en'), '2 minutes ago');
  assert.equal(core.relativeTime(new Date(now + 3 * 86400000).toISOString(), now, 'en'), 'in 3 days');
  assert.equal(core.relativeTime('not a date', now, 'en'), '');
  assert.equal(core.prettyArgs({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(core.approvalPath({ approval: 'pre-approved' }), 'pre-approved');
  assert.equal(core.approvalPath({ approval: 'hour-grant' }), 'hour-grant');
  assert.equal(core.approvalPath({ preApproved: true }), 'pre-approved');
  assert.equal(core.approvalPath({ approval: 'something-new' }), null, 'unknown paths are not guessed');
  assert.equal(core.approvalPath(null), null);
  assert.ok(core.prettyArgs({ big: 'x'.repeat(9000) }).length <= 4002, 'huge args are capped');
});

// ---- wiring + strings --------------------------------------------------------------------

test('wiring: /ai route, one provider above AppShell, the dialog uses the shared queue', () => {
  const app = read('src', 'renderer', 'App.jsx');
  assert.match(app, /const AiPage = lazy\(\(\) => import\('@\/pages\/AiPage\.jsx'\)\);/);
  assert.match(app, /<Route path="\/ai" element=\{<AiPage \/>\} \/>/);
  assert.match(app, /<AiApprovalsProvider>\s*<AppShell>/, 'one queue for the whole app, inside the sign-in gate');
  const dialog = read('src', 'renderer', 'components', 'ai', 'AiApprovalDialog.jsx');
  assert.match(dialog, /const current = currentApproval\(queue, hidden\);/, 'one dialog, never stacked');
  assert.match(dialog, /onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/, 'a stray click outside does not dismiss it');
  assert.match(dialog, /requestAnimationFrame\(\(\) => \{ if \(denyRef\.current\) denyRef\.current\.focus\(\); \}\)/, 'focus lands on Deny, the safe default');
  assert.match(dialog, /const disabled = busy \|\| !armed;/, 'buttons wake up a moment after a new request appears');
  assert.match(dialog, /role="alertdialog"/);
  const provider = read('src', 'renderer', 'components', 'ai', 'AiApprovalsProvider.jsx');
  assert.match(provider, /softglazeApi\.ai\.onApprovalRequested\(/);
  assert.match(provider, /softglazeApi\.ai\.approvals\.respond\(approval\.id, decision\)/);
  const page = read('src', 'renderer', 'pages', 'AiPage.jsx');
  assert.match(page, /approvals\.clearAll\(\);/, 'Stop all AI clears the waiting requests');
  assert.doesNotMatch(page, /window\.confirm\(/, 'confirmations use the app dialog');
});

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

test('strings: en and es carry the same keys, and every literal t() key used by the AI UI exists', () => {
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'ai.json'));
  const es = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'es', 'ai.json'));
  const enKeys = flatKeys(en).sort();
  const esKeys = flatKeys(es).sort();
  assert.deepEqual(esKeys.filter((k) => !enKeys.includes(k)), [], 'es has keys en lacks');
  assert.deepEqual(enKeys.filter((k) => !esKeys.includes(k)), [], 'en has keys es lacks');
  // Product and node names stay in English in both languages.
  const brandNames = new Set(['connect.clients.claude-code.title', 'connect.clients.claude-desktop.title', 'connect.clients.gemini-cli.title', 'connect.clients.windsurf.title', 'connect.clients.cline.title', 'connect.n8n.b.kind']);
  const sameAsEnglish = enKeys.filter((k) => !brandNames.has(k)).filter((k) => {
    const a = k.split('.').reduce((o, p) => o[p], en);
    const b = k.split('.').reduce((o, p) => o[p], es);
    return a === b && /[a-z]{4,}\s[a-z]{3,}/i.test(a);
  });
  assert.deepEqual(sameAsEnglish, [], 'every sentence is translated');

  const has = (key) => {
    const leafs = new Set(enKeys);
    return leafs.has(key) || leafs.has(`${key}_one`) || leafs.has(`${key}_other`) || enKeys.some((k) => k.startsWith(`${key}.`));
  };
  const missing = [];
  for (const file of AI_SOURCES) {
    const src = read(file);
    for (const m of src.matchAll(/\bt\('([A-Za-z0-9_.-]+)'/g)) if (!has(m[1])) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);

  for (const k of ['nav.ai', 'nav.beta']) {
    for (const lang of ['en', 'es']) {
      const common = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'common.json'));
      assert.ok(k.split('.').reduce((o, p) => o && o[p], common), `${lang} common ${k}`);
    }
  }
  const idx = read('src', 'renderer', 'i18n', 'index.js');
  assert.match(idx, /ai: aiEn,/);
  assert.match(idx, /ai: aiEs,/);
  assert.match(en.automation.warning, /^These tools will run without asking you\. They stay limited to the chosen groups, are logged, and stop with Stop all AI\.$/);
  assert.match(en.settings.hosts.description, /For n8n or other tools running in Docker, add host\.docker\.internal\./);
  assert.match(en.settings.expert.warning, /Detectable\./);
  assert.match(en.settings.expert.warning, /Owner only\./);
});

test('no fake data in the shipped page: no demo tokens, ports or approvals hard-coded', () => {
  for (const file of AI_SOURCES) {
    const src = read(file);
    assert.doesNotMatch(src, /sgai_[A-Za-z0-9]{8,}/, `${file} has a token-like literal`);
    assert.doesNotMatch(src, /127\.0\.0\.1:\d{2,5}/, `${file} has a hard-coded port`);
  }
});
