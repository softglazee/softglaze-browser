'use strict';
// Loopback-only HTTP server for the Developer API (/api/v1) and SoftGlaze AI (/mcp). It binds
// 127.0.0.1 only and runs while either is switched on (both off by default).
//
// Every request is checked, in order:
//   1. Host header: 127.0.0.1, localhost or [::1] with our port, plus any extra host name the
//      Owner allowed (for example host.docker.internal for n8n in Docker). Stops DNS rebinding.
//   2. Origin header: refused unless it is this server itself. No CORS: web pages cannot call it.
//   3. Size: bodies over 1 MB (/mcp) or 64 KB (/api/v1) are refused.
//   4. Bearer token (except /api/v1/health): hashed lookup, not revoked, not expired, a member
//      that still exists and is active, and the workspace unlocked. AI tokens (sgai_) work on
//      /mcp and /api/v1; Developer API tokens (sg_) on /api/v1 only.
//   5. The call runs through the AI tool registry as the token's member (scope, permissions,
//      group limit, approvals, plan limits, audit).
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_PORT = 8080;
const HOST = '127.0.0.1';
const MCP_BODY_LIMIT = 1024 * 1024;
const REST_BODY_LIMIT = 64 * 1024;
const AUTH_FAILURES_PER_MINUTE = 30;

let server = null;
let runningPort = null;
let ai = null; // src/main/ai/index.js, set by configure()
let readConfigFn = async () => ({ enabled: false, port: DEFAULT_PORT });
let writeConfigFn = async () => {};
let syncChain = Promise.resolve();
let lastStartError = null; // why the server could not start (port in use), for the status
const authFailures = [];

function configure(deps = {}) {
  if (typeof deps.readConfig === 'function') readConfigFn = deps.readConfig;
  if (typeof deps.writeConfig === 'function') writeConfigFn = deps.writeConfig;
  if (deps.ai) ai = deps.ai;
}

function sendJson(res, status, obj, headers = {}) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* ignore */ } return; }
  try {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  } catch (e) { try { res.end(); } catch (_) { /* ignore */ } }
}

function sendError(res, status, error, message, extra = {}) {
  sendJson(res, status, { ok: false, error, message, ...extra });
}

// ---- Host / Origin (DNS rebinding and browser pages) ----
function allowedHostNames() {
  const extra = ai && ai.settings ? (ai.settings().extraAllowedHosts || []) : [];
  return ['127.0.0.1', 'localhost', '[::1]', ...extra];
}

function hostAllowed(hostHeader, port) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (!h || !port) return false;
  return allowedHostNames().some((name) => h === `${name}:${port}`);
}

function originAllowed(origin, port) {
  if (origin === undefined) return true; // native clients send no Origin
  const o = String(origin || '').trim().toLowerCase();
  return allowedHostNames().some((name) => o === `http://${name}:${port}`);
}

// ---- Bodies ----
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { const e = new Error('too large'); e.status = 413; reject(e); return; }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return; // the rest is drained and dropped; the 413 closes the connection
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; const e = new Error('too large'); e.status = 413; reject(e); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const text = await readBody(req, limit);
  if (!text.trim()) return undefined;
  try { return JSON.parse(text); } catch (e) { const err = new Error('bad json'); err.status = 400; throw err; }
}

// ---- Auth ----
function bearerOf(req) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization || ''));
  return m ? m[1] : '';
}

function tooManyFailures() {
  const now = Date.now();
  while (authFailures.length && now - authFailures[0] > 60 * 1000) authFailures.shift();
  return authFailures.length >= AUTH_FAILURES_PER_MINUTE;
}

async function authenticate(req, res, transport) {
  if (!ai) { sendError(res, 503, 'Unavailable', 'SoftGlaze is still starting.'); return null; }
  if (tooManyFailures()) { sendError(res, 429, 'TooManyRequests', 'Too many failed sign-ins in the last minute. Wait and try again.'); return null; }
  const result = await ai.authenticate(bearerOf(req), { transport });
  if (!result.ok) {
    if (result.status === 401) authFailures.push(Date.now());
    const headers = result.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="SoftGlaze"' } : {};
    sendJson(res, result.status || 401, { ok: false, error: result.code || 'Unauthorized', message: result.message }, headers);
    return null;
  }
  return result.auth;
}

