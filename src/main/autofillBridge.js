'use strict';
// ---------------------------------------------------------------------------
// SoftGlaze Smart Autofill - loopback bridge for the Firefox WebExtension.
//
// Firefox profiles launch raw (no CDP / no puppeteer exposeFunction), so the
// in-page autofill widget cannot reach Electron the way the Chromium build does.
// Instead the Firefox extension's background script talks to THIS tiny HTTP server
// over loopback to read available personas and mark them used. (Chromium keeps
// using the exposeFunction bridge in browserEngine - this is Firefox-only.)
//
// Design mirrors localApi.js: 127.0.0.1 only, never bound to the network. The
// actual persona logic lives in ipcHandlers; it is injected via configure() to
// avoid a circular require (autofillBridge has no deps on ipcHandlers).
//
// AUTH / THREAT MODEL: we bind loopback and send NO CORS headers, so a visited
// web page can't read responses cross-origin. audit E3/S1: the token used to be a
// static string shipped inside the public .xpi, so anyone could read it. It is now
// RANDOM PER APP RUN and reaches the extension out-of-band: firefoxEngine writes it
// to Firefox's managed-storage manifest for our extension id at each launch (see
// firefoxEngine.writeAutofillManagedToken) and the background script reads it with
// browser.storage.managed. The server also listens ONLY while at least one Firefox
// autofill session runs (acquire/release), and refuses vault calls while the vault
// is locked or nobody is signed in (deps.isAvailable).
// ---------------------------------------------------------------------------
const http = require('node:http');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
// First free port in this small range is used; the extension probes the same range.
const PORT_RANGE = [47800, 47801, 47802, 47803, 47804, 47805, 47806, 47807, 47808, 47809];
// Per-app-run secret. Never persisted by this module; firefoxEngine hands it to the
// extension through the managed-storage manifest.
const TOKEN = crypto.randomBytes(24).toString('hex');

let server = null;
let runningPort = null;
let listForUrlFn = null;   // (url) => Promise<{ personas: [...] } | [...]>
let markUsedFn = null;     // (id, url) => Promise<any>
let getSecretFn = null;    // (id, url) => Promise<{ password } | null>  (origin-scoped)
let isAvailableFn = null;  // () => Promise<boolean>  false while locked / signed out
let holders = 0;           // running Firefox autofill sessions (acquire/release)

function configure(deps = {}) {
  if (typeof deps.listForUrl === 'function') listForUrlFn = deps.listForUrl;
  if (typeof deps.markUsed === 'function') markUsedFn = deps.markUsed;
  if (typeof deps.getSecret === 'function') getSecretFn = deps.getSecret;
  if (typeof deps.isAvailable === 'function') isAvailableFn = deps.isAvailable;
}

// Vault calls are refused while the app is locked or signed out. Fails CLOSED: a
// throwing check means "not available".
async function vaultAvailable() {
  if (typeof isAvailableFn !== 'function') return true;
  try { return (await isAvailableFn()) === true; } catch (e) { return false; }
}

function sendJson(res, status, obj) {
  try {
    const body = JSON.stringify(obj);
    // Deliberately NO Access-Control-Allow-Origin: a page's fetch stays unreadable
    // cross-origin. The extension background (host-permitted) is exempt from CORS.
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  } catch (e) { try { res.end(); } catch (_) {} }
}

