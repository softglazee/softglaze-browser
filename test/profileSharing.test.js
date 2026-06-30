'use strict';

// Phase F2: unit tests for the pure shared-profile (ProfileAccess) ACL resolution
// in permissions.js. These guard the fail-closed semantics: a member only reaches
// a profile via ownership, assignment, or an explicit share to a visible member,
// and 'use' shares never grant edit.
const test = require('node:test');
const assert = require('node:assert');
const permissions = require('../src/main/permissions.js');

const { profileRowAccessible, accessLevelRank } = permissions;

test('accessLevelRank maps levels (unknown -> use)', () => {
  assert.strictEqual(accessLevelRank('use'), 1);
  assert.strictEqual(accessLevelRank('edit'), 2);
  assert.strictEqual(accessLevelRank('bogus'), 1);
  assert.strictEqual(accessLevelRank(undefined), 1);
});

test('owner in the visible set has full (edit) access', () => {
  const visible = new Set([5]);
  const row = { ownerMemberId: 5, assignedMemberId: null, accesses: [] };
  assert.strictEqual(profileRowAccessible(visible, row, false), true);
  assert.strictEqual(profileRowAccessible(visible, row, true), true);
});

test('assignee in the visible set has full (edit) access', () => {
  const visible = new Set([7]);
  const row = { ownerMemberId: 1, assignedMemberId: 7, accesses: [] };
  assert.strictEqual(profileRowAccessible(visible, row, true), true);
});

test('no ownership/assignment/share -> fail closed', () => {
  const visible = new Set([9]);
  const row = { ownerMemberId: 1, assignedMemberId: 2, accesses: [{ memberId: 3, level: 'edit' }] };
  assert.strictEqual(profileRowAccessible(visible, row, false), false);
  assert.strictEqual(profileRowAccessible(visible, row, true), false);
});

test("a 'use' share grants access but NOT edit", () => {
  const visible = new Set([4]);
  const row = { ownerMemberId: 1, assignedMemberId: 2, accesses: [{ memberId: 4, level: 'use' }] };
  assert.strictEqual(profileRowAccessible(visible, row, false), true);
  assert.strictEqual(profileRowAccessible(visible, row, true), false);
});

test("an 'edit' share grants access AND edit", () => {
  const visible = new Set([4]);
  const row = { ownerMemberId: 1, assignedMemberId: 2, accesses: [{ memberId: 4, level: 'edit' }] };
  assert.strictEqual(profileRowAccessible(visible, row, false), true);
  assert.strictEqual(profileRowAccessible(visible, row, true), true);
});

test('a share to a member outside the visible set is ignored', () => {
  const visible = new Set([4]);
  const row = { ownerMemberId: 1, assignedMemberId: 2, accesses: [{ memberId: 99, level: 'edit' }] };
  assert.strictEqual(profileRowAccessible(visible, row, false), false);
});

test('null/empty rows are not accessible', () => {
  const visible = new Set([1]);
  assert.strictEqual(profileRowAccessible(visible, null, false), false);
  assert.strictEqual(profileRowAccessible(null, { ownerMemberId: 1 }, false), false);
});
