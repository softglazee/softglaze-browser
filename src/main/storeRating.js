'use strict';
// Microsoft Store build only: a polite request for a rating in the Microsoft Store (a small card on the
// Dashboard), and a permanent "Rate SoftGlaze Browser" entry in Settings > Updates. The website and
// base builds never count anything, never ask and never show the entry.
//
// When the card may show (shouldAsk):
//   - the app has been used on at least 3 different days, AND at least 5 profile launches succeeded;
//   - nobody chose "Rate" (on the card or in Settings) or "Don't ask again";
//   - "Not now" hides it for 30 days; after the third "Not now" (the first ask and 2 more) it is over;
//   - main also holds it back while the first-run wizard is open or the licence is not in a normal
//     state (trial or subscription ended, grace, blocked, licence on another computer): see
//     licenceBlocksAsk. The renderer asks only on the Dashboard, and only when this start showed no
//     sign-up, email-code, plan or blocked screen (src/renderer/lib/storeRating.mjs).
//
// Microsoft Store policy: nothing (no reward, discount, trial time or feature) is tied to rating, and
// every user gets the same card leading straight to the Store's own rating dialog. There is no
// "do you like us?" step that sends only happy users to the Store.
//
// Rating opens the Store's in-app dialog (StoreContext.RequestRateAndReviewAppAsync through the Store
// addon, owner = the app window, the same pattern as purchases). When the addon is missing, there is
// no window, or the call fails, it opens the Store app's review page instead (REVIEW_URI; "Using
// StoreId is recommended", learn.microsoft.com/windows/apps/develop/launch/launch-store-app).
// Nothing here talks to our servers.
//
// Every dependency is injected, so tests drive it with fakes and no real Store call is made.

const STORE_PRODUCT_ID = '9NQZMTHN87CB';
const REVIEW_URI = `ms-windows-store://review/?ProductId=${STORE_PRODUCT_ID}`;
const STATE_SETTING = 'storeRatingPrompt';
const MIN_DAYS = 3;
const MIN_LAUNCHES = 5;
const SNOOZE_MS = 30 * 86400000;
const MAX_NOT_NOW = 3; // the first ask plus 2 more
const CHOICES = Object.freeze(['rate', 'notNow', 'never']);
// The dialog was shown: the customer rated, or closed it. Anything else falls back to the Store page.
const DIALOG_SHOWN = new Set(['Succeeded', 'CanceledByUser']);

const pad = (n) => String(n).padStart(2, '0');
// The local calendar day, so "3 different days" follows the customer's clock, not UTC.
function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const days = Array.isArray(s.days) ? [...new Set(s.days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].slice(0, MIN_DAYS) : [];
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  return {
    days,
    launches: Math.min(num(s.launches), MIN_LAUNCHES),
    notNow: num(s.notNow),
    snoozedUntil: num(s.snoozedUntil),
    done: s.done === 'rated' || s.done === 'never' ? s.done : null
  };
}

// Each returns the SAME object when nothing changes, so the caller can skip the write.
function withDay(state, now) {
  if (state.done || state.days.length >= MIN_DAYS) return state;
  const day = localDay(now);
  if (state.days.includes(day)) return state;
  return { ...state, days: [...state.days, day] };
}

function withLaunch(state) {
  if (state.done || state.launches >= MIN_LAUNCHES) return state;
  return { ...state, launches: state.launches + 1 };
}

function withChoice(state, choice, now) {
  if (choice === 'rate') return { ...state, done: 'rated' };
  if (choice === 'never') return { ...state, done: 'never' };
  if (choice === 'notNow') return { ...state, notNow: state.notNow + 1, snoozedUntil: now + SNOOZE_MS };
  return state;
}

function shouldAsk(state, { storeBuild, now }) {
  if (storeBuild !== true) return false;
  const s = normalize(state);
  if (s.done) return false;
  if (s.notNow >= MAX_NOT_NOW) return false;
  if (s.snoozedUntil && now < s.snoozedUntil) return false;
  return s.days.length >= MIN_DAYS && s.launches >= MIN_LAUNCHES;
}

