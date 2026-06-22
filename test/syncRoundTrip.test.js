'use strict';
// Cloud sync: engine+transport round-trip (zero-knowledge), conflict policy, and
// the concrete REST transport against a loopback HTTP server. No Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { CloudSyncEngine } = require('../src/main/cloudSync.js');
const { RestBucketTransport } = require('../src/main/syncTransport.js');
const { decideProfileSync } = require('../src/main/syncPolicy.js');

// In-memory transport that records what the "server" would store.
function memTransport() {
  const store = new Map();
  return {
    store,
    async put(key, buf) { store.set(key, Buffer.from(buf)); },
    async get(key) { return store.has(key) ? store.get(key) : null; }
  };
}

test('engine round-trips profile state through a transport and converges', async () => {
  const t = memTransport();
  const e = new CloudSyncEngine({ transport: t });
  await e.deriveMasterKey('sync-pass', 'shared-namespace');

  const state = { cookies: [{ name: 'sid', value: 'TOP-SECRET-COOKIE' }], fingerprint: { ua: 'Mozilla/5.0' } };
  const push = await e.pushProfileState('p1', state);
  assert.equal(push.ok, true);

  // A SECOND install with the SAME passphrase + namespace + transport converges.
  const e2 = new CloudSyncEngine({ transport: t });
  await e2.deriveMasterKey('sync-pass', 'shared-namespace');
  const pull = await e2.pullProfileState('p1');
  assert.equal(pull.ok, true);
  assert.deepEqual(pull.state, CloudSyncEngine.serializeProfileState(state));
});

test('what the server stores is opaque ciphertext (zero-knowledge)', async () => {
  const t = memTransport();
  const e = new CloudSyncEngine({ transport: t });
  await e.deriveMasterKey('sync-pass', 'shared-namespace');
  await e.pushProfileState('p1', { cookies: [{ name: 'sid', value: 'TOP-SECRET-COOKIE' }] });

  const storedBytes = [...t.store.values()][0].toString('utf8');
  assert.ok(storedBytes.length > 0, 'something was stored');
  assert.ok(!storedBytes.includes('TOP-SECRET-COOKIE'), 'plaintext cookie must never reach the server');
  assert.ok(!storedBytes.includes('sid'), 'cookie names must not leak either');
});

test('a wrong passphrase cannot decrypt another install\'s data', async () => {
  const t = memTransport();
  const e = new CloudSyncEngine({ transport: t });
  await e.deriveMasterKey('right-pass', 'ns');
  await e.pushProfileState('p1', { cookies: [{ name: 'a', value: 'b' }] });

  const wrong = new CloudSyncEngine({ transport: t });
  await wrong.deriveMasterKey('WRONG-pass', 'ns');
  const res = await wrong.pullProfileState('p1');
  assert.equal(res.ok, false); // GCM tag fails -> reported, never silently wrong
});

test('decideProfileSync resolves push/pull/noop/conflict correctly', () => {
  // remote absent -> first push
  assert.deepEqual(
    decideProfileSync({ localUpdatedAt: 100, remoteMeta: null, lastSync: null }),
    { action: 'push', resolution: 'push', reason: 'remote-absent' }
  );
  // only local changed since last sync -> push
  assert.equal(decideProfileSync({ localUpdatedAt: 200, remoteMeta: { updatedAt: 100 }, lastSync: { syncedAt: 100 } }).action, 'push');
  // only remote changed -> pull
  assert.equal(decideProfileSync({ localUpdatedAt: 100, remoteMeta: { updatedAt: 200 }, lastSync: { syncedAt: 100 } }).action, 'pull');
  // neither changed -> noop
  assert.equal(decideProfileSync({ localUpdatedAt: 100, remoteMeta: { updatedAt: 100 }, lastSync: { syncedAt: 100 } }).action, 'noop');
  // both changed -> conflict, LWW picks the newer side
  const c = decideProfileSync({ localUpdatedAt: 300, remoteMeta: { updatedAt: 250 }, lastSync: { syncedAt: 100 } });
  assert.equal(c.action, 'conflict');
  assert.equal(c.resolution, 'push'); // local (300) newer than remote (250)
  const c2 = decideProfileSync({ localUpdatedAt: 250, remoteMeta: { updatedAt: 300 }, lastSync: { syncedAt: 100 } });
  assert.equal(c2.resolution, 'pull'); // remote newer
});

test('RestBucketTransport put/get round-trips over HTTP; missing key -> null', async () => {
  const store = new Map();
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.replace(/^\//, ''));
    if (req.headers.authorization !== 'Bearer tok') { res.writeHead(401); return res.end(); }
    if (req.method === 'PUT') {
      const ch = [];
      req.on('data', (c) => ch.push(c));
      req.on('end', () => { store.set(key, Buffer.concat(ch)); res.writeHead(204); res.end(); });
    } else if (req.method === 'GET') {
      if (store.has(key)) { res.writeHead(200); res.end(store.get(key)); }
      else { res.writeHead(404); res.end(); }
    } else { res.writeHead(405); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const t = new RestBucketTransport({ baseUrl: `http://127.0.0.1:${port}`, token: 'tok' });
    await t.put('softglaze/a.sgz-env', Buffer.from('opaque-bytes'));
    const got = await t.get('softglaze/a.sgz-env');
    assert.equal(got.toString('utf8'), 'opaque-bytes');
    assert.equal(await t.get('softglaze/missing.sgz-env'), null);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
