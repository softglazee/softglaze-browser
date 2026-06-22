'use strict';
// ---------------------------------------------------------------------------
// Softglaze — license lifecycle state machine (Phase 8). Pure + dependency-free
// so it can be unit-tested directly (test/licensePolicy.test.js), the same seam
// pattern as teamPolicy.js / syncPolicy.js. The Electron/DB side (ipcHandlers.js)
// feeds it raw values and acts on the result (persisting the owner ban state,
// rendering the gate, etc.).
//
// States, evaluated against the license's `trialEndsAt` boundary (which the paid
// flow also advances, so a lapsed paid licence falls through the same grace→ban):
//   paid      — type 'paid' and now <= ends
//   trialing  — type 'trial' and now <= ends
//   grace     — now within `graceDays` after ends (app works, but nags)
//   banned    — past ends + graceDays (and not paid)
//
// HONEST CAVEAT: this is local-first and therefore bypassable (editing the SQLite
// file or the system clock). It's the UX + best-effort gate, not unbreakable DRM —
// real enforcement needs a signed, server-time licensing backend.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function ceilDays(ms) {
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

// Compute the current license state. `now` is supplied (and should already be the
// tamper-clamped value — see clampNow) so this stays pure and deterministic.
function computeLicenseState({ type, trialEndsAt, now, graceDays = 3 } = {}) {
  const ends = toMs(trialEndsAt);
  const nowMs = toMs(now) ?? 0;
  const isPaidType = String(type || '').toLowerCase() === 'paid';
  const graceEnds = ends != null ? ends + graceDays * DAY_MS : null;

  let state;
  let daysLeftTrial = null;
  let daysLeftGrace = null;

  if (ends == null) {
    // No expiry recorded — a paid licence is active, anything else is treated as a
    // fresh trial with unknown remaining time (the DB layer always sets trialEndsAt,
    // so this is only a defensive fallback).
    state = isPaidType ? 'paid' : 'trialing';
  } else if (nowMs <= ends) {
    state = isPaidType ? 'paid' : 'trialing';
    if (!isPaidType) daysLeftTrial = ceilDays(ends - nowMs);
  } else if (nowMs <= graceEnds) {
    state = 'grace';
    daysLeftTrial = 0;
    daysLeftGrace = ceilDays(graceEnds - nowMs);
  } else {
    state = 'banned';
    daysLeftTrial = 0;
    daysLeftGrace = 0;
  }

  return {
    state,
    isPaid: state === 'paid',
    isTrial: state === 'trialing',
    isGrace: state === 'grace',
    isBanned: state === 'banned',
    daysLeftTrial,
    daysLeftGrace,
    endsAt: ends != null ? new Date(ends).toISOString() : null,
    graceEndsAt: graceEnds != null ? new Date(graceEnds).toISOString() : null
  };
}

// Best-effort clock-tamper clamp. If the system clock has jumped materially
// BACKWARD versus the last value we persisted, a user could be trying to extend an
// expired trial. We don't trust the rolled-back clock for licensing: the effective
// "now" never goes below the last seen time (minus a small tolerance for legit
// drift/NTP corrections). Returns the effective now to compute state with, the new
// lastSeenAt to persist, and whether tampering was detected.
function clampNow({ now, lastSeenAt, toleranceMs = DAY_MS } = {}) {
  const nowMs = toMs(now) ?? 0;
  const seen = toMs(lastSeenAt);
  const tampered = seen != null && nowMs < seen - toleranceMs;
  const effectiveNow = seen != null ? Math.max(nowMs, seen) : nowMs;
  return { effectiveNow, lastSeenAt: Math.max(nowMs, seen ?? nowMs), tampered };
}

module.exports = { computeLicenseState, clampNow, toMs, DAY_MS };
