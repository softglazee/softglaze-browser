'use strict';
// Loopback HTTP bridge for the Firefox autofill extension, which cannot reach Electron over CDP.
// No CORS headers, so pages cannot read responses; the per-run token reaches the extension through
// Firefox managed storage. ipcHandlers injects persona logic via configure() (avoids a require cycle).
//
// One port per running Firefox profile. The add-on (signed by Mozilla, so it cannot change per
// profile) probes PORT_RANGE in order and talks to the first port that answers its ping, and every
// profile reads the same token. To tell profiles apart, each Firefox autofill session gets its own
// port here, and firefoxEngine writes `network.security.ports.banned` into that profile's user.js
// with every other port of the range: Firefox refuses those ports for the profile, add-on included,
// so a request can only arrive on the port of the profile that sent it. The vault rule is then asked
// for that session (isAvailable({ sessionId })), i.e. for the member who launched that profile.
const http = require('node:http');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
// The ports the add-on probes (src/firefox-extension/sg-background.js PORTS); fixed by the signed .xpi.
const PORT_RANGE = Object.freeze([47800, 47801, 47802, 47803, 47804, 47805, 47806, 47807, 47808, 47809]);
// Per-app-run secret. Never persisted by this module; firefoxEngine hands it to the
// extension through the managed-storage manifest.
const TOKEN = crypto.randomBytes(24).toString('hex');

const listeners = new Map(); // session key -> { server, port, sessionId }
let listForUrlFn = null;   // (url) => Promise<{ personas: [...] } | [...]>
let markUsedFn = null;     // (id, url) => Promise<any>
let getSecretFn = null;    // (id, url) => Promise<{ password } | null>  (origin-scoped)
let isAvailableFn = null;  // ({ sessionId }) => Promise<boolean>  false while locked / signed out / not allowed

function configure(deps = {}) {
  if (typeof deps.listForUrl === 'function') listForUrlFn = deps.listForUrl;
  if (typeof deps.markUsed === 'function') markUsedFn = deps.markUsed;
  if (typeof deps.getSecret === 'function') getSecretFn = deps.getSecret;
  if (typeof deps.isAvailable === 'function') isAvailableFn = deps.isAvailable;
}

// Vault calls are refused while the app is locked or signed out, and for a profile whose launcher may
// not use the vault in autofill. Fails closed: a throwing check means "not available".
async function vaultAvailable(ctx) {
  if (typeof isAvailableFn !== 'function') return true;
  try { return (await isAvailableFn(ctx)) === true; } catch (e) { return false; }
}

function sendJson(res, status, obj) {
  try {
    const body = JSON.stringify(obj);
    // No Access-Control-Allow-Origin, so a page's fetch stays unreadable cross-origin.
    // The extension background (host-permitted) is exempt from CORS.
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  } catch (e) { try { res.end(); } catch (_) {} }
}

// DNS-rebinding guard, as in localApi.js: serve only requests whose Host header targets this
// listener's loopback port. The extension always sends Host 127.0.0.1:<port>.
function hostAllowed(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function authed(req, port) {
  return hostAllowed(req, port) && String(req.headers['x-sg-autofill-token'] || '') === TOKEN;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    req.on('data', (c) => { data += c; if (data.length > 1e6) { try { req.destroy(); } catch (e) {} finish({}); } });
    req.on('end', () => { try { finish(data ? JSON.parse(data) : {}); } catch (e) { finish({}); } });
    req.on('error', () => finish({}));
    // A client abort or our own req.destroy() (size cap) emits 'close', not 'error'; without this the
    // promise never settles.
    req.on('close', () => finish({}));
  });
}

