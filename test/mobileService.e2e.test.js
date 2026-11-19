'use strict';
// The app-level service (src/main/mobile/index.js) as ipcHandlers wires it, with the Prisma device
// store over the in-memory fake Prisma, sealed settings, and the real local relay through
// SG_RELAY_URL: turn on, pair from the QR, confirm, see the phone listed, approval from the AI
// engine's event hook, revoke, and turn off. Skipped without the SoftGlaze-Mobile relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { P } = require('../src/main/mobile/protocol');
const { createFakePrisma } = require('./helpers/fakePrisma');
const { createTestHost, createTestSyncHost } = require('./helpers/mobileHost');
const { TestPhone, startLocalRelay, relayAvailable } = require('./helpers/mobilePhone');

const skip = relayAvailable() ? false : 'SoftGlaze-Mobile relay not found (set SG_MOBILE_REPO)';

function waitFor(fn, ms = 5000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let v;
      try { v = await fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() > until) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('the phone companion service: on, pair, approve, revoke, off', { skip, timeout: 60_000 }, async (t) => {
  const relay = await startLocalRelay();
  t.after(() => relay.stop());
  const prevUrl = process.env.SG_RELAY_URL;
  process.env.SG_RELAY_URL = relay.url;
  t.after(() => { if (prevUrl === undefined) delete process.env.SG_RELAY_URL; else process.env.SG_RELAY_URL = prevUrl; });

  const mobile = require('../src/main/mobile');
  const db = createFakePrisma();
  const settings = new Map();
  const events = [];
  const host = createTestHost({ profiles: [{ id: 3, title: 'Store' }] });
  mobile.configure({
    getPrisma: () => db,
    readSetting: async (k, f) => (settings.has(k) ? JSON.parse(settings.get(k)) : f),
    writeSetting: async (k, v) => { settings.set(k, JSON.stringify(v)); },
    seal: (s) => `enc:v1:${Buffer.from(s).toString('base64')}`,
    open: (s) => Buffer.from(String(s).slice(7), 'base64').toString(),
    emit: (ch, data) => events.push({ ch, data }),
    appVersion: '1.0.27',
    bridge: host,
    sync: { ...createTestSyncHost(), closeProfile: async () => {} }
  });
  t.after(() => mobile.shutdown());

  await mobile.start();
  assert.equal(mobile.isRunning(), false, 'off by default');
  let st = await mobile.status();
  assert.equal(st.enabled, false);
  assert.equal(st.relayUrl, relay.url);

  st = await mobile.setEnabled(true);
  assert.equal(mobile.isRunning(), true);
  const identityRow = JSON.parse(settings.get('mobileIdentity'));
  assert.ok(identityRow.sealed.startsWith('enc:v1:'), 'PC keys stored sealed');
  await waitFor(async () => (await mobile.status()).relay.state === 'ready');

  const pairing = await mobile.startPairing();
  assert.match(pairing.qrImage, /^data:image\/svg\+xml;base64,/);
  const phone = new TestPhone({ url: relay.url, name: 'Owner Phone' });
  t.after(() => phone.close());
  await phone.connect();
  const sas = await phone.pair(pairing.qrText);
  st = await waitFor(async () => { const s = await mobile.status(); return s.pairing && s.pairing.stage === 'confirm' ? s : null; });
  assert.equal(st.pairing.sas, sas);
  assert.equal(st.pairing.qrImage, undefined, 'the QR is gone once a phone answered');
  phone.link();
  const device = await mobile.confirmPairing({ pairingId: st.pairing.pairingId, memberId: null, scopes: ['view', 'approve_ai'] });
  assert.equal(db._tables.pairedDevice.length, 1);
  assert.equal(db._tables.pairedDevice[0].mailboxId, phone.identity.mailboxId);
  await phone.waitMessage((m) => m.type === 'hello');
  const snap = await phone.waitMessage((m) => m.type === 'state.snapshot');
  assert.deepEqual(snap.body.profiles.map((p) => p.title), ['Store']);
  st = await mobile.status();
  assert.equal(st.devices.length, 1);
  assert.equal(st.devices[0].name, 'Owner Phone');
  assert.ok(events.some((e) => e.ch === 'mobile:changed'));

  // The AI engine's approval event reaches the phone; the answer goes back through the manager.
  const a = host.approvalsManager.request({ tokenId: 1, memberId: null, tool: 'profiles_start', summary: 'Start Store', allowHour: true });
  mobile.onApprovalEvent('ai:approval-requested', host.approvalsManager.publicView(a));
  const req = await phone.waitMessage((m) => m.type === 'approval_request');
  assert.equal(req.body.approvalId, a.id);
  const cmd = await phone.command({ name: 'approval.answer', approvalId: a.id, decision: 'deny' });
  assert.equal((await phone.result(cmd)).body.ok, true);
  assert.equal((await a.promise).decision, 'deny');

  // Revoke: gone from the store and from the relay.
  await mobile.revokeDevice(device.deviceId);
  await phone.waitFrame((f) => f.t === 'revoked');
  assert.equal(db._tables.pairedDevice.length, 0);

  await mobile.setEnabled(false);
  assert.equal(mobile.isRunning(), false);
  // Turning it on again keeps the same PC keys (phones paired before keep working).
  await mobile.setEnabled(true);
  const again = P.importIdentity(JSON.parse(Buffer.from(JSON.parse(settings.get('mobileIdentity')).sealed.slice(7), 'base64').toString()));
  assert.equal(again.mailboxId, identityRow.mailboxId);
  await mobile.setEnabled(false);
});
