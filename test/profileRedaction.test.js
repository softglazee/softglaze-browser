'use strict';
// Audit T2-1: profile rows must not ship stored secrets to the renderer, and redaction
// must not wipe those secrets when the editor saves the masked values back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SECRET_MASK, maskProxyInfoString, redactPlatformAccounts, redactProfileRow, restoreMaskedSecrets
} = require('../src/main/profileRedaction');

const IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');

const row = () => ({
  id: 7,
  title: 'Shop 1',
  twoFactorSeed: 'enc:v1:SEALEDSEED',
  proxyInfoString: '1.2.3.4:8080:alice:s3cret',
  platformAccounts: JSON.stringify([{ platform: 'Facebook', username: 'a@x.com', password: 'fbpass' }, { platform: 'Google', username: 'b@x.com', password: '' }]),
  proxy: { host: '1.2.3.4', port: 8080, username: 'alice', password: 's3cret' }
});

test('the 2FA seed never leaves the main process, even for the owner', () => {
  assert.equal(redactProfileRow(row(), { reveal: true }).twoFactorSeed, SECRET_MASK);
  assert.equal(redactProfileRow(row(), { reveal: false }).twoFactorSeed, SECRET_MASK);
  assert.equal(redactProfileRow({ ...row(), twoFactorSeed: null }, { reveal: true }).twoFactorSeed, null);
});

test('a restricted viewer gets the proxy and platform passwords masked', () => {
  const r = redactProfileRow(row(), { reveal: false });
  assert.equal(r.proxyInfoString, `1.2.3.4:8080:alice:${SECRET_MASK}`);
  assert.ok(!JSON.stringify(r).includes('s3cret'));
  const accs = redactPlatformAccounts(JSON.parse(row().platformAccounts), false);
  assert.equal(accs[0].password, SECRET_MASK);
  assert.equal(accs[0].username, 'a@x.com');
  assert.equal(accs[1].password, '', 'an empty password stays empty, not a mask');
});

test('an owner still sees their own proxy and platform passwords', () => {
  assert.equal(redactProfileRow(row(), { reveal: true }).proxyInfoString, '1.2.3.4:8080:alice:s3cret');
  assert.equal(redactPlatformAccounts(JSON.parse(row().platformAccounts), true)[0].password, 'fbpass');
});

test('the string fallback masks host:port:user:pass and leaves bare host:port alone', () => {
  assert.equal(maskProxyInfoString('h.example:1080:u:p:with:colons', null), `h.example:1080:u:${SECRET_MASK}`);
  assert.equal(maskProxyInfoString('h.example:1080', null), 'h.example:1080');
  assert.equal(maskProxyInfoString('h.example:1080:u:', null), 'h.example:1080:u:');
  assert.equal(maskProxyInfoString(null, null), null);
});

test('saving the masked values back keeps what is stored', () => {
  const existing = row();
  const input = restoreMaskedSecrets({
    id: 7,
    twoFactorSeed: SECRET_MASK,
    platformAccounts: [{ platform: 'Facebook', username: 'a@x.com', password: SECRET_MASK }, { platform: 'Google', username: 'b@x.com', password: '' }],
    proxyRaw: `1.2.3.4:8080:alice:${SECRET_MASK}`
  }, existing);
  assert.equal(input.twoFactorSeed, undefined, 'a masked seed means unchanged');
  assert.equal(input.platformAccounts[0].password, 'fbpass');
  assert.equal(input.proxyRaw, '1.2.3.4:8080:alice:s3cret');
});

test('real edits still apply: a new password, a cleared seed, a reordered list', () => {
  const existing = row();
  const input = restoreMaskedSecrets({
    twoFactorSeed: '',
    platformAccounts: [
      { platform: 'Google', username: 'b@x.com', password: 'newgoogle' },
      { platform: 'Facebook', username: 'a@x.com', password: SECRET_MASK }
    ]
  }, existing);
  assert.equal(input.twoFactorSeed, '', 'an emptied field still clears the seed');
  assert.equal(input.platformAccounts[0].password, 'newgoogle');
  assert.equal(input.platformAccounts[1].password, 'fbpass', 'a moved row keeps its own password');
});

test('a mask with nothing stored becomes empty rather than being saved as dots', () => {
  const input = restoreMaskedSecrets({ twoFactorSeed: SECRET_MASK, platformAccounts: [{ platform: 'X', username: 'u', password: SECRET_MASK }], proxyRaw: `h:1:u:${SECRET_MASK}` }, null);
  assert.equal(input.twoFactorSeed, undefined);
  assert.equal(input.platformAccounts[0].password, '');
  assert.equal(input.proxyRaw, 'h:1:u:');
});

test('serializeProfile, updateProfile, createProfile and the local API use the redaction', () => {
  const ser = /function serializeProfile\(profile\) \{[\s\S]*?\n\}/.exec(IPC)[0];
  assert.match(ser, /redactProfileRow\(profile, \{ reveal \}\)/);
  assert.match(ser, /\.\.\.safe,/);
  assert.ok(!/\.\.\.profile,/.test(ser), 'the raw row must not be spread any more');
  assert.match(ser, /redactPlatformAccounts\(/);
  assert.match(/async function updateProfile\(payload\) \{[\s\S]*?\n\}/.exec(IPC)[0], /input = restoreMaskedSecrets\(input, existing\)/);
  assert.match(/async function createProfile\(payload\) \{[\s\S]*?\n\}/.exec(IPC)[0], /restoreMaskedSecrets\(requireObject\(payload\), null\)/);
  assert.match(IPC, /proxy: p\.proxyInfoString \? maskProxyInfoString\(p\.proxyInfoString, null\) : null/);
});
