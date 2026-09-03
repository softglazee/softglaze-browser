'use strict';
// ---------------------------------------------------------------------------
// Page -> main RPC that does NOT depend on CDP Runtime bindings.
//
// WHY THIS EXISTS
// Every page->main feature (persona/Data-Vault autofill, the macro recorder, the
// start-page new-tab links, synchronized-session mirroring) used to ride on
// puppeteer's `page.exposeFunction`, which is built on `Runtime.addBinding`.
//
// fingerprint-chromium — the native anti-detect engine — breaks that. Measured on
// build 148.0.7778.215:
//   • the binding works in the FIRST execution context, then dies on the next
//     navigation (even to about:blank),
//   • puppeteer re-injects its WRAPPER on every document, so `window.__sgFoo` is
//     still `typeof 'function'` and looks healthy,
//   • calling it throws `globalThis[(prefix + name)] is not a function`,
//   • re-sending Runtime.addBinding for the new context does NOT recover it.
// Callers that swallowed that throw (the start page did) silently did nothing.
// `Runtime.consoleAPICalled` is also suppressed on that build, so console is not a
// usable transport either. `Runtime.evaluate` (main -> page) is unaffected.
//
// TRANSPORT
// The page fetches a sentinel https URL and the main process fulfils it over CDP's
// Fetch domain — verified working on BOTH stock Chrome and fingerprint-chromium.
//   • Host is under `.invalid` (RFC 6761): it can never resolve publicly, so if
//     interception ever fails the request dies locally instead of leaking payload.
//   • The path carries a per-session random token, and Fetch.enable is scoped to
//     that exact prefix. A visited site cannot probe for the bridge (an untokened
//     URL is never paused, so it just fails DNS) — otherwise the bridge itself
//     would fingerprint the profile as SoftGlaze.
//   • Only the sentinel prefix is paused, so ordinary page traffic is untouched.
//
// The page-side helper prefers the native binding and falls back to RPC, so stock
// Chrome keeps its existing, proven path and only the broken engine pays for it.
// ---------------------------------------------------------------------------

const crypto = require('node:crypto');

const SENTINEL_HOST = 'sg-bridge.invalid';

// Cap a single RPC payload. The fill plan is the largest legitimate caller and is
// already item/char capped upstream; this is a backstop against a hostile page
// trying to push the main process around.
const MAX_BODY_BYTES = 512 * 1024;

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

