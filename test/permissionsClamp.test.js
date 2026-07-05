'use strict';
// Regression test for the effectivePermissions clamp (audit: a stored/tampered
// permissionsJson could ESCALATE beyond the role default — raise quota limits or turn on
// child-role create-flags). Stored values may only RESTRICT within the role, never exceed it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { effectivePermissions } = require('../src/main/permissions.js');

test('a tampered OPERATOR cannot raise numeric limits above the role default', () => {
  const eff = effectivePermissions({
    role: 'OPERATOR',
    permissionsJson: JSON.stringify({ maxProfiles: 999999, maxProxies: 999999, maxBrowsers: 999 })
  });
  // OPERATOR defaults: maxProfiles 10, maxProxies 10, maxBrowsers 2.
  assert.equal(eff.maxProfiles, 10);
  assert.equal(eff.maxProxies, 10);
  assert.equal(eff.maxBrowsers, 2);
});

test('a tampered role cannot turn on child-role create-flags', () => {
  const eff = effectivePermissions({
    role: 'OPERATOR',
    permissionsJson: JSON.stringify({ canCreateAdmins: true, canCreateManagers: true, canCreateOperators: true })
  });
  assert.equal(eff.canCreateAdmins, false);
  assert.equal(eff.canCreateManagers, false);
  assert.equal(eff.canCreateOperators, false);
});

test('a stored value may RESTRICT below the default', () => {
  const eff = effectivePermissions({
    role: 'MANAGER', // default maxProfiles 50, canCreateOperators true
    permissionsJson: JSON.stringify({ maxProfiles: 5, canCreateOperators: false })
  });
  assert.equal(eff.maxProfiles, 5);
  assert.equal(eff.canCreateOperators, false);
});

test('an unlimited (-1) role default can be restricted but a stored -1 cannot exceed a finite cap', () => {
  // Owner is unlimited; a stored restriction is honored.
  const owner = effectivePermissions({ role: 'OWNER', permissionsJson: JSON.stringify({ maxProfiles: 20 }) });
  assert.equal(owner.maxProfiles, 20);
  // Operator (finite cap 10) with a stored "unlimited" (-1) is clamped to the default.
  const op = effectivePermissions({ role: 'OPERATOR', permissionsJson: JSON.stringify({ maxProfiles: -1 }) });
  assert.equal(op.maxProfiles, 10);
});

test('no stored patch → role defaults intact', () => {
  const eff = effectivePermissions({ role: 'MANAGER' });
  assert.equal(eff.maxProfiles, 50);
  assert.equal(eff.canCreateOperators, true);
  assert.equal(eff.canCreateAdmins, false);
});
