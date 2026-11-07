'use strict';
// The one tool registry behind every AI and Local API front door (MCP over Streamable HTTP, the
// legacy SSE transport, the stdio bridge and /api/v1). A call goes through, in order:
//   1. SoftGlaze AI switched on                         (Stop all AI switches it off)
//   2. token scope covers the tool's scope             (read < operate < full)
//   3. Expert tools: Expert mode on and an Owner token
//   4. argument validation (zod) and a per-token rate limit
//   5. everything below runs AS THE TOKEN'S MEMBER (actor.js): the app's permission checks,
//      profile/proxy access, ownership stamps and activity-log rows all use that member
//   6. the member's role permission for the tool (ACTION_CATALOG) and access to every profile it
//      touches, limited further to the token's allowed groups
//   7. approval inside SoftGlaze: pre-approved (automation tokens, within caps), a grant from
//      "Allow for 1 hour", or a dialog the user answers (2 minutes, then denied)
//   8. the handler, then one audit row with redacted arguments, outcome and duration
// Tools that must never be reachable are kept out by name and by a whitelist of app functions
// the registry may hold (ALLOWED_DEPS).
const z = require('zod');
const { TOOLS } = require('./tools');
const aiTokens = require('./aiTokens');
const { ApprovalManager } = require('./approvals');
const { scrubText, redactArgs } = require('./redact');
const actor = require('./actor');

// What AI apps can never do through SoftGlaze, shown in the guide and enforced below.
const NEVER_EXPOSED = Object.freeze([
  'export or read cookies',
  '2FA / TOTP codes',
  'proxy passwords or usernames',
  'persona, vault or saved-login passwords',
  'delete, trash or purge anything',
  'billing, payments and licences',
  'member and role changes',
  'settings that weaken security',
  'run arbitrary JavaScript in pages'
]);
// No tool may be named after a never-exposed capability.
const NEVER_EXPOSED_NAME = /cookie|2fa|totp|\botp\b|password|passwd|secret|vault|persona|delete|purge|trash|billing|invoice|payment|licen[cs]e|member|\brole|invite|setting|evaluate|execute|javascript|\beval\b/i;
// The only app functions the AI layer is given. Anything else passed in is refused at start-up,
// so a cookie exporter, a delete handler or a settings writer can never be wired in by mistake.
const ALLOWED_DEPS = Object.freeze([
  'getPrisma', 'requirePermission', 'getActiveMember', 'getLicense',
  'scopedProfileWhere', 'scopedProxyWhere', 'assertCanAccessProfile', 'assertCanAccessProxy', 'partitionAccessibleProfileIds',
  'listAllSessions', 'isFirefoxSession', 'launchProfile', 'closeSession', 'markAutomationDriven',
  'createProfile', 'updateProfile', 'batchGenerateProfiles', 'createGroup', 'assignProfilesToGroup',
  'checkProxy', 'getProxyHealthHistory', 'getRecentProxyHealth', 'getVendorScoreboard', 'rotateProxyIp',
  'bulkAssignProxies', 'harvestFreeProxies', 'cancelFreeProxyHarvest',
  'getMacros', 'saveMacro', 'normalizeMacroSteps', 'runParallelMacro', 'getParallelRunStatus', 'stopParallelRun',
  'startWarmer', 'stopWarmer', 'listActiveWarmers',
  'captchaScores', 'prelaunchCheck', 'analyzeProfileLeaks',
  'runMacro', 'humanType', 'getAutomationPage'
]);
const FORBIDDEN_DEP = /cookie|totp|2fa|twoFactor|delete|purge|trash|password|vault|persona|billing|invoice|payment|redeem|(create|update|switch|remove|set)Member|role|setGlobal|setSetting|writeSetting|restore|backup|export/i;

const SCOPES = aiTokens.SCOPES;
const APPROVAL_RULES = ['none', 'ask', 'always', 'page', 'self'];
const MODES = ['never', 'ask-hour', 'ask-always'];
const DEFAULT_INLINE_WAIT_MS = 50 * 1000; // MCP clients time a request out after 60 s by default
const PROGRESS_EVERY_MS = 10 * 1000;
const CALLS_PER_MINUTE = 120;
const JOB_INLINE_MS = 40 * 1000;

