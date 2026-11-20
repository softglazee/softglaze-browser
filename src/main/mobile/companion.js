'use strict';
// The phone companion on the PC: pairing by QR, the relay connection, Noise sessions and sealed
// envelopes, and the bridge (state, commands, approvals). Transport and storage are injected, so the
// unit and end to end tests run it in plain Node against a real local relay.
//
// Pairing (PROTOCOL.md section 5): startPairing() opens a 5 minute single-use offer and returns the
// sgpair:1: text for the QR. The phone's PairInit arrives with the ticket; respond() gives the reply
// and the 6-digit code. Nothing about the phone is stored or trusted until the user confirms the
// codes match and picks the member and scopes (confirmPairing). Then: PairedDevice row, relay link,
// and once the link is active on both sides, hello {deviceId, scopes} and the state snapshot.
//
// Sessions (section 6): the phone opens a Noise IK session after every reconnect; acceptSession only
// accepts a pinned, not revoked key. Live state goes over the session; anything that must reach an
// offline phone (approvals, results, revoke) goes sealed to its pinned key, approvals with push.
const { EventEmitter } = require('node:events');
const { P } = require('./protocol');
const { rowFromPairing, publicDevice, deviceKind, defaultScopesFor } = require('./devices');
const { MobileBridge } = require('./bridge');

const PAIRING_TTL_MS = 5 * 60_000;
// Push kind for a message resent sealed after its session copy was queued.
const PUSH_FOR = Object.freeze({ approval_request: 'approval', alert: 'alert', revoke: 'security' });
const CONFIRM_TTL_MS = 5 * 60_000;

