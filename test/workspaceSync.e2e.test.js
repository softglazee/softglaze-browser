'use strict';
// Cloud sync phase 1 end to end: the REAL licensing server (/v1/sync/*, in-memory Prisma, over HTTP), the
// desktop service + replica on a REAL throwaway SQLite database (all app migrations applied), and a web
// browser played by @softglaze/protocol's WorkspaceSync with an in-memory replica (what app.softglaze.com runs).
// The browser joins with the one-time code; the PC is "off" (not syncing) while the browser edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'licensing-server');
const skip = fs.existsSync(path.join(SERVER, 'node_modules', 'express')) ? false : 'licensing-server dependencies not installed';

let H = null;
let sessions = null;
if (!skip) {
  H = require(path.join(SERVER, 'test', 'helpers', 'harness.js'));
  sessions = require(path.join(SERVER, 'src', 'auth', 'sessions.js'));
}

// Desktop side on a temp database (set AFTER the server harness, which sets its own DATABASE_URL).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cloudsync-'));
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('FAKE' + Buffer.from(String(s), 'utf8').toString('hex'), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8').slice(4), 'hex').toString('utf8')
};
const elPath = require.resolve('electron');
require.cache[elPath] = { id: elPath, filename: elPath, loaded: true, exports: { app: { isPackaged: false, getPath: () => userData }, safeStorage: fakeSafeStorage } };
process.env.DATABASE_URL = `file:${path.join(userData, 'softglaze.sqlite').replace(/\\/g, '/')}`;

const MAIN = path.join(ROOT, 'src', 'main');
const database = require(path.join(MAIN, 'database.js'));
const { P } = require(path.join(MAIN, 'mobile', 'protocol.js'));
const { createKeystore } = require(path.join(MAIN, 'workspaceSync', 'keystore.js'));
const { createDesktopReplica, createDbShadowStore } = require(path.join(MAIN, 'workspaceSync', 'replica.js'));
const { createWorkspaceSyncService } = require(path.join(MAIN, 'workspaceSync', 'service.js'));

const quiet = { info() {}, warn() {} };
let base;
let db;
let pcToken;
let webToken;
let customer;
let service;
let profileCap = 1000;
const running = new Set();

function buildService() {
  const keystore = createKeystore({ safeStorage: fakeSafeStorage, dir: () => userData });
  let n = 0;
  const replica = createDesktopReplica({
    P,
    getPrisma: () => db,
    uniqueDataDirName: async (title) => `cs-${String(title || 'p').replace(/[^a-z0-9]/gi, '-')}-${++n}-${Date.now()}`,
    assertProfileCapacity: async () => {
      const used = await db.profile.count({ where: { deletedAt: null } });
      if (used + 1 > profileCap) throw Object.assign(new Error('limit'), { code: 'PLAN_LIMIT' });
    },
    isProfileRunning: (id) => running.has(id),
    fillNewProfile: () => ({ os: 'Windows', osVersion: '11', userAgent: 'Mozilla/5.0 (generated)', webglVendor: 'Google Inc.', deviceName: 'DESKTOP-GEN1', macAddress: '00-1A-2B-3C-4D-5E' }),
    log: quiet
  });
  return createWorkspaceSyncService({
    P,
    keystore,
    replica,
    shadow: createDbShadowStore(() => db),
    apiBaseUrl: () => base,
    sessionToken: () => pcToken,
    accountId: () => customer.id,
    deviceName: () => 'Home PC',
    flagEnabled: () => true,
    setInterval: () => null,
    clearInterval: () => {},
    log: quiet
  });
}

// The browser: protocol client + in-memory replica, enrolled with the code the PC shows.
async function enrolBrowser(code) {
  const identity = P.generateIdentity();
  const api = new P.WsHttpApi({ baseUrl: base, auth: { token: () => webToken } });
  const secret = P.parseEnrolCode(code);
  const request = P.makeEnrolRequest(secret, identity, 'Chrome on laptop', 'web');
  const { id } = await api.enrol(request);
  return { identity, api, secret, request, id };
}

