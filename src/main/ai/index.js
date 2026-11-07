'use strict';
// SoftGlaze AI service: owns the settings, tokens, approvals, audit, memories, the tool registry
// and the MCP handler, and is what localApi.js (HTTP), ipc.js (the AI page) and ipcHandlers.js
// (session events) talk to. configure() is called once from ipcHandlers.registerIpcHandlers with:
//   toolDeps  the whitelisted app functions the tools may call (toolRegistry.ALLOWED_DEPS)
//   host      { getPrisma, readSetting, writeSetting, emit, appVersion, isWorkspaceLocked,
//               getWindowMember, getLicense, localApi, bridgeInfo, listAllSessions, closeSession,
//               stopParallelRun, stopWarmer }
const aiTokens = require('./aiTokens');
const aiAudit = require('./aiAudit');
const aiSettings = require('./aiSettings');
const memories = require('./memories');
const prompts = require('./prompts');
const snippets = require('./snippets');
const { ApprovalManager } = require('./approvals');
const { ToolRegistry, RateLimiter, AiTracker, JobStore } = require('./toolRegistry');
const { McpHttpHandler } = require('./mcpServer');

const state = {
  host: null,
  toolDeps: null,
  settings: aiSettings.normalizeStored(null),
  loaded: false,
  registry: null,
  approvals: null,
  tracker: new AiTracker(),
  jobs: new JobStore(),
  limiter: new RateLimiter(),
  memory: null,
  mcp: null,
  lastStop: null
};

function host() {
  if (!state.host) throw new Error('SoftGlaze AI is not ready yet.');
  return state.host;
}

function emit(channel, data) {
  try { if (state.host && typeof state.host.emit === 'function') state.host.emit(channel, data); } catch (e) { /* renderer gone */ }
}

function configure({ toolDeps, host: h, inlineWaitMs, approvalTimeoutMs }) {
  state.host = h;
  state.toolDeps = toolDeps;
  state.approvals = new ApprovalManager({ emit, timeoutMs: approvalTimeoutMs });
  state.memory = memories.createMemoryStore({ read: (k, f) => h.readSetting(k, f), write: (k, v) => h.writeSetting(k, v) });
  state.registry = new ToolRegistry({
    deps: toolDeps,
    inlineWaitMs,
    services: {
      settings: () => state.settings,
      isEnabled: () => state.settings.enabled,
      approvals: state.approvals,
      audit: {
        record: (entry) => {
          try { return aiAudit.record(h.getPrisma(), entry); } catch (e) { return Promise.resolve(null); } // database locked
        }
      },
      memory: state.memory,
      tracker: state.tracker,
      jobs: state.jobs,
      limiter: state.limiter
    }
  });
  state.mcp = new McpHttpHandler({
    registry: state.registry,
    memory: state.memory,
    appVersion: h.appVersion,
    onClientSeen: (tokenId, clientName) => {
      if (!clientName) return;
      try { aiTokens.touchToken(h.getPrisma(), { id: tokenId }, clientName).catch(() => {}); } catch (e) { /* database locked */ }
      emit('ai:status-changed', { at: new Date().toISOString() });
    }
  });
}

// Reads the stored settings (call once the database is readable).
async function load() {
  const raw = await host().readSetting(aiSettings.SETTINGS_KEY, null);
  state.settings = aiSettings.normalizeStored(raw);
  state.loaded = true;
  return state.settings;
}

function settings() { return state.settings; }
function isEnabled() { return Boolean(state.settings.enabled); }
function registry() { return state.registry; }
function mcpHandler() { return state.mcp; }

async function saveSettings(next) {
  await host().writeSetting(aiSettings.SETTINGS_KEY, next);
  state.settings = aiSettings.normalizeStored(next);
  return state.settings;
}

// ---- Authentication of an HTTP request's Bearer token ----
// transport 'mcp' | 'sse' accepts SoftGlaze AI tokens only; 'rest' also accepts Developer API
// tokens. Returns { ok: true, auth } or { ok: false, status, code, message }.
async function authenticate(bearer, { transport = 'mcp' } = {}) {
  const h = host();
  if (h.isWorkspaceLocked()) return { ok: false, status: 423, code: 'LOCKED', message: 'The SoftGlaze workspace is locked. Unlock it in the app and try again.' };
  const db = h.getPrisma();
  const v = await aiTokens.verifyToken(db, bearer, { kinds: transport === 'rest' ? ['api', 'ai'] : ['ai'] });
  if (!v.ok) return v;
  const row = v.row;
  const member = await resolveTokenMember(db, row);
  if (!member.ok) return member;
  aiTokens.touchToken(db, row, null).catch(() => {});
  return {
    ok: true,
    auth: {
      token: {
        id: row.id,
        name: row.name,
        kind: row.kind || 'api',
        scope: row.scope || 'read',
        groupIds: aiTokens.groupIdsOf(row),
        preApproved: aiTokens.preApprovedOf(row),
        memberId: member.memberId,
        memberName: member.memberName,
        lastClientName: row.lastClientName || null
      }
    }
  };
}

