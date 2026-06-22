'use strict';
// Phase 8: license lifecycle state machine + clock-tamper clamp.
// Pure module — node:test drives it directly.
const test = require('node:test');
const assert = require('node:assert/strict');

const { computeLicenseState, clampNow, DAY_MS } = require('../src/main/licensePolicy');

const NOW = 1_750_000_000_000; // fixed reference instant (ms)
const days = (n) => n * DAY_MS;

test('trialing while inside the trial window', () => {
  const s = computeLicenseState({ type: 'trial', trialEndsAt: NOW + days(3), now: NOW, graceDays: 3 });
  assert.equal(s.state, 'trialing');
  assert.equal(s.isTrial, true);
  assert.equal(s.daysLeftTrial, 3);
  assert.equal(s.daysLeftGrace, null);
});

test('grace within graceDays after the trial ends', () => {
  const s = computeLicenseState({ type: 'trial', trialEndsAt: NOW - days(1), now: NOW, graceDays: 3 });
  assert.equal(s.state, 'grace');
  assert.equal(s.isGrace, true);
  assert.equal(s.daysLeftTrial, 0);
  assert.equal(s.daysLeftGrace, 2); // 3-day grace, 1 day elapsed
});

test('banned once past trial end + grace', () => {
  const s = computeLicenseState({ type: 'trial', trialEndsAt: NOW - days(4), now: NOW, graceDays: 3 });
  assert.equal(s.state, 'banned');
  assert.equal(s.isBanned, true);
});

test('exactly at the grace boundary is still grace (inclusive)', () => {
  const s = computeLicenseState({ type: 'trial', trialEndsAt: NOW - days(3), now: NOW, graceDays: 3 });
  assert.equal(s.state, 'grace');
  assert.equal(s.daysLeftGrace, 0);
});

test('paid and active is paid (no trial countdown)', () => {
  const s = computeLicenseState({ type: 'paid', trialEndsAt: NOW + days(20), now: NOW, graceDays: 3 });
  assert.equal(s.state, 'paid');
  assert.equal(s.isPaid, true);
  assert.equal(s.daysLeftTrial, null);
});

test('a lapsed paid licence falls through the same grace then ban', () => {
  assert.equal(computeLicenseState({ type: 'paid', trialEndsAt: NOW - days(1), now: NOW, graceDays: 3 }).state, 'grace');
  assert.equal(computeLicenseState({ type: 'paid', trialEndsAt: NOW - days(5), now: NOW, graceDays: 3 }).state, 'banned');
});

test('endsAt / graceEndsAt are ISO strings derived from the boundary', () => {
  const ends = NOW + days(2);
  const s = computeLicenseState({ type: 'trial', trialEndsAt: ends, now: NOW, graceDays: 3 });
  assert.equal(s.endsAt, new Date(ends).toISOString());
  assert.equal(s.graceEndsAt, new Date(ends + days(3)).toISOString());
});

test('clampNow flags a backward clock jump and never lets effective-now regress', () => {
  const r = clampNow({ now: NOW - days(10), lastSeenAt: NOW, toleranceMs: DAY_MS });
  assert.equal(r.tampered, true);
  assert.equal(r.effectiveNow, NOW); // clamped forward to last seen
  assert.equal(r.lastSeenAt, NOW);
});

test('clampNow accepts forward time and small drift without flagging', () => {
  const fwd = clampNow({ now: NOW + days(1), lastSeenAt: NOW, toleranceMs: DAY_MS });
  assert.equal(fwd.tampered, false);
  assert.equal(fwd.effectiveNow, NOW + days(1));
  assert.equal(fwd.lastSeenAt, NOW + days(1));

  const drift = clampNow({ now: NOW - 1000, lastSeenAt: NOW, toleranceMs: DAY_MS });
  assert.equal(drift.tampered, false); // within tolerance
  assert.equal(drift.effectiveNow, NOW); // still clamped, but not flagged
});

test('a tamper-clamped now keeps an expired trial expired (no free extension)', () => {
  // Clock rolled back to mid-trial, but lastSeenAt is past the grace window.
  const { effectiveNow } = clampNow({ now: NOW - days(20), lastSeenAt: NOW + days(1), toleranceMs: DAY_MS });
  const s = computeLicenseState({ type: 'trial', trialEndsAt: NOW - days(5), now: effectiveNow, graceDays: 3 });
  assert.equal(s.state, 'banned');
});