function validateDeps(deps) {
  const keys = Object.keys(deps || {});
  for (const k of keys) {
    if (!ALLOWED_DEPS.includes(k)) throw new Error(`SoftGlaze AI was given an app function it may not hold: ${k}`);
  }
  for (const k of ALLOWED_DEPS) {
    if (FORBIDDEN_DEP.test(k)) throw new Error(`ALLOWED_DEPS lists a forbidden capability: ${k}`);
  }
}

function validateTool(t) {
  if (!t || !/^[a-z][a-z0-9_]{2,40}$/.test(t.name)) throw new Error(`Bad tool name: ${t && t.name}`);
  if (NEVER_EXPOSED_NAME.test(t.name)) throw new Error(`Tool ${t.name} is named after a never-exposed capability.`);
  if (!SCOPES.includes(t.scope)) throw new Error(`Tool ${t.name} has an unknown scope.`);
  if (!APPROVAL_RULES.includes(t.approval)) throw new Error(`Tool ${t.name} has an unknown approval rule.`);
  if (t.scope !== 'read' && t.approval === 'none') throw new Error(`Tool ${t.name} changes something but asks nobody.`);
  if (t.expert && (t.scope !== 'full' || t.approval !== 'always')) throw new Error(`Expert tool ${t.name} must be full scope and ask every time.`);
  const a = t.annotations || {};
  for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
    if (typeof a[k] !== 'boolean') throw new Error(`Tool ${t.name} is missing annotation ${k}.`);
  }
  if (a.destructiveHint) throw new Error(`Tool ${t.name} is destructive; destructive tools are never exposed.`);
  if (typeof t.handler !== 'function' || typeof t.summarize !== 'function') throw new Error(`Tool ${t.name} is incomplete.`);
  if (t.approval === 'self' && typeof t.selfKey !== 'function') throw new Error(`Tool ${t.name} needs selfKey.`);
}

// Approval mode for a tool's scope. 'never' is honoured for read tools only.
function modeFor(approvalMode, scope) {
  const m = (approvalMode && approvalMode[scope]) || (scope === 'read' ? 'never' : (scope === 'full' ? 'ask-always' : 'ask-hour'));
  if (!MODES.includes(m)) return scope === 'read' ? 'never' : 'ask-hour';
  if (m === 'never' && scope !== 'read') return 'ask-hour';
  return m;
}

function domainAllowed(url, list) {
  if (!Array.isArray(list) || !list.length) return true;
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return false; }
  return list.some((raw) => {
    const d = String(raw || '').trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    return d && (host === d || host.endsWith(`.${d}`));
  });
}

function zodMessage(error) {
  const issues = (error && error.issues) || [];
  return issues.slice(0, 4).map((i) => `${(i.path || []).join('.') || 'arguments'}: ${i.message}`).join('; ') || 'Invalid arguments.';
}

function userError(message, code = 'USER') {
  const e = new Error(message);
  e.code = code;
  e.userFacing = true;
  return e;
}

// Sliding-window counters per token.
class RateLimiter {
  constructor({ perMinute = CALLS_PER_MINUTE, now = () => Date.now() } = {}) {
    this.perMinute = perMinute;
    this.now = now;
    this.calls = new Map();
    this.preApproved = new Map();
  }
  _window(map, key, span, limit, take) {
    const t = this.now();
    const list = (map.get(key) || []).filter((x) => t - x < span);
    if (list.length >= limit) { map.set(key, list); return false; }
    if (take) list.push(t);
    map.set(key, list);
    return true;
  }
  take(tokenId) { return this._window(this.calls, tokenId, 60 * 1000, this.perMinute, true); }
  preApprovedLeft(tokenId, perHour) { return this._window(this.preApproved, tokenId, 60 * 60 * 1000, perHour, false); }
  usePreApproved(tokenId, perHour) { return this._window(this.preApproved, tokenId, 60 * 60 * 1000, perHour, true); }
}

