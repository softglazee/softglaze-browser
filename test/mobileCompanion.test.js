'use strict';
// Unit tests of the phone companion (src/main/mobile): vendored protocol, settings, identity,
// device store, bridge rules, relay client, IPC member rules, sync mapping, the migration, the
// preload channel list and the UI strings. The end to end tests with the real relay are in
// mobileCompanion.e2e.test.js and mobileSync.e2e.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const { P, VENDOR, wireProfileId, parseWireProfileId } = require('../src/main/mobile/protocol');
const config = require('../src/main/mobile/config');
const { loadOrCreateIdentity, pcDeviceId } = require('../src/main/mobile/identity');
const { createMemoryDeviceStore, rowFromPairing, publicDevice } = require('../src/main/mobile/devices');
const { MobileBridge, chunkSummaries, summaryOf } = require('../src/main/mobile/bridge');
const { RelayClient } = require('../src/main/mobile/relayClient');
const { memberForPhone, MOBILE_CHANNELS } = require('../src/main/mobile/ipc');
const mapping = require('../src/main/mobile/sync/mapping');
const { qrSvg } = require('../src/main/mobile/qr');
const { createTestHost } = require('./helpers/mobileHost');

const ROOT = path.join(__dirname, '..');

// ---- vendored protocol ----
test('the vendored protocol bundle is the one VENDOR.json describes', () => {
  const file = path.join(ROOT, 'src', 'main', 'mobile', 'vendor', VENDOR.bundle);
  // Hash with LF line ends (a Windows checkout with core.autocrlf has CRLF in the working copy).
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(sha, VENDOR.sha256, 'run scripts/vendor-softglaze-protocol.mjs instead of editing the bundle');
  assert.equal(VENDOR.package, '@softglaze/protocol');
  assert.equal(VENDOR.protocolCommit, 'f6f1fa1b9bab1317cdb66dac649ef09413524062', 'protocol with approval_request.resolution and the push kind update');
  const ended = P.createMessage('approval_request', { approvalId: 'appr_000001', tool: 't', summary: 's', allowHour: true, expiresAt: 1, resolution: 'approved' });
  assert.equal(ended.body.resolution, 'approved', 'the bundle keeps resolution (an older bundle strips it)');
  assert.ok(P.PUSH_KINDS.includes('update'));
  assert.deepEqual(VENDOR.dependencies, { '@noble/ciphers': '2.4.0', '@noble/curves': '2.4.0', '@noble/hashes': '2.4.0', valibot: '1.5.0' });
  for (const name of ['PairingOffer', 'acceptSession', 'sealTo', 'openSealed', 'buildAuthFrame', 'SyncEngine', 'SyncSpaceOwner']) assert.equal(typeof P[name], 'function', name);
});

test('profile ids on the wire fit the protocol id pattern and map back', () => {
  assert.equal(wireProfileId(12), 'p0000012');
  assert.equal(parseWireProfileId('p0000012'), 12);
  assert.equal(parseWireProfileId(wireProfileId(123456789)), 123456789);
  assert.equal(parseWireProfileId('pp-phone-1'), null);
  assert.equal(parseWireProfileId('p12'), null);
  assert.ok(P.isValidMessage(P.createMessage('command', { name: 'profile.start', profileIds: [wireProfileId(1)] })));
  assert.throws(() => wireProfileId(0));
});

// ---- settings ----
test('relay address: env override, stored value, default; host for auth; only wss or local ws', () => {
  assert.equal(config.relayUrlOf({ relayUrl: null }, {}), config.DEFAULT_RELAY_URL);
  assert.equal(config.relayUrlOf({ relayUrl: 'wss://r.example.com/v1' }, {}), 'wss://r.example.com/v1');
  assert.equal(config.relayUrlOf({ relayUrl: 'wss://r.example.com/v1' }, { SG_RELAY_URL: 'ws://127.0.0.1:9999/v1' }), 'ws://127.0.0.1:9999/v1');
  assert.equal(config.relayHostOf('wss://relay.softglaze.com/v1', {}), 'relay.softglaze.com');
  assert.equal(config.relayHostOf('ws://127.0.0.1:8787/v1', {}), '127.0.0.1');
  assert.equal(config.relayHostOf('ws://[::1]:8787/v1', {}), '::1');
  assert.equal(config.relayHostOf('ws://127.0.0.1:8787/v1', { SG_RELAY_HOST: 'relay.test' }), 'relay.test');
  assert.equal(config.validateRelayUrl('wss://relay.softglaze.com/v1'), 'wss://relay.softglaze.com/v1');
  assert.equal(config.validateRelayUrl('ws://localhost:8787/v1'), 'ws://localhost:8787/v1');
  assert.throws(() => config.validateRelayUrl('ws://relay.softglaze.com/v1'));
  assert.throws(() => config.validateRelayUrl('wss://user:pw@relay.softglaze.com/v1'));
  assert.throws(() => config.validateRelayUrl('https://relay.softglaze.com'));
  const s = config.normalizeSettings({ enabled: true, syncProfiles: [3, '3', 'x', -1, 4] });
  assert.deepEqual(s.syncProfiles, [3, 4]);
  assert.equal(config.normalizeSettings(null).enabled, false, 'off by default');
});

