'use strict';
// In-process integration test of SoftGlaze AI: the real localApi server on a random port, the real
// tool registry, approvals, audit and MCP server, fake app functions behind them, driven by the
// official MCP SDK client over Streamable HTTP and the legacy SSE transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('node:path');
const { createFakeApp, makeToken } = require('./helpers/aiFakes');
const ai = require('../src/main/ai');
const localApi = require('../src/main/localApi');

let app;
let port;
const tokens = {};
let approvalPolicy = null; // (approval) => 'allow-once' | 'allow-hour' | 'deny' | null (no answer)
const requested = [];

function onEmit(channel, data) {
  if (channel !== 'ai:approval-requested') return;
  requested.push(data);
  const decision = approvalPolicy ? approvalPolicy(data) : null;
  if (decision) setTimeout(() => ai.respondApproval(data.id, decision), 50);
}

async function connect(token, name = 'integration-test') {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  await client.connect(transport);
  return client;
}

function rawRequest({ method = 'POST', path = '/mcp', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };
const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

test.before(async () => {
  app = createFakeApp({ onEmit });
  ai.configure({ toolDeps: app.toolDeps, host: app.host, inlineWaitMs: 700, approvalTimeoutMs: 6000 });
  localApi.configure({ ai, ...app.localApiDeps });
  await ai.load();
  await ai.setEnabled(true);
  port = (await localApi.getStatus()).port;
  tokens.operate = (await makeToken(app.db, { name: 'Claude Code on test PC', memberId: 1, scope: 'operate' })).token;
  tokens.read = (await makeToken(app.db, { name: 'Read only', memberId: 1, scope: 'read' })).token;
  const revoked = await makeToken(app.db, { name: 'Old', memberId: 1, scope: 'operate' });
  await ai.revokeToken(revoked.id);
  tokens.revoked = revoked.token;
  tokens.api = (await makeToken(app.db, { name: 'Script', memberId: 1, scope: 'operate' }, 'api')).token;
  tokens.auto = (await makeToken(app.db, {
    name: 'n8n nightly', memberId: 1, scope: 'operate', groupIds: [1],
    preApprovedTools: ['start_profile', 'run_macro'], maxProfilesPerCall: 1, maxCallsPerHour: 2,
    allowed: ['start_profile', 'run_macro', 'stop_profile']
  })).token;
});

test.after(async () => {
  await ai.mcpHandler().dispose();
  await localApi.stop();
});

test('initialize, list tools, read the server instructions', async () => {
  const client = await connect(tokens.operate);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('workspace_summary') && names.includes('create_profile') && names.includes('page_snapshot'));
  assert.ok(!names.includes('get_cdp_endpoint'), 'Expert tools stay hidden while Expert mode is off');
  const create = tools.find((t) => t.name === 'create_profile');
  assert.equal(create.annotations.readOnlyHint, false);
  assert.equal(create.annotations.destructiveHint, false);
  assert.equal(tools.find((t) => t.name === 'list_profiles').annotations.readOnlyHint, true);
  assert.equal(create.inputSchema.type, 'object');
  assert.ok(create.inputSchema.properties.name);
  const instructions = client.getInstructions();
  assert.match(instructions, /softglaze:\/\/memory\/workspace/);
  assert.match(instructions, /Refuse requests it prohibits/);
  assert.match(instructions, /stop every profile and run you started/);
  await client.close();
});

test('a read token sees only read tools', async () => {
  const client = await connect(tokens.read);
  const { tools } = await client.listTools();
  assert.ok(tools.length > 5);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint === true || t.name === 'check_proxy'), tools.map((t) => t.name).join(','));
  await client.close();
});