// What AI apps started: profiles and runs, by token. "Stop all AI" stops these, and
// stop_profile / stop_run need no approval for the token that started the target.
class AiTracker {
  constructor() { this.profiles = new Map(); this.runs = new Map(); }
  addProfile(tokenId, profileId) { this.profiles.set(Number(profileId), tokenId); }
  removeProfile(profileId) { this.profiles.delete(Number(profileId)); }
  isAiStartedProfile(profileId) { return this.profiles.has(Number(profileId)); }
  addRun(tokenId, runId, kind) { this.runs.set(String(runId), { tokenId, kind }); }
  removeRun(runId) { this.runs.delete(String(runId)); }
  startedBy(tokenId, key) {
    if (!key) return false;
    if (key.kind === 'profile') return this.profiles.get(Number(key.id)) === tokenId;
    if (key.kind === 'run') { const r = this.runs.get(String(key.id)); return Boolean(r && r.tokenId === tokenId); }
    return false;
  }
  allProfiles() { return [...this.profiles.keys()]; }
  allRuns() { return [...this.runs.entries()].map(([runId, r]) => ({ runId, ...r })); }
  clear() { this.profiles.clear(); this.runs.clear(); }
}

// Background jobs for tools that can outlast an MCP request (free-proxy search, batch generate).
class JobStore {
  constructor({ inlineMs = JOB_INLINE_MS, keepMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
    this.inlineMs = inlineMs;
    this.keepMs = keepMs;
    this.now = now;
    this.jobs = new Map();
  }
  view(j) {
    return { runId: j.id, kind: j.kind, label: j.label, running: j.running, startedAt: new Date(j.startedAt).toISOString(), finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null, result: j.result ? (j.result.data || j.result) : null, error: j.error };
  }
  async start(tokenId, kind, label, fn, { cancel = null, inlineMs } = {}) {
    for (const [k, j] of this.jobs) if (!j.running && this.now() - j.finishedAt > this.keepMs) this.jobs.delete(k);
    const ac = new AbortController();
    const job = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, tokenId, kind, label, running: true, startedAt: this.now(), finishedAt: null, result: null, error: null, ac, cancel };
    this.jobs.set(job.id, job);
    const p = Promise.resolve().then(() => fn(ac.signal)).then(
      (r) => { job.result = r; },
      (e) => { job.error = scrubText((e && e.message) || 'The job failed.'); }
    ).finally(() => { job.running = false; job.finishedAt = this.now(); });
    const wait = Number.isFinite(inlineMs) ? inlineMs : this.inlineMs;
    let timer;
    const done = await Promise.race([p.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), wait); })]);
    clearTimeout(timer);
    if (done) {
      this.jobs.delete(job.id);
      if (job.error) throw userError(job.error, 'JOB_FAILED');
      return job.result;
    }
    return {
      summary: `${label} is still running in the background (runId ${job.id}). Check it with get_run_status.`,
      data: { runId: job.id, running: true }
    };
  }
  get(id, tokenId) {
    const j = this.jobs.get(String(id));
    return j && j.tokenId === tokenId ? this.view(j) : null;
  }
  cancel(id, tokenId) {
    const j = this.jobs.get(String(id));
    if (!j || (tokenId != null && j.tokenId !== tokenId) || !j.running) return false;
    try { j.ac.abort(); } catch (e) { /* ignore */ }
    if (typeof j.cancel === 'function') Promise.resolve().then(j.cancel).catch(() => {});
    return true;
  }
  cancelAll() {
    let n = 0;
    for (const j of this.jobs.values()) if (this.cancel(j.id, null)) n += 1;
    return n;
  }
}

class ToolRegistry {
  // services: { settings(), isEnabled(), approvals, audit: { record }, memory, tracker, jobs, limiter }
  constructor({ deps, services, tools = TOOLS, inlineWaitMs = DEFAULT_INLINE_WAIT_MS, now = () => Date.now() }) {
    validateDeps(deps);
    this.deps = deps;
    this.services = services;
    this.inlineWaitMs = inlineWaitMs;
    this.now = now;
    this.inflight = new Set();
    this.tools = new Map();
    for (const t of tools) {
      validateTool(t);
      if (this.tools.has(t.name)) throw new Error(`Duplicate tool ${t.name}`);
      this.tools.set(t.name, { ...t, schema: z.object(t.input || {}) });
    }
  }

  get(name) { return this.tools.get(name) || null; }

  names() { return [...this.tools.keys()]; }

  // Tools that may be pre-approved on an automation token: operate scope, never Expert.
  preApprovableNames() {
    return [...this.tools.values()].filter((t) => t.scope === 'operate' && !t.expert).map((t) => t.name);
  }