async function openBrowser(b) {
  const st = await b.api.enrolStatus(b.id);
  assert.equal(st.status, 'approved');
  const mk = P.acceptEnrolApproval({ secret: b.secret, request: b.request, approval: st.approval, device: b.identity });
  const info = (await b.api.status()).workspace;
  const { ring } = P.openWorkspace(info, mk);
  const replica = new P.MemoryReplica();
  const sync = new P.WorkspaceSync({
    api: b.api,
    ring,
    ownerSignPub: mk.sign.publicKey,
    device: { tag: P.deviceTagOf(b.identity.sign.publicKey), signSecret: b.identity.sign.secretKey },
    replica,
    shadow: new P.MemoryShadowStore()
  });
  return { mk, ring, replica, sync };
}

const byKind = (replica, kind) => [...replica.records.values()].filter((r) => r.kind === kind);
const findTitle = (replica, title) => byKind(replica, 'profile').find((r) => r.values.title === title);

test.before(async () => {
  if (skip) return;
  base = await H.start();
  const T = (await H.seedTenant('tenantcloud')).id;
  process.env.CLOUD_SYNC = 'on';
  customer = await H.db.customer.create({ data: { tenantId: T, email: 'owner@example.com', emailKey: 'owner@example.com', tier: 'pro', status: 'paid' } });
  pcToken = (await sessions.createSession(H.db, { tenantId: T, customer, provider: 'google', kind: 'desktop' })).token;
  webToken = (await sessions.createSession(H.db, { tenantId: T, customer, provider: 'google', kind: 'web' })).token;
  await database.bootstrapDatabase();
  db = database.getPrisma();
  service = buildService();
});

test.after(async () => {
  if (skip) return;
  delete process.env.CLOUD_SYNC;
  await database.disconnectPrisma().catch(() => {});
  await H.stop();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* Windows may hold the file */ }
});

