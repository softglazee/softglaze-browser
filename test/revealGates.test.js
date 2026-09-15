'use strict';
// Audit T2-3 and T2-4: cookie dumps, full profile archives and live 2FA codes are
// credentials. Profile access (which an operator gets from use-level sharing) is not
// enough; they need the matching rbacPolicy clearance and they leave an audit entry.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rbac = require('../src/main/rbacPolicy');

const IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

test('operators cannot export cookies or read 2FA codes; managers and above can', () => {
  for (const kind of ['cookieDump', 'twoFactorCode']) {
    assert.throws(() => rbac.assertCanReveal('OPERATOR', kind), /cannot reveal/, `${kind} must be denied to OPERATOR`);
    for (const role of ['MANAGER', 'ADMIN', 'OWNER', 'SUPER_ADMIN']) {
      assert.doesNotThrow(() => rbac.assertCanReveal(role, kind), `${kind} must be allowed to ${role}`);
    }
  }
});

test('the reveal helper is a no-op in single-user mode and uses the member role otherwise', () => {
  const body = fnBody('assertCanRevealKind');
  assert.match(body, /const member = await getActiveMember\(\)/);
  assert.match(body, /if \(!member\) return;/);
  assert.match(body, /rbacPolicy\.assertCanReveal\(member\.role, kind\)/);
});

function assertGateBefore(fn, kind, sensitiveMarker) {
  const body = fnBody(fn);
  const gateAt = body.indexOf(`await assertCanRevealKind('${kind}')`);
  const readAt = body.indexOf(sensitiveMarker);
  assert.ok(gateAt > -1, `${fn} must call assertCanRevealKind('${kind}')`);
  assert.ok(readAt > -1, `${fn}: marker ${sensitiveMarker} not found`);
  assert.ok(gateAt < readAt, `${fn} must check clearance before touching the secret`);
  return body;
}

test('cookie export is gated before cookies are read, and audited', () => {
  const body = assertGateBefore('exportProfileCookies', 'cookieDump', 'exportSessionCookies(');
  assert.match(body, /logAudit\('profile\.cookies_exported'/);
});

test('profile archive export is gated like a cookie dump, and audited', () => {
  const body = assertGateBefore('exportProfileArchive', 'cookieDump', 'profileArchive.exportProfileArchive(');
  assert.match(body, /logAudit\('profile\.archive_exported'/);
});

test('2FA codes are gated before the seed is read, and audited', () => {
  const body = assertGateBefore('getProfile2faToken', 'twoFactorCode', 'twoFactorSeed: true');
  assert.match(body, /logAudit\('profile\.2fa_code_read'/);
});
