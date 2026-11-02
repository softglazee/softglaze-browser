'use strict';
// Audit 2 Nov 2026 #5: on a shared computer anyone could become Owner. The registered
// Owner has no login password (its credential is the workspace password). A team member
// signed in with their own password (which unlocks the workspace), clicked Sign out (the
// workspace stayed unlocked), and the member picker then opened the Owner with no
// credential. Pending invites (e.g. an ADMIN invite) opened the same way, and the
// pre-sign-in member list exposed pending invite codes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

test('signing out locks the workspace when a workspace password is set (fails closed)', () => {
  const body = fnBody('memberLogout');
  assert.match(body, /if \(v\.enabled && v\.hash\) \{ vaultLocked = true; vaultUnlockSource = null; \}/);
  assert.match(body, /catch \(e\) \{[\s\S]*?vaultLocked = true; vaultUnlockSource = null;/);
});

test('every unlock records how it happened', () => {
  assert.match(fnBody('memberLogin'), /vaultLocked = false;[^\n]*\r?\n\s*vaultUnlockSource = 'member';/);
  assert.match(fnBody('acceptInvite'), /vaultLocked = false;\r?\n\s*vaultUnlockSource = 'member';/);
  assert.match(fnBody('superLogin'), /vaultUnlockSource = 'super';/);
  assert.match(fnBody('vaultUnlock'), /vaultLocked = false;\r?\n\s*vaultUnlockSource = 'vault';/);
  assert.match(fnBody('vaultLock'), /vaultLocked = true; vaultUnlockSource = null;/);
  assert.match(fnBody('vaultDisable'), /vaultUnlockSource = 'none';/);
  assert.match(fnBody('accountRegister'), /vaultUnlockSource = 'vault';/);
  // No unlock site may be left without its source.
  const lines = IPC.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*vaultLocked = false;/.test(line)) {
      assert.match(lines[i + 1], /vaultUnlockSource = '/, `unlock at line ${i + 1} must set vaultUnlockSource`);
    } else if (/vaultLocked = false/.test(line) && !/^let /.test(line)) {
      assert.match(line, /vaultUnlockSource = '/, `inline unlock at line ${i + 1} must set vaultUnlockSource`);
    }
  });
});

test('with nobody signed in, a password-less identity needs a workspace-password unlock', () => {
  const body = fnBody('switchMember');
  assert.match(body, /if \(m\.inviteStatus === 'pending'\) \{[\s\S]*?INVITE_PENDING/);
  assert.match(body, /if \(vaultOn && vaultUnlockSource !== 'vault'\) \{[\s\S]*?verifySecret\(pw, v\.salt, v\.hash\)[\s\S]*?NEED_PASSWORD/);
  // Members WITH a login password still need their own password (unchanged).
  assert.match(body, /if \(m\.passwordHash\) \{\s*const pw = String\(input\.password \|\| ''\);\s*if \(!verifySecret\(pw, m\.passwordSalt, m\.passwordHash\)\)/);
});

test('the normal boot path is unchanged: workspace password unlock, then pick the Owner', () => {
  // vaultUnlock sets 'vault', so the picker opens the password-less Owner as before.
  assert.match(fnBody('vaultUnlock'), /vaultUnlockSource = 'vault';/);
  assert.match(fnBody('restoreSession'), /else vaultUnlockSource = 'none';/, 'no workspace password = single-user, unrestricted');
});

test('pending invite codes are only listed to a signed-in viewer', () => {
  assert.match(fnBody('listMembers'), /inviteCode: viewer && m\.inviteStatus === 'pending' \? m\.inviteCode : null,/);
});