// A licence the app is nagging about, or that stops work, is no moment to ask for a rating.
function licenceBlocksAsk(lic) {
  if (!lic || typeof lic !== 'object') return true;
  return Boolean(lic.isBanned || lic.needsPlan || lic.isGrace || lic.isExpired || lic.reason === 'machine_mismatch');
}

function createStoreRating(deps) {
  const { isStoreBuild, readSetting, writeSetting, bridge, openExternal } = deps;
  const promptBlocked = deps.promptBlocked || (async () => false);
  const now = deps.now || Date.now;
  let chain = Promise.resolve();

  // Read, change and write the state one at a time, so launches started together are all counted.
  function update(change) {
    const run = chain.then(async () => {
      const cur = normalize(await readSetting(STATE_SETTING, null));
      const next = change(cur);
      if (next !== cur) await writeSetting(STATE_SETTING, next);
      return next;
    });
    chain = run.catch(() => {});
    return run;
  }

  // The app was used today (start-up, a Dashboard visit).
  async function noteUse() {
    if (!isStoreBuild()) return null;
    return update((s) => withDay(s, now()));
  }

  // A profile launch succeeded (counts as use today too).
  async function noteLaunch() {
    if (!isStoreBuild()) return null;
    return update((s) => withDay(withLaunch(s), now()));
  }

  // { storeBuild, ask }: storeBuild shows the Settings entry, ask shows the Dashboard card.
  async function status() {
    if (!isStoreBuild()) return { storeBuild: false, ask: false };
    let s;
    try { s = await update((x) => withDay(x, now())); } catch (_) { return { storeBuild: true, ask: false }; }
    let ask = shouldAsk(s, { storeBuild: true, now: now() });
    if (ask) {
      try { if (await promptBlocked()) ask = false; } catch (_) { ask = false; }
    }
    return { storeBuild: true, ask };
  }

  // "Not now" or "Don't ask again" on the card ("Rate" goes through rate()).
  async function choose(choice) {
    if (!isStoreBuild()) return { storeBuild: false, ask: false };
    if (choice !== 'notNow' && choice !== 'never') throw new Error('Unknown choice.');
    await update((s) => withChoice(s, choice, now()));
    return { storeBuild: true, ask: false };
  }

  async function tryDialog(hwnd) {
    try {
      if (!bridge || typeof bridge.available !== 'function' || !bridge.available()) return { shown: false, reason: 'addon_unavailable' };
      if (!hwnd) return { shown: false, reason: 'no_window' };
      const r = await bridge.call('rate', { hwnd: String(hwnd) });
      if (r && r.ok === true && DIALOG_SHOWN.has(r.status)) return { shown: true, status: r.status };
      // Still open after the bridge's wait: the dialog is on screen, so do not open a second one.
      if (r && r.error === 'timeout') return { shown: true, status: 'timeout' };
      return { shown: false, reason: String((r && (r.ok === true ? r.status : r.error)) || 'store_error') };
    } catch (e) {
      return { shown: false, reason: 'bridge_error' };
    }
  }

  // "Rate in Microsoft Store" (card or Settings). After this the card never shows again.
  async function rate(hwnd) {
    if (!isStoreBuild()) return { ok: false, error: 'not_store_build' };
    await update((s) => withChoice(s, 'rate', now())).catch(() => {});
    const tried = await tryDialog(hwnd);
    if (tried.shown) return { ok: true, via: 'dialog', status: tried.status };
    try {
      await openExternal(REVIEW_URI);
      return { ok: true, via: 'store_page', reason: tried.reason };
    } catch (e) {
      return { ok: false, error: 'open_failed', reason: tried.reason };
    }
  }

  return { noteUse, noteLaunch, status, choose, rate };
}

module.exports = {
  createStoreRating,
  shouldAsk,
  normalize,
  withDay,
  withLaunch,
  withChoice,
  licenceBlocksAsk,
  localDay,
  STORE_PRODUCT_ID,
  REVIEW_URI,
  STATE_SETTING,
  MIN_DAYS,
  MIN_LAUNCHES,
  SNOOZE_MS,
  MAX_NOT_NOW,
  CHOICES
};