// The member a token acts as. A token with no member acts as the workspace owner: nobody in
// single-user mode, else the first Owner. A missing, suspended or banned member stops the token.
async function resolveTokenMember(db, row) {
  if (row.memberId != null) {
    const m = await db.member.findUnique({ where: { id: row.memberId } }).catch(() => null);
    if (!m) return { ok: false, status: 403, code: 'MEMBER_GONE', message: 'The member this token acts as no longer exists. Create a new token.' };
    if (m.status === 'suspended' || m.status === 'banned') return { ok: false, status: 403, code: 'MEMBER_BLOCKED', message: `The member this token acts as is ${m.status}.` };
    return { ok: true, memberId: m.id, role: m.role, memberName: m.name || null };
  }
  const count = await db.member.count().catch(() => 0);
  if (!count) return { ok: true, memberId: null, role: 'OWNER', memberName: 'Workspace owner' };
  const owner = await db.member.findFirst({ where: { role: 'OWNER' }, orderBy: { id: 'asc' } }).catch(() => null);
  if (!owner) return { ok: false, status: 403, code: 'NO_OWNER', message: 'This token has no member and the workspace has no Owner. Create a new token.' };
  if (owner.status === 'suspended' || owner.status === 'banned') return { ok: false, status: 403, code: 'MEMBER_BLOCKED', message: `The workspace owner is ${owner.status}.` };
  return { ok: true, memberId: owner.id, role: 'OWNER', memberName: owner.name || null };
}

// ---- Status, enable, settings ----
async function status() {
  const h = host();
  const api = await h.localApi.getStatus();
  let plan = null;
  try { const l = await h.getLicense(); plan = { tier: (l.limits && l.limits.tier) || l.tier || 'pro', state: l.state || null, maxParallel: l.limits ? l.limits.maxParallel : null }; } catch (e) { plan = null; }
  const running = new Set(h.listAllSessions().map((s) => Number(s.sessionId)));
  const runningAiSessions = state.tracker.allProfiles().filter((pid) => running.has(pid)).length;
  return {
    enabled: isEnabled(),
    running: Boolean(api.running) && isEnabled(),
    port: api.port,
    url: `http://127.0.0.1:${api.port}/mcp`,
    sseUrl: `http://127.0.0.1:${api.port}/mcp/sse`,
    plan,
    // Only apps active in the last two minutes (or holding a stream open): a client that quit
    // without closing its session is not "connected" for the 30 minutes before the idle sweep.
    clients: state.mcp ? state.mcp.clients({ activeOnly: true }).map((c) => ({ tokenId: c.tokenId, tokenName: c.tokenName, clientName: c.clientName, lastSeenAt: c.lastSeenAt, transport: c.transport })) : [],
    pendingApprovals: state.approvals ? state.approvals.pendingCount() : 0,
    runningAiSessions,
    lastStopAll: state.lastStop,
    // Switched on but not listening, e.g. the port is used by another program at start-up.
    error: isEnabled() && !api.running
      ? (api.error || 'SoftGlaze AI is on, but its server is not running. Switch it off and on again, or choose another port.')
      : null
  };
}

async function setEnabled(on) {
  const s = await saveSettings({ ...state.settings, enabled: Boolean(on) });
  if (!s.enabled) {
    if (state.mcp) await state.mcp.closeAll();
    if (state.approvals) state.approvals.cancelAll();
  }
  try { await host().localApi.sync(); }
  catch (e) {
    if (s.enabled) {
      await saveSettings({ ...state.settings, enabled: false });
      const msg = e && e.code === 'EADDRINUSE' ? 'The port is already in use by another program. Choose another port in SoftGlaze AI settings.' : ((e && e.message) || 'Could not start the SoftGlaze AI server.');
      throw new Error(msg);
    }
  }
  emit('ai:status-changed', { at: new Date().toISOString() });
  return status();
}

async function getSettings() {
  const api = await host().localApi.getStatus();
  const s = state.settings;
  return { approvalMode: { ...s.approvalMode }, pageDomainAllowList: [...s.pageDomainAllowList], expertMode: s.expertMode, extraAllowedHosts: [...s.extraAllowedHosts], port: api.port };
}

async function setSettings(patch, { isOwner = false } = {}) {
  const p = (patch && typeof patch === 'object') ? { ...patch } : {};
  delete p.enabled; // ai:set-enabled is the only switch
  const port = p.port;
  delete p.port;
  const next = aiSettings.applyPatch(state.settings, p, { isOwner });
  await saveSettings({ ...next, enabled: state.settings.enabled });
  if (port !== undefined && port !== null && port !== '') await host().localApi.setPort(aiSettings.parsePort(port));
  return getSettings();
}

// ---- Tokens ----
async function listTokens() {
  return aiTokens.listTokens(host().getPrisma(), { kind: 'ai' });
}

async function createToken(input, { createdById = null, callerIsOwner = false } = {}) {
  return aiTokens.createToken(host().getPrisma(), input, {
    kind: 'ai',
    createdById,
    callerIsOwner,
    allowedPreApprovedTools: state.registry.preApprovableNames()
  });
}

