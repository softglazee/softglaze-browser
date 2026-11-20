'use strict';
// End to end: the real relay (SoftGlaze-Mobile/relay, as a child process), the desktop companion
// (src/main/mobile) and a phone built only from @softglaze/protocol. Pairing with the 6-digit code,
// link, hello with scopes, state snapshot, a profile command, an AI approval round trip through
// ApprovalManager, a refused command, reconnect with a new Noise IK session, and revoke.
// Skipped when the SoftGlaze-Mobile repository (relay dist + node_modules) is not on this PC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { P } = require('../src/main/mobile/protocol');
const { RelayClient } = require('../src/main/mobile/relayClient');
const { MobileCompanion } = require('../src/main/mobile/companion');
const { createMemoryDeviceStore } = require('../src/main/mobile/devices');
const { TestPhone, startLocalRelay, relayAvailable } = require('./helpers/mobilePhone');
const { createTestHost } = require('./helpers/mobileHost');

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

test('phone companion end to end through the local relay', { skip, timeout: 60_000 }, async (t) => {
  const relay = await startLocalRelay();
  t.after(() => relay.stop());

  const host = createTestHost({
    members: [{ id: 1, name: 'Owner', role: 'OWNER' }, { id: 2, name: 'Ali', role: 'OPERATOR' }],
    profiles: [
      { id: 11, title: 'Shop main', memberId: 1, group: 'Shops', tags: ['priority'], proxyCountry: 'DE' },
      { id: 12, title: 'Ali profile', memberId: 2 },
      { id: 13, title: 'Owner only', memberId: 1 }
    ]
  });
  const identity = P.generateIdentity();
  const store = createMemoryDeviceStore();
  const relayClient = new RelayClient({ url: relay.url, host: relay.host, identity, backoffMinMs: 100, backoffMaxMs: 500 });
  const pc = new MobileCompanion({ identity, relay: relayClient, relayUrl: relay.url, store, host });
  t.after(() => pc.stop('quit'));
  pc.start();
  await waitFor(() => relayClient.ready);

  // ---- pairing ----
  const offer = pc.startPairing();
  assert.match(offer.qrText, /^sgpair:1:/);
  assert.equal(offer.stage, 'open');
  const phone = new TestPhone({ url: relay.url, name: 'Ali Pixel' });
  t.after(() => phone.close());
  assert.equal((await phone.connect()).t, 'ready');
  const phoneSas = await phone.pair(offer.qrText);
  const confirmView = await waitFor(() => (pc.pairingView() && pc.pairingView().stage === 'confirm' ? pc.pairingView() : null));
  assert.equal(confirmView.sas, phoneSas, 'both screens show the same 6 digits');
  assert.equal(confirmView.phone.name, 'Ali Pixel');
  assert.equal(await store.list().then((l) => l.length), 0, 'nothing stored before the user confirms');

  // The phone links right away; hello must not arrive before the PC user confirmed.
  phone.link();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(phone.messages.length, 0, 'no hello before confirmation');

  const device = await pc.confirmPairing({ pairingId: confirmView.pairingId, memberId: 2, scopes: ['view', 'control_profiles', 'approve_ai'] });
  assert.equal(device.memberId, 2);
  assert.ok(!('x25519Pub' in device), 'renderer view carries no keys');
  const hello = await phone.waitMessage((m) => m.type === 'hello');
  assert.equal(hello.body.deviceId, device.deviceId);
  assert.deepEqual(hello.body.scopes.sort(), ['approve_ai', 'control_profiles', 'view']);
  const snap = await phone.waitMessage((m) => m.type === 'state.snapshot');
  assert.equal(snap.body.pcName, 'OFFICE-PC');
  assert.deepEqual(snap.body.profiles.map((p) => p.id), ['p0000012'], 'an Operator sees only their own profiles');
  assert.equal(pc.pairingView(), null, 'the offer is gone after pairing');

  // ---- command: start a profile ----
  const start = await phone.command({ name: 'profile.start', profileIds: ['p0000012'] });
  assert.equal(start.ack.status, 'delivered');
  const r1 = await phone.result(start);
  assert.equal(r1.body.ok, true);
  assert.equal(host.state.profiles.get(12).status, 'running');
  const patch = await phone.waitMessage((m) => m.type === 'state.patch' && m.body.upsert && m.body.upsert.some((p) => p.status === 'running'));
  assert.equal(patch.body.baseRev, snap.body.rev);

  // Another member's profile is refused by the app's own access check.
  const other = await phone.command({ name: 'profile.start', profileIds: ['p0000011'] });
  const r2 = await phone.result(other);
  assert.equal(r2.body.ok, false);
  assert.equal(r2.body.code, 'forbidden');
  assert.equal(host.state.profiles.get(11).status, 'stopped');

  // A scope the phone does not have.
  const totp = await phone.command({ name: 'totp.request', entryId: 'totp_000001' });
  assert.equal((await phone.result(totp)).body.code, 'forbidden');

  // ---- AI approval round trip ----
  const approval = host.approvalsManager.request({ tokenId: 7, tokenName: 'Claude token', memberId: 2, memberName: 'Ali', clientName: 'Claude Desktop', tool: 'profiles_start', summary: 'Start profile Ali profile', args: { profileId: 12, password: 'hunter2' }, allowHour: true });
  await pc.onApprovalRequested(host.approvalsManager.publicView(approval));
  const req = await phone.waitMessage((m) => m.type === 'approval_request');
  assert.equal(req.sealed, true, 'approvals travel sealed (push-capable)');
  assert.equal(req.body.approvalId, approval.id);
  assert.equal(req.body.allowHour, true);
  assert.equal(req.body.clientName, 'Claude Desktop');
  assert.equal(req.body.args.password, '••••', 'arguments are redacted again before they leave the PC');
  const answer = await phone.command({ name: 'approval.answer', approvalId: approval.id, decision: 'allow_1h' });
  const r3 = await phone.result(answer);
  assert.equal(r3.body.ok, true);
  assert.equal((await approval.promise).decision, 'allow-hour');
  assert.equal(host.approvalsManager.hasHourGrant(7, 'profiles_start'), true);

  // An approval for a token of another member never reaches this Operator's phone and cannot be answered.
  const foreign = host.approvalsManager.request({ tokenId: 8, memberId: 1, tool: 'profiles_delete', allowHour: false });
  const sentTo = await pc.onApprovalRequested(host.approvalsManager.publicView(foreign));
  assert.deepEqual(sentTo, []);
  const sneaky = await phone.command({ name: 'approval.answer', approvalId: foreign.id, decision: 'allow_once' });
  assert.equal((await phone.result(sneaky)).body.code, 'forbidden');
  assert.equal(host.approvalsManager.pendingCount(), 1);
  host.approvalsManager.respond(foreign.id, 'deny');

  // Every command wrote exactly one ActivityLog row with the device id.
  const cmdRows = host.state.activity.filter((a) => a.action.startsWith('mobile.') && a.action !== 'mobile.paired');
  assert.equal(cmdRows.length, 5);
  for (const row of cmdRows) assert.equal(row.detail.deviceId, device.deviceId);

  // ---- replay of a command envelope is refused ----
  const replayMsg = P.createMessage('command', { name: 'profile.stop', profileIds: ['p0000012'] });
  const env = phone.session.seal(replayMsg);
  await phone.sendEnv(env);
  await phone.waitMessage((m) => m.type === 'result' && m.body.re === replayMsg.id);
  assert.equal(host.state.profiles.get(12).status, 'stopped');
  host.state.profiles.get(12).status = 'running';
  await phone.sendEnv(env); // same envelope again
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(host.state.profiles.get(12).status, 'running', 'the replayed stop did nothing');

  // ---- reconnect: new Noise IK session, hello + snapshot again ----
  await phone.close();
  await waitFor(() => pc.online.get(phone.identity.mailboxId) === false);
  assert.equal((await phone.connect()).t, 'ready');
  phone.messages.length = 0;
  await phone.openSession();
  await phone.waitMessage((m) => m.type === 'hello');
  const snap2 = await phone.waitMessage((m) => m.type === 'state.snapshot');
  assert.equal(snap2.body.profiles[0].status, 'running');
  const req2 = await phone.command({ name: 'state.request' });
  assert.equal((await phone.result(req2)).body.ok, true);

  // A sealed command (no session) works too.
  const sealedCmd = await phone.command({ name: 'profile.stop', profileIds: ['p0000012'] }, { sealed: true });
  assert.equal((await phone.result(sealedCmd)).body.ok, true);

  // ---- revoke on the PC ----
  await pc.revokeDevice(device.deviceId);
  await phone.waitFrame((f) => f.t === 'revoked');
  assert.equal((await store.list()).length, 0, 'the row is gone once the relay was told');
  const after = await phone.command({ name: 'state.request' });
  assert.equal(after.ack.status, 'rejected');
  assert.equal(after.ack.reason, 'not_linked');

  // The relay never saw plaintext.
  const log = relay.log.join('\n');
  for (const secret of ['Shop main', 'Ali profile', 'hunter2', 'Claude Desktop', identity.mailboxId]) assert.ok(!log.includes(secret), `relay log leaks ${secret}`);
});
