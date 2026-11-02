'use strict';
// Defines the window.__sgPersona* surface sg-widget.js expects, answered by the background script.
// No __sgPersonaFillPlan: Firefox has no trusted CDP typing, so the widget types in-page and fetches
// one password via __sgPersonaGetSecret, a Firefox-only getter; page JS cannot reach this sandbox.

window.__sgPersonaList = function (url) {
  try { return browser.runtime.sendMessage({ type: 'list', url: String(url || '') }); }
  catch (e) { return Promise.resolve([]); }
};

window.__sgPersonaMarkUsed = function (id, url) {
  try { return browser.runtime.sendMessage({ type: 'markUsed', id: String(id || ''), url: String(url || '') }); }
  catch (e) { return Promise.resolve({ ok: false }); }
};

// Active identity for a multi-step signup ('get' | 'set' id | 'clear'). Kept by the
// background script per tab + site, so it survives the page loads between steps.
window.__sgPersonaActive = function (op, id) {
  try { return browser.runtime.sendMessage({ type: 'active', op: String(op || 'get'), id: String(id || '') }); }
  catch (e) { return Promise.resolve(null); }
};

// Resolves one persona's password for on-demand fill (origin-scoped in the app).
// Returns { password } or null.
window.__sgPersonaGetSecret = function (id, url) {
  try { return browser.runtime.sendMessage({ type: 'secret', id: String(id || ''), url: String(url || '') }); }
  catch (e) { return Promise.resolve(null); }
};