// ---- identity ----
function memStore() {
  const m = new Map();
  return { m, read: async (k, f) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : f), write: async (k, v) => { m.set(k, v); } };
}
const fakeSealer = { seal: (s) => `enc:v1:${Buffer.from(s).toString('base64')}`, open: (s) => (s.startsWith('enc:v1:') ? Buffer.from(s.slice(7), 'base64').toString() : '') };

test('the PC identity is made once, stored sealed, and read back', async () => {
  const store = memStore();
  const a = await loadOrCreateIdentity({ store, sealer: fakeSealer, key: 'id' });
  assert.equal(a.created, true);
  const saved = store.m.get('id');
  assert.ok(saved.sealed.startsWith('enc:v1:'));
  assert.ok(!JSON.stringify(saved).includes(P.toBase64Url(a.identity.dh.secretKey)), 'no secret key in clear');
  const b = await loadOrCreateIdentity({ store, sealer: fakeSealer, key: 'id' });
  assert.equal(b.created, false);
  assert.equal(b.identity.mailboxId, a.identity.mailboxId);
  assert.ok(P.equalBytes(b.identity.dh.secretKey, a.identity.dh.secretKey));
  assert.match(pcDeviceId(a.identity), /^pc-[A-Za-z0-9_-]{8}$/);
});

test('without OS encryption no identity is created; unreadable keys are reported, not replaced', async () => {
  const store = memStore();
  await assert.rejects(loadOrCreateIdentity({ store, sealer: { seal: () => { throw new Error('no safeStorage'); }, open: () => '' }, key: 'id' }), /safeStorage/);
  assert.equal(store.m.size, 0);
  await loadOrCreateIdentity({ store, sealer: fakeSealer, key: 'id' });
  await assert.rejects(loadOrCreateIdentity({ store, sealer: { seal: fakeSealer.seal, open: () => '' }, key: 'id' }), (e) => e.code === 'MOBILE_KEYS_UNREADABLE');
});

// ---- device store ----
function fakePeer(name = 'Phone') {
  const id = P.generateIdentity();
  return { identity: id, peer: { dhPub: id.dh.publicKey, signPub: id.sign.publicKey, mailboxId: id.mailboxId, device: { name, platform: 'ios', appVersion: '1.0.0' } } };
}

test('paired devices: scopes always include view, a phone pairing again replaces its row, the renderer never gets keys', async () => {
  const store = createMemoryDeviceStore();
  const { peer } = fakePeer('Ali iPhone');
  const d1 = await store.create(rowFromPairing({ peer, memberId: 2, scopes: ['approve_ai', 'bogus'] }));
  assert.deepEqual(d1.scopes.sort(), ['approve_ai', 'view']);
  assert.equal(d1.keyId, P.keyId(peer.dhPub));
  const d2 = await store.create(rowFromPairing({ peer, memberId: 2, scopes: ['view'] }));
  assert.equal((await store.list()).length, 1);
  assert.notEqual(d1.deviceId, d2.deviceId);
  const pub = publicDevice(d2);
  for (const k of ['dhPub', 'x25519Pub', 'ed25519Pub', 'keyId']) assert.ok(!(k in pub), k);
  await store.update(d2.deviceId, { revokedAt: new Date().toISOString() });
  assert.equal((await store.active()).length, 0);
  assert.equal((await store.revokedPending()).length, 1);
});

// ---- bridge ----
function bridgeFor({ host, devices }) {
  const sent = [];
  const bridge = new MobileBridge({
    host: { ...host, pcName: () => 'OFFICE-PC', platform: 'windows', appVersion: '1.0.27', updateDevice: async () => {} },
    send: async (device, msg, opts) => { sent.push({ device: device.deviceId, msg, opts }); return true; },
    isLive: () => true,
    devices: async () => devices
  });
  return { bridge, sent };
}
const dev = (over = {}) => ({ deviceId: 'dev_1', name: 'Phone', memberId: 2, scopes: ['view', 'control_profiles', 'approve_ai'], ...over });

