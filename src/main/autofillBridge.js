'use strict';
// ---------------------------------------------------------------------------
// SoftGlaze Smart Autofill — loopback bridge for the Firefox WebExtension.
//
// Firefox profiles launch raw (no CDP / no puppeteer exposeFunction), so the
// in-page autofill widget cannot reach Electron the way the Chromium build does.
// Instead the Firefox extension's background script talks to THIS tiny HTTP server
// over loopback to read available personas and mark them used. (Chromium keeps
// using the exposeFunction bridge in browserEngine — this is Firefox-only.)
//
// Design mirrors localApi.js: 127.0.0.1 only, never bound to the network. The
// actual persona logic lives in ipcHandlers; it is injected via configure() to
// avoid a circular require (autofillBridge has no deps on ipcHandlers).
//
// AUTH / THREAT MODEL: we bind loopback and send NO CORS headers, so a visited
// web page can't read responses cross-origin. A static shared secret
// (X-SG-Autofill-Token) blocks casual other-local-apps. A signed .xpi is a fixed
// artifact, so a per-launch token can't be injected without breaking the
// signature — the static secret is the deliberate trade-off, and the data is the
// user's own demo personas, not high-value secrets.
// ---------------------------------------------------------------------------
const http = require('node:http');

const HOST = '127.0.0.1';
// First free port in this small range is used; the extension probes the same range.
const PORT_RANGE = [47800, 47801, 47802, 47803, 47804, 47805, 47806, 47807, 47808, 47809];
const TOKEN = 'sg-ff-autofill-9f3c1a7b2e6d4058'; // MUST match src/firefox-extension/sg-background.js

let server = null;
let runningPort = null;
let listForUrlFn = null;   // (url) => Promise<{ personas: [...] } | [...]>
let markUsedFn = null;     // (id, url) => Promise<any>
let getSecretFn = null;    // (id, url) => Promise<{ password } | null>  (origin-scoped)
// () => boolean — true ONLY while a Firefox profile is actually running. HARDENING (audit):
// autofill is Firefox-only and only meaningful while Firefox is open, yet the static token +
// "every persona offered for unknown hosts" meant a local process could dump personas 24/7.
// Gating the data endpoints on a live Firefox session shrinks that window to when Firefox is
// actually up. (Residual, documented: during an active session a token-holder can still over-
// read; the full fix is a per-launch token via managed-storage/native-messaging, blocked today
// by the signed .xpi — a separate project.)
let sessionActiveFn = null;

function configure(deps = {}) {
  if (typeof deps.listForUrl === 'function') listForUrlFn = deps.listForUrl;
  if (typeof deps.markUsed === 'function') markUsedFn = deps.markUsed;
  if (typeof deps.getSecret === 'function') getSecretFn = deps.getSecret;
  if (typeof deps.sessionActive === 'function') sessionActiveFn = deps.sessionActive;
}

// Data endpoints (list/secret/mark-used) are served ONLY while a Firefox session is live.
// Fail-closed on any error in the check. /ping is exempt (harmless discovery probe).
function sessionActive() {
  if (typeof sessionActiveFn !== 'function') return true; // not wired → preserve old behavior
  try { return sessionActiveFn() === true; } catch (e) { return false; }
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

function authed(req) {
  return String(req.headers['x-sg-autofill-token'] || '') === TOKEN;
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
    // — without this the promise would hang forever and the await never returns.
    req.on('close', () => finish({}));
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${HOST}:${runningPort || PORT_RANGE[0]}`);

    // Discovery probe — unauthenticated body is harmless (just a service tag), but
    // we still require the token so only our extension treats a port as "ours".
    if (req.method === 'GET' && url.pathname === '/sg-autofill/ping') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { service: 'softglaze-autofill', version: 1 });
    }

    if (req.method === 'GET' && url.pathname === '/sg-autofill/list') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!sessionActive()) return sendJson(res, 503, { error: 'No active session' });
      if (typeof listForUrlFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
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
      if (!sessionActive()) return sendJson(res, 503, { error: 'No active session' });
      if (typeof getSecretFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
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
      if (!sessionActive()) return sendJson(res, 503, { error: 'No active session' });
      if (typeof markUsedFn !== 'function') return sendJson(res, 503, { error: 'Unavailable' });
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
// failed bind can't break app startup — autofill just stays unavailable.
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
  return { running: Boolean(server), port: runningPort, host: HOST };
}

module.exports = { configure, start, stop, getStatus, TOKEN, PORT_RANGE };
