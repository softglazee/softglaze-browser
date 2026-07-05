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
// loopback bridge. `__sgPersonaFillPlan` is intentionally NOT defined — Firefox has
// no CDP "trusted" typing path, so the widget uses its in-page synthetic-typing
// fallback. That fallback fetches the selected persona's password on demand via
// `__sgPersonaGetSecret` (defined here, Firefox-only): the vault list stays
// password-free (audit C2) and only the single chosen secret is resolved, and only
// in this ISOLATED content-script world where page JS can't read it. It is
// deliberately NOT exposed on Chromium (there the trusted CDP typer fills it, so a
// page-callable getter would reopen the C2 vault-theft hole).
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

// Resolve exactly ONE persona's password for on-demand fill (origin-scoped in the
// app). Returns { password } or null. Firefox-only — see the note above.
window.__sgPersonaGetSecret = function (id, url) {
  try { return browser.runtime.sendMessage({ type: 'secret', id: String(id || ''), url: String(url || '') }); }
  catch (e) { return Promise.resolve(null); }
};