test('bridge: a missing scope is refused before anything runs, with exactly one activity row', async () => {
  const host = createTestHost({ members: [{ id: 2, name: 'Ali', role: 'OPERATOR' }], profiles: [{ id: 5, title: 'A', memberId: 2 }] });
  const { bridge, sent } = bridgeFor({ host, devices: [] });
  const msg = P.createMessage('command', { name: 'profile.start', profileIds: ['p0000005'] });
  const res = await bridge.handleMessage(dev({ scopes: ['view'] }), msg);
  assert.equal(res.body.code, 'forbidden');
  assert.equal(host.state.profiles.get(5).status, 'stopped');
  assert.equal(host.state.activity.length, 1);
  assert.equal(host.state.activity[0].action, 'mobile.profile.start');
  assert.equal(host.state.activity[0].detail.code, 'forbidden');
  assert.equal(sent.filter((s) => s.msg.type === 'result').length, 1);
});

test('bridge: a suspended or deleted member answers nothing', async () => {
  const host = createTestHost({ members: [{ id: 2, name: 'Ali', role: 'OPERATOR', status: 'suspended' }], profiles: [{ id: 5, title: 'A', memberId: 2 }] });
  const { bridge } = bridgeFor({ host, devices: [] });
  const r1 = await bridge.handleMessage(dev(), P.createMessage('command', { name: 'profile.start', profileIds: ['p0000005'] }));
  assert.equal(r1.body.code, 'forbidden');
  const r2 = await bridge.handleMessage(dev({ memberId: 99 }), P.createMessage('command', { name: 'state.request' }));
  assert.equal(r2.body.code, 'forbidden');
  assert.equal(host.state.profiles.get(5).status, 'stopped');
});

test('bridge: a phone paired in single-user mode acts as the first Owner once a team exists', async () => {
  const host = createTestHost({ members: [{ id: 1, name: 'Boss', role: 'OWNER' }], profiles: [{ id: 5, title: 'A', memberId: 3 }] });
  const { bridge } = bridgeFor({ host, devices: [] });
  const r = await bridge.handleMessage(dev({ memberId: null }), P.createMessage('command', { name: 'profile.start', profileIds: ['p0000005'] }));
  assert.equal(r.body.ok, true);
  assert.deepEqual(host.state.actedAs, [1]);
});

test('bridge: approval_request carries allowHour, redacted args and expiry; token member id and token name', () => {
  const host = createTestHost();
  const { bridge } = bridgeFor({ host, devices: [] });
  const a = host.approvalsManager.request({ tokenId: 1, tokenName: 'n8n', memberId: 4, memberName: 'Sara', clientName: 'n8n', tool: 'cookies_export', summary: 'Export cookies', args: { profileId: 3, cookie: 'secret', nested: { apiKey: 'k' } }, allowHour: false });
  const msg = bridge.approvalMessage(host.approvalsManager.publicView(a));
  assert.equal(msg.type, 'approval_request');
  assert.equal(msg.body.allowHour, false);
  assert.equal(msg.body.args.cookie, '••••');
  assert.ok(!JSON.stringify(msg.body.args).includes('"k"'));
  assert.equal(msg.body.memberName, 'Sara');
  assert.equal(msg.body.expiresAt, a.expiresAt);
  assert.equal(msg.body.tokenMemberId, '4');
  assert.equal(msg.body.tokenName, 'n8n');
  host.approvalsManager.cancelAll();
});

test('bridge: approval answers map to ApprovalManager decisions and are checked against canAnswerApproval', async () => {
  const host = createTestHost({ members: [{ id: 1, name: 'Boss', role: 'OWNER' }, { id: 2, name: 'Ali', role: 'OPERATOR' }, { id: 3, name: 'Sam', role: 'ADMIN' }] });
  const { bridge } = bridgeFor({ host, devices: [] });
  const mine = host.approvalsManager.request({ tokenId: 1, memberId: 2, tool: 't', allowHour: false });
  const r1 = await bridge.handleMessage(dev(), P.createMessage('command', { name: 'approval.answer', approvalId: mine.id, decision: 'allow_1h' }));
  assert.equal(r1.body.ok, true);
  assert.equal(r1.body.data.decision, 'allow-once', 'no hour where the request does not allow it');
  const other = host.approvalsManager.request({ tokenId: 2, memberId: 1, tool: 't' });
  const r2 = await bridge.handleMessage(dev(), P.createMessage('command', { name: 'approval.answer', approvalId: other.id, decision: 'deny' }));
  assert.equal(r2.body.code, 'forbidden');
  const r3 = await bridge.handleMessage(dev({ memberId: 3 }), P.createMessage('command', { name: 'approval.answer', approvalId: other.id, decision: 'deny' }));
  assert.equal(r3.body.ok, true, 'an Admin answers any approval');
  assert.equal((await other.promise).decision, 'deny');
  const r4 = await bridge.handleMessage(dev({ memberId: 3 }), P.createMessage('command', { name: 'approval.answer', approvalId: other.id, decision: 'deny' }));
  assert.equal(r4.body.code, 'expired');
});

