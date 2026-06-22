'use strict';
// ---------------------------------------------------------------------------
// Softglaze Pro — Local Developer REST API
//
// A tiny, loopback-only HTTP server that lets power users drive Softglaze
// programmatically (CI, scripts, orchestration). It is OFF by default and only
// ever binds to 127.0.0.1 — it is never exposed on the network.
//
// Auth: every protected route requires `Authorization: Bearer sg_…`. We store
// only the SHA-256 hash of each token (see the ApiToken model), so the request
// token is hashed and matched against the table; a hit updates lastUsedAt.
//
// Design: the actual profile-launch logic lives in ipcHandlers (it handles
// Firefox routing, proxy rotation and global settings). To avoid a circular
// require, that launcher is injected via configure() rather than required here.
// ---------------------------------------------------------------------------
const http = require('node:http');
const crypto = require('node:crypto');
const { getPrisma } = require('./database');

const DEFAULT_PORT = 8080;
const HOST = '127.0.0.1';

let server = null;
let runningPort = null;
let launchProfileByIdFn = null;
let readProfilesFn = async () => [];
let readConfigFn = async () => ({ enabled: false, port: DEFAULT_PORT });
let writeConfigFn = async () => {};

function configure(deps = {}) {
  if (typeof deps.launchProfileById === 'function') launchProfileByIdFn = deps.launchProfileById;
  if (typeof deps.readProfiles === 'function') readProfilesFn = deps.readProfiles;
  if (typeof deps.readConfig === 'function') readConfigFn = deps.readConfig;
  if (typeof deps.writeConfig === 'function') writeConfigFn = deps.writeConfig;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sendJson(res, status, obj) {
  try {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  } catch (e) { try { res.end(); } catch (_) {} }
}

// Resolve a Bearer token to its ApiToken row, or null. Best-effort updates
// lastUsedAt (fire-and-forget — auth must not wait on the write).
async function verifyBearer(req) {
  const auth = String(req.headers['authorization'] || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const tokenHash = sha256(m[1].trim());
  let row = null;
  try { row = await getPrisma().apiToken.findUnique({ where: { tokenHash } }); }
  catch (e) { return null; }
  if (!row) return null;
  getPrisma().apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return row;
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${HOST}:${runningPort || DEFAULT_PORT}`);
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','v1','profiles','12','start']

    // Health probe — unauthenticated, so scripts can detect the server is up.
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      return sendJson(res, 200, { ok: true, service: 'Softglaze Local API', version: 'v1' });
    }

    // GET /api/v1/profiles  — list current profile configurations (Bearer auth).
    if (req.method === 'GET' && url.pathname === '/api/v1/profiles') {
      const token = await verifyBearer(req);
      if (!token) return sendJson(res, 401, { error: 'Unauthorized', message: 'A valid Bearer API token is required.' });
      try {
        const profiles = await readProfilesFn();
        return sendJson(res, 200, { ok: true, count: Array.isArray(profiles) ? profiles.length : 0, profiles: profiles || [] });
      } catch (e) {
        return sendJson(res, 500, { error: 'ServerError', message: e && e.message ? e.message : 'Could not read profiles.' });
      }
    }

    // POST /api/v1/profiles/:id/start  — launch a profile by id (Bearer auth).
    // Returns the WebDriver/CDP `wsEndpoint` so callers can attach Playwright,
    // Puppeteer, or a CDP-speaking Selenium driver directly to the container.
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'profiles' && parts[4] === 'start') {
      const token = await verifyBearer(req);
      if (!token) return sendJson(res, 401, { error: 'Unauthorized', message: 'A valid Bearer API token is required.' });

      const id = Number.parseInt(parts[3], 10);
      if (!Number.isInteger(id) || id < 1) return sendJson(res, 400, { error: 'BadRequest', message: 'Invalid profile id.' });
      if (typeof launchProfileByIdFn !== 'function') {
        return sendJson(res, 503, { error: 'Unavailable', message: 'The launcher is not ready yet.' });
      }
      try {
        const result = await launchProfileByIdFn(id, 'about:blank');
        return sendJson(res, 200, {
          ok: true,
          profileId: id,
          sessionId: result && result.sessionId ? result.sessionId : null,
          wsEndpoint: result && result.wsEndpoint ? result.wsEndpoint : null
        });
      } catch (e) {
        return sendJson(res, 500, { error: 'LaunchFailed', message: e && e.message ? e.message : 'Could not launch profile.' });
      }
    }

    return sendJson(res, 404, { error: 'NotFound', message: 'Unknown endpoint.' });
  } catch (e) {
    sendJson(res, 500, { error: 'ServerError', message: e && e.message ? e.message : 'Internal error.' });
  }
}

function isRunning() { return Boolean(server); }

async function start(port) {
  if (server) return { running: true, port: runningPort };
  let cfg = {};
  try { cfg = (await readConfigFn()) || {}; } catch (e) { cfg = {}; }
  const desired = Number(port || cfg.port || DEFAULT_PORT);
  await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => { handleRequest(req, res); });
    s.on('error', (err) => { reject(err); });
    s.listen(desired, HOST, () => { server = s; runningPort = desired; resolve(); });
  });
  return { running: true, port: runningPort };
}

async function stop() {
  if (!server) { runningPort = null; return { running: false }; }
  await new Promise((resolve) => { try { server.close(() => resolve()); } catch (e) { resolve(); } });
  server = null;
  runningPort = null;
  return { running: false };
}

// Persist the enabled flag and start/stop the server to match. Throws (e.g.
// EADDRINUSE) so the caller/UI can surface a "port already in use" message.
async function setEnabled(enabled) {
  let cfg = {};
  try { cfg = (await readConfigFn()) || {}; } catch (e) { cfg = {}; }
  cfg.enabled = Boolean(enabled);
  if (!cfg.port) cfg.port = DEFAULT_PORT;
  await writeConfigFn(cfg);
  if (cfg.enabled) await start(cfg.port);
  else await stop();
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
    url: `http://${HOST}:${port}`
  };
}

// Start at boot if the persisted config says enabled. Never throws.
async function startIfEnabled() {
  try {
    const cfg = (await readConfigFn()) || {};
    if (cfg.enabled) await start(cfg.port);
  } catch (e) { /* port busy / config unreadable — stay down */ }
}

module.exports = {
  DEFAULT_PORT,
  configure,
  start,
  stop,
  setEnabled,
  getStatus,
  isRunning,
  startIfEnabled
};
