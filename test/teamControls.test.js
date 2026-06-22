'use strict';
// Team-at-scale policy helpers (src/main/teamPolicy.js). Pure — no Electron, no
// DB. Covers seat math, audit-CSV escaping, and the profile-lock conflict rule.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  seatsForLicense, activeSeatIds, seatUsage,
  csvEscape, activityToCsv, lockBlocks
} = require('../src/main/teamPolicy.js');

// --- Seats -----------------------------------------------------------------
test('seatsForLicense derives the cap from the license type', () => {
  assert.equal(seatsForLicense({ type: 'trial' }), 3);
  assert.equal(seatsForLicense({ type: 'paid' }), 25);
  assert.equal(seatsForLicense(null), 3);            // missing => default
  assert.equal(seatsForLicense({ type: 'weird' }), 3); // unknown => default
});

test('activeSeatIds counts the owner + descendants, ignoring suspended and other trees', () => {
  const members = [
    { id: 1, status: 'active', parentMemberId: null },   // OWNER (root)
    { id: 2, status: 'active', parentMemberId: 1 },       // admin under owner
    { id: 3, status: 'suspended', parentMemberId: 1 },    // suspended → no seat
    { id: 4, status: 'active', parentMemberId: 2 },       // operator (deeper)
    { id: 9, status: 'active', parentMemberId: null }     // a DIFFERENT owner tree
  ];
  const ids = activeSeatIds(members, 1);
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 4]); // owner + 2 active descendants
  assert.ok(!ids.has(3), 'suspended member must not consume a seat');
  assert.ok(!ids.has(9), 'a different owner tree must not be counted');
});

test('seatUsage reports used/total/remaining/full at the boundary', () => {
  const members = [
    { id: 1, status: 'active', parentMemberId: null },
    { id: 2, status: 'active', parentMemberId: 1 },
    { id: 3, status: 'active', parentMemberId: 1 }
  ];
  const u = seatUsage(members, 1, { type: 'trial' }); // 3 used / 3 total
  assert.equal(u.used, 3);
  assert.equal(u.total, 3);
  assert.equal(u.remaining, 0);
  assert.equal(u.full, true);

  const u2 = seatUsage(members, 1, { type: 'paid' }); // 3 / 25
  assert.equal(u2.full, false);
  assert.equal(u2.remaining, 22);
});

// --- Audit CSV -------------------------------------------------------------
test('csvEscape quotes only when needed and doubles embedded quotes', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape(null), '');
});

test('activityToCsv emits a header and escapes every field', () => {
  const csv = activityToCsv([
    { id: 1, createdAt: '2026-06-22T00:00:00.000Z', memberName: 'Jane, Q.', action: 'reassign', profileTitle: 'Acct "A"', detail: 'x\ny' }
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'id,createdAt,memberName,action,profileTitle,detail');
  assert.equal(lines[1], '1,2026-06-22T00:00:00.000Z,"Jane, Q.",reassign,"Acct ""A""","x\ny"');
});

// --- Profile lock conflict -------------------------------------------------
test('lockBlocks: a live lock blocks a different member but not the holder', () => {
  const lock = { memberId: 5, sessionId: 's5' };
  const live = new Set(['s5']);
  assert.equal(lockBlocks(lock, 7, live), true);   // another member → blocked
  assert.equal(lockBlocks(lock, 5, live), false);  // the holder → allowed (re-launch)
});

test('lockBlocks: a stale lock (session gone) never blocks; no lock never blocks', () => {
  const lock = { memberId: 5, sessionId: 'dead' };
  assert.equal(lockBlocks(lock, 7, new Set(['s_other'])), false); // session not live → reaped
  assert.equal(lockBlocks(null, 7, new Set(['s5'])), false);      // no lock at all
});

test('lockBlocks: single-user mode (null holder vs null requester) does not block', () => {
  const lock = { memberId: null, sessionId: 's1' };
  assert.equal(lockBlocks(lock, null, new Set(['s1'])), false);
});
