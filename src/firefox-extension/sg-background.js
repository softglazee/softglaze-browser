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
// fails). Auth (audit E3/S1): a PER-APP-RUN token the SoftGlaze app writes to
// Firefox's managed storage for this extension id at every launch - it is no
// longer a static string baked into this file. Re-read on every discovery, so an
// app restart (new token) heals itself on the next call.
// ---------------------------------------------------------------------------

var PORTS = [47800, 47801, 47802, 47803, 47804, 47805, 47806, 47807, 47808, 47809];

var baseUrl = null;
var token = null;

function loadToken() {
  try {
    return browser.storage.managed.get('token').then(function (r) {
      token = (r && typeof r.token === 'string' && r.token) ? r.token : null;
      return token;
    }).catch(function () { token = null; return null; });
  } catch (e) { token = null; return Promise.resolve(null); }
}

function hdr() { return { 'X-SG-Autofill-Token': token || '' }; }

function pingPort(port) {
  var url = 'http://127.0.0.1:' + port + '/sg-autofill/ping';
  return fetch(url, { headers: hdr() }).then(function (r) {
    if (!r.ok) return null;
    return r.json().then(function (j) {
      return (j && j.service === 'softglaze-autofill') ? ('http://127.0.0.1:' + port) : null;
    });
  }).catch(function () { return null; });
}

function discover() {
  if (baseUrl && token) return Promise.resolve(baseUrl);
  return loadToken().then(function (t) {
    if (!t) return null; // no token handed over: never send an empty one around
    var chain = Promise.resolve(null);
    PORTS.forEach(function (p) {
      chain = chain.then(function (found) { return found || pingPort(p); });
    });
    return chain.then(function (found) { baseUrl = found; return found; });
  });
}

function doFetch(base, pathAndQuery, opts) {
  var init = { headers: Object.assign({ 'Content-Type': 'application/json' }, hdr()) };
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

// audit E3: the origin a call is scoped to comes from the SENDER (the browser's own
// record of which top-level document the content script runs in), never from the
// message body. Anything that is not a top-frame http(s) content script is ignored.
function senderUrl(sender) {
  if (!sender || sender.id !== browser.runtime.id) return '';
  if (sender.frameId != null && sender.frameId !== 0) return '';
  var u = String(sender.url || (sender.tab && sender.tab.url) || '');
  return /^https?:\/\//i.test(u) ? u : '';
}

// Active identities for multi-step signups, per tab + site, in memory (same rules as
// browserEngine.js: registrable-domain site key, 30 min idle timeout).
var ACTIVE_TTL_MS = 30 * 60 * 1000;
var activeIds = new Map(); // 'tabId|site' -> { id, url, at }
function siteKeyOf(u) {
  var h = '';
  try { h = new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  if (!h) return '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.indexOf(':') >= 0) return h;
  var parts = h.split('.');
  if (parts.length <= 2) return h;
  var tld = parts[parts.length - 1], sld = parts[parts.length - 2];
  var keep = (tld.length === 2 && /^(co|com|net|org|gov|edu|ac|ne|or|go)$/.test(sld)) ? 3 : 2;
  return parts.slice(-keep).join('.');
}
function activeKey(sender, url) {
  var tab = sender && sender.tab && sender.tab.id != null ? sender.tab.id : 'x';
  var site = siteKeyOf(url);
  return site ? (tab + '|' + site) : '';
}
if (browser.tabs && browser.tabs.onRemoved) {
  browser.tabs.onRemoved.addListener(function (tabId) {
    activeIds.forEach(function (v, k) { if (k.indexOf(tabId + '|') === 0) activeIds.delete(k); });
  });
}

browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || !msg.type) return;
  var url = senderUrl(sender);
  if (!url) return undefined;
  if (msg.type === 'active') {
    var key = activeKey(sender, url);
    if (!key) return Promise.resolve(null);
    if (msg.op === 'clear') { activeIds.delete(key); return Promise.resolve(null); }
    if (msg.op === 'set') {
      var pid = String(msg.id || '');
      // Only an identity the vault offers for this origin can become active.
      return call('/sg-autofill/list?url=' + encodeURIComponent(url), { method: 'GET' })
        .then(function (r) {
          var list = (r && Array.isArray(r.personas)) ? r.personas : [];
          var ok = list.some(function (p) { return p && String(p.id) === pid; });
          if (!ok) return null;
          activeIds.set(key, { id: pid, url: url, at: Date.now() });
          return { id: pid };
        })
        .catch(function () { return null; });
    }
    var e = activeIds.get(key);
    if (!e || Date.now() - e.at > ACTIVE_TTL_MS) { activeIds.delete(key); return Promise.resolve(null); }
    e.at = Date.now();
    return Promise.resolve({ id: e.id });
  }
  if (msg.type === 'list') {
    return call('/sg-autofill/list?url=' + encodeURIComponent(url), { method: 'GET' })
      .then(function (r) { return (r && Array.isArray(r.personas)) ? r.personas : []; })
      .catch(function () { return []; });
  }
  if (msg.type === 'markUsed') {
    // Mark it on the site it was active for (the final submit may already be on the
    // post-signup page), then release it.
    var akey = activeKey(sender, url);
    var act = akey ? activeIds.get(akey) : null;
    var markUrl = (act && act.id === String(msg.id || '')) ? act.url : url;
    return call('/sg-autofill/mark-used', { method: 'POST', body: JSON.stringify({ id: msg.id, url: markUrl }) })
      .then(function () { if (act && act.id === String(msg.id || '')) activeIds.delete(akey); return { ok: true }; })
      .catch(function () { return { ok: false }; });
  }
  if (msg.type === 'secret') {
    // On-demand single-password fetch for the in-page fill (see sg-bridge.js). The
    // bridge returns 404 (→ call() rejects) when the id isn't offered for this url.
    return call('/sg-autofill/secret?id=' + encodeURIComponent(msg.id || '') + '&url=' + encodeURIComponent(url), { method: 'GET' })
      .then(function (r) { return (r && r.ok && r.password != null) ? { password: r.password } : null; })
      .catch(function () { return null; });
  }
  return undefined;
});
