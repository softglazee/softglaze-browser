'use strict';
// E2E sync envelope: encrypt → decrypt round-trip + tamper resistance
// (src/main/cloudSync.js). Pure node:crypto — no Electron, no transport needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CloudSyncEngine } = require('../src/main/cloudSync.js');

async function freshEngine() {
  const e = new CloudSyncEngine();
  await e.deriveMasterKey('master-pass', 'workspace-salt');
  return e;
}

test('encryptPayload then decryptPayload round-trips the profile state', async () => {
  const e = await freshEngine();
  const state = CloudSyncEngine.serializeProfileState({
    cookies: [{ name: 'sid', value: 'abc' }],
    localStorage: { theme: 'dark' },
    fingerprint: { ua: 'Mozilla/5.0' }
  });
  const env = e.encryptPayload(state);
  assert.equal(env.v, 1);
  assert.deepEqual(e.decryptPayload(env), state);
});

test('a tampered envelope fails the GCM tag', async () => {
  const e = await freshEngine();
  const env = e.encryptPayload({ secret: 'x' });
  const raw = Buffer.from(env.data, 'base64');
  raw[0] ^= 0xff; // flip one ciphertext byte
  const tampered = { ...env, data: raw.toString('base64') };
  assert.throws(() => e.decryptPayload(tampered));
});

test('each encryption uses a fresh salt + iv (no keystream reuse)', async () => {
  const e = await freshEngine();
  const a = e.encryptPayload({ n: 1 });
  const b = e.encryptPayload({ n: 1 });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.salt, b.salt);
});

test('encrypt requires a derived master key first', () => {
  const e = new CloudSyncEngine();
  assert.throws(() => e.encryptPayload({ a: 1 }), /Master key/i);
});

test('pushProfileState reports skipped when no transport is configured', async () => {
  const e = await freshEngine();
  const res = await e.pushProfileState('p1', { cookies: [] });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, true);
});