test('PC turns on, a browser joins with the code, both edit, nothing readable on the server', { skip }, async () => {
  // Existing workspace on the PC.
  const group = await db.group.create({ data: { name: 'TikTok', color: '#ff0055' } });
  const pg = await db.proxyGroup.create({ data: { name: 'US residential' } });
  const proxy = await db.proxy.create({ data: { name: 'US 1', type: 'HTTP', host: 'gate.provider.example', port: 8000, username: 'user-us', password: 'hunter2-secret', proxyGroupId: pg.id, rotationUrl: 'https://provider.example/rotate?k=1' } });
  const prof = await db.profile.create({
    data: {
      title: 'Etsy US 03', dataDirName: 'etsy-us-03', groupId: group.id, proxyId: proxy.id, tags: JSON.stringify(['etsy', 'us']), notes: 'warm up first',
      launchArgs: '--renderer-cmd-prefix=calc.exe', startupUrls: 'https://www.etsy.com\nfile:///C:/Windows/win.ini', os: 'Windows', canvasNoise: false
    }
  });
  await db.template.create({ data: { name: 'Win 11 Chrome', dataJson: JSON.stringify({ os: 'Windows', launchArgs: '--no-sandbox' }) } });

  // Turn on: kit check, then create + first upload.
  const st0 = await service.status();
  assert.equal(st0.server.enabled, true);
  assert.equal(st0.server.workspace, null);
  const kit = await service.turnOnStart();
  assert.equal(kit.words.length, 24);
  await assert.rejects(service.turnOnConfirm({ [kit.check[0]]: 'wrong', [kit.check[1]]: kit.words[kit.check[1] - 1] }), (e) => e.code === 'KIT_MISMATCH');
  const on = await service.turnOnConfirm({ [kit.check[0]]: kit.words[kit.check[0] - 1], [kit.check[1]]: ` ${kit.words[kit.check[1] - 1].toUpperCase()} ` });
  assert.equal(on.ok, true);
  assert.equal(on.report.pushed, 5);
  const st1 = await service.status();
  assert.equal(st1.on, true);
  assert.ok(st1.server.workspace.bytesUsed > 0);

  // The server holds ciphertext only.
  const rows = await H.db.syncRecord.findMany({});
  assert.equal(rows.length, 5);
  for (const r of rows) {
    const text = Buffer.from(r.body).toString('latin1');
    for (const secret of ['hunter2', 'Etsy US', 'gate.provider', 'TikTok', 'warm up']) assert.ok(!text.includes(secret), `server body leaks ${secret}`);
  }

  // A browser joins: the PC sees only requests made with its code, then approves.
  const offer = service.enrolStart();
  const stranger = await enrolBrowser(P.createEnrolOffer().code); // someone else's code
  const b = await enrolBrowser(offer.code);
  const poll = await service.enrolPoll();
  assert.deepEqual(poll.requests.map((r) => r.id), [b.id]);
  assert.ok(!poll.requests.some((r) => r.id === stranger.id));
  await service.enrolApprove(b.id);
  const web = await openBrowser(b);
  const devices = await service.devices();
  assert.deepEqual(devices.map((d) => [d.name, d.platform, d.self]).sort(), [['Chrome on laptop', 'web', false], ['Home PC', 'pc', true]]);

  // The PC is now OFF (no sync calls). The browser reads everything and edits.
  await web.sync.sync();
  const wp = findTitle(web.replica, 'Etsy US 03');
  assert.ok(wp, 'profile reached the browser');
  assert.equal(wp.values.launchArgs, undefined, 'launch flags never leave the PC');
  assert.equal(wp.values.startupUrls, 'https://www.etsy.com/', 'file: start pages are dropped');
  assert.deepEqual(wp.values.tags, ['etsy', 'us']);
  assert.equal(wp.values.canvasNoise, false);
  const wproxy = byKind(web.replica, 'proxy')[0];
  assert.equal(wproxy.values.password, 'hunter2-secret');
  assert.equal(wp.values.proxySid, wproxy.sid);
  assert.equal(byKind(web.replica, 'group')[0].sid, wp.values.groupSid);
  assert.equal(wproxy.values.proxyGroupSid, byKind(web.replica, 'proxyGroup')[0].sid);
  assert.ok(!JSON.parse(byKind(web.replica, 'template')[0].values.dataJson).launchArgs, 'template snapshot drops launch flags');

  web.replica.put('profile', wp.sid, { title: 'Etsy US 03 (warmed)', tags: ['etsy', 'us', 'ready'] });
  const newProxySid = P.newSid();
  web.replica.put('proxy', newProxySid, { name: 'DE 1', type: 'SOCKS5', host: 'de.provider.example', port: 1080, username: 'u-de', password: 'pw-de' });
  const newProfileSid = P.newSid();
  web.replica.put('profile', newProfileSid, { title: 'Made on the web', deviceNameType: 'Custom', deviceName: '', macAddress: null, proxySid: newProxySid, groupSid: wp.values.groupSid, tags: ['web'], deletedAt: null });
  // A forged field from a compromised browser is dropped by every device.
  web.replica.put('profile', newProfileSid, { launchArgs: '--no-sandbox' });
  const wr = await web.sync.sync();
  assert.equal(wr.pushed, 3);

  // The PC comes back.
  const pr = await service.syncNow();
  assert.equal(pr.rejected.length, 0, JSON.stringify(pr.rejected));
  const p1 = await db.profile.findUnique({ where: { id: prof.id } });
  assert.equal(p1.title, 'Etsy US 03 (warmed)');
  assert.deepEqual(JSON.parse(p1.tags), ['etsy', 'us', 'ready']);
  assert.equal(p1.launchArgs, '--renderer-cmd-prefix=calc.exe', 'local launch flags stay as they were');
  assert.equal(p1.startupUrls, 'https://www.etsy.com\nfile:///C:/Windows/win.ini', 'the PC keeps its own start pages until edited');
  const p2 = await db.profile.findUnique({ where: { syncId: newProfileSid } });
  assert.ok(p2 && p2.dataDirName, 'web profile created with its own data folder');
  assert.equal(p2.launchArgs, null);
  assert.equal(p2.groupId, group.id);
  assert.equal(p2.os, 'Windows', 'generated fingerprint fills what the web left empty');
  assert.equal(p2.deviceName, 'DESKTOP-GEN1', 'an empty custom device name gets a generated one');
  assert.equal(p2.macAddress, '00-1A-2B-3C-4D-5E');
  const px = await db.proxy.findUnique({ where: { syncId: newProxySid } });
  assert.equal(px.password, 'pw-de', 'password arrives and is sealed again at rest by the app');
  assert.equal(p2.proxyId, px.id);

  // The PC's generated fingerprint goes back to the browser on the next round.
  await service.syncNow();
  await web.sync.sync();
  assert.equal(web.replica.records.get(newProfileSid).values.userAgent, 'Mozilla/5.0 (generated)');

  // Same field edited on both while apart: newest wins everywhere.
  await db.profile.update({ where: { id: prof.id }, data: { notes: 'pc note', os: 'macOS' } });
  await new Promise((r) => setTimeout(r, 5));
  web.replica.put('profile', wp.sid, { os: 'Linux' });
  await service.syncNow();
  await web.sync.sync();
  await service.syncNow();
  const p3 = await db.profile.findUnique({ where: { id: prof.id } });
  assert.equal(p3.os, 'Linux');
  assert.equal(p3.notes, 'pc note');
  assert.equal(web.replica.records.get(wp.sid).values.notes, 'pc note');

  // Trash from the web; delete forever from the web while the profile runs on the PC (kept, retried).
  web.replica.put('profile', wp.sid, { deletedAt: Date.now() });
  await web.sync.sync();
  await service.syncNow();
  assert.ok((await db.profile.findUnique({ where: { id: prof.id } })).deletedAt, 'trashed on the PC');
  running.add(p2.id);
  web.replica.records.delete(newProfileSid);
  await web.sync.sync();
  let r = await service.syncNow();
  assert.deepEqual(r.rejected.map((x) => x.reason), ['running']);
  assert.ok(await db.profile.findUnique({ where: { id: p2.id } }), 'not deleted while running');
  running.delete(p2.id);
  r = await service.syncNow();
  assert.equal(await db.profile.findUnique({ where: { id: p2.id } }), null, 'deleted once closed');
  await web.sync.sync();
  assert.equal(web.replica.records.has(newProfileSid), false, 'and it stays deleted on the browser');

  // Plan limit on the PC: a profile over the cap is refused there, not deleted anywhere.
  profileCap = await db.profile.count({ where: { deletedAt: null } });
  const capSid = P.newSid();
  web.replica.put('profile', capSid, { title: 'Over the cap' });
  await web.sync.sync();
  r = await service.syncNow();
  assert.deepEqual(r.rejected.map((x) => x.reason), ['plan_limit']);
  await web.sync.sync();
  assert.ok(web.replica.records.has(capSid));
  profileCap = 1000;
  await service.syncNow();
  assert.ok(await db.profile.findUnique({ where: { syncId: capSid } }));

  // Removing the browser: its writes are refused from then on.
  const webTag = P.deviceTagOf(b.identity.sign.publicKey);
  await service.revokeDevice(webTag);
  web.replica.put('profile', capSid, { title: 'after removal' });
  const after = await web.sync.sync();
  assert.ok(after.rejected.some((x) => x.reason === 'forbidden'));

  // A new kit; then off with the cloud copy deleted.
  const again = await service.reissueKit();
  assert.equal(again.words.length, 24);
  await service.turnOff({ deleteCloud: true });
  const st2 = await service.status();
  assert.equal(st2.on, false);
  assert.equal(st2.server.workspace, null);
  assert.equal((await H.db.syncRecord.findMany({})).length, 0);
  assert.ok(await db.profile.findUnique({ where: { id: prof.id } }), 'local data stays');
});
