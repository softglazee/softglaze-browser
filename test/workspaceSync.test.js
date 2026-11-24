'use strict';
// Cloud sync (src/main/workspaceSync) unit tests: keystore, IPC owner rule, preload channel list, the
// service's refusals, and the Settings strings. The full flow against the real server is in
// workspaceSync.e2e.test.js. (test/cloudSync.test.js covers the older src/main/cloudSync.js envelope.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { P } = require('../src/main/mobile/protocol');
const { createKeystore } = require('../src/main/workspaceSync/keystore');
const { CLOUD_SYNC_CHANNELS, registerCloudSyncIpc } = require('../src/main/workspaceSync/ipc');
const { createWorkspaceSyncService } = require('../src/main/workspaceSync/service');

const fakeSafeStorage = (on = true) => ({
  isEncryptionAvailable: () => on,
  encryptString: (s) => Buffer.from('X' + Buffer.from(s).toString('hex')),
  decryptString: (b) => Buffer.from(b.toString().slice(1), 'hex').toString()
});

test('the vendored protocol has the cloud sync module (0.2.0)', () => {
  assert.equal(require('../src/main/mobile/vendor/VENDOR.json').version, '0.2.0');
  for (const fn of ['createWorkspace', 'recoverWorkspace', 'WorkspaceSync', 'WsHttpApi', 'createEnrolOffer', 'approveEnrolRequest', 'sanitizeValues', 'newSid']) {
    assert.ok(P[fn], `missing ${fn}`);
  }
});

test('keystore: sealed file, never written without OS encryption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ks-'));
  const ks = createKeystore({ safeStorage: fakeSafeStorage(), dir: () => dir });
  assert.equal(ks.read(), null);
  ks.patch({ mkSeed: 'abc' });
  ks.patch({ workspaceId: 'w' });
  assert.deepEqual(ks.read(), { v: 1, mkSeed: 'abc', workspaceId: 'w' });
  assert.ok(!fs.readFileSync(path.join(dir, ks.FILE_NAME), 'utf8').includes('abc'));
  const off = createKeystore({ safeStorage: fakeSafeStorage(false), dir: () => dir });
  assert.equal(off.read(), null);
  assert.throws(() => off.write({}), (e) => e.code === 'NO_OS_ENCRYPTION');
  ks.clear();
  assert.equal(ks.read(), null);
});

test('IPC: only the Owner (or single-user mode) may use cloud sync', async () => {
  const handlers = {};
  const service = new Proxy({}, { get: (_, k) => async () => ({ called: k }) });
  let member = null;
  registerCloudSyncIpc((ch, fn) => { handlers[ch] = fn; }, service, { getWindowMember: async () => member, qrDataUrl: () => 'data:' });
  const channels = Object.values(CLOUD_SYNC_CHANNELS).filter((c) => c !== CLOUD_SYNC_CHANNELS.CHANGED);
  assert.deepEqual(Object.keys(handlers).sort(), channels.sort());
  assert.deepEqual(await handlers[CLOUD_SYNC_CHANNELS.STATUS](), { called: 'status' });
  member = { id: 1, role: 'OWNER', status: 'active' };
  assert.deepEqual(await handlers[CLOUD_SYNC_CHANNELS.TURN_OFF]({ deleteCloud: true }), { called: 'turnOff' });
  for (const role of ['ADMIN', 'MANAGER', 'OPERATOR']) {
    member = { id: 2, role, status: 'active' };
    await assert.rejects(handlers[CLOUD_SYNC_CHANNELS.STATUS](), (e) => e.code === 'FORBIDDEN');
  }
  member = { id: 1, role: 'OWNER', status: 'suspended' };
  await assert.rejects(handlers[CLOUD_SYNC_CHANNELS.SYNC_NOW](), (e) => e.code === 'FORBIDDEN');
});

