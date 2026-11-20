#!/usr/bin/env node
'use strict';
// The REAL desktop companion (src/main/mobile: RelayClient, MobileCompanion, MobileBridge,
// MobileSync) as a child process for the cross test with the phone app's own relay code
// (liveDesktop.cross.test.ts, run by the phone app's jest). In-memory profiles, members and the
// real ApprovalManager (test/helpers/mobileHost.js). JSON lines on stdin, one JSON answer per line.
const { createInterface } = require('node:readline');
const { P } = require('../../src/main/mobile/protocol');
const { RelayClient } = require('../../src/main/mobile/relayClient');
const { MobileCompanion } = require('../../src/main/mobile/companion');
const { createMemoryDeviceStore, publicDevice } = require('../../src/main/mobile/devices');
const { MobileSync, cachedStore } = require('../../src/main/mobile/sync/service');
const { createDesktopSyncLocal } = require('../../src/main/mobile/sync/local');
const { createTestHost, createTestSyncHost } = require('../helpers/mobileHost');

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const log = [];
const state = { pc: null, host: null, syncHost: null, sync: null, store: null, autoConfirm: false, scopes: null, answers: [], keyring: null, enabled: new Set() };

function start({ relayUrl, host }) {
  const identity = P.generateIdentity();
  state.host = createTestHost({
    profiles: [
      { id: 11, title: 'Shop US', group: 'Stores', proxyCountry: 'US', tags: ['shop'], status: 'running' },
      { id: 12, title: 'Support DE', group: 'Support', proxyCountry: 'DE' },
      { id: 13, title: 'Research' }
    ]
  });
  state.syncHost = createTestSyncHost({ profiles: [{ id: 11, title: 'Shop US', notes: 'Main shop', folder: 'Stores' }] });
  state.sync = new MobileSync({
    identity,
    relayUrl,
    relayHost: host,
    keyring: { load: () => state.keyring, save: (s) => { state.keyring = JSON.parse(JSON.stringify(s)); } },
    state: cachedStore(null, async () => {}),
    local: createDesktopSyncLocal(state.syncHost),
    settings: { enabled: () => [...state.enabled], pcName: () => 'OFFICE-PC' },
    host: { closeProfile: async () => {}, notify: () => {} }
  });
  state.store = createMemoryDeviceStore();
  const relay = new RelayClient({ url: relayUrl, host, identity, backoffMinMs: 200, backoffMaxMs: 1000 });
  state.pc = new MobileCompanion({ identity, relay, relayUrl, store: state.store, host: state.host, sync: state.sync, log: (...a) => log.push(a.join(' ')) });
  state.pc.on('changed', (d) => {
    if (d.what !== 'pairing') return;
    const v = state.pc.pairingView();
    if (v && v.stage === 'confirm') state.lastSas = v.sas;
    if (v && v.stage === 'confirm' && state.autoConfirm) {
      state.pc.confirmPairing({ pairingId: v.pairingId, memberId: null, scopes: state.scopes || P.OWNER_DEFAULT_SCOPES }).catch((e) => log.push(`confirm failed ${e.message}`));
    }
  });
  // Like src/main/mobile/index.js onApprovalEvent: the end of an approval goes to the devices that got it.
  state.host.state.onApprovalEvent = (ch, data) => {
    if (ch === 'ai:approval-resolved') state.pc.onApprovalResolved(data).catch((e) => log.push(`resolved failed ${e.message}`));
  };
  state.pc.start();
  return { pc: { mailbox: identity.mailboxId, dhPub: P.toBase64Url(identity.dh.publicKey), signPub: P.toBase64Url(identity.sign.publicKey) } };
}

async function handle(m) {
  switch (m.cmd) {
    case 'start': {
      const r = start(m);
      const until = Date.now() + 10000;
      while (!state.pc.relay.ready && Date.now() < until) await new Promise((res) => setTimeout(res, 25));
      return { ok: state.pc.relay.ready, ...r };
    }
    case 'pairOffer':
      state.autoConfirm = m.autoConfirm !== false;
      state.scopes = m.scopes || null;
      return { ok: true, ...state.pc.startPairing() };
    case 'pairState':
      return { ok: true, pairing: state.pc.pairingView(), lastSas: state.lastSas };
    case 'devices':
      return { ok: true, devices: (await state.store.list()).map((d) => ({ ...publicDevice(d), online: state.pc.online.get(d.mailboxId) === true, live: state.pc.sessions.has(d.mailboxId) })) };
    case 'approval': {
      const a = state.host.approvalsManager.request({
        tokenId: 7, tokenName: m.tokenName || 'Claude token', memberId: null, memberName: 'Owner', clientName: m.clientName || 'Claude Desktop',
        tool: m.tool || 'profiles_start', summary: m.summary || 'Start Shop US', args: { profileId: 11 }, allowHour: m.allowHour !== false
      });
      a.promise.then((r) => state.answers.push({ approvalId: a.id, decision: r.decision }));
      const sentTo = await state.pc.onApprovalRequested(state.host.approvalsManager.publicView(a));
      return { ok: true, approvalId: a.id, sentTo };
    }
    case 'respond':
      // Answered on the PC (or the web app): ApprovalManager.respond, as the approval dialog does.
      return { ok: true, ...state.host.approvalsManager.respond(m.approvalId, m.decision) };
    case 'answers':
      return { ok: true, answers: state.answers, pending: state.host.approvalsManager.pendingCount() };
    case 'profiles':
      return { ok: true, profiles: [...state.host.state.profiles.values()].map((p) => ({ id: p.id, status: p.status })) };
    case 'activity':
      return { ok: true, activity: state.host.state.activity.map((a) => ({ action: a.action, code: a.detail && a.detail.code })) };
    case 'revoke':
      return { ok: true, ...(await state.pc.revokeDevice(m.deviceId)) };
    case 'enableSync':
      state.enabled.add(m.id);
      await state.sync.onDevicesChanged(await state.store.active());
      await state.sync.enableProfile(m.id);
      return { ok: true };
    case 'sync':
      return { ok: true, report: await state.sync.syncAll() };
    case 'syncProfile':
      return { ok: true, profile: await state.syncHost.readProfile(m.id) };
    case 'log':
      return { ok: true, log };
    default:
      return { ok: false, error: `unknown ${m.cmd}` };
  }
}

out({ ready: true });
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  chain = chain.then(async () => {
    const m = JSON.parse(line);
    if (m.cmd === 'quit') { try { state.pc && state.pc.stop('quit'); state.sync && state.sync.stop(); } catch (e) { /* closing */ } out({ seq: m.seq, ok: true }); setTimeout(() => process.exit(0), 50); return; }
    try { out({ seq: m.seq, ...(await handle(m)) }); } catch (e) { out({ seq: m.seq, ok: false, error: String((e && e.message) || e) }); }
  });
});
