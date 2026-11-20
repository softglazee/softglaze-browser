'use strict';
// Profile sync between this PC and its phones (SoftGlaze-Mobile docs/features/PROFILE-SYNC.md,
// "Desktop side"), built on @softglaze/protocol's SyncSpaceOwner and SyncEngine exactly like
// tools/sync-peer/peer.mjs. The relay only stores sealed blobs; keys never leave the devices.
//
//   - Owner: one space per PC. Members = paired phones with the phone_profiles_linked scope. A phone
//     removed (revoke, scope taken away) triggers a key rotation and a re-seal of every blob.
//   - Engine: origin 'pc', deviceId = pc-<mailbox prefix>, the PC's own X25519 key as owner key.
//   - Opt in per profile ("Sync with my phone"), off by default.
//   - Lease (one device at a time): acquire before launch (in_use -> refused with the holder's
//     name), renew every 30 s while open, release after the browser closed (uploads the cookie
//     jar), checkpoint on suspend. A lost lease closes the profile on the PC.
//   - Rounds: on start, every 60 s, after a profile closes, after edits (debounced).
const { EventEmitter } = require('node:events');
const { P } = require('../protocol');
const { syncIdOf } = require('./local');
const { pcDeviceId } = require('../identity');

const ROUND_EVERY_MS = 60_000;
const EDIT_DEBOUNCE_MS = 5_000;

// fetch-based transport (Node 22+ / Electron main), the HttpFn contract of SyncRelayClient.
async function fetchHttp(req) {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, ...(req.body ? { body: req.body } : {}) });
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) };
}

// Synchronous stores the engine wants, over an async backing store: loaded once, written behind.
function cachedStore(initial, persist) {
  let value = initial;
  let chain = Promise.resolve();
  return {
    load: () => (value == null ? null : JSON.parse(JSON.stringify(value))),
    save: (v) => {
      value = JSON.parse(JSON.stringify(v));
      const snapshot = value;
      chain = chain.then(() => persist(snapshot)).catch(() => {});
    },
    flush: () => chain
  };
}

class MobileSync extends EventEmitter {
  // opts: { identity, relayUrl, relayHost, http?, keyring { load(), save(stored) } (stored JSON via
  //         exportKeyring, sealed by the caller), state (cachedStore-like), local (SyncLocal),
  //         settings { enabled(): number[] (local ids), pcName() }, host { closeProfile(localId),
  //         notify(event) }, now?, log? }
  constructor(opts) {
    super();
    this.o = opts;
    this.log = opts.log || (() => {});
    this.identity = opts.identity;
    this.spaceId = P.syncSpaceId(this.identity.sign.publicKey);
    this.keys = {
      load: () => { const s = opts.keyring.load(); return s ? P.importKeyring(s) : null; },
      save: (ring) => opts.keyring.save(P.exportKeyring(ring))
    };
    this.client = new P.SyncRelayClient({ relayUrl: opts.relayUrl, identity: this.identity, http: opts.http || fetchHttp, host: opts.relayHost, ...(opts.now ? { now: opts.now } : {}) });
    this.owner = new P.SyncSpaceOwner({ client: this.client, identity: this.identity, spaceId: this.spaceId, keys: this.keys, ...(opts.now ? { now: opts.now } : {}) });
    this.engine = new P.SyncEngine({
      client: this.client,
      identity: this.identity,
      deviceId: pcDeviceId(this.identity),
      deviceName: opts.settings.pcName(),
      origin: 'pc',
      spaceId: this.spaceId,
      ownerDhPub: this.identity.dh.publicKey,
      local: opts.local,
      state: opts.state,
      keys: this.keys,
      ...(opts.now ? { now: opts.now } : {})
    });
    this.members = [];
    this.renewTimers = new Map(); // syncId -> interval
    this.roundTimer = null;
    this.editTimer = null;
    this.lastReport = null;
  }

  memberOf(device) { return { mailbox: device.mailboxId, dhPub: device.x25519Pub }; }

  // Paired phones changed (paired, scope given): the space members follow.
  async onDevicesChanged(devices) {
    this.members = devices.filter((d) => !d.revokedAt && d.scopes.includes('phone_profiles_linked')).map((d) => this.memberOf(d));
    if (!this.o.settings.enabled().length && !this.keys.load()) return { setup: false };
    await this.owner.setup(this.members);
    return { setup: true, epoch: this.owner.currentEpoch() };
  }

  // A phone loses sync (revoke or scope removed): rotate the key and re-seal, before the unlink.
  async removeMember(device, remaining) {
    if (!this.keys.load()) return { resealed: 0 };
    this.members = remaining.filter((d) => !d.revokedAt && d.scopes.includes('phone_profiles_linked') && d.deviceId !== device.deviceId).map((d) => this.memberOf(d));
    return this.owner.removeMember(this.memberOf(device), this.members);
  }

  // "Sync with my phone" on for a profile. The first one creates the space.
  async enableProfile(localId) {
    if (!this.keys.load()) await this.owner.setup(this.members);
    await this.engine.enable(syncIdOf(localId));
    this.scheduleRound(0);
  }