  // Tools a token may see: within its scope; Expert tools only with Expert mode on.
  forToken(token) {
    const settings = this.services.settings();
    return [...this.tools.values()].filter((t) => aiTokens.scopeAllows(token.scope, t.scope) && (!t.expert || settings.expertMode));
  }

  // Reference table for the UI, docs and tests.
  describe() {
    return [...this.tools.values()].map((t) => ({
      name: t.name, title: t.title, description: t.description, scope: t.scope, permission: t.permission || null,
      approval: t.approval, expert: Boolean(t.expert), annotations: t.annotations
    }));
  }

  abortAll() {
    let n = 0;
    for (const ac of this.inflight) { try { ac.abort(); n += 1; } catch (e) { /* ignore */ } }
    return n;
  }

  // cc: { token: { id, name, kind, scope, groupIds, preApproved, memberId }, clientName, transport,
  //       signal, onProgress, includeWsEndpoint, waitForApproval: 'inline' | 'full' }
  // Returns { ok: true, summary, data?, content?, approval } or
  //         { ok: false, code, error, pending?, approvalId? }.
  async call(name, rawArgs, cc) {
    const started = this.now();
    const token = cc.token;
    const auditBase = { tokenId: token.id, tokenName: token.name, memberId: token.memberId, clientName: cc.clientName || null, transport: cc.transport || null, tool: name };
    const audit = (outcome, extra = {}) => Promise.resolve(this.services.audit.record({ ...auditBase, outcome, durationMs: this.now() - started, ...extra })).catch(() => {});
    const refuse = async (code, error, outcome = 'denied', extra = {}) => {
      await audit(outcome, { error, args: rawArgs, summary: extra.summary || null, approval: extra.approval || null });
      return { ok: false, code, error, ...extra };
    };

    const tool = this.tools.get(name);
    if (!tool) return refuse('UNKNOWN_TOOL', `There is no SoftGlaze tool named "${name}".`, 'error');
    if (!this.services.isEnabled()) return refuse('AI_OFF', 'SoftGlaze AI is switched off in the app. Ask the user to switch it on from the SoftGlaze AI page.');
    if (!aiTokens.scopeAllows(token.scope, tool.scope)) {
      return refuse('SCOPE', `This token has the ${token.scope} scope; ${name} needs ${tool.scope}. The Owner or an Admin can create a token with the ${tool.scope} scope on the SoftGlaze AI page.`);
    }
    const settings = this.services.settings();
    if (tool.expert && !settings.expertMode) return refuse('EXPERT_OFF', 'Expert tools are off. Only the Owner can turn on Expert mode on the SoftGlaze AI page.');
    const parsed = tool.schema.safeParse(rawArgs == null ? {} : rawArgs);
    if (!parsed.success) return refuse('BAD_ARGS', `Invalid arguments for ${name}: ${zodMessage(parsed.error)}`, 'error');
    const args = parsed.data;
    if (!this.services.limiter.take(token.id)) return refuse('RATE_LIMIT', 'Too many calls from this token in the last minute. Wait a moment and try again.');

    const ac = new AbortController();
    const onAbort = () => { try { ac.abort(); } catch (e) { /* ignore */ } };
    if (cc.signal) { if (cc.signal.aborted) onAbort(); else cc.signal.addEventListener('abort', onAbort, { once: true }); }
    this.inflight.add(ac);
    const actorRecord = { memberId: token.memberId, tokenId: token.id, tokenName: token.name, clientName: cc.clientName || null, via: token.kind === 'api' ? 'api' : 'ai' };
    let summary = null;
    let approval = null;
    try {
      return await actor.run(actorRecord, async () => {
        const ctx = this._context(tool, cc, ac.signal);
        if (tool.expert) await ctx.assertOwner();
        if (tool.permission) {
          try { await this.deps.requirePermission(tool.permission); }
          catch (e) { throw userError(e.message || 'Your role does not permit this action.', 'FORBIDDEN'); }
        }
        const t = tool.targets ? tool.targets(args) : { profileIds: [] };
        let profileIds = (t && t.profileIds) || [];
        if (typeof tool.resolveTargets === 'function') profileIds = await tool.resolveTargets(args, ctx);
        if (profileIds.length && !(t && t.dynamic)) await ctx.assertProfiles(profileIds);
        const info = { count: profileIds.length + ((t && t.newProfiles) || 0), profileIds };
        summary = tool.summarize(args, info);
        // Name the profiles in the dialog and the audit, so the user sees what they approve.
        if (profileIds.length) {
          const named = await ctx.db.profile.findMany({ where: { id: { in: profileIds.slice(0, 5) } }, select: { id: true, title: true } });
          const titles = named.map((p) => p.title).filter(Boolean);
          if (titles.length) summary += ` (${titles.join(', ')}${profileIds.length > titles.length ? ` and ${profileIds.length - titles.length} more` : ''})`;
        }

        const decision = await this._approve(tool, args, ctx, cc, summary, info, settings);
        approval = decision.approval || null;
        if (decision.outcome === 'denied') {
          await audit('denied', { summary, args, approval, error: decision.error });
          return { ok: false, code: decision.code || 'DENIED', error: decision.error };
        }
        if (decision.outcome === 'pending') {
          await audit('pending', { summary, args, approval: 'asked' });
          return { ok: false, pending: true, code: 'APPROVAL_PENDING', approvalId: decision.approvalId, error: decision.error };
        }
        if (ac.signal.aborted) throw userError('Stopped: the user pressed Stop all AI or the request was cancelled.', 'ABORTED');
        const out = await tool.handler(args, ctx);
        await audit('ok', { summary, args, approval });
        return { ok: true, summary: out.summary, data: out.data, content: out.content, approval };
      });
    } catch (e) {
      const code = (e && e.code) || 'ERROR';
      const denied = code === 'FORBIDDEN' || code === 'DENIED' || code === 'LIMIT_REACHED' || code === 'PROFILE_LOCKED' || code === 'CONCURRENCY_LIMIT';
      const error = scrubText((e && e.message) || 'The tool failed.');
      await audit(denied ? 'denied' : 'error', { summary, args, approval, error });
      return { ok: false, code, error };
    } finally {
      this.inflight.delete(ac);
      if (cc.signal) cc.signal.removeEventListener('abort', onAbort);
    }
  }

