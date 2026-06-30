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

function configure(deps = {}) {
  if (typeof deps.listForUrl === 'function') listForUrlFn = deps.listForUrl;
  if (typeof deps.markUsed === 'function') markUsedFn = deps.markUsed;
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
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
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

    if (req.method === 'POST' && url.pathname === '/sg-autofill/mark-used') {
      if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
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