test('bridge: approvals reach only phones with approve_ai whose member may answer, sealed with push', async () => {
  const host = createTestHost({ members: [{ id: 1, name: 'Boss', role: 'OWNER' }, { id: 2, name: 'Ali', role: 'OPERATOR' }] });
  const devices = [
    dev({ deviceId: 'owner', memberId: 1 }),
    dev({ deviceId: 'ali', memberId: 2 }),
    dev({ deviceId: 'viewonly', memberId: 1, scopes: ['view'] })
  ];
  const { bridge, sent } = bridgeFor({ host, devices });
  const a = host.approvalsManager.request({ tokenId: 1, memberId: 1, tool: 't' });
  const to = await bridge.onApprovalRequested(host.approvalsManager.publicView(a));
  assert.deepEqual(to, ['owner']);
  assert.equal(sent[0].opts.push, 'approval');
  bridge.dispose();
  host.approvalsManager.cancelAll();
});

test('bridge: a large workspace is sent as a snapshot plus patches that each fit one envelope', async () => {
  const profiles = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, title: `Profile with a fairly long name number ${i + 1}`, group: 'Group A', tags: ['one', 'two'], proxyCountry: 'US', memberId: 1 }));
  const host = createTestHost({ profiles });
  const { bridge, sent } = bridgeFor({ host, devices: [] });
  await bridge.sendSnapshot(dev({ memberId: null }));
  assert.equal(sent[0].msg.type, 'state.snapshot');
  assert.ok(sent.length > 2);
  let total = 0;
  let rev = sent[0].msg.body.rev;
  total += sent[0].msg.body.profiles.length;
  for (const s of sent.slice(1)) {
    assert.equal(s.msg.type, 'state.patch');
    assert.equal(s.msg.body.baseRev, rev);
    rev = s.msg.body.rev;
    total += s.msg.body.upsert.length;
  }
  assert.equal(total, 1200);
  for (const s of sent) assert.doesNotThrow(() => P.encodeMessage(s.msg), 'fits the 32 KiB plaintext limit');
  // Nothing changed: no patch. One profile starts: one small patch.
  sent.length = 0;
  assert.equal(await bridge.sendPatch(dev({ memberId: null })), false);
  host.state.profiles.get(7).status = 'running';
  await bridge.sendPatch(dev({ memberId: null }));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].msg.body.upsert.map((p) => p.id), ['p0000007']);
  assert.ok(chunkSummaries([summaryOf({ id: 1, title: 'x' })]).length === 1);
});

// ---- relay client against an in-process relay stub ----
function startStubRelay(t) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const state = { conns: [], frames: [], authOk: 0 };
  wss.on('connection', (ws) => {
    state.conns.push(ws);
    const nonce = crypto.randomBytes(16).toString('base64url');
    ws.send(JSON.stringify({ t: 'challenge', v: 1, nonce }));
    ws.on('message', (d) => {
      const f = JSON.parse(String(d));
      state.frames.push(f);
      if (f.t === 'auth') {
        const ok = P.verify(P.fromBase64Url(f.sig), P.authPayload(nonce, f.mailbox, f.role, '127.0.0.1'), P.fromBase64Url(f.pub)) && P.mailboxIdFromSignKey(P.fromBase64Url(f.pub)) === f.mailbox;
        if (!ok) { ws.close(4001); return; }
        state.authOk++;
        ws.send(JSON.stringify({ t: 'ready', mailbox: f.mailbox, queued: 1 }));
        ws.send(JSON.stringify({ t: 'msg', qid: 'q1', from: 'x'.repeat(22), env: 'AQID', ts: Date.now() }));
      }
      if (f.t === 'send' && f.to !== 'silent'.padEnd(22, 'x')) ws.send(JSON.stringify({ t: 'ack', id: f.id, status: 'queued' }));
    });
  });
  t.after(() => new Promise((r) => wss.close(r)));
  return new Promise((resolve) => wss.on('listening', () => resolve({ wss, state, url: `ws://127.0.0.1:${wss.address().port}/v1` })));
}