// The in-page helper. Serialized with .toString(), so it must be self-contained.
// `window.__sgBridge(name, arg)` -> Promise, used by the vault widget, the macro
// recorder and the start page instead of calling the raw binding directly.
function bridgeClientScript(endpoint) {
  if (window.__sgBridge) return;
  var ENDPOINT = endpoint;
  // Varargs, so this is a drop-in for the exposeFunction bindings it replaces —
  // __sgPersonaMarkUsed(id, url) and __sgPersonaFillPlan(plan, token) both take two.
  var call = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    // 1. Native binding first — present and working on stock Chrome.
    var fn = window[name];
    if (typeof fn === 'function') {
      try {
        var p = fn.apply(window, args);
        // A broken binding throws synchronously; reaching here means it took the
        // call. Normalise to a promise so both paths look identical to callers.
        return Promise.resolve(p);
      } catch (e) { /* binding dead on this engine — fall through to RPC */ }
    }
    // 2. RPC fallback over the intercepted sentinel URL.
    try {
      return fetch(ENDPOINT + '/' + encodeURIComponent(name), {
        method: 'POST',
        // No explicit Content-Type: keeps this a CORS "simple request", so there
        // is no preflight to fulfil as well.
        body: JSON.stringify({ args: args }),
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors'
      }).then(function (r) {
        return r.json();
      }).then(function (d) {
        if (d && d.error) throw new Error(d.error);
        return d ? d.result : null;
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };
  try {
    Object.defineProperty(window, '__sgBridge', {
      value: call, writable: false, configurable: false, enumerable: false
    });
  } catch (e) {
    window.__sgBridge = call;
  }
}

// One bridge per page. Persona autofill, the start page and the macro recorder all
// attach to the same page at different times; without this they would each call
// Fetch.enable and stack interceptors on one target. Re-attaching MERGES the new
// handlers into the existing channel and reuses its endpoint.
const bridges = new WeakMap();

// Attach the RPC channel to one page.
//   handlers : { name: async (...args) => result }  — the same functions passed to
//              exposeFunction, so the two transports cannot drift apart.
// Returns { endpoint, dispose }. Never throws: a page that cannot host the bridge
// must still load.
async function attachPageBridge(page, handlers) {
  if (!page || !handlers) return { endpoint: null, dispose: () => {} };

  const existing = bridges.get(page);
  if (existing) {
    Object.assign(existing.handlers, handlers);
    return { endpoint: existing.endpoint, dispose: existing.dispose };
  }

  const token = newToken();
  const endpoint = `https://${SENTINEL_HOST}/${token}`;
  const pattern = `${endpoint}/*`;

  const liveHandlers = Object.assign({}, handlers);
  let cdp = null;
  try {
    cdp = await page.target().createCDPSession();
    // Scope interception to the sentinel prefix ONLY. Ordinary requests are never
    // paused, so this adds no latency to real page traffic.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: pattern }] });
  } catch (e) {
    try { if (cdp) await cdp.detach(); } catch (e2) { /* ignore */ }
    return { endpoint: null, dispose: () => {} };
  }

  const respond = async (requestId, status, obj) => {
    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          // The caller may be a file:// page (opaque "null" origin) or any site the
          // profile is on; the endpoint is unguessable, so a wildcard is safe here.
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Cache-Control', value: 'no-store' }
        ],
        body: Buffer.from(JSON.stringify(obj)).toString('base64')
      });
    } catch (e) { /* page navigated away mid-call */ }
  };

  const onPaused = async (event) => {
    const requestId = event && event.requestId;
    if (!requestId) return;
    try {
      const url = String((event.request && event.request.url) || '');
      if (!url.startsWith(endpoint + '/')) {
        // Not ours — hand it straight back rather than hanging the request.
        try { await cdp.send('Fetch.continueRequest', { requestId }); } catch (e) { /* ignore */ }
        return;
      }
      const name = decodeURIComponent(url.slice(endpoint.length + 1).split('?')[0]);
      const handler = Object.prototype.hasOwnProperty.call(liveHandlers, name) ? liveHandlers[name] : null;
      if (typeof handler !== 'function') return respond(requestId, 404, { error: 'unknown method' });

      let args = [];
      const raw = event.request && event.request.postData;
      if (typeof raw === 'string') {
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return respond(requestId, 413, { error: 'payload too large' });
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed && parsed.args)) args = parsed.args;
        } catch (e) { args = []; }
      }

      let result = null;
      try {
        result = await handler(...args);
      } catch (e) {
        return respond(requestId, 200, { error: String((e && e.message) || e) });
      }
      return respond(requestId, 200, { result: result === undefined ? null : result });
    } catch (e) {
      try { await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }); } catch (e2) { /* ignore */ }
    }
  };

  cdp.on('Fetch.requestPaused', onPaused);

  // Install the page helper for THIS document and every future one, so it survives
  // the navigations that kill the native binding.
  const source = `(${bridgeClientScript.toString()})(${JSON.stringify(endpoint)});`;
  try { await page.evaluateOnNewDocument(source); } catch (e) { /* ignore */ }
  try { await page.evaluate(source); } catch (e) { /* no document yet */ }

  const dispose = async () => {
    bridges.delete(page);
    try { cdp.off('Fetch.requestPaused', onPaused); } catch (e) { /* ignore */ }
    try { await cdp.send('Fetch.disable'); } catch (e) { /* ignore */ }
    try { await cdp.detach(); } catch (e) { /* ignore */ }
  };

  bridges.set(page, { endpoint, handlers: liveHandlers, dispose });
  return { endpoint, dispose };
}

module.exports = { attachPageBridge, bridgeClientScript, SENTINEL_HOST };