  async _approve(tool, args, ctx, cc, summary, info, settings) {
    const token = cc.token;
    const approvals = this.services.approvals;
    const mode = modeFor(settings.approvalMode, tool.scope);
    let rule = tool.approval;
    if (rule === 'none') {
      if (mode === 'never') return { approval: 'none' };
      rule = 'ask';
    }
    // Developer API tokens (Settings > Developer API) drive scripts on /api/v1, which cannot answer
    // dialogs; they never reach /mcp.
    if (token.kind === 'api' && cc.transport === 'rest') return { approval: 'developer-token' };
    if (rule === 'self') {
      if (this.services.tracker.startedBy(token.id, tool.selfKey(args))) return { approval: 'started-by-this-token' };
      rule = 'ask';
    }
    const many = typeof tool.many === 'function' ? Boolean(tool.many(args)) : false;
    const askEveryTime = rule === 'always' || many || (mode === 'ask-always' && rule !== 'page');
    const grantKey = rule === 'page' ? `page:${info.profileIds[0]}` : tool.name;
    const fingerprint = ApprovalManager.fingerprint(tool.name, args);

    // Automation tokens: pre-approved tools skip the dialog within their caps; over a cap they ask.
    const pre = token.preApproved;
    if (pre && pre.tools.includes(tool.name) && !tool.expert && token.groupIds.length) {
      const withinProfiles = info.count <= pre.maxProfilesPerCall;
      if (withinProfiles && this.services.limiter.usePreApproved(token.id, pre.maxCallsPerHour)) return { approval: 'pre-approved' };
    }
    if (approvals.consumeLateGrant(token.id, fingerprint)) return { approval: 'allow-once' };
    if (!askEveryTime && approvals.hasHourGrant(token.id, grantKey)) return { approval: 'hour-grant' };

    const ctxArgs = redactArgs(args);
    let a = approvals.findPending(token.id, fingerprint);
    if (!a) {
      a = approvals.request({
        tokenId: token.id,
        tokenName: token.name,
        memberId: token.memberId,
        clientName: cc.clientName || null,
        tool: tool.name,
        summary: `${cc.clientName || token.name} wants to: ${summary}`,
        args: ctxArgs,
        allowHour: !askEveryTime,
        grantKey,
        fingerprint
      });
    }
    a.detached = false;
    const waitMs = cc.waitForApproval === 'full' ? Math.max(0, a.expiresAt - this.now()) + 1000 : this.inlineWaitMs;
    const startedWait = this.now();
    let progressTimer = null;
    if (typeof cc.onProgress === 'function') {
      progressTimer = setInterval(() => {
        const secs = Math.round((this.now() - startedWait) / 1000);
        Promise.resolve(cc.onProgress({ progress: secs, total: Math.round((a.expiresAt - startedWait) / 1000), message: 'Waiting for the user to approve in SoftGlaze' })).catch(() => {});
      }, PROGRESS_EVERY_MS);
      if (progressTimer.unref) progressTimer.unref();
    }
    let waitTimer = null;
    const WAIT_OVER = Symbol('wait');
    const result = await Promise.race([
      a.promise,
      new Promise((r) => { waitTimer = setTimeout(() => r(WAIT_OVER), waitMs); }),
      new Promise((r) => { if (ctx.signal.aborted) r(WAIT_OVER); else ctx.signal.addEventListener('abort', () => r(WAIT_OVER), { once: true }); })
    ]);
    clearTimeout(waitTimer);
    if (progressTimer) clearInterval(progressTimer);
    if (result === WAIT_OVER) {
      a.detached = true;
      const secsLeft = Math.max(0, Math.round((a.expiresAt - this.now()) / 1000));
      return {
        outcome: 'pending',
        approvalId: a.id,
        error: `Waiting for the user to approve this in the SoftGlaze app (about ${secsLeft} seconds left). Tell the user, then call ${tool.name} again with exactly the same arguments; it runs once they allow it. If they deny it or nobody answers, it is denied.`
      };
    }
    const d = result.decision;
    if (d === 'allow-once' || d === 'allow-hour') return { approval: d };
    if (d === 'deny') return { outcome: 'denied', approval: 'deny', code: 'DENIED_BY_USER', error: 'The user denied this in SoftGlaze. Do not retry it; ask the user what to do instead.' };
    if (d === 'timeout') return { outcome: 'denied', approval: 'timeout', code: 'APPROVAL_TIMEOUT', error: 'No one answered the approval in SoftGlaze within 2 minutes, so it was denied.' };
    return { outcome: 'denied', approval: 'cancelled', code: 'STOPPED', error: 'Stopped: the user pressed Stop all AI in SoftGlaze.' };
  }