function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => { if (fn()) return resolve(); if (Date.now() > end) return reject(new Error('timed out')); setTimeout(tick, 10); };
    tick();
  });
}

test('relay client: signed auth, got for every routed message, acks, reconnect after a drop', async (t) => {
  const stub = await startStubRelay(t);
  const identity = P.generateIdentity();
  const client = new RelayClient({ url: stub.url, host: '127.0.0.1', identity, backoffMinMs: 20, backoffMaxMs: 50, ackTimeoutMs: 200 });
  t.after(() => client.stop());
  const msgs = [];
  client.on('msg', (f) => msgs.push(f));
  client.start();
  await until(() => client.ready);
  await until(() => stub.state.frames.some((f) => f.t === 'got' && f.qid === 'q1'));
  assert.equal(msgs.length, 1);
  const ack = await client.sendEnvelope('y'.repeat(22), new Uint8Array([1, 2, 3]), 'approval');
  assert.deepEqual(ack, { status: 'queued', reason: null });
  const sendFrame = stub.state.frames.find((f) => f.t === 'send');
  assert.equal(sendFrame.push, 'approval');
  assert.equal(sendFrame.env, 'AQID');
  const lost = await client.sendEnvelope('silent'.padEnd(22, 'x'), new Uint8Array([1]));
  assert.equal(lost.reason, 'timeout');
  // The relay drops the socket: the client comes back by itself.
  stub.state.conns[0].close(1001);
  await until(() => stub.state.authOk === 2);
  await until(() => client.ready);
  client.stop('quit');
  assert.equal(client.status().state, 'stopped');
});

test('relay client: not connected means rejected, never a throw', async () => {
  const client = new RelayClient({ url: 'ws://127.0.0.1:9/v1', host: '127.0.0.1', identity: P.generateIdentity() });
  assert.deepEqual(await client.sendEnvelope('y'.repeat(22), new Uint8Array([1])), { status: 'rejected', reason: 'offline' });
  assert.equal(client.link('y'.repeat(22)), false);
});

// ---- IPC member rules ----
test('who a phone may act as follows the AI token rule', async () => {
  const members = new Map([[1, { id: 1, role: 'OWNER', status: 'active' }], [2, { id: 2, role: 'ADMIN', status: 'active' }], [3, { id: 3, role: 'OPERATOR', status: 'active' }], [4, { id: 4, role: 'OPERATOR', status: 'suspended' }], [5, { id: 5, role: 'MANAGER', status: 'active' }]]);
  const host = {
    membersExist: async () => true,
    ownerId: async () => 1,
    getMember: async (id) => members.get(id) || null,
    visibleMemberIds: async (m) => (m.id === 2 ? new Set([2, 3, 4]) : new Set([m.id]))
  };
  const owner = members.get(1);
  const admin = members.get(2);
  assert.equal(await memberForPhone(owner, 3, host), 3);
  assert.equal(await memberForPhone(null, null, host), 1, 'single window user (owner) defaults to the Owner');
  assert.equal(await memberForPhone(admin, null, host), 2, 'defaults to yourself');
  assert.equal(await memberForPhone(admin, 3, host), 3);
  await assert.rejects(memberForPhone(admin, 1, host), /Owner/);
  await assert.rejects(memberForPhone(admin, 5, host), /members you manage/);
  await assert.rejects(memberForPhone(owner, 4, host), /suspended/);
  assert.equal(await memberForPhone(null, 3, { ...host, membersExist: async () => false }), null, 'single-user mode stores no member');
});

// ---- sync mapping ----
test('region settings map between the desktop editor and the sync payload', () => {
  const r = mapping.regionFromDesktop({ timezoneType: 'Custom', timezoneCustom: 'Asia/Karachi', languageType: 'Real', locationType: 'Custom', locationLat: '31.5', locationLng: '74.3', locationAcc: '50', webrtc: 'Disabled' });
  assert.deepEqual(r, { tzMode: 'manual', tz: 'Asia/Karachi', langMode: 'auto', geoMode: 'manual', geo: { lat: 31.5, lon: 74.3, accuracyM: 50 }, webrtcMode: 'disabled' });
  assert.deepEqual(mapping.regionFromDesktop({}), { tzMode: 'proxy', langMode: 'proxy', geoMode: 'proxy', webrtcMode: 'proxy' });
  assert.deepEqual(mapping.regionFromDesktop({ locationType: 'Block' }).geoMode, 'off');
  const back = mapping.regionToDesktop(r, {});
  assert.deepEqual(mapping.regionFromDesktop(back), r, 'round trip');
  assert.deepEqual(mapping.regionToDesktop({ tzMode: 'proxy', langMode: 'proxy', geoMode: 'proxy', webrtcMode: 'proxy' }, { timezoneType: 'Custom', webrtc: 'Replace' }), { timezoneType: null }, 'proxy resets a manual value and keeps the desktop WebRTC protection mode');
});