test('resources: memories, guides and live views', async () => {
  const client = await connect(tokens.operate);
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  for (const u of ['softglaze://memory/workspace', 'softglaze://guide/how-softglaze-works', 'softglaze://guide/acceptable-use', 'softglaze://workspace/summary']) assert.ok(uris.includes(u), u);
  const { resourceTemplates } = await client.listResourceTemplates();
  assert.ok(resourceTemplates.some((t) => t.uriTemplate === 'softglaze://profiles/{id}'));
  const mem = await client.readResource({ uri: 'softglaze://memory/workspace' });
  assert.match(mem.contents[0].text, /## Never do/);
  const aup = await client.readResource({ uri: 'softglaze://guide/acceptable-use' });
  assert.match(aup.contents[0].text, /Refuse these/);
  const profile = await client.readResource({ uri: 'softglaze://profiles/1' });
  const body = JSON.parse(profile.contents[0].text);
  assert.equal(body.data.name, 'US-QA-01');
  assert.ok(!profile.contents[0].text.includes('pw-secret'));
  await client.close();
});

test('prompts: list and render with arguments', async () => {
  const client = await connect(tokens.operate);
  const { prompts } = await client.listPrompts();
  assert.equal(prompts.length, 12);
  const geo = prompts.find((p) => p.name === 'create_geo_profiles');
  assert.deepEqual(geo.arguments.map((a) => [a.name, a.required]), [['count', true], ['country', true], ['group', true]]);
  const r = await client.getPrompt({ name: 'create_geo_profiles', arguments: { count: '5', country: 'de', group: 'QA Germany' } });
  assert.match(r.messages[0].content.text, /Create 5 new profiles for DE in the group "QA Germany"/);
  await assert.rejects(() => client.getPrompt({ name: 'create_geo_profiles', arguments: { count: '5' } }));
  await client.close();
});

test('read tools answer without approval and never leak secrets', async () => {
  const client = await connect(tokens.operate);
  const before = requested.length;
  const sum = await client.callTool({ name: 'workspace_summary', arguments: {} });
  assert.ok(!sum.isError, textOf(sum));
  const data = JSON.parse(sum.content[1].text);
  assert.equal(data.counts.profiles, 3);
  assert.equal(data.limits.maxParallelProfilesPerRun, 3);
  const proxies = await client.callTool({ name: 'list_proxies', arguments: {} });
  const ptext = textOf(proxies);
  assert.ok(!ptext.includes('pw-secret') && !ptext.includes('user-secret'), 'no proxy credentials');
  const profile = await client.callTool({ name: 'get_profile', arguments: { id: 1 } });
  const t = textOf(profile);
  for (const secret of ['pw-secret', 'user-secret', 'sealed', '"password"']) assert.ok(!t.includes(secret), secret);
  const macro = await client.callTool({ name: 'get_macro', arguments: { id: 1 } });
  assert.ok(!textOf(macro).includes('hunter2'), 'typed macro values are hidden');
  assert.match(textOf(macro), /\{\{email\}\}/);
  assert.equal(requested.length, before, 'no approval for reads');
  await client.close();
});

test('an approval-required tool is held until the user allows it', async () => {
  const client = await connect(tokens.operate, 'Claude Code');
  approvalPolicy = (a) => (a.tool === 'create_profile' ? 'allow-once' : null);
  const before = requested.length;
  const r = await client.callTool({ name: 'create_profile', arguments: { name: 'AI-TEST-01', group: 'QA' } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(requested.length, before + 1);
  const a = requested[requested.length - 1];
  assert.equal(a.clientName, 'Claude Code');
  assert.match(a.summary, /Claude Code wants to: Create profile "AI-TEST-01" in group QA/);
  assert.equal(a.allowHour, true);
  const audit = await ai.listAudit({ tool: 'create_profile' });
  assert.equal(audit.items[0].outcome, 'ok');
  assert.equal(audit.items[0].approval, 'allow-once');
  assert.equal(audit.items[0].clientName, 'Claude Code');
  approvalPolicy = null;
  await client.close();
});

test('allow for 1 hour stops asking for that tool; deny is final', async () => {
  const client = await connect(tokens.operate);
  approvalPolicy = (a) => (a.tool === 'start_profile' ? 'allow-hour' : (a.tool === 'update_profile' ? 'deny' : null));
  const first = await client.callTool({ name: 'start_profile', arguments: { id: 1 } });
  assert.ok(!first.isError, textOf(first));
  const asked = requested.length;
  const second = await client.callTool({ name: 'start_profile', arguments: { id: 2 } });
  assert.ok(!second.isError, textOf(second));
  assert.equal(requested.length, asked, 'the hour grant covers the second start');
  const denied = await client.callTool({ name: 'update_profile', arguments: { id: 1, name: 'Renamed' } });
  assert.ok(denied.isError);
  assert.match(textOf(denied), /denied this in SoftGlaze/);
  const stop = await client.callTool({ name: 'stop_profile', arguments: { id: 2 } });
  assert.ok(!stop.isError, 'stopping a profile this token started needs no approval');
  approvalPolicy = null;
  await client.close();
});

test('page tools: asked once per profile, then snapshot hides passwords and marks page text untrusted', async () => {
  const client = await connect(tokens.operate);
  approvalPolicy = (a) => (a.tool.startsWith('page_') ? 'allow-hour' : null);
  const before = requested.length;
  const nav = await client.callTool({ name: 'page_navigate', arguments: { profileId: 1, url: 'https://example.com/login' } });
  assert.ok(!nav.isError, textOf(nav));
  const snap = await client.callTool({ name: 'page_snapshot', arguments: { profileId: 1 } });
  assert.ok(!snap.isError, textOf(snap));
  const s = textOf(snap);
  assert.match(s, /^Untrusted page content follows/);
  assert.match(s, /textbox "Password" \[value="\[hidden\]"\]/);
  assert.match(s, /\{aria\/Sign in\[role="button"\]\}/);
  assert.ok(!s.includes('hunter2'));
  const typed = await client.callTool({ name: 'page_type', arguments: { profileId: 1, selector: '#email', text: 'me@example.com' } });
  assert.ok(!typed.isError, textOf(typed));
  assert.equal(requested.length, before + 1, 'one approval for all page tools on profile 1');
  const shot = await client.callTool({ name: 'page_screenshot', arguments: { profileId: 1 } });
  assert.equal(shot.content[0].type, 'image');
  const notRunning = await client.callTool({ name: 'page_snapshot', arguments: { profileId: 3 } });
  assert.ok(notRunning.isError);
  approvalPolicy = null;
  await client.close();
});

test('an approval answered after the client stopped waiting goes through on the identical retry', async () => {
  const client = await connect(tokens.operate);
  approvalPolicy = null;
  const args = { name: 'Check dashboards', steps: [{ type: 'goto', url: 'https://example.com' }, { type: 'click', selector: '#refresh' }] };
  const first = await client.callTool({ name: 'save_macro', arguments: args });
  assert.ok(first.isError);
  assert.match(textOf(first), /Waiting for the user to approve this in the SoftGlaze app/);
  const pending = ai.listApprovals().find((x) => x.tool === 'save_macro');
  assert.ok(pending);
  ai.respondApproval(pending.id, 'allow-once');
  const asked = requested.length;
  const retry = await client.callTool({ name: 'save_macro', arguments: args });
  assert.ok(!retry.isError, textOf(retry));
  assert.equal(requested.length, asked, 'the retry used the late grant');
  await client.close();
});

test('bad tokens get 401, web pages and rebinding hosts get 403', async () => {
  const bad = await rawRequest({ headers: { Authorization: 'Bearer sgai_wrong', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: INIT });
  assert.equal(bad.status, 401);
  const none = await rawRequest({ headers: { 'Content-Type': 'application/json' }, body: INIT });
  assert.equal(none.status, 401);
  const revoked = await rawRequest({ headers: { Authorization: `Bearer ${tokens.revoked}`, 'Content-Type': 'application/json' }, body: INIT });
  assert.equal(revoked.status, 401);
  assert.match(revoked.text, /revoked/);
  const apiOnMcp = await rawRequest({ headers: { Authorization: `Bearer ${tokens.api}`, 'Content-Type': 'application/json' }, body: INIT });
  assert.equal(apiOnMcp.status, 403, 'Developer API tokens do not open MCP sessions');
  const origin = await rawRequest({ headers: { Authorization: `Bearer ${tokens.operate}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: INIT });
  assert.equal(origin.status, 403);
  const rebind = await rawRequest({ headers: { Host: `evil.example:${port}`, Authorization: `Bearer ${tokens.operate}`, 'Content-Type': 'application/json' }, body: INIT });
  assert.equal(rebind.status, 403);
  const bigBody = `{"x":"${'a'.repeat(1100 * 1024)}"}`;
  const big = await rawRequest({ headers: { Authorization: `Bearer ${tokens.operate}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bigBody) }, body: bigBody });
  assert.equal(big.status, 413);
});

test('an extra allowed host (n8n in Docker) is refused until the Owner allows it', async () => {
  const dockerHost = { Host: `host.docker.internal:${port}`, Authorization: `Bearer ${tokens.operate}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const before = await rawRequest({ headers: dockerHost, body: INIT });
  assert.equal(before.status, 403);
  await assert.rejects(() => ai.setSettings({ extraAllowedHosts: ['host.docker.internal'] }, { isOwner: false }), /Only the Owner/);
  await ai.setSettings({ extraAllowedHosts: ['host.docker.internal'] }, { isOwner: true });
  const after = await rawRequest({ headers: dockerHost, body: INIT });
  assert.equal(after.status, 200, after.text);
  await ai.setSettings({ extraAllowedHosts: [] }, { isOwner: true });
  const again = await rawRequest({ headers: dockerHost, body: INIT });
  assert.equal(again.status, 403);
});

test('the legacy SSE transport works through the SDK client (n8n and older clients)', async () => {
  const client = new Client({ name: 'n8n', version: '1.0.0' });
  const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/mcp/sse`), {
    requestInit: { headers: { Authorization: `Bearer ${tokens.operate}` } }
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'workspace_summary'));
  const r = await client.callTool({ name: 'list_groups', arguments: {} });
  assert.ok(!r.isError, textOf(r));
  assert.ok(ai.mcpHandler().clients().some((c) => c.transport === 'sse' && c.clientName === 'n8n'));
  const audit = await ai.listAudit({ tool: 'list_groups' });
  assert.equal(audit.items[0].transport, 'sse');
  await client.close();
});

test('the stdio bridge (Claude Desktop, .mcpb) forwards to the app over HTTP', async () => {
  const client = new Client({ name: 'Claude Desktop', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'src', 'main', 'ai', 'bridge', 'softglaze-mcp-bridge.js')],
    env: { ...process.env, SOFTGLAZE_MCP_URL: `http://127.0.0.1:${port}/mcp`, SOFTGLAZE_TOKEN: tokens.operate },
    stderr: 'pipe'
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'list_profiles'));
  const r = await client.callTool({ name: 'workspace_summary', arguments: {} });
  assert.ok(!r.isError, textOf(r));
  const mem = await client.readResource({ uri: 'softglaze://memory/workspace' });
  assert.match(mem.contents[0].text, /Workspace notes for AI/);
  assert.ok(ai.mcpHandler().clients().some((c) => c.clientName === 'Claude Desktop'));
  await client.close();
});

