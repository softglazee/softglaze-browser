'use strict';
// ---------------------------------------------------------------------------
// SoftGlaze Smart Autofill — content-script bridge shim (runs BEFORE sg-widget.js).
//
// The shared widget (sg-widget.js, generated from src/main/personaAutofill.js)
// expects exactly the same surface the Chromium build exposes via puppeteer:
//   • window.__sgPersonaList(url)        -> [persona, …]
//   • window.__sgPersonaMarkUsed(id,url) -> { ok }
// On Chromium those are injected by exposeFunction. Here we provide them as thin
// wrappers over runtime.sendMessage, which the background script answers from the
// loopback bridge. `__sgPersonaFillPlan` is intentionally NOT defined — without it
// the widget uses its in-page synthetic-typing fallback (Firefox has no CDP
// "trusted" typing path), exactly as documented in personaAutofill.js.
//
// Both files in this content_scripts entry share one sandbox, so window expandos
// set here are visible to sg-widget.js.
// ---------------------------------------------------------------------------

window.__sgPersonaList = function (url) {
  try { return browser.runtime.sendMessage({ type: 'list', url: String(url || '') }); }
  catch (e) { return Promise.resolve([]); }
};

window.__sgPersonaMarkUsed = function (id, url) {
  try { return browser.runtime.sendMessage({ type: 'markUsed', id: String(id || ''), url: String(url || '') }); }
  catch (e) { return Promise.resolve({ ok: false }); }
};