test('proxy without password unless opted in; cookies map both ways', () => {
  const proxy = { type: 'SOCKS5', host: 'h', port: 1080, username: 'u', password: 'p', countryCode: 'de' };
  assert.deepEqual(mapping.proxyFromDesktop(proxy, false), { type: 'socks5', host: 'h', port: 1080, username: 'u', countryCode: 'DE' });
  assert.equal(mapping.proxyFromDesktop(proxy, true).password, 'p');
  assert.equal(mapping.proxyFromDesktop(null, true), null);
  const cdp = { name: 'sid', value: 'v', domain: 'shop.example', path: '/a', expires: 1999999999.5, secure: true, httpOnly: true, sameSite: 'Strict' };
  const sc = mapping.cookieFromCdp(cdp);
  assert.deepEqual(sc, { name: 'sid', value: 'v', domain: 'shop.example', path: '/a', expires: 1999999999, secure: true, httpOnly: true, sameSite: 'strict', hostOnly: true });
  assert.deepEqual(mapping.cookieToCdp(sc), { name: 'sid', value: 'v', path: '/a', url: 'https://shop.example/a', secure: true, httpOnly: true, sameSite: 'Strict', expires: 1999999999 });
  const dom = mapping.cookieToCdp({ ...sc, domain: '.example', hostOnly: false, expires: null, sameSite: 'unspecified' });
  assert.equal(dom.domain, '.example');
  assert.equal('expires' in dom, false, 'a session cookie stays a session cookie');
  assert.equal(mapping.cookieFromCdp({ name: 'a', value: '', domain: 'x', expires: -1, session: true }).expires, null);
});

test('the pairing QR is an SVG with a white quiet zone', () => {
  const svg = qrSvg(`sgpair:1:${'A'.repeat(200)}`);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.ok(svg.length > 1000);
});

// ---- migration ----
test('the PairedDevice migration applies after every earlier migration', (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { t.skip('node:sqlite is not available'); return; }
  const dir = path.join(ROOT, 'prisma', 'migrations');
  const db = new DatabaseSync(':memory:');
  const strip = (sql) => sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const folder of fs.readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort()) {
    db.exec(strip(fs.readFileSync(path.join(dir, folder, 'migration.sql'), 'utf8')));
  }
  db.exec(`INSERT INTO "PairedDevice" ("deviceId","name","mailboxId","x25519Pub","ed25519Pub","keyId") VALUES ('dev_a','P','m1','x','e','k')`);
  const row = db.prepare('SELECT * FROM "PairedDevice"').get();
  assert.equal(row.scopesJson, '["view"]');
  assert.equal(row.memberId, null);
  assert.throws(() => db.exec(`INSERT INTO "PairedDevice" ("deviceId","name","mailboxId","x25519Pub","ed25519Pub","keyId") VALUES ('dev_b','P','m1','x','e','k')`), /UNIQUE/);
  const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  assert.match(schema, /model PairedDevice \{/);
});

