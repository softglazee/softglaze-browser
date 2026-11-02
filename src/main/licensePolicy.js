'use strict';
// Pure licence state machine (tested in test/licensePolicy.test.js); ipcHandlers acts on the result.
// Against trialEndsAt: paid/trialing until it ends, grace for graceDays (works but nags), then banned.
// Local-first, so editing SQLite or the clock bypasses it; real enforcement is the signed backend.

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
// tamper-clamped value - see clampNow) so this stays pure and deterministic.
function computeLicenseState({ type, trialEndsAt, now, graceDays = 3 } = {}) {
  const ends = toMs(trialEndsAt);
  const nowMs = toMs(now) ?? 0;
  const isPaidType = String(type || '').toLowerCase() === 'paid';
  const graceEnds = ends != null ? ends + graceDays * DAY_MS : null;

  let state;
  let daysLeftTrial = null;
  let daysLeftGrace = null;

  if (ends == null) {
    // No expiry recorded: a paid licence is lifetime, but a missing trial boundary fails closed as
    // expired (the DB always sets trialEndsAt, so this only fires on a wiped or tampered column).
    if (isPaidType) {
      state = 'paid';
    } else {
      state = 'banned';
      daysLeftTrial = 0;
      daysLeftGrace = 0;
    }
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

// Clock-tamper clamp: the effective now never drops below the last seen time (minus a tolerance for
// drift/NTP), so rolling the clock back cannot extend a trial. Returns the effective now, the new
// lastSeenAt to persist and whether tampering was detected.
function clampNow({ now, lastSeenAt, toleranceMs = DAY_MS, maxAdvanceMs = 90 * DAY_MS } = {}) {
  const nowMs = toMs(now) ?? 0;
  const seen = toMs(lastSeenAt);
  const tampered = seen != null && nowMs < seen - toleranceMs;
  const effectiveNow = seen != null ? Math.max(nowMs, seen) : nowMs;
  // Cap how far the persisted floor advances per call (maxAdvanceMs, 90 days): a transient clock spike
  // would otherwise become a permanent floor that expires a valid licence. The floor still catches up
  // over later opens, and rollback is still held.
  const nextSeen = seen == null ? nowMs
    : (nowMs <= seen ? seen : Math.min(nowMs, seen + maxAdvanceMs));
  return { effectiveNow, lastSeenAt: nextSeen, tampered };
}

module.exports = { computeLicenseState, clampNow, toMs, DAY_MS };