async function revokeToken(id) {
  const res = await aiTokens.revokeToken(host().getPrisma(), id);
  const tokenId = Number(id);
  if (state.mcp) await state.mcp.closeAll(tokenId);
  if (state.approvals) state.approvals.forgetToken(tokenId);
  return res;
}

// ---- Stop all AI ----
// Switches SoftGlaze AI off (so no client can carry on), closes every AI session, denies pending
// approvals, forgets "allow for 1 hour" grants, aborts calls in flight and background jobs, and
// stops the runs and profiles AI apps started. The user switches AI back on from the AI page.
async function stopAll() {
  const h = host();
  await saveSettings({ ...state.settings, enabled: false });
  // Deny and abort first, so a client waiting on a call gets its "Stopped" answer before its
  // session closes.
  const deniedApprovals = state.approvals ? state.approvals.cancelAll() : 0;
  const abortedCalls = state.registry ? state.registry.abortAll() : 0;
  const cancelledJobs = state.jobs.cancelAll();
  for (let i = 0; i < 10 && state.registry && state.registry.inflight.size; i += 1) await new Promise((r) => setTimeout(r, 50));
  const revokedSessions = state.mcp ? await state.mcp.closeAll() : 0;
  let stoppedRuns = cancelledJobs;
  for (const r of state.tracker.allRuns()) {
    try {
      if (r.runId.startsWith('par-')) { const x = await h.stopParallelRun({ runId: r.runId }); if (x && x.stopped) stoppedRuns += 1; }
      else if (r.runId.startsWith('warm-')) { const x = await h.stopWarmer({ runId: r.runId, force: true }); if (x && x.stopped) stoppedRuns += 1; }
    } catch (e) { /* run already ended */ }
  }
  let stoppedProfiles = 0;
  const running = new Set(h.listAllSessions().map((s) => Number(s.sessionId)));
  for (const pid of state.tracker.allProfiles()) {
    if (!running.has(pid)) continue;
    try { const x = await h.closeSession(pid); if (x && x.closed) stoppedProfiles += 1; } catch (e) { /* already closed */ }
  }
  state.tracker.clear();
  try { await h.localApi.sync(); } catch (e) { /* server stays as it is */ }
  state.lastStop = new Date().toISOString();
  emit('ai:status-changed', { at: state.lastStop });
  return { stoppedRuns, stoppedProfiles, revokedSessions, deniedApprovals, abortedCalls };
}

// ---- Approvals ----
function listApprovals() { return state.approvals ? state.approvals.list() : []; }
function getApproval(id) { return state.approvals ? state.approvals.get(id) : null; }
function respondApproval(id, decision) {
  if (!state.approvals) return { ok: false };
  return state.approvals.respond(id, decision);
}

// ---- Audit, memories, prompts, snippets ----
function listAudit(q) { return aiAudit.list(host().getPrisma(), q || {}); }

// The built-in, read-only guides, shown on the AI page's Memory tab.
function guides() {
  return [
    { uri: memories.URIS.howItWorks, title: 'How SoftGlaze works', markdown: memories.HOW_SOFTGLAZE_WORKS },
    { uri: memories.URIS.acceptableUse, title: 'Acceptable use', markdown: memories.ACCEPTABLE_USE }
  ];
}
function memoryView(m) {
  return { markdown: m.markdown, updatedAt: m.updatedAt, defaultMarkdown: m.defaultMarkdown, guides: guides() };
}
async function memoryGet() { return memoryView(await state.memory.get()); }
async function memorySet(md) { return memoryView(await state.memory.set(md)); }
async function memoryReset() { return memoryView(await state.memory.reset()); }

// Tools an automation token may pre-approve: operate scope only, never Expert, never anything on
// the never-exposed list (the registry refuses those outright).
function preApprovableTools() {
  const names = new Set(state.registry.preApprovableNames());
  return state.registry.describe()
    .filter((t) => names.has(t.name))
    .map((t) => ({ name: t.name, title: t.title, scope: t.scope, destructive: Boolean(t.annotations && t.annotations.destructiveHint) }));
}

function listPrompts() { return prompts.listPrompts(); }

function bridgeInfo() {
  const h = host();
  return typeof h.bridgeInfo === 'function' ? h.bridgeInfo() : { command: 'node', args: [], env: {}, mcpbPath: null };
}

async function getSnippets() {
  const api = await host().localApi.getStatus();
  return snippets.buildSnippets({ port: api.port, bridge: bridgeInfo() });
}

// ---- Session events from the app ----
function onProfileClosed(profileId) {
  state.tracker.removeProfile(profileId);
}

module.exports = {
  configure,
  load,
  settings,
  isEnabled,
  registry,
  mcpHandler,
  authenticate,
  resolveTokenMember,
  status,
  setEnabled,
  getSettings,
  setSettings,
  listTokens,
  createToken,
  revokeToken,
  stopAll,
  listApprovals,
  getApproval,
  respondApproval,
  listAudit,
  memoryGet,
  memorySet,
  memoryReset,
  listPrompts,
  guides,
  preApprovableTools,
  bridgeInfo,
  getSnippets,
  onProfileClosed,
  _state: state
};