// `entry`: the listener the request arrived on ({ port, sessionId }); its session is the profile asking.
async function handleRequest(req, res, entry) {
  const port = entry.port;
  const ctx = { sessionId: entry.sessionId };
  try {
    const url = new URL(req.url, `http://${HOST}:${port}`);

    // Discovery probe - unauthenticated body is harmless (just a service tag), but
    // we still require the token so only our extension treats a port as "ours".
    if (req.method === 'GET' && url.pathname === '/sg-autofill/ping') {
      if (!authed(req, port)) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { service: 'softglaze-autofill', version: 1 });
    }

    if (req.method === 'GET' && url.pathname === '/sg-autofill/list') {
      if (!authed(req, port)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (typeof listForUrlFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
      if (!(await vaultAvailable(ctx))) return sendJson(res, 423, { error: 'Locked' });
      const target = url.searchParams.get('url') || '';
      try {
        const r = await listForUrlFn(target, ctx);
        const personas = Array.isArray(r) ? r : (r && Array.isArray(r.personas) ? r.personas : []);
        return sendJson(res, 200, { ok: true, personas });
      } catch (e) {
        return sendJson(res, 200, { ok: false, personas: [] });
      }
    }

    // Resolves one persona's password for an on-demand fill (Firefox has no trusted CDP typer).
    // getSecretFn resolves only personas offered for `url`, so a token holder cannot dump passwords by id.
    if (req.method === 'GET' && url.pathname === '/sg-autofill/secret') {
      if (!authed(req, port)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (typeof getSecretFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
      if (!(await vaultAvailable(ctx))) return sendJson(res, 423, { error: 'Locked' });
      const id = url.searchParams.get('id') || '';
      const target = url.searchParams.get('url') || '';
      try {
        const s = await getSecretFn(id, target, ctx);
        if (!s || s.password == null || s.password === '') return sendJson(res, 404, { ok: false });
        return sendJson(res, 200, { ok: true, password: String(s.password) });
      } catch (e) {
        return sendJson(res, 404, { ok: false });
      }
    }

    if (req.method === 'POST' && url.pathname === '/sg-autofill/mark-used') {
      if (!authed(req, port)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (typeof markUsedFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
      if (!(await vaultAvailable(ctx))) return sendJson(res, 423, { error: 'Locked' });
      const body = await readBody(req);
      try {
        await markUsedFn(String(body.id || ''), String(body.url || ''), ctx);
        return sendJson(res, 200, { ok: true });
      } catch (e) {
        return sendJson(res, 200, { ok: false });
      }
    }

    return sendJson(res, 404, { error: 'NotFound' });
  } catch (e) {
    sendJson(res, 500, { error: 'ServerError' });
  }
}

// Binds the first free port of the range not already ours. Resolves (never throws) with the entry, or
// null when every port is taken, so a failed bind cannot break a launch: that profile just gets no
// autofill.
function listenForSession(key, sessionId) {
  const taken = new Set([...listeners.values()].map((e) => e.port));
  const free = PORT_RANGE.filter((p) => !taken.has(p));
  return new Promise((resolve) => {
    const tryAt = (idx) => {
      if (idx >= free.length) { resolve(null); return; }
      const port = free[idx];
      const entry = { server: null, port, sessionId };
      const s = http.createServer((req, res) => { handleRequest(req, res, entry); });
      s.on('error', () => { try { s.close(); } catch (_) {} tryAt(idx + 1); });
      s.listen(port, HOST, () => { entry.server = s; listeners.set(key, entry); resolve(entry); });
    };
    tryAt(0);
  });
}

function closeEntry(entry) {
  return new Promise((resolve) => {
    if (!entry || !entry.server) { resolve(); return; }
    try { entry.server.close(() => resolve()); } catch (e) { resolve(); }
  });
}

function getStatus(sessionId) {
  const ports = [...listeners.values()].map((e) => e.port).sort((a, b) => a - b);
  const mine = sessionId == null ? null : listeners.get(String(sessionId));
  return {
    running: listeners.size > 0,
    // This session's port when one is named, else the lowest one listening.
    port: mine ? mine.port : (sessionId == null && ports.length ? ports[0] : null),
    ports,
    host: HOST,
    holders: listeners.size
  };
}

// A port for one Firefox autofill session (the profile id): each launch acquires, each exit releases.
// Serialized so a release racing a fresh acquire never leaves a port bound or closed by mistake.
// `port` in the result is this session's, or null when no port of the range is free.
let lifecycle = Promise.resolve();
let anonymous = 0;
function acquire(sessionId) {
  const key = sessionId == null ? `anon-${++anonymous}` : String(sessionId);
  lifecycle = lifecycle.then(async () => {
    if (listeners.has(key)) return;
    await listenForSession(key, sessionId == null ? null : String(sessionId));
  }).catch(() => null);
  return lifecycle.then(() => ({ ...getStatus(key), port: listeners.has(key) ? listeners.get(key).port : null }));
}

// Without a session id: the most recent anonymous acquire (tests and tools).
function release(sessionId) {
  lifecycle = lifecycle.then(async () => {
    let key = sessionId == null ? null : String(sessionId);
    if (key == null) key = [...listeners.keys()].reverse().find((k) => k.startsWith('anon-')) || null;
    const entry = key == null ? null : listeners.get(key);
    if (!entry) return;
    listeners.delete(key);
    await closeEntry(entry);
  }).catch(() => null);
  return lifecycle.then(() => getStatus());
}

// The ports a Firefox profile must not reach: the whole range except its own. A profile without
// autofill (`port` null) gets the whole range, so a copy of the add-on it may still have cannot reach
// another profile's port.
function portsBannedFor(port) {
  return PORT_RANGE.filter((p) => p !== port);
}

// Tests and tools: one listener with no session (its vault check gets sessionId null, which main
// refuses).
async function start() {
  const st = await acquire(null);
  return { running: st.port != null, port: st.port };
}

async function stop() {
  lifecycle = lifecycle.then(async () => {
    const all = [...listeners.values()];
    listeners.clear();
    await Promise.all(all.map(closeEntry));
  }).catch(() => null);
  await lifecycle;
  return { running: false };
}

function getToken() { return TOKEN; }

module.exports = { configure, start, stop, acquire, release, getStatus, getToken, portsBannedFor, PORT_RANGE, TOKEN, HOST };
