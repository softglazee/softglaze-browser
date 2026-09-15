'use strict';
// Audit T2-6, desktop side: the licensing server issues a per-install secret once and
// requires it for license and redeem. The app must keep it sealed and send it, and must
// not identify itself by email.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'src', 'main', 'licenseClient.js'), 'utf8');

test('the client sends the install secret on license and redeem, and no email', () => {
  assert.match(CLIENT, /license: \(\{ installId, installSecret \}\) => postJson\('\/v1\/license', \{ tenantId: tenantConfig\(\)\.tenantId, installId, installSecret \}\)/);
  assert.match(CLIENT, /redeem: \(\{ code, installId, installSecret \}\) => postJson\('\/v1\/redeem', \{ tenantId: tenantConfig\(\)\.tenantId, code, installId, installSecret \}\)/);
});

test('the install secret is stored sealed and returned with the install id', () => {
  const fn = /async function ensureBackendInstall\(\) \{[\s\S]*?\n\}/.exec(IPC)[0];
  assert.match(fn, /writeSetting\('backendInstallSecret', secretStore\.seal\(/);
  assert.match(fn, /secretStore\.open\(sealed\)/);
  assert.match(fn, /return \{ installId: res\.installId, installSecret: String\(res\.installSecret\) \}/);
  assert.match(fn, /already registered/i, 'a machine the server already knows gets a fresh identity instead of a lockout');
});

test('every licensing call passes the authenticated install', () => {
  assert.match(IPC, /licenseClient\.api\.license\(\{ installId: install\.installId, installSecret: install\.installSecret \}\)/);
  assert.match(IPC, /licenseClient\.api\.redeem\(\{ code: code\.trim\(\)\.toUpperCase\(\), installId: install\.installId, installSecret: install\.installSecret \}\)/);
  assert.ok(!/const installId = await ensureBackendInstall\(\)/.test(IPC), 'no caller may treat the result as a bare id');
});