  async disableProfile(localId, removeFromCloud) {
    await this.engine.disable(syncIdOf(localId), Boolean(removeFromCloud));
  }

  // Remove everything from the relay (all profiles, all devices). Local data stays.
  async deleteAll() {
    await this.owner.deleteAll();
  }

  profileStatus(localId) {
    const id = syncIdOf(localId);
    return { ...(this.engine.profileState(id) || { enabled: false }), conflicts: this.engine.conflicts(id).length, holds: this.engine.holds(id), bytes: this.engine.storedBytes(id) };
  }

  status() {
    const profiles = {};
    for (const [id, st] of Object.entries(this.engine.state.profiles)) profiles[id] = { ...st, conflicts: this.engine.conflicts(id).length, holds: this.engine.holds(id) };
    return { spaceReady: Boolean(this.keys.load()), epoch: this.owner.currentEpoch(), members: this.members.length, lastReport: this.lastReport, profiles };
  }

  async syncAll() {
    if (!this.keys.load()) return { ok: true, profiles: [], added: [], removed: [], idle: true };
    const r = await this.engine.syncAll();
    this.lastReport = { at: (this.o.now || Date.now)(), ok: r.ok, error: r.error || null, added: r.added, removed: r.removed, profiles: r.profiles.map((p) => ({ profileId: p.profileId, ok: p.ok, error: p.error || null, created: p.created, conflicts: p.conflicts })) };
    this.emit('changed', this.lastReport);
    return r;
  }

  scheduleRound(delay = EDIT_DEBOUNCE_MS) {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => { this.editTimer = null; this.syncAll().catch((e) => this.log('sync round failed', e && e.message)); }, delay);
    if (this.editTimer.unref) this.editTimer.unref();
  }

  start() {
    this.scheduleRound(1000);
    this.roundTimer = setInterval(() => { this.syncAll().catch(() => {}); }, ROUND_EVERY_MS);
    if (this.roundTimer.unref) this.roundTimer.unref();
  }

  stop() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    if (this.editTimer) clearTimeout(this.editTimer);
    for (const t of this.renewTimers.values()) clearInterval(t);
    this.renewTimers.clear();
    this.roundTimer = null;
    this.editTimer = null;
  }

  isSynced(localId) {
    const st = this.engine.profileState(syncIdOf(localId));
    return Boolean(st && st.enabled && !st.paused);
  }

  // ---- lease around a desktop launch ----
  // Returns { ok: true } (launch may go on) or throws IN_USE with the holder. When the relay cannot
  // be reached the launch goes on (local first) and the result says so.
  async beforeLaunch(localId, { takeover = false } = {}) {
    if (!this.isSynced(localId)) return { ok: true, synced: false };
    const id = syncIdOf(localId);
    const r = await this.engine.acquire(id, { takeover });
    if (r.ok) return { ok: true, synced: true, cookiesApplied: r.cookiesApplied, previous: r.previous || null };
    if (r.reason === 'in_use') {
      const since = r.holder && r.holder.since ? new Date(r.holder.since) : null;
      const e = new Error(`This profile is open on ${r.holder.name || 'a phone'}${since ? ` since ${since.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}. Take it over from Settings > Phones, or close it on the phone first.`);
      e.code = 'IN_USE';
      e.holder = r.holder;
      throw e;
    }
    return { ok: true, synced: true, leaseError: r.reason === 'error' ? r.error : r.reason };
  }

  afterLaunch(localId) {
    const id = syncIdOf(localId);
    if (!this.engine.holds(id) || this.renewTimers.has(id)) return;
    const t = setInterval(() => { this._renew(localId).catch(() => {}); }, P.SYNC_LEASE_RENEW_MS);
    if (t.unref) t.unref();
    this.renewTimers.set(id, t);
  }

  async _renew(localId) {
    const id = syncIdOf(localId);
    const r = await this.engine.renew(id);
    if (!r.ok && r.reason === 'lost') {
      this._stopRenew(id);
      this.emit('lease-lost', { localId, holder: r.holder || null });
      try { await this.o.host.closeProfile(localId, { reason: 'lease-lost' }); } catch (e) { /* already closed */ }
      try { this.o.host.notify({ kind: 'lease_taken_over', localId, holderName: r.holder ? r.holder.name : null }); } catch (e) { /* ignore */ }
    }
    return r;
  }

  _stopRenew(id) {
    const t = this.renewTimers.get(id);
    if (t) clearInterval(t);
    this.renewTimers.delete(id);
  }

  // The browser of a synced profile closed (cookies flushed by the browser on exit): upload the
  // jar, release, then a round. A profile closed because the lease was lost releases nothing.
  async afterClose(localId) {
    const id = syncIdOf(localId);
    this._stopRenew(id);
    if (!this.engine.holds(id)) return null;
    const r = await this.engine.release(id);
    this.scheduleRound(1000);
    return r;
  }

  // powerMonitor suspend: upload the jar of every open synced profile and renew.
  async checkpointAll() {
    for (const id of this.renewTimers.keys()) await this.engine.checkpoint(id).catch(() => null);
  }
}

module.exports = { MobileSync, cachedStore, fetchHttp, ROUND_EVERY_MS };