// DNS-rebinding guard (audit T2-2), matching localApi.js: only serve requests whose Host
// header targets our loopback bind. Without it a page on evil.com whose DNS was rebound to
// 127.0.0.1 could reach the bridge; the extension always sends Host 127.0.0.1:<port>, so
// this never rejects a legitimate call.
function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const port = runningPort || PORT_RANGE[0];
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function authed(req) {
  return hostAllowed(req) && String(req.headers['x-sg-autofill-token'] || '') === TOKEN;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    req.on('data', (c) => { data += c; if (data.length > 1e6) { try { req.destroy(); } catch (e) {} finish({}); } });
    req.on('end', () => { try { finish(data ? JSON.parse(data) : {}); } catch (e) { finish({}); } });
    req.on('error', () => finish({}));
    // A client abort OR our own req.destroy() (the size-cap path) emits 'close', not 'error'
    // - without this the promise would hang forever and the await never returns.
    req.on('close', () => finish({}));
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${HOST}:${runningPort || PORT_RANGE[0]}`);

    // Discovery probe - unauthenticated body is harmless (just a service tag), but
    // we still require the token so only our extension treats a port as "ours".
    if (req.method === 'GET' && url.pathname === '/sg-autofill/ping') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { service: 'softglaze-autofill', version: 1 });
    }

    if (req.method === 'GET' && url.pathname === '/sg-autofill/list') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (typeof listForUrlFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
      if (!(await vaultAvailable())) return sendJson(res, 423, { error: 'Locked' });
      const target = url.searchParams.get('url') || '';
      try {
        const r = await listForUrlFn(target);
        const personas = Array.isArray(r) ? r : (r && Array.isArray(r.personas) ? r.personas : []);
        return sendJson(res, 200, { ok: true, personas });
      } catch (e) {
        return sendJson(res, 200, { ok: false, personas: [] });
      }
    }

    // Resolve ONE persona's password for on-demand fill. Firefox has no CDP
    // trusted-typer, so the isolated content-script must set the value itself; it
    // requests exactly the selected id here (never the whole vault). getSecretFn is
    // origin-scoped server-side (getPersonaSecretForUrl only resolves a persona
    // OFFERED for `url`), so a stray token holder can't dump passwords by id.
    if (req.method === 'GET' && url.pathname === '/sg-autofill/secret') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (typeof getSecretFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
      if (!(await vaultAvailable())) return sendJson(res, 423, { error: 'Locked' });
      const id = url.searchParams.get('id') || '';
      const target = url.searchParams.get('url') || '';
      try {
        const s = await getSecretFn(id, target);
        if (!s || s.password == null || s.password === '') return sendJson(res, 404, { ok: false });
        return sendJson(res, 200, { ok: true, password: String(s.password) });
      } catch (e) {
        return sendJson(res, 404, { ok: false });
      }
    }

    if (req.method === 'POST' && url.pathname === '/sg-autofill/mark-used') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (typeof markUsedFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
      if (!(await vaultAvailable())) return sendJson(res, 423, { error: 'Locked' });
      const body = await readBody(req);
      try {
        await markUsedFn(String(body.id || ''), String(body.url || ''));
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

// Bind the first free port in the range. Resolves silently (never throws) so a
// failed bind can't break app startup - autofill just stays unavailable.
function listenOnRange(idx = 0) {
  return new Promise((resolve) => {
    if (idx >= PORT_RANGE.length) { resolve(null); return; }
    const port = PORT_RANGE[idx];
    const s = http.createServer((req, res) => { handleRequest(req, res); });
    s.on('error', () => { try { s.close(); } catch (_) {} resolve(listenOnRange(idx + 1)); });
    s.listen(port, HOST, () => { server = s; runningPort = port; resolve(port); });
  });
}

async function start() {
  if (server) return { running: true, port: runningPort };
  const port = await listenOnRange(0);
  return { running: Boolean(server), port };
}

async function stop() {
  if (!server) { runningPort = null; return { running: false }; }
  await new Promise((resolve) => { try { server.close(() => resolve()); } catch (e) { resolve(); } });
  server = null;
  runningPort = null;
  return { running: false };
}

function getStatus() {
  return { running: Boolean(server), port: runningPort, host: HOST, holders };
}

// audit E3: listen only while a Firefox autofill session needs it. Each launch
// acquires, each exit releases; the server closes with the last one. Serialized so
// a release racing a fresh acquire can never leave the server stopped.
let lifecycle = Promise.resolve();
function acquire() {
  holders += 1;
  lifecycle = lifecycle.then(() => (holders > 0 ? start() : null)).catch(() => null);
  return lifecycle.then(() => getStatus());
}
function release() {
  holders = Math.max(0, holders - 1);
  lifecycle = lifecycle.then(() => (holders === 0 ? stop() : null)).catch(() => null);
  return lifecycle.then(() => getStatus());
}
function getToken() { return TOKEN; }

module.exports = { configure, start, stop, acquire, release, getStatus, getToken, TOKEN, PORT_RANGE };
