'use strict';

// Regression guard for H-CR2: the per-workspace E2E salt was minted locally and
// NEVER shared, so a second device derived a DIFFERENT master key, could not
// decrypt the first device's envelopes, and its push re-encrypted the remote under
// the new key (mutually destructive). The salt is not secret; every device must
// derive from the SAME salt. resolveWorkspaceSalt makes a bucket-held salt
// authoritative and uploads the local one exactly once when the bucket has none,
// falling back to the local salt on any transport error so unlock never blocks.

const test = require('node:test');
const assert = require('node:assert');
const { resolveWorkspaceSalt } = require('../src/main/cloudSync.js');

function mockTransport(existing) {
  const store = new Map();
  if (existing !== undefined) store.set('ns/workspace.salt', Buffer.from(existing, 'utf8'));
  const calls = { get: 0, put: 0, putValue: null };
  return {
    calls,
    async get(k) { calls.get += 1; return store.has(k) ? store.get(k) : null; },
    async put(k, b) { calls.put += 1; calls.putValue = b.toString('utf8'); store.set(k, Buffer.isBuffer(b) ? b : Buffer.from(String(b))); }
  };
}

test('adopts the salt already in the bucket (bucket is authoritative)', async () => {
  const t = mockTransport('REMOTE_SALT_B64');
  let persisted = null;
  const salt = await resolveWorkspaceSalt(t, 'ns', 'LOCAL_SALT', (s) => { persisted = s; });
  assert.strictEqual(salt, 'REMOTE_SALT_B64');
  assert.strictEqual(persisted, 'REMOTE_SALT_B64', 'adopted salt is persisted locally');
  assert.strictEqual(t.calls.put, 0, 'must never overwrite an existing bucket salt');
});

test('uploads the local salt when the bucket has none', async () => {
  const t = mockTransport();
  const salt = await resolveWorkspaceSalt(t, 'ns', 'LOCAL_SALT', () => {});
  assert.strictEqual(salt, 'LOCAL_SALT');
  assert.strictEqual(t.calls.put, 1);
  assert.strictEqual(t.calls.putValue, 'LOCAL_SALT', 'the local salt is published to the bucket');
});

test('mints and uploads a salt when neither local nor bucket has one', async () => {
  const t = mockTransport();
  const salt = await resolveWorkspaceSalt(t, 'ns', null, () => {});
  assert.ok(typeof salt === 'string' && salt.length >= 16, 'a fresh salt is minted');
  assert.strictEqual(t.calls.put, 1);
  assert.strictEqual(t.calls.putValue, salt);
});

test('falls back to the local salt on a transport error (never blocks unlock)', async () => {
  const t = { async get() { throw new Error('bucket down'); }, async put() { throw new Error('bucket down'); } };
  const salt = await resolveWorkspaceSalt(t, 'ns', 'LOCAL_SALT', () => {});
  assert.strictEqual(salt, 'LOCAL_SALT');
});

test('two devices converge on the first device salt', async () => {
  const shared = mockTransport();
  const a = await resolveWorkspaceSalt(shared, 'ns', 'DEVICE_A_SALT', () => {});
  const b = await resolveWorkspaceSalt(shared, 'ns', 'DEVICE_B_SALT', () => {});
  assert.strictEqual(a, 'DEVICE_A_SALT');
  assert.strictEqual(b, 'DEVICE_A_SALT', 'device B must adopt the salt device A published');
});
