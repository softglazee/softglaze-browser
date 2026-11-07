// SoftGlaze AI page logic that does not need React: permissions, error states, connect snippets,
// the create-token flow, settings validation and formatting. Framework-free (.mjs) for node:test.

// ---- Who may see what -----------------------------------------------------------------------

// The page and the nav item: Owner and Admin (spec §10). Single-user mode (no member, me === null)
// is the owner. `undefined` means "not loaded yet" and shows nothing.
export function canManageAi(me) {
  if (me === undefined) return false;
  if (me === null) return true;
  return ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(me.role);
}

// Owner-only parts: expert mode, extra allowed host names, automation tokens (spec §10, §11).
export function isAiOwner(me) {
  if (me === undefined) return false;
  if (me === null) return true;
  return ['OWNER', 'SUPER_ADMIN'].includes(me.role);
}

// ---- Errors ---------------------------------------------------------------------------------

// 'unavailable': this build has no AI engine (no handler, old preload) -> a calm explanation.
// 'forbidden': the member may not manage SoftGlaze AI. Anything else is a real error with Retry.
export function classifyAiError(e) {
  if (!e) return 'error';
  const code = String(e.code || '').toUpperCase();
  const msg = String((e && e.message) || e);
  if (code === 'AI_UNAVAILABLE') return 'unavailable';
  if (/No handler registered/i.test(msg) || /preload API is unavailable/i.test(msg) || /Blocked IPC channel: ai:/i.test(msg)) return 'unavailable';
  if (code === 'FORBIDDEN' || code === 'PERMISSION_DENIED') return 'forbidden';
  return 'error';
}

export function errorText(e) {
  return (e && e.message) ? String(e.message) : String(e || '');
}

// ---- Connect an AI app ----------------------------------------------------------------------

export const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>';
export const DOCS_BASE = 'https://browser.softglaze.com/docs/ai-agents';
export const CLIENT_ORDER = ['claude-desktop', 'claude-code', 'cursor', 'vscode', 'gemini-cli', 'codex', 'windsurf', 'cline', 'n8n', 'other'];
// Clients that start a local program (stdio) and so need the bridge.
export const STDIO_CLIENTS = new Set(['claude-desktop', 'other']);

const CLIENT_ALIASES = {
  claudedesktop: 'claude-desktop',
  claudeapp: 'claude-desktop',
  claudecode: 'claude-code',
  cursor: 'cursor',
  vscode: 'vscode',
  vscodecopilot: 'vscode',
  visualstudiocode: 'vscode',
  copilot: 'vscode',
  githubcopilot: 'vscode',
  gemini: 'gemini-cli',
  geminicli: 'gemini-cli',
  codex: 'codex',
  codexcli: 'codex',
  openaicodex: 'codex',
  chatgpt: 'codex',
  chatgptdesktop: 'codex',
  chatgptcodex: 'codex',
  chatgptdesktopcodex: 'codex',
  n8n: 'n8n',
  other: 'other',
  others: 'other',
  generic: 'other',
  windsurf: 'windsurf',
  devin: 'windsurf',
  devindesktop: 'windsurf',
  cline: 'cline',
  windsurfclineothers: 'other',
  otherapps: 'other'
};

const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Maps the engine's `client` id (or title) to one of CLIENT_ORDER, or null when unknown.
export function normalizeClientKey(client, title) {
  return CLIENT_ALIASES[compact(client)] || CLIENT_ALIASES[compact(title)] || null;
}

// Our own guide on browser.softglaze.com, one anchor per client (the website adds them).
export function docsUrlFor(key) {
  return key && CLIENT_ORDER.includes(key) ? `${DOCS_BASE}#${key}` : DOCS_BASE;
}