test('preload exposes exactly the main cloud sync channels', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
  const block = /const CLOUD_SYNC_CHANNELS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(src)[1];
  const pre = Object.fromEntries([...block.matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(pre, { ...CLOUD_SYNC_CHANNELS });
  assert.match(src, /for \(const channel of Object\.values\(CLOUD_SYNC_CHANNELS\)\) ALLOWED_CHANNELS\.add\(channel\);/);
});

function svc(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-svc-'));
  const calls = [];
  const status = over.status || { enabled: true, plan: { allowed: true, tier: 'pro', quotaBytes: 1, readOnly: false }, workspace: null };
  const fetch = async (url, init) => {
    calls.push([init.method, url]);
    if (url.endsWith('/v1/sync/workspace') && init.method === 'GET') return { status: 200, ok: true, json: async () => status };
    return { status: 201, ok: true, json: async () => ({ ok: true }) };
  };
  const s = createWorkspaceSyncService({
    P,
    keystore: createKeystore({ safeStorage: fakeSafeStorage(), dir: () => dir }),
    replica: { list: async () => [], apply: async () => ({}) },
    shadow: { load: async () => null, save: async () => {}, clear: async () => {} },
    apiBaseUrl: () => 'https://api.test',
    sessionToken: () => ('token' in over ? over.token : 'tok'),
    accountId: () => 7,
    deviceName: () => 'PC',
    flagEnabled: () => over.flag !== false,
    fetch,
    setInterval: () => null,
    clearInterval: () => {}
  });
  return { s, calls };
}

test('service refuses what it cannot do, with codes the page shows', async () => {
  await assert.rejects(svc({ flag: false }).s.turnOnStart(), (e) => e.code === 'CLOUD_SYNC_UNAVAILABLE');
  await assert.rejects(svc({ token: null }).s.turnOnStart(), (e) => e.code === 'SIGN_IN_REQUIRED');
  await assert.rejects(svc({ status: { enabled: false, plan: { allowed: true }, workspace: null } }).s.turnOnStart(), (e) => e.code === 'CLOUD_SYNC_UNAVAILABLE');
  await assert.rejects(svc({ status: { enabled: true, plan: { allowed: false }, workspace: null } }).s.turnOnStart(), (e) => e.code === 'PLAN_REQUIRED');
  await assert.rejects(svc({ status: { enabled: true, plan: { allowed: true }, workspace: { id: 'x' } } }).s.turnOnStart(), (e) => e.code === 'WORKSPACE_EXISTS');
  await assert.rejects(svc().s.turnOnConfirm({}), (e) => e.code === 'KIT_EXPIRED');
  await assert.rejects(svc().s.recover('a b c'), (e) => e.code === 'NO_WORKSPACE');
  assert.throws(() => svc().s.enrolStart(), (e) => e.code === 'CLOUD_SYNC_OFF');
  assert.deepEqual(await svc().s.enrolPoll(), { active: false, requests: [] });
  const off = await svc({ token: null }).s.status();
  assert.equal(off.on, false);
  assert.equal(off.signedIn, false);
  assert.equal(off.server, null);
});

test('turn on: nothing is sent before the kit is checked', async () => {
  const { s, calls } = svc();
  const kit = await s.turnOnStart();
  assert.equal(kit.words.length, 24);
  assert.deepEqual(calls.map((c) => c[0]), ['GET']);
  assert.equal((await s.status()).pendingKit, true);
  s.turnOnCancel();
  assert.equal((await s.status()).pendingKit, false);
});

test('Settings strings: every key the page uses exists in English', () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', 'en', 'cloudSync.json'), 'utf8'));
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'CloudSyncSettings.jsx'), 'utf8');
  const get = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), en);
  for (const m of src.matchAll(/\bt\('([a-zA-Z.]+)'/g)) assert.ok(get(m[1]) !== undefined, `missing ${m[1]}`);
  for (const p of ['pc', 'web', 'phone']) assert.ok(en.devices[`platform_${p}`]);
});