// ---- preload, strings ----
test('the preload allows exactly the mobile channels main registers', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
  const block = /const MOBILE_CHANNELS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(preload);
  assert.ok(block);
  const fromPreload = Object.fromEntries([...block[1].matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(fromPreload, { ...MOBILE_CHANNELS });
  assert.match(preload, /for \(const channel of Object\.values\(MOBILE_CHANNELS\)\) ALLOWED_CHANNELS\.add\(channel\);/);
});

test('phone UI strings: English and Spanish have the same keys, plain words, no dashes', () => {
  const read = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', l, 'mobile.json'), 'utf8'));
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  const en = read('en');
  const es = read('es');
  assert.deepEqual(keys(es), keys(en));
  const values = (o) => Object.values(o).flatMap((v) => (v && typeof v === 'object' ? values(v) : [String(v)]));
  for (const s of [...values(en), ...values(es)]) {
    assert.doesNotMatch(s, /antidetect|undetectable|bypass|spoof|stealth/i, s);
    assert.doesNotMatch(s, /[‒-―]| - /, `dash in: ${s}`);
  }
});

test('the SoftGlaze web app pairs as a browser: kind from the web- app version, view and approve_ai ticked by default', async () => {
  const { deviceKind, defaultScopesFor } = require('../src/main/mobile/devices');
  assert.equal(deviceKind('web-1.2.0'), 'browser');
  assert.equal(deviceKind('1.0.0'), 'phone');
  assert.equal(deviceKind(null), 'phone');
  assert.deepEqual(defaultScopesFor('browser'), ['view', 'approve_ai']);
  assert.ok(defaultScopesFor('phone').includes('control_profiles'));
  const store = createMemoryDeviceStore();
  const { peer } = fakePeer('SoftGlaze web (Chrome on Windows)');
  peer.device = { name: 'SoftGlaze web (Chrome on Windows)', platform: 'windows', appVersion: 'web-1.0.0' };
  const d = await store.create(rowFromPairing({ peer, memberId: null, scopes: defaultScopesFor('browser') }));
  assert.equal(publicDevice(d).kind, 'browser');
  assert.deepEqual(d.scopes.sort(), ['approve_ai', 'view']);
});

test('bridge: state.request answers with the snapshot plus every pending approval this phone may answer', async () => {
  const host = createTestHost({ members: [{ id: 1, name: 'Boss', role: 'OWNER' }, { id: 2, name: 'Ali', role: 'OPERATOR' }] });
  const { bridge, sent } = bridgeFor({ host, devices: [] });
  const mine = host.approvalsManager.request({ tokenId: 1, tokenName: 'n8n', memberId: 2, tool: 't' });
  host.approvalsManager.request({ tokenId: 2, memberId: 1, tool: 'owner-only' });
  const r = await bridge.handleMessage(dev(), P.createMessage('command', { name: 'state.request' }));
  assert.equal(r.body.ok, true);
  assert.deepEqual(sent.map((s) => s.msg.type), ['state.snapshot', 'approval_request', 'result']);
  assert.equal(sent[1].msg.body.approvalId, mine.id);
  assert.equal(sent[1].msg.body.tokenName, 'n8n');
  bridge.dispose();
  host.approvalsManager.cancelAll();
});

test('bridge: an approval that ends goes again with resolution and the silent push update, only to the devices that got it', async () => {
  const host = createTestHost({ members: [{ id: 1, name: 'Boss', role: 'OWNER' }, { id: 2, name: 'Ali', role: 'OPERATOR' }] });
  const devices = [dev({ deviceId: 'owner', memberId: 1 }), dev({ deviceId: 'ali', memberId: 2 })];
  const { bridge, sent } = bridgeFor({ host, devices });
  const resolvedEvent = (id) => host.state.approvalEvents.find((e) => e.ch === 'ai:approval-resolved' && e.data.id === id);

  // Answered on the PC (or the web app): the owner's phone got it, so only the owner's phone gets the end.
  const a = host.approvalsManager.request({ tokenId: 1, memberId: 1, tool: 'profiles_start', summary: 'Start Shop US' });
  assert.deepEqual(await bridge.onApprovalRequested(host.approvalsManager.publicView(a)), ['owner']);
  const before = Date.now();
  host.approvalsManager.respond(a.id, 'allow-once');
  assert.deepEqual(resolvedEvent(a.id).data, { id: a.id, decision: 'allow-once' });
  assert.deepEqual(await bridge.onApprovalResolved(resolvedEvent(a.id).data), ['owner']);
  const end = sent.at(-1);
  assert.equal(end.msg.type, 'approval_request');
  assert.equal(end.msg.body.approvalId, a.id);
  assert.equal(end.msg.body.resolution, 'approved');
  assert.ok(end.msg.body.expiresAt >= before && end.msg.body.expiresAt <= Date.now(), 'expiresAt is the end time (older phones show it as expired)');
  assert.equal(end.opts.push, 'update');
  assert.deepEqual(await bridge.onApprovalResolved(resolvedEvent(a.id).data), [], 'sent once');

  // Timed out -> expired; Stop all AI (cancelled) -> denied; state.request resends count as targets.
  const b = host.approvalsManager.request({ tokenId: 1, memberId: 2, tool: 't' });
  await bridge.handleMessage(devices[1], P.createMessage('command', { name: 'state.request' }));
  assert.deepEqual(await bridge.onApprovalResolved({ id: b.id, decision: 'timeout' }), ['ali']);
  assert.equal(sent.at(-1).msg.body.resolution, 'expired');
  const c = host.approvalsManager.request({ tokenId: 1, memberId: 1, tool: 't' });
  await bridge.onApprovalRequested(host.approvalsManager.publicView(c));
  assert.deepEqual(await bridge.onApprovalResolved({ id: c.id, decision: 'cancelled' }), ['owner']);
  assert.equal(sent.at(-1).msg.body.resolution, 'denied');
  bridge.dispose();
  host.approvalsManager.cancelAll();
});

test('bridge: an approval answered while it was still being sent: the late device gets the end right after it', async () => {
  const host = createTestHost({ members: [{ id: 1, name: 'Boss', role: 'OWNER' }] });
  const { bridge, sent } = bridgeFor({ host, devices: [dev({ deviceId: 'owner', memberId: 1 })] });
  const a = host.approvalsManager.request({ tokenId: 1, memberId: 1, tool: 't' });
  const view = host.approvalsManager.publicView(a);
  host.approvalsManager.respond(a.id, 'deny');
  assert.deepEqual(await bridge.onApprovalResolved({ id: a.id, decision: 'deny' }), [], 'nobody had it yet');
  await bridge.onApprovalRequested(view);
  assert.deepEqual(sent.map((s) => [s.msg.body.resolution || 'pending', s.opts.push]), [['pending', 'approval'], ['denied', 'update']]);
  bridge.dispose();
});

test('activity log: a web browser device says "via browser", a phone "via phone"', () => {
  const actor = require('../src/main/ai/actor');
  actor.run({ memberId: 1, clientName: 'SoftGlaze web (Chrome on Windows)', via: 'mobile', deviceKind: 'browser' }, () => {
    assert.equal(actor.label(), '[via browser: SoftGlaze web (Chrome on Windows)]');
  });
  actor.run({ memberId: 1, clientName: 'Pixel 9', via: 'mobile', deviceKind: 'phone' }, () => assert.equal(actor.label(), '[via phone: Pixel 9]'));
  actor.run({ memberId: 1, clientName: 'Pixel 9', via: 'mobile' }, () => assert.equal(actor.label(), '[via phone: Pixel 9]'));
  const ipc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
  assert.match(ipc, /via: 'mobile', deviceKind: mobileDeviceKind\(device\)/, 'runAs tells the actor which kind of device acts');
  assert.match(ipc, /via: `\[via \$\{kind\}: /, 'the bridge activity row uses the device kind');
  assert.doesNotMatch(ipc, /\[via phone: \$\{/, 'no hard coded "via phone" left');
});

test('ApprovalManager: every end emits ai:approval-resolved (main process only, never sent to windows)', () => {
  const host = createTestHost();
  const m = host.approvalsManager;
  const a = m.request({ tokenId: 1, tool: 't' });
  m.respond(a.id, 'allow-hour');
  const b = m.request({ tokenId: 1, tool: 't' });
  m.cancelAll();
  assert.deepEqual(host.state.approvalEvents.filter((e) => e.ch === 'ai:approval-resolved').map((e) => e.data), [
    { id: a.id, decision: 'allow-hour' },
    { id: b.id, decision: 'cancelled' }
  ]);
  const aiIndex = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ai', 'index.js'), 'utf8');
  assert.match(aiIndex, /MAIN_ONLY_EVENTS = new Set\(\['ai:approval-resolved'\]\)/);
  const mobileIndex = fs.readFileSync(path.join(ROOT, 'src', 'main', 'mobile', 'index.js'), 'utf8');
  assert.match(mobileIndex, /channel === 'ai:approval-resolved'\) state\.companion\.onApprovalResolved\(data\)/);
});

test('dev server: the downloaded browser folders (./chrome, ./firefox) are not watched', async () => {
  const { pathToFileURL } = require('node:url');
  const cfg = (await import(pathToFileURL(path.join(ROOT, 'vite.config.mjs')).href)).default;
  const ignored = cfg.server.watch.ignored;
  assert.equal(typeof ignored, 'function');
  for (const p of ['chrome', 'firefox', path.join(process.cwd(), 'firefox', 'xul.dll'), path.join(process.cwd(), 'chrome', 'win64-131', 'chrome.exe'), 'Firefox/x']) assert.equal(ignored(p), true, p);
  for (const p of [path.join(process.cwd(), 'src', 'renderer', 'chrome', 'x.js'), path.join(process.cwd(), 'src', 'main', 'firefox.js'), 'chromeX', path.join(process.cwd(), 'index.html')]) assert.equal(ignored(p), false, p);
});
