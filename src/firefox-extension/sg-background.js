'use strict';
// ---------------------------------------------------------------------------
// SoftGlaze Smart Autofill — Firefox background script.
//
// Firefox profiles are launched raw (no CDP / no puppeteer exposeFunction), so
// the in-page widget can't reach Electron directly. This background script is the
// only context allowed to talk to the loopback autofill bridge that the SoftGlaze
// app runs (host permission http://127.0.0.1/*; content scripts can't cross-origin
// fetch). The content-script shim (sg-bridge.js) forwards `list` / `markUsed`
// requests here via runtime.sendMessage and we answer from the bridge.
//
// Discovery: the bridge binds the first free port in a small fixed loopback range,
// so we probe that range once and cache the live base URL (re-probing if a call
// fails). Auth is a static shared secret — see the threat-model note in
// src/main/autofillBridge.js (loopback-only + no CORS already blocks web pages;
// the token blocks casual other-local-apps; the data is demo personas).
// ---------------------------------------------------------------------------

var PORTS = [47800, 47801, 47802, 47803, 47804, 47805, 47806, 47807, 47808, 47809];
var TOKEN = 'sg-ff-autofill-9f3c1a7b2e6d4058'; // MUST match autofillBridge.js
var HDR = { 'X-SG-Autofill-Token': TOKEN };

var baseUrl = null;

function pingPort(port) {
  var url = 'http://127.0.0.1:' + port + '/sg-autofill/ping';
  return fetch(url, { headers: HDR }).then(function (r) {
    if (!r.ok) return null;
    return r.json().then(function (j) {
      return (j && j.service === 'softglaze-autofill') ? ('http://127.0.0.1:' + port) : null;
    });
  }).catch(function () { return null; });
}

function discover() {
  if (baseUrl) return Promise.resolve(baseUrl);
  var chain = Promise.resolve(null);
  PORTS.forEach(function (p) {
    chain = chain.then(function (found) { return found || pingPort(p); });
  });
  return chain.then(function (found) { baseUrl = found; return found; });
}

function doFetch(base, pathAndQuery, opts) {
  var init = { headers: Object.assign({ 'Content-Type': 'application/json' }, HDR) };
  if (opts && opts.method) init.method = opts.method;
  if (opts && opts.body != null) init.body = opts.body;
  return fetch(base + pathAndQuery, init).then(function (r) {
    if (!r.ok) throw new Error('bridge HTTP ' + r.status);
    return r.json();
  });
}

// Call the bridge, transparently re-discovering the port if the cached one died
// (e.g. the app restarted onto a different port).
function call(pathAndQuery, opts) {
  return discover().then(function (base) {
    if (!base) throw new Error('SoftGlaze autofill bridge is offline.');
    return doFetch(base, pathAndQuery, opts).catch(function (err) {
      baseUrl = null;
      return discover().then(function (again) {
        if (!again) throw err;
        return doFetch(again, pathAndQuery, opts);
      });
    });
  });
}

browser.runtime.onMessage.addListener(function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'list') {
    return call('/sg-autofill/list?url=' + encodeURIComponent(msg.url || ''), { method: 'GET' })
      .then(function (r) { return (r && Array.isArray(r.personas)) ? r.personas : []; })
      .catch(function () { return []; });
  }
  if (msg.type === 'markUsed') {
    return call('/sg-autofill/mark-used', { method: 'POST', body: JSON.stringify({ id: msg.id, url: msg.url }) })
      .then(function () { return { ok: true }; })
      .catch(function () { return { ok: false }; });
  }
  return undefined;
});