function errorWith(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

class MobileCompanion extends EventEmitter {
  // opts: { identity, relay (RelayClient), relayUrl, store (device store), host (bridge host),
  //         sync? ({ onDevicesChanged(devices), removeMember(device, remaining) }), now?, log? }
  constructor(opts) {
    super();
    this.identity = opts.identity;
    this.relay = opts.relay;
    this.relayUrl = opts.relayUrl;
    this.store = opts.store;
    this.host = opts.host;
    this.sync = opts.sync || null;
    this.now = opts.now || Date.now;
    this.log = opts.log || (() => {});
    this.seen = new P.SeenCache(); // one cache for every session and sealed message
    this.sessions = new Map(); // phone mailbox -> Session
    this.online = new Map(); // phone mailbox -> boolean (relay presence)
    this.awaitingLink = new Set(); // mailboxes paired but not yet linked on both sides
    this.offer = null; // { offer, pairingId, expiresAt, stage, sas?, peer?, session?, timer }
    this.bridge = new MobileBridge({
      host: { ...opts.host, updateDevice: (id, patch) => this.store.update(id, patch) },
      send: (device, msg, o) => this.sendTo(device, msg, o),
      isLive: (device) => this.isLive(device),
      devices: () => this.store.active(),
      now: this.now,
      log: this.log
    });
    this._wire();
  }

  _wire() {
    this.relay.on('ready', () => { this._onReady().catch((e) => this.log('ready handling failed', e && e.message)); });
    this.relay.on('state', (s) => this.emit('changed', { what: 'relay', relay: s }));
    this.relay.on('disconnected', () => { for (const s of this.sessions.values()) s.close(); this.sessions.clear(); this.online.clear(); });
    this.relay.on('msg', (f) => { this._onMsg(f).catch((e) => this.log('message failed', e && e.code ? e.code : e && e.message)); });
    this.relay.on('linked', (f) => { this._onLinked(f).catch(() => {}); });
    this.relay.on('revoked', (f) => { this._onPeerRevoked(f.peer, 'unpaired_on_phone').catch(() => {}); });
    this.relay.on('presence', (f) => {
      this.online.set(f.peer, Boolean(f.online));
      if (!f.online) { const s = this.sessions.get(f.peer); if (s) s.close(); this.sessions.delete(f.peer); }
      this.emit('changed', { what: 'presence' });
    });
  }

  start() { this.relay.start(); }

  stop(byeReason = 'quit') {
    if (this.offer) this.cancelPairing();
    this.bridge.dispose();
    this.relay.stop(byeReason);
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }

  isLive(device) {
    return this.relay.ready && this.sessions.has(device.mailboxId) && this.online.get(device.mailboxId) !== false;
  }

  async status() {
    const devices = await this.store.list();
    return {
      relay: this.relay.status(),
      mailboxId: this.identity.mailboxId,
      pairing: this.pairingView(),
      devices: devices.map((d) => ({ ...publicDevice(d), online: this.online.get(d.mailboxId) === true, live: this.sessions.has(d.mailboxId) }))
    };
  }

  // ---- relay connected ----
  async _onReady() {
    // Revocations made while offline: tell the relay now, then forget the row.
    for (const d of await this.store.revokedPending()) await this._finishRevoke(d);
    const active = await this.store.active();
    for (const d of active) this.relay.link(d.mailboxId);
    this.relay.presenceSub(active.map((d) => d.mailboxId));
    if (this.offer && this.offer.stage === 'open') this.relay.pairOpen(this.offer.pairingId, this.offer.expiresAt - this.now());
    this.emit('changed', { what: 'relay' });
  }

  // ---- pairing ----
  pairingView() {
    const o = this.offer;
    if (!o) return null;
    const v = { pairingId: o.pairingId, stage: o.stage, expiresAt: new Date(o.expiresAt).toISOString() };
    if (o.stage === 'open') v.qrText = o.qrText;
    if (o.stage === 'confirm') {
      const kind = deviceKind(o.peer.device.appVersion);
      v.sas = o.sas;
      v.phone = { name: o.peer.device.name, platform: o.peer.device.platform, appVersion: o.peer.device.appVersion, kind };
      v.defaultScopes = defaultScopesFor(kind);
    }
    if (o.error) v.error = o.error;
    return v;
  }

  startPairing() {
    if (!this.relay.ready) throw errorWith('RELAY_OFFLINE', 'Not connected to the SoftGlaze relay yet. Check the internet connection and try again.');
    if (this.offer) this.cancelPairing();
    const offer = P.PairingOffer.create({ relayUrl: this.relayUrl, identity: this.identity, now: this.now(), ttlMs: PAIRING_TTL_MS });
    const o = { offer, pairingId: offer.pairingIdB64, qrText: offer.qrText, expiresAt: offer.payload.expiresAt, stage: 'open', timer: null };
    o.timer = setTimeout(() => this._expireOffer(o), Math.max(1000, o.expiresAt - this.now()));
    if (o.timer.unref) o.timer.unref();
    this.offer = o;
    this.relay.pairOpen(o.pairingId, o.expiresAt - this.now());
    this.emit('changed', { what: 'pairing' });
    return this.pairingView();
  }

  _expireOffer(o) {
    if (this.offer !== o) return;
    try { o.offer.cancel(); } catch (e) { /* already burned */ }
    this.relay.pairClose(o.pairingId);
    if (o.session) o.session.close();
    this.offer = null;
    this.emit('changed', { what: 'pairing', expired: true });
  }

  cancelPairing() {
    const o = this.offer;
    if (!o) return { ok: true };
    clearTimeout(o.timer);
    try { o.offer.cancel(); } catch (e) { /* already burned */ }
    this.relay.pairClose(o.pairingId);
    if (o.session) o.session.close();
    this.offer = null;
    this.emit('changed', { what: 'pairing' });
    return { ok: true };
  }

  async _onPairInit(f, env) {
    const o = this.offer;
    if (!o || o.stage !== 'open' || f.ticket !== o.pairingId) return;
    let r;
    try {
      r = o.offer.respond(env, { identity: this.identity, device: { name: this.host.pcName().slice(0, 200), platform: this.host.platform, appVersion: this.host.appVersion }, now: this.now() });
    } catch (e) {
      // A wrong secret counts as an attempt; the offer stays open until it is burned or expires.
      o.error = e && e.code ? e.code : 'invalid';
      if (!o.offer.isOpen(this.now())) this._expireOffer(o);
      else this.emit('changed', { what: 'pairing' });
      return;
    }
    const ack = await this.relay.pairReply(f.from, o.pairingId, r.envelope);
    if (ack.status !== 'delivered') {
      r.result.session.close();
      o.error = 'phone_gone';
      this._expireOffer(o);
      return;
    }
    clearTimeout(o.timer);
    o.stage = 'confirm';
    o.sas = r.result.sas;
    o.peer = r.result.peer;
    o.session = r.result.session;
    o.expiresAt = this.now() + CONFIRM_TTL_MS;
    o.timer = setTimeout(() => this._expireOffer(o), CONFIRM_TTL_MS);
    if (o.timer.unref) o.timer.unref();
    this.emit('changed', { what: 'pairing' });
  }

  // The user checked that both screens show the same 6 digits and picked who the phone acts as.
  // { pairingId, memberId (null = single-user mode), scopes[], name? }
  async confirmPairing(input) {
    const o = this.offer;
    if (!o || o.stage !== 'confirm' || input.pairingId !== o.pairingId) throw errorWith('PAIRING_GONE', 'This pairing has ended. Start again.');
    clearTimeout(o.timer);
    this.offer = null;
    const scopes = P.parseScopes(input.scopes || ['view']);
    const device = await this.store.create(rowFromPairing({ peer: o.peer, name: input.name, memberId: input.memberId, scopes }));
    this.sessions.set(device.mailboxId, o.session);
    this.online.set(device.mailboxId, true);
    this.awaitingLink.add(device.mailboxId);
    this.relay.link(device.mailboxId);
    this.relay.presenceSub([device.mailboxId]);
    await this.host.logActivity({ device, memberId: device.memberId, action: 'mobile.paired', profileId: 0, detail: { source: 'mobile', deviceId: device.deviceId, device: device.name, scopes } }).catch(() => {});
    if (this.sync) await this.sync.onDevicesChanged(await this.store.active()).catch((e) => this.log('sync members failed', e && e.message));
    this.emit('changed', { what: 'devices' });
    return publicDevice(device);
  }

  // The codes did not match (or the user changed their mind): the phone is never trusted.
  rejectPairing(pairingId) {
    const o = this.offer;
    if (o && o.pairingId === pairingId) {
      // The phone linked right after the handshake; unlinking sends it `revoked`, so it stops
      // waiting for the hello at once.
      if (o.peer) this.relay.unlink(o.peer.mailboxId);
      this.cancelPairing();
    }
    return { ok: true };
  }

  async _onLinked(f) {
    if (!f.active || !this.awaitingLink.has(f.peer)) return;
    this.awaitingLink.delete(f.peer);
    const device = await this.store.byMailbox(f.peer);
    if (!device || device.revokedAt) return;
    await this._greet(device);
  }

  // Every new session: hello (deviceId + scopes, the phone builds its own member from them), the
  // state, and every approval still pending (the phone does not keep them across reconnects).
  async _greet(device) {
    await this.sendTo(device, this.bridge.helloFor(device), { liveOnly: true });
    await this.bridge.sendSnapshot(device);
    await this.bridge.sendPendingApprovals(device);
  }

  // ---- inbound envelopes ----
  async _onMsg(f) {
    let env;
    try { env = P.fromBase64Url(f.env); } catch (e) { return; }
    if (f.ticket) return this._onPairInit(f, env);
    const device = await this.store.byMailbox(f.from);
    if (!device || device.revokedAt) return; // not paired (or revoked): drop without answering
    let kind;
    try { kind = P.peekEnvelope(env).kind; } catch (e) { return; }
    const now = this.now();
    if (kind === P.EnvelopeKind.SessionInit) {
      const r = P.acceptSession({ identity: this.identity, envelope: env, now, isPaired: (pub) => P.equalBytes(pub, device.dhPub) });
      const old = this.sessions.get(device.mailboxId);
      if (old) old.close();
      this.sessions.set(device.mailboxId, r.session);
      this.online.set(device.mailboxId, true);
      await this.relay.sendEnvelope(device.mailboxId, r.envelope);
      await this.store.update(device.deviceId, { lastSeenAt: new Date(now).toISOString() }).catch(() => {});
      this.bridge.forget(device.deviceId);
      await this._greet(device);
      this.emit('changed', { what: 'presence' });
      return;
    }
    let msg;
    if (kind === P.EnvelopeKind.Session) {
      const s = this.sessions.get(device.mailboxId);
      if (!s) return; // the phone will open a new session
      msg = s.open(env, { now, seen: this.seen });
    } else if (kind === P.EnvelopeKind.Sealed) {
      msg = P.openSealed({
        recipient: this.identity,
        envelope: env,
        now,
        seen: this.seen,
        resolveSender: (kid) => (kid === device.keyId ? device.dhPub : null)
      }).message;
    } else {
      return;
    }
    if (msg.type === 'revoke') return this._onPeerRevoked(device.mailboxId, 'unpaired_on_phone');
    await this.bridge.handleMessage(device, msg);
  }

  // ---- outbound ----
  // { push: 'alert' | 'approval' | 'security' | 'update' } always goes sealed (the push blob must be openable
  // by the phone's notification handler). { liveOnly } sends only over a live session (state).
  async sendTo(device, msg, opts = {}) {
    const session = this.sessions.get(device.mailboxId);
    const live = session && this.online.get(device.mailboxId) !== false;
    if (opts.liveOnly && !live) return false;
    let env;
    let viaSession = false;
    if (!opts.push && live) { env = session.seal(msg); viaSession = true; }
    else env = P.sealTo({ sender: this.identity, recipientDhPub: device.dhPub, message: msg });
    const ack = await this.relay.sendEnvelope(device.mailboxId, env, opts.push || null);
    if (ack.status === 'queued' && viaSession) {
      // The phone went away and will open a NEW session when it is back, so the queued session copy
      // is unreadable then (LIVE-COMPANION.md 3.3). Drop the session and send it again sealed, with
      // a push for what a person should see (the phone's id cache drops a duplicate).
      session.close();
      this.sessions.delete(device.mailboxId);
      this.online.set(device.mailboxId, false);
      if (!opts.liveOnly) {
        const sealed = P.sealTo({ sender: this.identity, recipientDhPub: device.dhPub, message: msg });
        const again = await this.relay.sendEnvelope(device.mailboxId, sealed, PUSH_FOR[msg.type] || null);
        return this._afterAck(device, again);
      }
      return false;
    }
    return this._afterAck(device, ack);
  }

  // `rejected: not_linked` means the phone unpaired itself (its sealed revoke may have been purged
  // with the queue while this PC was offline, LIVE-COMPANION.md 3.5): forget it here too. Not for a
  // phone that is still being paired (its link is not active yet).
  _afterAck(device, ack) {
    if (ack.status === 'rejected' && ack.reason === 'not_linked' && !this.awaitingLink.has(device.mailboxId)) {
      this._onPeerRevoked(device.mailboxId, 'unpaired_on_phone').catch(() => {});
    }
    return ack.status !== 'rejected';
  }

  // ---- manage ----
  async renameDevice(deviceId, name) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw new Error('Enter a name.');
    const d = await this.store.update(deviceId, { name: n });
    this.emit('changed', { what: 'devices' });
    return publicDevice(d);
  }

  // Changes who the phone acts as and what it may do; a live phone gets a new hello at once.
  async updateDevice(deviceId, { memberId, scopes }) {
    const patch = {};
    if (memberId !== undefined) patch.memberId = memberId;
    if (scopes !== undefined) patch.scopes = P.parseScopes(scopes);
    const before = await this.store.byDeviceId(deviceId);
    if (!before || before.revokedAt) throw new Error('Phone not found.');
    const d = await this.store.update(deviceId, patch);
    this.bridge.forget(d.deviceId);
    if (this.isLive(d)) await this._greet(d).catch(() => {});
    const syncChanged = before.scopes.includes('phone_profiles_linked') !== d.scopes.includes('phone_profiles_linked');
    if (this.sync && syncChanged) {
      const active = await this.store.active();
      if (d.scopes.includes('phone_profiles_linked')) await this.sync.onDevicesChanged(active).catch(() => {});
      else await this.sync.removeMember(d, active).catch(() => {});
    }
    this.emit('changed', { what: 'devices' });
    return publicDevice(d);
  }

  // Revoke on the PC: refused at once (isPaired / resolveSender read revokedAt), then the phone is
  // told (sealed revoke), removed from profile sync (key rotation) and unlinked on the relay.
  async revokeDevice(deviceId, reason = 'revoked_on_pc') {
    const d = await this.store.byDeviceId(deviceId);
    if (!d) return { ok: false };
    await this.store.update(deviceId, { revokedAt: new Date(this.now()).toISOString() });
    const s = this.sessions.get(d.mailboxId);
    if (s) s.close();
    this.sessions.delete(d.mailboxId);
    this.bridge.forget(d.deviceId);
    await this.host.logActivity({ device: d, memberId: d.memberId, action: 'mobile.revoked', profileId: 0, detail: { source: 'mobile', deviceId: d.deviceId, device: d.name, reason } }).catch(() => {});
    if (this.relay.ready) {
      try {
        const msg = P.createMessage('revoke', { deviceId: d.deviceId, reason });
        await this.relay.sendEnvelope(d.mailboxId, P.sealTo({ sender: this.identity, recipientDhPub: d.dhPub, message: msg }), 'security');
      } catch (e) { /* the unlink below tells the phone too */ }
      await this._finishRevoke(d);
    }
    this.emit('changed', { what: 'devices' });
    return { ok: true };
  }

  async _finishRevoke(d) {
    if (this.sync && d.scopes.includes('phone_profiles_linked')) {
      await this.sync.removeMember(d, (await this.store.active()).filter((x) => x.deviceId !== d.deviceId)).catch((e) => this.log('sync remove failed', e && e.message));
    }
    if (!this.relay.ready) return;
    this.relay.unlink(d.mailboxId);
    this.online.delete(d.mailboxId);
    await this.store.remove(d.deviceId);
  }

  // The phone unpaired itself (sealed revoke, or the relay's `revoked` after its unlink).
  async _onPeerRevoked(mailbox, reason) {
    const d = await this.store.byMailbox(mailbox);
    if (!d) return;
    await this.store.update(d.deviceId, { revokedAt: new Date(this.now()).toISOString() });
    const s = this.sessions.get(mailbox);
    if (s) s.close();
    this.sessions.delete(mailbox);
    this.bridge.forget(d.deviceId);
    await this.host.logActivity({ device: d, memberId: d.memberId, action: 'mobile.revoked', profileId: 0, detail: { source: 'mobile', deviceId: d.deviceId, device: d.name, reason } }).catch(() => {});
    await this._finishRevoke(d);
    this.emit('changed', { what: 'devices' });
  }

  // ---- events from the app ----
  onApprovalRequested(view) { return this.bridge.onApprovalRequested(view); }
  onApprovalResolved(data) { return this.bridge.onApprovalResolved(data); }
  onStateChanged() { this.bridge.schedulePublish(); }
}

module.exports = { MobileCompanion, PAIRING_TTL_MS };