// ---- Registry calls from REST ----
const FORBIDDEN_CODES = ['SCOPE', 'DENIED', 'FORBIDDEN', 'DENIED_BY_USER', 'APPROVAL_TIMEOUT', 'STOPPED', 'EXPERT_OFF', 'LIMIT_REACHED', 'PROFILE_LOCKED', 'CONCURRENCY_LIMIT'];
function statusForCode(code) {
  if (code === 'UNKNOWN_TOOL') return 404;
  if (code === 'BAD_ARGS' || code === 'USER') return 400;
  if (code === 'RATE_LIMIT') return 429;
  if (code === 'AI_OFF') return 503;
  if (code === 'APPROVAL_PENDING') return 202;
  if (FORBIDDEN_CODES.includes(code)) return 403;
  return 500;
}

async function callTool(res, auth, name, args) {
  const ctx = {
    token: auth.token,
    clientName: auth.token.kind === 'api' ? `Local API: ${auth.token.name}` : (auth.token.lastClientName || auth.token.name),
    transport: 'rest',
    waitForApproval: 'full',
    // Scripts attach Playwright/Puppeteer to a started profile; AI tokens need the full scope.
    includeWsEndpoint: auth.token.kind === 'api' || auth.token.scope === 'full'
  };
  const r = await ai.registry().call(name, args, ctx);
  if (!r.ok) { sendError(res, statusForCode(r.code), r.code || 'Error', r.error); return null; }
  return r;
}