test('the bridge reports a clear error when the token is missing', async () => {
  const client = new Client({ name: 'Claude Desktop', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'src', 'main', 'ai', 'bridge', 'softglaze-mcp-bridge.js')],
    env: { ...process.env, SOFTGLAZE_MCP_URL: `http://127.0.0.1:${port}/mcp`, SOFTGLAZE_TOKEN: '' },
    stderr: 'pipe'
  });
  await assert.rejects(() => client.connect(transport), /SOFTGLAZE_TOKEN is not set/);
  await transport.close().catch(() => {});
});

test('pre-approved automation tokens skip the dialog only inside their groups and caps', async () => {
  const client = await connect(tokens.auto, 'n8n');
  approvalPolicy = null;
  const before = requested.length;
  const ok = await client.callTool({ name: 'start_profile', arguments: { id: 2 } });
  assert.ok(!ok.isError, textOf(ok));
  assert.equal(requested.length, before, 'no dialog for a pre-approved tool in its group');
  const audit = await ai.listAudit({ tool: 'start_profile' });
  assert.equal(audit.items[0].approval, 'pre-approved');
  const outside = await client.callTool({ name: 'start_profile', arguments: { id: 3 } });
  assert.ok(outside.isError);
  assert.match(textOf(outside), /outside the groups this token may use/);
  const overCap = await client.callTool({ name: 'run_macro', arguments: { macroId: 1, profileIds: [1, 2] } });
  assert.ok(overCap.isError, 'more profiles than maxProfilesPerCall asks, and nobody answers');
  assert.match(textOf(overCap), /Waiting for the user/);
  assert.equal(requested.length, before + 1);
  assert.equal(requested[requested.length - 1].allowHour, false, 'many profiles: ask every time');
  const second = await client.callTool({ name: 'run_macro', arguments: { macroId: 1, profileIds: [1] } });
  assert.ok(!second.isError, textOf(second));
  const capped = await client.callTool({ name: 'run_macro', arguments: { macroId: 1, profileIds: [2] } });
  assert.ok(capped.isError, 'maxCallsPerHour reached: falls back to asking');
  const { tools } = await client.listTools();
  assert.ok(!tools.some((t) => t.name === 'get_cdp_endpoint'));
  await client.close();
});