// The AI app's own documentation when the engine links it (https only, never our own site again).
export function appDocsUrl(given) {
  const s = String(given || '');
  if (!/^https:\/\//i.test(s)) return null;
  try { if (new URL(s).hostname === 'browser.softglaze.com') return null; } catch (e) { return null; }
  return s;
}

// Base URL of the local server, from status.url when the engine gives one.
export function serverOrigin(status) {
  if (status && status.url) {
    try { return new URL(String(status.url)).origin; } catch (e) { /* fall through */ }
  }
  const port = status && Number(status.port);
  return Number.isInteger(port) && port > 0 ? `http://127.0.0.1:${port}` : null;
}

// 'running' | 'off' | 'error' (switched on but not running) | 'unknown'
export function serverState(status) {
  if (!status || typeof status !== 'object') return 'unknown';
  if (!status.enabled) return 'off';
  return status.running ? 'running' : 'error';
}

// "127.0.0.1:47321" for the header.
export function serverAddress(status) {
  const o = serverOrigin(status);
  if (!o) return '';
  try { return new URL(o).host; } catch (e) { return o; }
}

export function mcpUrl(status) {
  if (status && status.url) return String(status.url);
  const o = serverOrigin(status);
  return o ? `${o}/mcp` : null;
}

// n8n uses the legacy SSE transport (spec §11). status.sseUrl from the engine wins; otherwise it is
// <origin>/mcp/sse. Inside Docker the same URL is reached through host.docker.internal.
export function n8nEndpoints(status) {
  const origin = serverOrigin(status);
  let sse = status && status.sseUrl ? String(status.sseUrl) : (origin ? `${origin}/mcp/sse` : null);
  if (!sse) return null;
  let sseDocker = sse;
  try { const u = new URL(sse); u.hostname = 'host.docker.internal'; sseDocker = u.toString(); } catch (e) { sse = String(sse); }
  const apiOrigin = origin || (() => { try { return new URL(sse).origin; } catch (e) { return ''; } })();
  return {
    sse,
    sseDocker,
    apiStart: `POST ${apiOrigin}/api/v1/profiles/<PROFILE_ID>/start`,
    authHeader: `Authorization: Bearer ${TOKEN_PLACEHOLDER}`
  };
}

// The engine's snippets in a fixed order, one per client, plus the n8n card built here.
// Unknown clients keep their own title and go before "Other apps".
export function buildClientList(snippets, status) {
  const list = Array.isArray(snippets) ? snippets.filter((s) => s && typeof s === 'object') : [];
  const byKey = new Map();
  const unknown = [];
  for (const s of list) {
    const key = normalizeClientKey(s.client, s.title);
    const entry = {
      key: key || `custom:${compact(s.client || s.title) || unknown.length}`,
      known: Boolean(key),
      title: s.title || s.client || '',
      kind: ['command', 'json', 'toml'].includes(s.kind) ? s.kind : 'json',
      where: s.where || '',
      text: typeof s.text === 'string' ? s.text : '',
      docsUrl: docsUrlFor(key),
      appDocsUrl: appDocsUrl(s.docsUrl)
    };
    if (!key) unknown.push(entry);
    else if (!byKey.has(key)) byKey.set(key, entry);
  }
  if (!byKey.has('n8n') && n8nEndpoints(status)) {
    byKey.set('n8n', { key: 'n8n', known: true, title: 'n8n', kind: 'n8n', where: '', text: '', docsUrl: docsUrlFor('n8n'), appDocsUrl: null });
  }
  const ordered = CLIENT_ORDER.filter((k) => k !== 'other' && byKey.has(k)).map((k) => byKey.get(k));
  return [...ordered, ...unknown, ...(byKey.has('other') ? [byKey.get('other')] : [])];
}

// Splits snippet text so the token placeholder can be highlighted.
export function splitSnippet(text, placeholder = TOKEN_PLACEHOLDER) {
  const s = String(text == null ? '' : text);
  if (!placeholder || !s.includes(placeholder)) return s ? [{ text: s, placeholder: false }] : [];
  const out = [];
  s.split(placeholder).forEach((part, i) => {
    if (i > 0) out.push({ text: placeholder, placeholder: true });
    if (part) out.push({ text: part, placeholder: false });
  });
  return out;
}

export function hasPlaceholder(text) {
  return String(text || '').includes(TOKEN_PLACEHOLDER);
}

// Puts a freshly created token into a snippet. Only used inside the one-time reveal step.
export function fillToken(text, token) {
  const s = String(text == null ? '' : text);
  if (!token || typeof token !== 'string') return s;
  return s.split(TOKEN_PLACEHOLDER).join(token);
}

// Codex reads the token from an environment variable (bearer_token_env_var).
export function envVarCommand(hostOs, value = TOKEN_PLACEHOLDER) {
  return hostOs === 'Windows'
    ? `setx SOFTGLAZE_TOKEN "${value}"`
    : `export SOFTGLAZE_TOKEN="${value}"`;
}

// ---- Tokens ---------------------------------------------------------------------------------

export const SCOPES = ['read', 'operate', 'full'];
export const EXPIRY_OPTIONS = [7, 30, 90, null];
export const NAME_MAX = 60;
export const AUTOMATION_DEFAULTS = Object.freeze({ maxProfilesPerCall: 5, maxCallsPerHour: 60 });
// The engine's limits (aiTokens MAX_PROFILES_PER_CALL / MAX_CALLS_PER_HOUR); a larger number would only fail there.
export const AUTOMATION_LIMITS = Object.freeze({ maxProfilesPerCall: [1, 50], maxCallsPerHour: [1, 1000] });

// Operate-scope tools an Owner may pre-approve on an Automation token (spec §11), the same list the
// engine answers on ai:preapprovable-tools (toolRegistry.preApprovableNames). Left out on purpose:
// expert and never-exposed tools, stop_all_profiles (too broad for an unattended run) and
// update_memory (it rewrites the instructions every AI reads).
export const PREAPPROVABLE_TOOLS = Object.freeze([
  { group: 'profiles', tools: ['create_profile', 'update_profile', 'batch_generate_profiles'] },
  { group: 'sessions', tools: ['start_profile', 'stop_profile'] },
  { group: 'proxies', tools: ['assign_proxy', 'rotate_proxy_ip', 'find_free_proxies'] },
  { group: 'groups', tools: ['create_group', 'move_profiles_to_group'] },
  { group: 'automation', tools: ['save_macro', 'run_macro', 'stop_run', 'start_warmer'] },
  { group: 'page', tools: ['page_navigate', 'page_snapshot', 'page_click', 'page_type', 'page_press_key', 'page_scroll', 'page_screenshot', 'page_extract_text', 'page_wait_for'] }
]);
export const PREAPPROVABLE_SET = new Set(PREAPPROVABLE_TOOLS.flatMap((g) => g.tools));

const TOOL_GROUP = new Map(PREAPPROVABLE_TOOLS.flatMap((g) => g.tools.map((name) => [name, g.group])));

// The list the Automation section shows: ai:preapprovable-tools ([{ name, title, scope, destructive }])
// when the engine answers, grouped like the built-in list (unknown tools under "other"); the
// built-in list when it does not. Only operate-scope tools are ever offered.
export function groupPreapprovable(list) {
  const fromEngine = Array.isArray(list)
    ? list.filter((x) => x && typeof x.name === 'string' && x.name && (x.scope == null || x.scope === 'operate'))
    : null;
  if (!fromEngine || fromEngine.length === 0) {
    return PREAPPROVABLE_TOOLS.map((g) => ({ group: g.group, tools: g.tools.map((name) => ({ name, title: null, destructive: false })) }));
  }
  const order = [...PREAPPROVABLE_TOOLS.map((g) => g.group), 'other'];
  const groups = new Map(order.map((g) => [g, []]));
  const seen = new Set();
  for (const x of fromEngine) {
    if (seen.has(x.name)) continue;
    seen.add(x.name);
    groups.get(TOOL_GROUP.get(x.name) || 'other').push({ name: x.name, title: x.title ? String(x.title) : null, destructive: x.destructive === true });
  }
  return order.filter((g) => groups.get(g).length).map((g) => ({ group: g, tools: groups.get(g) }));
}

export function preapprovableNames(groups) {
  return new Set((groups || []).flatMap((g) => g.tools.map((x) => x.name)));
}

export function defaultTokenForm({ me, members, clientTitle, automation = false } = {}) {
  const list = Array.isArray(members) ? members.filter((m) => m && m.status !== 'banned' && m.status !== 'suspended') : [];
  const mine = me && list.find((m) => m.id === me.id);
  const fallback = list.find((m) => m.role === 'OWNER') || list[0];
  return {
    name: clientTitle ? `${clientTitle} on this PC` : '',
    memberId: mine ? mine.id : (fallback ? fallback.id : null),
    // Read only unless the user picks more on purpose; an Automation token needs Operate.
    scope: automation ? 'operate' : 'read',
    expiresInDays: 30,
    groupMode: automation ? 'some' : 'all',
    groupIds: [],
    automation: Boolean(automation),
    preApprovedTools: [],
    maxProfilesPerCall: AUTOMATION_DEFAULTS.maxProfilesPerCall,
    maxCallsPerHour: AUTOMATION_DEFAULTS.maxCallsPerHour
  };
}

// Automation is on only for the Owner, on an operate/full token, with at least one tool picked.
export function automationActive(form, { isOwner } = {}) {
  return Boolean(isOwner && form && form.automation && form.scope !== 'read'
    && Array.isArray(form.preApprovedTools) && form.preApprovedTools.length > 0);
}

// Returns { field: i18nKey } for every problem; an empty object means the form can be sent.
export function validateTokenForm(form, { isOwner = false, hasMembers = true, allowedTools = PREAPPROVABLE_SET } = {}) {
  const errors = {};
  const name = String((form && form.name) || '').trim();
  if (!name) errors.name = 'errors.nameRequired';
  else if (name.length > NAME_MAX) errors.name = 'errors.nameTooLong';
  if (hasMembers && (form.memberId == null || form.memberId === '')) errors.memberId = 'errors.memberRequired';
  if (!SCOPES.includes(form.scope)) errors.scope = 'errors.scopeRequired';
  if (!EXPIRY_OPTIONS.includes(form.expiresInDays)) errors.expiresInDays = 'errors.expiryRequired';
  const auto = automationActive(form, { isOwner });
  const groups = Array.isArray(form.groupIds) ? form.groupIds : [];
  if (form.groupMode === 'some' && groups.length === 0) errors.groupIds = auto ? 'errors.groupsRequiredAutomation' : 'errors.groupsRequired';
  if (auto && form.groupMode !== 'some') errors.groupIds = 'errors.groupsRequiredAutomation';
  if (auto) {
    const bad = form.preApprovedTools.filter((t) => !allowedTools.has(t));
    if (bad.length) errors.preApprovedTools = 'errors.toolNotAllowed';
    for (const k of ['maxProfilesPerCall', 'maxCallsPerHour']) {
      const [lo, hi] = AUTOMATION_LIMITS[k];
      const v = Number(form[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) errors[k] = 'errors.limitRange';
    }
  }
  return errors;
}

// The ai.tokens.create() input (spec §10 + §11). Automation fields only when automation is active.
export function buildTokenInput(form, { isOwner = false, allowedTools = PREAPPROVABLE_SET } = {}) {
  const input = {
    name: String(form.name || '').trim(),
    memberId: form.memberId == null || form.memberId === '' ? null : form.memberId,
    scope: form.scope,
    expiresInDays: form.expiresInDays == null ? null : Number(form.expiresInDays),
    groupIds: form.groupMode === 'some' && Array.isArray(form.groupIds) ? form.groupIds.slice() : []
  };
  if (automationActive(form, { isOwner })) {
    input.preApprovedTools = form.preApprovedTools.filter((t) => allowedTools.has(t));
    input.maxProfilesPerCall = Number(form.maxProfilesPerCall);
    input.maxCallsPerHour = Number(form.maxCallsPerHour);
  }
  return input;
}

// The create-token dialog as a small state machine. The plain token exists only in the 'reveal'
// step and is wiped on close; closing before it was copied (or the box ticked) only warns.
export const initialTokenFlow = Object.freeze({
  step: 'closed', form: null, error: '', token: '', tokenId: null,
  copied: false, acknowledged: false, closeWarning: false, client: null
});

export function tokenFlowReducer(state, action) {
  switch (action && action.type) {
    case 'open':
      return { ...initialTokenFlow, step: 'form', form: action.form, client: action.client || null };
    case 'edit':
      if (state.step !== 'form') return state;
      return { ...state, form: { ...state.form, ...action.patch }, error: '' };
    case 'submit':
      if (state.step !== 'form') return state;
      return { ...state, step: 'saving', error: '' };
    case 'failed':
      if (state.step !== 'saving') return state;
      return { ...state, step: 'form', error: action.error || 'errors.create' };
    case 'created':
      if (state.step !== 'saving') return state;
      if (!action.token || typeof action.token !== 'string') return { ...state, step: 'form', error: 'errors.noToken' };
      return { ...state, step: 'reveal', token: action.token, tokenId: action.id == null ? null : action.id, copied: false, acknowledged: false, closeWarning: false };
    case 'copied':
      if (state.step !== 'reveal') return state;
      return { ...state, copied: true, closeWarning: false };
    case 'acknowledge':
      if (state.step !== 'reveal') return state;
      return { ...state, acknowledged: action.value !== false, closeWarning: false };
    case 'close':
      if (state.step === 'saving') return state;
      if (state.step === 'reveal' && !state.copied && !state.acknowledged && !action.force) return { ...state, closeWarning: true };
      return { ...initialTokenFlow };
    default:
      return state;
  }
}

export function canFinishReveal(state) {
  return Boolean(state && state.step === 'reveal' && (state.copied || state.acknowledged));
}

const DAY = 86400000;

function ms(v) {
  if (v == null || v === '') return NaN;
  return v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : Date.parse(String(v)));
}

// 'revoked' | 'expired' | 'expiring' (within 3 days) | 'active'
export function tokenState(tok, now = Date.now()) {
  if (!tok) return 'active';
  if (tok.revoked) return 'revoked';
  if (tok.expired === true) return 'expired';
  const exp = ms(tok.expiresAt);
  if (Number.isFinite(exp)) {
    if (exp <= now) return 'expired';
    if (exp - now <= 3 * DAY) return 'expiring';
  }
  return 'active';
}

export function isAutomationToken(tok) {
  return Boolean(tok && Array.isArray(tok.preApprovedTools) && tok.preApprovedTools.length > 0);
}

// Live tokens first (newest first), then expired, then revoked.
export function sortTokens(tokens, now = Date.now()) {
  const rank = { active: 0, expiring: 0, expired: 1, revoked: 2 };
  return (Array.isArray(tokens) ? tokens.slice() : []).sort((a, b) => {
    const r = rank[tokenState(a, now)] - rank[tokenState(b, now)];
    if (r) return r;
    return (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0);
  });
}

export function filterTokens(tokens, { query = '', showRevoked = false } = {}, now = Date.now()) {
  const q = String(query || '').trim().toLowerCase();
  return tokens.filter((tok) => {
    if (!showRevoked && tokenState(tok, now) === 'revoked') return false;
    if (!q) return true;
    return [tok.name, tok.memberName, tok.lastClientName].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

// ---- Settings -------------------------------------------------------------------------------

// "Never ask" exists only for read-only tools (spec §5).
export function approvalModeOptions(scope) {
  return scope === 'read' ? ['never', 'ask-hour', 'ask-always'] : ['ask-hour', 'ask-always'];
}

export function coerceApprovalMode(scope, mode) {
  return approvalModeOptions(scope).includes(mode) ? mode : 'ask-always';
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);
const HOST_RE = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function stripToHost(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '');
  s = s.replace(/:\d+$/, '');
  return s.replace(/\.$/, '');
}

// A site for the page-tools allow list: "https://www.Example.com/path" -> "www.example.com".
// "*.example.com" keeps its wildcard. Needs a dot; returns null when it is not a site name.
export function normalizeDomain(input) {
  let s = stripToHost(input);
  if (!s) return null;
  let wildcard = false;
  if (s.startsWith('*.')) { wildcard = true; s = s.slice(2); }
  if (/[^a-z0-9.-]/.test(s)) {
    try { s = new URL(`http://${s}`).hostname; } catch (e) { return null; }
  }
  if (!DOMAIN_RE.test(s) || IPV4_RE.test(s)) return null;
  return wildcard ? `*.${s}` : s;
}

// An extra host name the local server accepts (spec §11), e.g. host.docker.internal. Single-label
// names and IPv4 are fine; no ports, paths or wildcards.
export function normalizeHostName(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.includes('*')) return null;
  const s = stripToHost(raw);
  if (!s) return null;
  if (IPV4_RE.test(s)) return s;
  return HOST_RE.test(s) ? s : null;
}

export function addToList(list, value) {
  const arr = Array.isArray(list) ? list : [];
  return arr.includes(value) ? arr : [...arr, value];
}

export const PORT_RANGE = Object.freeze([1024, 65535]);
export function validPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= PORT_RANGE[0] && n <= PORT_RANGE[1];
}

// ---- Memory ---------------------------------------------------------------------------------

export const MEMORY_LIMIT_BYTES = 20 * 1024;

export function utf8Bytes(str) {
  const s = String(str == null ? '' : str);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}

export function memoryUsage(markdown) {
  const bytes = utf8Bytes(markdown);
  return { bytes, limit: MEMORY_LIMIT_BYTES, over: bytes > MEMORY_LIMIT_BYTES, fraction: Math.min(1, bytes / MEMORY_LIMIT_BYTES) };
}

export function formatKb(bytes) {
  const kb = Math.max(0, Number(bytes) || 0) / 1024;
  return kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
}

// ---- Activity -------------------------------------------------------------------------------

export const AUDIT_PAGE_SIZE = 50;
// 'pending': the call returned while its approval was still waiting.
export const OUTCOMES = ['ok', 'denied', 'error', 'pending'];
// A burst of status/approval events reloads the Activity tab once.
export const ACTIVITY_REFRESH_DEBOUNCE_MS = 600;

// Trailing-edge debounce: call() as often as you like, fn runs once ms after the last call.
// cancel() drops a pending run (the tab is hidden or unmounted). Timers are injectable for tests.
export function createDebounced(fn, ms, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let id = null;
  return {
    call: () => {
      if (id != null) clearTimer(id);
      id = setTimer(() => { id = null; fn(); }, ms);
    },
    cancel: () => {
      if (id != null) clearTimer(id);
      id = null;
    },
    pending: () => id != null
  };
}

export function buildAuditQuery(filters = {}, cursor = null, limit = AUDIT_PAGE_SIZE) {
  const q = { limit };
  if (cursor != null && cursor !== '') q.cursor = cursor;
  if (OUTCOMES.includes(filters.outcome)) q.outcome = filters.outcome;
  if (filters.client) q.clientName = String(filters.client);
  const search = String(filters.search || '').trim();
  if (search) q.search = search;
  return q;
}

// Applied on top of the engine's own filtering, so the table is right even if a filter is ignored.
export function filterAuditItems(items, filters = {}) {
  const list = Array.isArray(items) ? items : [];
  const search = String(filters.search || '').trim().toLowerCase();
  return list.filter((it) => {
    if (!it) return false;
    if (OUTCOMES.includes(filters.outcome) && it.outcome !== filters.outcome) return false;
    if (filters.client && it.clientName !== filters.client) return false;
    if (search && ![it.tool, it.summary, it.tokenName, it.clientName].some((v) => String(v || '').toLowerCase().includes(search))) return false;
    return true;
  });
}

export function formatDuration(msValue) {
  const n = Number(msValue);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} s`;
  const m = Math.floor(n / 60000);
  const s = Math.round((n % 60000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// "2 minutes ago" / "in 3 days" in the UI language.
export function relativeTime(value, now = Date.now(), lang = 'en') {
  const t = ms(value);
  if (!Number.isFinite(t)) return '';
  const diff = t - now;
  const abs = Math.abs(diff);
  const units = [['day', DAY], ['hour', 3600000], ['minute', 60000], ['second', 1000]];
  let fmt;
  try { fmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }); } catch (e) { fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); }
  if (abs < 45000) return fmt.format(0, 'second');
  for (const [unit, size] of units) {
    if (abs >= size || unit === 'second') return fmt.format(Math.round(diff / size), unit);
  }
  return '';
}

// Long tools hand back a run id ("job-..."); the activity row shows it so it can be looked up.
export function extractRunId(item) {
  if (!item) return null;
  if (typeof item.runId === 'string' && item.runId) return item.runId;
  const m = /\bjob-[A-Za-z0-9][A-Za-z0-9_-]*/.exec(String(item.summary || ''));
  if (m) return m[0];
  const a = item.args && typeof item.args === 'object' ? item.args.runId : null;
  return typeof a === 'string' && /^job-/.test(a) ? a : null;
}

// The engine leaves "Allow for 1 hour" out for actions that must ask every time.
export function canAllowHour(approval) {
  return Boolean(approval) && approval.allowHour !== false;
}

// How a call got through (engine audit `approval`), in words the activity table can show.
export const APPROVAL_PATHS = ['none', 'asked', 'pre-approved', 'allow-once', 'allow-hour', 'hour-grant', 'deny', 'timeout', 'cancelled', 'started-by-this-token', 'developer-token'];
export function approvalPath(item) {
  if (!item) return null;
  if (item.preApproved === true) return 'pre-approved';
  return APPROVAL_PATHS.includes(item.approval) ? item.approval : null;
}

// Plain "Pretty JSON" for the redacted approval args, capped so a huge payload cannot flood the dialog.
export function prettyArgs(args, max = 4000) {
  if (args === undefined) return '';
  let s;
  try { s = typeof args === 'string' ? args : JSON.stringify(args, null, 2); } catch (e) { s = String(args); }
  if (s == null) return '';
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}