  _context(tool, cc, signal) {
    const deps = this.deps;
    const services = this.services;
    const token = cc.token;
    const groupIds = token.groupIds || [];
    const db = deps.getPrisma();
    const denied = (message) => userError(message, 'DENIED');
    const ctx = {
      deps,
      db,
      services,
      signal,
      token,
      memberId: token.memberId,
      clientName: cc.clientName || null,
      includeWsEndpoint: Boolean(cc.includeWsEndpoint),
      tracker: services.tracker,
      settings: () => services.settings(),
      scrub: scrubText,
      userError: (m) => userError(m),
      denied,
      jobs: {
        get: (id, tokenId) => services.jobs.get(id, tokenId),
        cancel: (id, tokenId) => services.jobs.cancel(id, tokenId)
      },
      runJob: (kind, label, fn, opts) => services.jobs.start(token.id, kind, label, fn, opts),
      async profileWhere(base) {
        const w = await deps.scopedProfileWhere(base);
        return groupIds.length ? { AND: [w, { groupId: { in: groupIds } }] } : w;
      },
      async assertProfiles(ids, opts = {}) {
        const list = [...new Set((ids || []).map(Number))];
        if (!list.length) return [];
        const rows = await db.profile.findMany({ where: { id: { in: list } }, select: { id: true, groupId: true, deletedAt: true } });
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const pid of list) {
          const r = byId.get(pid);
          if (!r || r.deletedAt) throw userError(`Profile #${pid} was not found.`);
          if (groupIds.length && !groupIds.includes(r.groupId)) throw denied(`Profile #${pid} is outside the groups this token may use.`);
        }
        const { denied: blocked } = await deps.partitionAccessibleProfileIds(list, { requireEdit: Boolean(opts.edit) });
        if (blocked && blocked.length) throw denied(`You do not have ${opts.edit ? 'edit ' : ''}access to profile${blocked.length === 1 ? '' : 's'} ${blocked.map((x) => `#${x}`).join(', ')}.`);
        return list;
      },
      assertGroupAllowed(groupId) {
        if (!groupIds.length) return;
        if (groupId == null || !groupIds.includes(Number(groupId))) throw denied('This token may only use profiles in its own groups; choose one of them (see workspace_summary).');
      },
      async resolveGroup(ref) {
        const groups = await db.group.findMany({ select: { id: true, name: true } });
        const asNum = Number(ref);
        let g = Number.isInteger(asNum) && asNum > 0 ? groups.find((x) => x.id === asNum) : null;
        if (!g) {
          const want = String(ref).trim().toLowerCase();
          g = groups.find((x) => String(x.name).trim().toLowerCase() === want) || null;
        }
        if (!g) throw userError(`There is no group "${ref}". Use list_groups to see the groups.`);
        if (groupIds.length && !groupIds.includes(g.id)) throw denied(`The group "${g.name}" is outside the groups this token may use.`);
        return g;
      },
      async assertProxy(proxyId, opts = {}) {
        try { await deps.assertCanAccessProxy(proxyId); }
        catch (e) { throw userError(e.message || 'You do not have access to this proxy.', e.code === 'FORBIDDEN' ? 'DENIED' : 'USER'); }
        if (!opts.forRead && groupIds.length) {
          const outside = await db.profile.count({ where: { proxyId, deletedAt: null, NOT: { groupId: { in: groupIds } } } });
          if (outside) throw denied('This proxy is used by profiles outside the groups this token may use.');
        }
      },
      assertDomainAllowed(url) {
        const list = services.settings().pageDomainAllowList || [];
        if (!domainAllowed(url, list)) {
          let host = url;
          try { host = new URL(url).hostname; } catch (e) { /* keep url */ }
          throw denied(`${host} is not in the page-domain allow list in SoftGlaze AI settings.`);
        }
      },
      async runningProfileIds() {
        const ids = deps.listAllSessions().map((s) => Number(s.sessionId)).filter((n) => Number.isInteger(n) && n > 0);
        if (!ids.length) return new Set();
        const rows = await db.profile.findMany({ where: await ctx.profileWhere({ id: { in: ids } }), select: { id: true } });
        return new Set(rows.map((r) => r.id));
      },
      async visibleGroups() {
        const groups = await db.group.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, color: true } });
        const where = await ctx.profileWhere({ deletedAt: null, groupId: { not: null } });
        const rows = await db.profile.findMany({ where, select: { groupId: true } });
        const counts = new Map();
        for (const r of rows) counts.set(r.groupId, (counts.get(r.groupId) || 0) + 1);
        return groups
          .filter((g) => !groupIds.length || groupIds.includes(g.id))
          .map((g) => ({ id: g.id, name: g.name, color: g.color || null, profileCount: counts.get(g.id) || 0 }));
      },
      async license() {
        let l = {};
        try { l = (await deps.getLicense()) || {}; } catch (e) { l = {}; }
        const lim = l.limits || {};
        return { tier: lim.tier || l.tier || 'pro', type: l.type || null, state: l.state || null, daysLeft: l.daysLeft == null ? null : l.daysLeft, maxParallel: lim.maxParallel || 3, seats: lim.seats || null };
      },
      async isUnrestrictedViewer() {
        if (groupIds.length) return false;
        const m = await deps.getActiveMember();
        return !m || m.role === 'SUPER_ADMIN' || m.role === 'OWNER';
      },
      async assertOwner() {
        const m = await deps.getActiveMember();
        if (m && m.role !== 'OWNER' && m.role !== 'SUPER_ADMIN') throw denied('Only a token that acts as the Owner can use Expert tools.');
      }
    };
    return ctx;
  }
}

module.exports = {
  ToolRegistry,
  RateLimiter,
  AiTracker,
  JobStore,
  NEVER_EXPOSED,
  NEVER_EXPOSED_NAME,
  ALLOWED_DEPS,
  FORBIDDEN_DEP,
  MODES,
  modeFor,
  domainAllowed,
  validateDeps,
  validateTool,
  userError,
  DEFAULT_INLINE_WAIT_MS
};