test('the Developer API: scoped profile list, start returns the DevTools endpoint, stop', async () => {
  const list = await rawRequest({ method: 'GET', path: '/api/v1/profiles', headers: { Authorization: `Bearer ${tokens.api}` } });
  assert.equal(list.status, 200, list.text);
  const body = JSON.parse(list.text);
  assert.equal(body.count, 4);
  assert.ok(body.profiles.every((p) => p.title && !('proxyInfoString' in p)));
  assert.ok(!list.text.includes('pw-secret'));
  const start = await rawRequest({ method: 'POST', path: '/api/v1/profiles/3/start', headers: { Authorization: `Bearer ${tokens.api}`, 'Content-Type': 'application/json' }, body: { headless: true } });
  assert.equal(start.status, 200, start.text);
  assert.match(JSON.parse(start.text).wsEndpoint, /^ws:\/\//);
  const sessions = await rawRequest({ method: 'GET', path: '/api/v1/sessions', headers: { Authorization: `Bearer ${tokens.api}` } });
  assert.ok(JSON.parse(sessions.text).sessions.some((s) => s.profileId === 3));
  const stop = await rawRequest({ method: 'POST', path: '/api/v1/profiles/3/stop', headers: { Authorization: `Bearer ${tokens.api}` } });
  assert.equal(JSON.parse(stop.text).stopped, true);
  const health = await rawRequest({ method: 'GET', path: '/api/v1/health' });
  assert.equal(health.status, 200);
  const logged = app.db._tables.aiAuditLog.filter((r) => r.transport === 'rest');
  assert.ok(logged.some((r) => r.tool === 'start_profile' && r.approval === 'developer-token'));
});

test('Stop all AI closes sessions, denies pending approvals and switches AI off', async () => {
  const client = await connect(tokens.operate);
  approvalPolicy = null;
  const pendingCall = client.callTool({ name: 'create_group', arguments: { name: 'Pending group' } }).catch((e) => e);
  await new Promise((r) => setTimeout(r, 300));
  const res = await ai.stopAll();
  assert.ok(res.revokedSessions >= 1);
  assert.ok(res.deniedApprovals >= 1);
  assert.equal(ai.isEnabled(), false);
  const answered = await pendingCall;
  assert.ok(answered.isError, 'the waiting call is answered, not left hanging');
  assert.match(textOf(answered), /Stop all AI/);
  const after = await rawRequest({ headers: { Authorization: `Bearer ${tokens.operate}`, 'Content-Type': 'application/json' }, body: INIT });
  assert.equal(after.status, 503);
  assert.match(after.text, /switched off/);
  await ai.setEnabled(true);
});
