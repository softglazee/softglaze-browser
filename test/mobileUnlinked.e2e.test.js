'use strict';
// A phone that unpaired itself while the PC was offline: its sealed revoke was purged with the
// relay queue on `unlink`, so the PC only learns it from a send acked `rejected: not_linked`
// (LIVE-COMPANION.md 3.5). The PC must then forget the phone.
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

test('a not_linked ack means the phone unpaired itself: the PC forgets it', { skip, timeout: 60_000 }, async (t) => {
  const relay = await startLocalRelay();
  t.after(() => relay.stop());
  const identity = P.generateIdentity();
  const store = createMemoryDeviceStore();
  const host = createTestHost();
  const make = () => new MobileCompanion({ identity, relay: new RelayClient({ url: relay.url, host: relay.host, identity, backoffMinMs: 100, backoffMaxMs: 300 }), relayUrl: relay.url, store, host });

  let pc = make();
  pc.start();
  await waitFor(() => pc.relay.ready);
  const phone = new TestPhone({ url: relay.url });
  t.after(() => phone.close());
  await phone.connect();
  const sas = await phone.pair(pc.startPairing().qrText);
  const view = await waitFor(() => (pc.pairingView() && pc.pairingView().stage === 'confirm' ? pc.pairingView() : null));
  assert.equal(view.sas, sas);
  phone.link();
  await pc.confirmPairing({ pairingId: view.pairingId, memberId: null, scopes: ['view', 'approve_ai'] });
  await phone.waitMessage((m) => m.type === 'hello');

  // The PC goes offline; the phone unpairs (unlink) meanwhile.
  pc.stop('sleep');
  await new Promise((r) => setTimeout(r, 200));
  phone.send({ t: 'unlink', peer: identity.mailboxId });
  await new Promise((r) => setTimeout(r, 200));

  // The PC is back; the next approval to that phone is refused by the relay.
  pc = make();
  t.after(() => pc.stop('quit'));
  pc.start();
  await waitFor(() => pc.relay.ready);
  assert.equal((await store.list()).length, 1);
  const a = host.approvalsManager.request({ tokenId: 1, memberId: null, tool: 't' });
  await pc.onApprovalRequested(host.approvalsManager.publicView(a));
  await waitFor(async () => (await store.list()).length === 0);
  assert.ok(host.state.activity.some((r) => r.action === 'mobile.revoked' && r.detail.reason === 'unpaired_on_phone'));
  host.approvalsManager.cancelAll();
});