// ---- Routes ----
async function handleRequest(req, res) {
  const port = runningPort;
  try {
    if (!hostAllowed(req.headers.host, port)) return sendError(res, 403, 'Forbidden', 'Invalid Host header.');
    if (!originAllowed(req.headers.origin, port)) return sendError(res, 403, 'Forbidden', 'Requests from web pages are not allowed.');
    const url = new URL(req.url, `http://${HOST}:${port}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/mcp' || path === '/mcp/sse' || path === '/mcp/messages') return await handleMcp(req, res, url, path);

    if (req.method === 'GET' && path === '/api/v1/health') {
      return sendJson(res, 200, { ok: true, service: 'SoftGlaze Local API', version: 'v1', ai: Boolean(ai && ai.isEnabled()) });
    }
    if (!path.startsWith('/api/v1/')) return sendError(res, 404, 'NotFound', 'Unknown endpoint.');

    // Each kind of token follows its own switch: Developer API tokens (sg_) need the Developer
    // API on, SoftGlaze AI tokens (sgai_) need SoftGlaze AI on. Both go through the tool registry.
    const auth = await authenticate(req, res, 'rest');
    if (!auth) return undefined;
    if (auth.token.kind === 'ai') {
      if (!ai.isEnabled()) return sendError(res, 503, 'AiOff', 'SoftGlaze AI is switched off. Switch it on from the SoftGlaze AI page in the app.');
    } else {
      const cfg = (await readConfigFn().catch(() => ({}))) || {};
      if (!cfg.enabled) return sendError(res, 403, 'ApiOff', 'The Developer API is switched off in SoftGlaze (Settings > Developer API).');
    }
    const parts = path.split('/').filter(Boolean); // ['api','v1',...]

    // GET /api/v1/profiles?page=&pageSize=&group=&search=&status=&tag=
    if (req.method === 'GET' && path === '/api/v1/profiles') {
      const q = url.searchParams;
      const args = {};
      if (q.get('page')) args.page = Number(q.get('page'));
      if (q.get('pageSize')) args.pageSize = Number(q.get('pageSize'));
      if (q.get('group')) args.group = /^\d+$/.test(q.get('group')) ? Number(q.get('group')) : q.get('group');
      if (q.get('search')) args.search = q.get('search');
      if (q.get('status')) args.status = q.get('status');
      if (q.get('tag')) args.tag = q.get('tag');
      const r = await callTool(res, auth, 'list_profiles', args);
      if (!r) return undefined;
      const profiles = r.data.profiles.map((p) => ({ ...p, title: p.name }));
      return sendJson(res, 200, { ok: true, count: r.data.total, page: r.data.page, pageSize: r.data.pageSize, profiles });
    }
    // GET /api/v1/sessions
    if (req.method === 'GET' && path === '/api/v1/sessions') {
      const r = await callTool(res, auth, 'list_sessions', {});
      if (!r) return undefined;
      return sendJson(res, 200, { ok: true, sessions: r.data.sessions });
    }
    // POST /api/v1/profiles/:id/start  body { startUrl | url, headless }
    // POST /api/v1/profiles/:id/stop
    if (req.method === 'POST' && parts.length === 5 && parts[2] === 'profiles' && (parts[4] === 'start' || parts[4] === 'stop')) {
      const id = Number.parseInt(parts[3], 10);
      if (!Number.isInteger(id) || id < 1) return sendError(res, 400, 'BadRequest', 'Invalid profile id.');
      const body = (await readJson(req, REST_BODY_LIMIT)) || {};
      if (parts[4] === 'stop') {
        const r = await callTool(res, auth, 'stop_profile', { id });
        if (!r) return undefined;
        return sendJson(res, 200, { ok: true, profileId: id, stopped: r.data.stopped });
      }
      const args = { id };
      const startUrl = body.startUrl || body.url || url.searchParams.get('startUrl');
      if (startUrl) args.url = String(startUrl);
      if (body.headless !== undefined || url.searchParams.get('headless')) args.headless = body.headless === true || url.searchParams.get('headless') === 'true';
      const r = await callTool(res, auth, 'start_profile', args);
      if (!r) return undefined;
      return sendJson(res, 200, { ok: true, profileId: id, sessionId: r.data.sessionId || null, wsEndpoint: r.data.wsEndpoint || null, alreadyRunning: Boolean(r.data.alreadyRunning) });
    }
    // GET /api/v1/tools  and  POST /api/v1/tools/:name (body = the tool's arguments)
    if (req.method === 'GET' && path === '/api/v1/tools') {
      const tools = ai.registry().forToken(auth.token).map((t) => ({ name: t.name, title: t.title, description: t.description, scope: t.scope, approval: t.approval }));
      return sendJson(res, 200, { ok: true, tools });
    }
    if (req.method === 'POST' && parts.length === 4 && parts[2] === 'tools') {
      const args = (await readJson(req, REST_BODY_LIMIT)) || {};
      const r = await callTool(res, auth, decodeURIComponent(parts[3]), args);
      if (!r) return undefined;
      const textOnly = Array.isArray(r.content) && r.content.every((c) => c.type === 'text');
      return sendJson(res, 200, { ok: true, summary: r.summary, data: r.data === undefined ? null : r.data, content: textOnly ? r.content : undefined });
    }
    return sendError(res, 404, 'NotFound', 'Unknown endpoint.');
  } catch (e) {
    if (e && e.status === 413) return sendJson(res, 413, { ok: false, error: 'TooLarge', message: 'The request body is too large.' }, { Connection: 'close' });
    if (e && e.status === 400) return sendError(res, 400, 'BadRequest', 'The request body is not valid JSON.');
    return sendError(res, 500, 'ServerError', 'Internal error.');
  }
}

async function handleMcp(req, res, url, path) {
  if (!ai || !ai.isEnabled()) {
    return sendJson(res, 503, { jsonrpc: '2.0', error: { code: -32000, message: 'SoftGlaze AI is switched off. Switch it on from the SoftGlaze AI page in the app.' }, id: null });
  }
  const transport = path === '/mcp' ? 'mcp' : 'sse';
  let body;
  if (req.method === 'POST') {
    try { body = await readJson(req, MCP_BODY_LIMIT); }
    catch (e) {
      if (e.status === 413) return sendJson(res, 413, { jsonrpc: '2.0', error: { code: -32000, message: 'The request is too large.' }, id: null }, { Connection: 'close' });
      return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error.' }, id: null });
    }
  }
  const auth = await authenticate(req, res, transport);
  if (!auth) return undefined;
  // The SDK passes req.auth to tool callbacks as extra.authInfo.
  req.auth = { token: 'sgai', clientId: String(auth.token.id), scopes: [auth.token.scope], extra: { softglaze: auth } };
  const mcp = ai.mcpHandler();
  if (path === '/mcp') return mcp.handleStreamable(req, res, body, auth);
  if (path === '/mcp/sse') {
    if (req.method !== 'GET') return sendError(res, 405, 'MethodNotAllowed', 'Open the SSE stream with GET.');
    return mcp.handleSseOpen(req, res, auth);
  }
  if (req.method !== 'POST') return sendError(res, 405, 'MethodNotAllowed', 'Send messages with POST.');
  return mcp.handleSseMessage(req, res, body, auth, url.searchParams.get('sessionId'));
}

// ---- Lifecycle ----
function isRunning() { return Boolean(server); }

async function start(port) {
  if (server) return { running: true, port: runningPort };
  const desired = port === 0 ? 0 : Number(port || DEFAULT_PORT);
  await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => { handleRequest(req, res); });
    s.headersTimeout = 30 * 1000;
    s.requestTimeout = 0; // SSE streams and approval waits stay open
    s.keepAliveTimeout = 5 * 1000;
    s.on('error', (err) => { reject(err); });
    s.listen(desired, HOST, () => {
      server = s;
      const addr = s.address();
      runningPort = addr && typeof addr === 'object' ? addr.port : desired; // port 0 = any free port (tests)
      resolve();
    });
  });
  return { running: true, port: runningPort };
}

async function stop() {
  if (!server) { runningPort = null; return { running: false }; }
  const s = server;
  server = null;
  runningPort = null;
  await new Promise((resolve) => {
    try {
      s.close(() => resolve());
      if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    } catch (e) { resolve(); }
  });
  return { running: false };
}

// Runs the server while the Developer API or SoftGlaze AI is on, on the configured port.
function sync() {
  syncChain = syncChain.catch(() => {}).then(async () => {
    let cfg = {};
    try { cfg = (await readConfigFn()) || {}; } catch (e) { cfg = {}; }
    const port = cfg.port === 0 ? 0 : (Number(cfg.port) || DEFAULT_PORT); // 0 = any free port (tests)
    const want = Boolean(cfg.enabled) || Boolean(ai && ai.isEnabled());
    if (!want) { lastStartError = null; if (server) await stop(); return; }
    if (server && port !== 0 && runningPort !== port) await stop();
    if (!server) {
      try { await start(port); lastStartError = null; }
      catch (e) { lastStartError = e; throw e; }
    }
  });
  return syncChain;
}

// Persist the Developer API flag and start/stop the server to match. Throws (e.g. EADDRINUSE)
// so the caller/UI can show "port already in use".
async function setEnabled(enabled) {
  let cfg = {};
  try { cfg = (await readConfigFn()) || {}; } catch (e) { cfg = {}; }
  cfg.enabled = Boolean(enabled);
  if (!cfg.port) cfg.port = DEFAULT_PORT;
  await writeConfigFn(cfg);
  await sync();
  return getStatus();
}

async function setPort(port) {
  let cfg = {};
  try { cfg = (await readConfigFn()) || {}; } catch (e) { cfg = {}; }
  cfg.port = Number(port) || DEFAULT_PORT;
  await writeConfigFn(cfg);
  await sync();
  return getStatus();
}

async function getStatus() {
  let cfg = {};
  try { cfg = (await readConfigFn()) || {}; } catch (e) { cfg = {}; }
  const port = runningPort || Number(cfg.port) || DEFAULT_PORT;
  return {
    enabled: Boolean(cfg.enabled),
    running: isRunning(),
    port,
    host: HOST,
    url: `http://${HOST}:${port}`,
    aiEnabled: Boolean(ai && ai.isEnabled()),
    error: !server && lastStartError ? startErrorMessage(lastStartError, port) : null
  };
}

function startErrorMessage(e, port) {
  if (e && e.code === 'EADDRINUSE') return `Port ${port} is already in use by another program. Close it, or choose another port in SoftGlaze AI settings.`;
  if (e && e.code === 'EACCES') return `SoftGlaze is not allowed to use port ${port}. Choose another port in SoftGlaze AI settings.`;
  return `The local server could not start: ${(e && e.message) || 'unknown error'}.`;
}

// Start at boot if the Developer API or SoftGlaze AI is on. Never throws.
async function startIfEnabled() {
  try { await sync(); } catch (e) { /* port busy / config unreadable - stay down */ }
}

module.exports = {
  DEFAULT_PORT,
  HOST,
  configure,
  start,
  stop,
  sync,
  setEnabled,
  setPort,
  getStatus,
  startIfEnabled,
  isRunning,
  // exported for tests
  hostAllowed,
  originAllowed,
  statusForCode
};
