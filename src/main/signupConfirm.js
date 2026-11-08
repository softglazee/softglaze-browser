'use strict';
// "Confirm your email" in tenant (sellable) builds, from 1.0.23. Every workspace needs a customer whose
// email our licensing server verified on this install, so each install is a lead the owner sees in the
// website admin. The server is the source of truth (POST /v1/account/status, asked on every start);
// this module decides what the app does with its answer. Pure: ipcHandlers.js passes the answer, the
// cached record and the clock, so tests cover every case.
//
//   server says verified          -> verified (a 1.0.22 sign-up through the server is never asked again)
//   server says not verified      -> needed: the Gate shows the step before the app can be used
//   server could not be asked     -> the last answer for THIS install when it was "verified"; otherwise
//                                    let them in and ask again at the next start, for at most OFFLINE_DAYS
//                                    from the first time it could not be asked (then: overdue, required).
//                                    A paid licence on this computer is never locked out by our server.
//
// The cached record (Setting CACHE_SETTING, sealed) only stands in for the server while it cannot be
// asked. Deleting it never skips the step: the next start asks the server again.

const CACHE_SETTING = 'signupConfirm';
// The offline window a licence already has: a lease is valid for LEASE_DAYS (7 by default) without the
// server, so confirming the email waits at most as long.
const OFFLINE_DAYS = 7;
const DAY = 86400000;

const toMs = (v) => {
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
const iso = (ms) => new Date(ms).toISOString();

// The record for this install, or null (another install's record, or unreadable).
function cacheFor(cache, installKey) {
  if (!cache || typeof cache !== 'object' || !installKey) return null;
  return String(cache.installKey || '') === String(installKey) ? cache : null;
}

// The deferral window, anchored on the first time the step could not be done (kept in the record).
function windowFrom(mine, nowMs, offlineDays) {
  const first = mine ? toMs(mine.firstDeferredAt) : null;
  const since = first != null && first <= nowMs ? first : nowMs;
  return { since, until: since + offlineDays * DAY };
}

// server: { verified: boolean } | null (could not ask: offline, timeout, server error, older server)
// cache: the stored record { v, installKey, verified, checkedAt, firstDeferredAt } | null
// installKey: this install's id at the licensing server (or a stable stand-in before it registered)
// paid: a verified paid lease on this computer. nowMs: the tamper-clamped clock.
// -> { state: 'verified' | 'needed' | 'deferred' | 'overdue', required, offline, deferredUntil, cache }
function decide({ server, cache, installKey, paid = false, nowMs = Date.now(), offlineDays = OFFLINE_DAYS } = {}) {
  const now = Number(nowMs);
  const mine = cacheFor(cache, installKey);
  if (server && server.verified === true) {
    return { state: 'verified', required: false, offline: false, deferredUntil: null, cache: { v: 1, installKey, verified: true, checkedAt: iso(now), firstDeferredAt: null } };
  }
  if (server && server.verified === false) {
    // Keep the deferral anchor: a failed code email later must not restart the window.
    return { state: 'needed', required: true, offline: false, deferredUntil: null, cache: { v: 1, installKey, verified: false, checkedAt: iso(now), firstDeferredAt: mine ? mine.firstDeferredAt || null : null } };
  }
  if (mine && mine.verified === true) return { state: 'verified', required: false, offline: true, deferredUntil: null, cache: mine };
  return deferral({ mine, installKey, paid, nowMs: now, offlineDays, offline: true });
}

// Our side failed while the step was shown (no answer, or the code email could not be sent): may the
// person go on for now? Same window as above; a paid licence always may.
function deferAfterFailure({ cache, installKey, paid = false, nowMs = Date.now(), offlineDays = OFFLINE_DAYS } = {}) {
  const d = deferral({ mine: cacheFor(cache, installKey), installKey, paid, nowMs: Number(nowMs), offlineDays, offline: false });
  return { allowed: d.state === 'deferred', ...d };
}

function deferral({ mine, installKey, paid, nowMs, offlineDays, offline }) {
  const w = windowFrom(mine, nowMs, offlineDays);
  const cache = { v: 1, installKey, verified: false, checkedAt: mine ? mine.checkedAt || null : null, firstDeferredAt: iso(w.since) };
  if (paid) return { state: 'deferred', required: false, offline, deferredUntil: null, cache };
  if (nowMs < w.until) return { state: 'deferred', required: false, offline, deferredUntil: iso(w.until), cache };
  return { state: 'overdue', required: true, offline, deferredUntil: iso(w.until), cache };
}

// App error codes that mean "our side failed", not the person's input: the step may then be put off.
const OUR_SIDE_CODES = Object.freeze(['CONFIRM_OFFLINE', 'SIGNUP_OFFLINE', 'SERVER_UNAVAILABLE', 'SIGNUP_FAILED']);
function isOurSide(err) { return Boolean(err && OUR_SIDE_CODES.includes(err.code)); }

module.exports = { CACHE_SETTING, OFFLINE_DAYS, OUR_SIDE_CODES, cacheFor, decide, deferAfterFailure, isOurSide };
