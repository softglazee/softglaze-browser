'use strict';
// Page -> main RPC without CDP bindings: fingerprint-chromium kills exposeFunction bindings after the
// first navigation. The page fetches a per-session tokenized URL under .invalid (never resolves, so
// nothing leaks) that main fulfils via CDP Fetch; only that prefix is paused, so sites cannot probe it.

const crypto = require('node:crypto');

const SENTINEL_HOST = 'sg-bridge.invalid';

// Backstop against a hostile page; the fill plan is the largest legitimate payload and is already
// capped upstream.
const MAX_BODY_BYTES = 512 * 1024;

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

// In-page helper, serialized with .toString(), so it must be self-contained. With `fileOnly` only
// the file:// start page gets window.__sgBridge, so visited sites in that tab never see it.
function bridgeClientScript(endpoint, fileOnly) {
  if (fileOnly && !(typeof location !== 'undefined' && location && location.protocol === 'file:')) return;
  if (window.__sgBridge) return;
  var ENDPOINT = endpoint;
  // Varargs, so this is a drop-in for the exposeFunction bindings it replaces -
  // __sgPersonaMarkUsed(id, url) and __sgPersonaFillPlan(plan, token) both take two.
  var call = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    // 1. Native binding first - present and working on stock Chrome.
    var fn = window[name];
    if (typeof fn === 'function') {
      try {
        var p = fn.apply(window, args);
        // A broken binding throws synchronously; reaching here means it took the
        // call. Normalise to a promise so both paths look identical to callers.
        return Promise.resolve(p);
      } catch (e) { /* binding dead on this engine - fall through to RPC */ }
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

// One bridge per page: autofill, the start page and the recorder attach at different times and would
// otherwise stack Fetch.enable interceptors. Re-attaching merges handlers into the existing channel.
const bridges = new WeakMap();

// handlers: { name: async (...args) => result }, the same functions given to exposeFunction.
// Returns { endpoint, dispose } and never throws. opts.fileOnly limits the helper to file:// (start
// page); a later attach without it widens the channel to every document.
async function attachPageBridge(page, handlers, opts = {}) {
  if (!page || !handlers) return { endpoint: null, dispose: () => {} };
  const fileOnly = Boolean(opts && opts.fileOnly);

  const existing = bridges.get(page);
  if (existing) {
    Object.assign(existing.handlers, handlers);
    if (existing.fileOnly && !fileOnly) {
      existing.fileOnly = false;
      const wide = `(${bridgeClientScript.toString()})(${JSON.stringify(existing.endpoint)}, false);`;
      try { await page.evaluateOnNewDocument(wide); } catch (e) { /* ignore */ }
      try { await page.evaluate(wide); } catch (e) { /* no document yet */ }
    }
    return { endpoint: existing.endpoint, dispose: existing.dispose };
  }

  const token = newToken();
  const endpoint = `https://${SENTINEL_HOST}/${token}`;
  const pattern = `${endpoint}/*`;

  const liveHandlers = Object.assign({}, handlers);
  let cdp = null;
  try {
    cdp = await page.target().createCDPSession();
    // Intercept only the sentinel prefix, so real page traffic is never paused or slowed.
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
        // Not ours - hand it straight back rather than hanging the request.
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

  // Install the helper for this document and every future one, so it survives the navigations that
  // kill the native binding.
  const source = `(${bridgeClientScript.toString()})(${JSON.stringify(endpoint)}, ${fileOnly});`;
  try { await page.evaluateOnNewDocument(source); } catch (e) { /* ignore */ }
  try { await page.evaluate(source); } catch (e) { /* no document yet */ }

  const dispose = async () => {
    bridges.delete(page);
    try { cdp.off('Fetch.requestPaused', onPaused); } catch (e) { /* ignore */ }
    try { await cdp.send('Fetch.disable'); } catch (e) { /* ignore */ }
    try { await cdp.detach(); } catch (e) { /* ignore */ }
  };

  bridges.set(page, { endpoint, handlers: liveHandlers, dispose, fileOnly });
  return { endpoint, dispose };
}

// Vault data goes over a private CDP isolated world, never the main-world bridge above.
// The fetch fallback needs a per-attach secret in the POST body, since URLs leak via Resource Timing.
// One CDP session for all of it (Chromium keys isolated worlds per session); never Runtime.enable.
function randIdent(prefix) {
  return prefix + crypto.randomBytes(9).toString('hex');
}

// Runs inside the isolated world. Serialized with .toString(): self-contained.
// `run` receives rpc(name, ...args) -> Promise.
function isolatedClientScript(cfg, run) {
  var B = cfg.binding, R = cfg.resolver, K = cfg.key, E = cfg.endpoint;
  if (window[cfg.guard]) return;
  window[cfg.guard] = true;
  var seq = 0, pending = {}, mode = null, probing = null;
  window[R] = function (id, ok, val) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    clearTimeout(p.t);
    if (ok) p.res(val); else p.rej(new Error(String(val || 'bridge error')));
  };
  function viaFetch(name, args) {
    return fetch(E + '/' + encodeURIComponent(name), {
      method: 'POST', body: JSON.stringify({ args: args, key: K }),
      // keepalive: a call made as the page navigates away (autofill marking an
      // identity used on the final submit) must still reach main.
      cache: 'no-store', credentials: 'omit', mode: 'cors', keepalive: true
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.error) throw new Error(d.error);
      return d ? d.result : null;
    });
  }
  function viaBinding(name, args, timeoutMs) {
    return new Promise(function (res, rej) {
      var fn = window[B];
      if (typeof fn !== 'function') { rej(new Error('no binding')); return; }
      var id = ++seq;
      var entry = { res: res, rej: rej, t: null };
      if (timeoutMs) entry.t = setTimeout(function () { delete pending[id]; rej(new Error('binding timeout')); }, timeoutMs);
      pending[id] = entry;
      try { fn(JSON.stringify({ id: id, name: name, args: args, key: K })); }
      catch (e) { delete pending[id]; clearTimeout(entry.t); rej(e); }
    });
  }
  // Pick the transport once per document: a binding that exists but never answers
  // (an engine that drops binding events) must not hang the widget forever.
  function ensureMode() {
    if (mode) return Promise.resolve(mode);
    if (!probing) {
      probing = viaBinding('__ping', [], 2500)
        .then(function () { mode = 'binding'; return mode; }, function () { mode = 'fetch'; return mode; });
    }
    return probing;
  }
  function rpc(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    return ensureMode().then(function (m) {
      if (m === 'binding') {
        return viaBinding(name, args, 0).catch(function (e) {
          if (e && /no binding|not a function/.test(String(e.message))) { mode = 'fetch'; return viaFetch(name, args); }
          throw e;
        });
      }
      return viaFetch(name, args);
    });
  }
  run(rpc);
}

// Runs `runSource` (a function expression taking rpc) in a private isolated world on every top-level
// document. evaluate() runs in that world of the top frame, where page JS cannot patch DOM APIs.
// Never throws: a page that cannot host the channel must still load.
async function attachIsolatedWorld(page, handlers, runSource) {
  const none = { ok: false, evaluate: async () => { throw new Error('isolated world unavailable'); }, dispose: async () => {} };
  if (!page || !handlers || !runSource) return none;
  const worldName = randIdent('w');
  const cfg = {
    binding: randIdent('b'),
    resolver: randIdent('r'),
    guard: randIdent('g'),
    key: newToken(),
    endpoint: `https://${SENTINEL_HOST}/${newToken()}`
  };
  const liveHandlers = Object.assign({ __ping: async () => true }, handlers);
  let cdp = null;
  try { cdp = await page.target().createCDPSession(); } catch (e) { return none; }

  const dispatch = async (name, args) => {
    const handler = Object.prototype.hasOwnProperty.call(liveHandlers, name) ? liveHandlers[name] : null;
    if (typeof handler !== 'function') throw new Error('unknown method');
    const r = await handler(...(Array.isArray(args) ? args : []));
    return r === undefined ? null : r;
  };

  // Transport 1: a binding that exists only in contexts named `worldName`.
  const onBinding = async (event) => {
    if (!event || event.name !== cfg.binding) return;
    let msg = null;
    try { msg = JSON.parse(String(event.payload || '')); } catch (e) { return; }
    if (!msg || msg.key !== cfg.key || typeof msg.id !== 'number') return;
    let ok = true;
    let val = null;
    try { val = await dispatch(String(msg.name || ''), msg.args); }
    catch (e) { ok = false; val = String((e && e.message) || e); }
    try {
      await cdp.send('Runtime.evaluate', {
        contextId: event.executionContextId,
        expression: `window[${JSON.stringify(cfg.resolver)}](${JSON.stringify(msg.id)}, ${ok}, ${JSON.stringify(val)})`,
        returnByValue: true
      });
    } catch (e) { /* document gone */ }
  };
  cdp.on('Runtime.bindingCalled', onBinding);
  try { await cdp.send('Runtime.addBinding', { name: cfg.binding, executionContextName: worldName }); } catch (e) { /* fetch only */ }

  // Transport 2: tokened sentinel fetch, authenticated by the body secret.
  const respond = async (requestId, status, obj) => {
    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
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
      if (!url.startsWith(cfg.endpoint + '/')) {
        try { await cdp.send('Fetch.continueRequest', { requestId }); } catch (e) { /* ignore */ }
        return;
      }
      const name = decodeURIComponent(url.slice(cfg.endpoint.length + 1).split('?')[0]);
      const raw = event.request && event.request.postData;
      let parsed = null;
      if (typeof raw === 'string' && Buffer.byteLength(raw) <= MAX_BODY_BYTES) {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      }
      // Wrong or missing secret: answer exactly like an unknown method, so a probe
      // learns nothing about which names exist.
      if (!parsed || parsed.key !== cfg.key) return respond(requestId, 404, { error: 'unknown method' });
      try {
        const result = await dispatch(name, parsed.args);
        return respond(requestId, 200, { result });
      } catch (e) {
        return respond(requestId, 200, { error: String((e && e.message) || e) });
      }
    } catch (e) {
      try { await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }); } catch (e2) { /* ignore */ }
    }
  };
  cdp.on('Fetch.requestPaused', onPaused);
  try { await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${cfg.endpoint}/*` }] }); } catch (e) { /* binding only */ }

  const source = `(${isolatedClientScript.toString()})(${JSON.stringify(cfg)}, ${runSource});`;
  let scriptId = null;
  // New-document scripts only fire for a session whose Page domain is enabled.
  // (Page.enable is what puppeteer itself sends on every page; it is not a tell.)
  try { await cdp.send('Page.enable'); } catch (e) { /* ignore */ }
  try {
    const r = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source, worldName });
    scriptId = r && r.identifier;
  } catch (e) { /* current document only */ }

  const topContextId = async () => {
    const tree = await cdp.send('Page.getFrameTree');
    const frameId = tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.id;
    const r = await cdp.send('Page.createIsolatedWorld', { frameId, worldName });
    return r.executionContextId;
  };
  // Run fn(...args) in the top frame's isolated world; JSON-able args/result only.
  const evaluate = async (fn, ...args) => {
    const executionContextId = await topContextId();
    const r = await cdp.send('Runtime.callFunctionOn', {
      functionDeclaration: fn.toString(),
      executionContextId,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true
    });
    if (!r || r.exceptionDetails) throw new Error('isolated evaluate failed');
    return r.result ? r.result.value : undefined;
  };

  // The document that is already loaded.
  try {
    const contextId = await topContextId();
    await cdp.send('Runtime.evaluate', { expression: source, contextId });
  } catch (e) { /* no document yet - the new-document script covers it */ }

  const dispose = async () => {
    try { cdp.off('Fetch.requestPaused', onPaused); cdp.off('Runtime.bindingCalled', onBinding); } catch (e) { /* ignore */ }
    try { if (scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); } catch (e) { /* ignore */ }
    try { await cdp.send('Fetch.disable'); } catch (e) { /* ignore */ }
    try { await cdp.detach(); } catch (e) { /* ignore */ }
  };
  return { ok: true, evaluate, dispose };
}

module.exports = { attachPageBridge, bridgeClientScript, attachIsolatedWorld, isolatedClientScript, SENTINEL_HOST };
