'use strict';
// Profile sync end to end: the real relay (blob store), the desktop sync owner + engine
// (src/main/mobile/sync) and a phone running @softglaze/protocol's SyncEngine with an in-memory
// phone store, the role tools/sync-peer/peer.mjs plays for the phone app's own e2e test, reversed.
// The phone pairs through the desktop companion first (the relay requires a link for sync access).
const test = require('node:test');
const assert = require('node:assert/strict');
const { P } = require('../src/main/mobile/protocol');
const { RelayClient } = require('../src/main/mobile/relayClient');
const { MobileCompanion } = require('../src/main/mobile/companion');
const { createMemoryDeviceStore } = require('../src/main/mobile/devices');
const { MobileSync, cachedStore, fetchHttp } = require('../src/main/mobile/sync/service');
const { createDesktopSyncLocal } = require('../src/main/mobile/sync/local');
const { TestPhone, startLocalRelay, relayAvailable } = require('./helpers/mobilePhone');
const { createTestHost, createTestSyncHost } = require('./helpers/mobileHost');

const skip = relayAvailable() ? false : 'SoftGlaze-Mobile relay not found (set SG_MOBILE_REPO)';
const clone = (x) => JSON.parse(JSON.stringify(x));

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

// The phone's sync side: SyncEngine (origin 'phone') over an in-memory profile store.
function phoneSync({ relay, identity, pcDhPub }) {
  const profiles = new Map();
  const jars = new Map();
  let state = null;
  let ring = null;
  const local = {
    read: async (id) => (profiles.has(id) ? clone(profiles.get(id)) : null),
    apply: async (id, data, create) => {
      const cur = profiles.get(id) || (create ? { meta: {}, tabs: { items: {}, active: null }, bookmarks: {}, history: {} } : null);
      if (!cur) return;
      profiles.set(id, { ...cur, ...clone(data), meta: { ...cur.meta, ...(data.meta || {}) } });
    },
    readCookies: async (id) => clone(jars.get(id) || []),
    replaceCookies: async (id, cookies) => { jars.set(id, clone(cookies)); }
  };
  const client = new P.SyncRelayClient({ relayUrl: relay.url, identity, http: fetchHttp, host: relay.host });
  const engine = new P.SyncEngine({
    client, identity, deviceId: `phone-${identity.mailboxId.slice(0, 6)}`, deviceName: 'Ali Pixel', origin: 'phone',
    spaceId: P.syncSpaceId(pcDhPub.sign), ownerDhPub: pcDhPub.dh, local,
    state: { load: () => (state ? clone(state) : null), save: (s) => { state = clone(s); } },
    keys: { load: () => ring, save: (r) => { ring = r; } }
  });
  return { engine, profiles, jars };
}

test('profile sync end to end through the local relay', { skip, timeout: 60_000 }, async (t) => {
  const relay = await startLocalRelay();
  t.after(() => relay.stop());

  // ---- desktop ----
  const identity = P.generateIdentity();
  const host = createTestHost({ profiles: [{ id: 11, title: 'Shop main' }] });
  const syncHost = createTestSyncHost({
    profiles: [{
      id: 11, title: 'Shop main', notes: 'Main shop', tags: ['priority'], startUrls: ['https://shop.example/'], folder: 'Shops',
      proxy: { type: 'SOCKS5', host: 'gw.example.net', port: 1080, username: 'user1', password: 'proxy-secret', countryCode: 'DE' },
      region: { timezoneType: 'Custom', timezoneCustom: 'Europe/Berlin', webrtc: 'Disabled' }
    }]
  });
  syncHost.jars.set(11, [
    { name: 'sid', value: 'desk-cookie', domain: 'shop.example', path: '/', expires: 2000000000, secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: 'pref', value: 'dark', domain: '.example', path: '/', expires: -1, session: true, secure: false, httpOnly: false }
  ]);
  const enabled = new Set();
  let keyring = null;
  const sync = new MobileSync({
    identity,
    relayUrl: relay.url,
    relayHost: relay.host,
    keyring: { load: () => keyring, save: (s) => { keyring = clone(s); } },
    state: cachedStore(null, async () => {}),
    local: createDesktopSyncLocal(syncHost),
    settings: { enabled: () => [...enabled], pcName: () => 'OFFICE-PC' },
    host: { closeProfile: async () => {}, notify: () => {} }
  });
  t.after(() => sync.stop());
  const store = createMemoryDeviceStore();
  const relayClient = new RelayClient({ url: relay.url, host: relay.host, identity, backoffMinMs: 100, backoffMaxMs: 500 });
  const pc = new MobileCompanion({ identity, relay: relayClient, relayUrl: relay.url, store, host, sync });
  t.after(() => pc.stop('quit'));
  pc.start();
  await waitFor(() => relayClient.ready);

  // ---- pair a phone with phone_profiles_linked ----
  const phone = new TestPhone({ url: relay.url, name: 'Ali Pixel' });
  t.after(() => phone.close());
  await phone.connect();
  const offer = pc.startPairing();
  const sas = await phone.pair(offer.qrText);
  const view = await waitFor(() => (pc.pairingView() && pc.pairingView().stage === 'confirm' ? pc.pairingView() : null));
  assert.equal(view.sas, sas);
  phone.link();
  enabled.add(11);
  const device = await pc.confirmPairing({ pairingId: view.pairingId, memberId: null, scopes: ['view', 'phone_profiles_linked'] });
  await phone.waitMessage((m) => m.type === 'hello');
  assert.equal(sync.members.length, 1, 'the phone became a space member');

  // ---- desktop profile appears on the phone (without the proxy password) ----
  await sync.enableProfile(11);
  const r1 = await sync.syncAll();
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const ph = phoneSync({ relay, identity: phone.identity, pcDhPub: { sign: identity.sign.publicKey, dh: identity.dh.publicKey } });
  const r2 = await ph.engine.syncAll();
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.deepEqual(r2.added, ['p0000011']);
  const onPhone = ph.profiles.get('p0000011');
  assert.equal(onPhone.meta.title, 'Shop main');
  assert.equal(onPhone.meta.folder, 'Shops');
  assert.deepEqual(onPhone.meta.region, { tzMode: 'manual', tz: 'Europe/Berlin', langMode: 'proxy', geoMode: 'proxy', webrtcMode: 'disabled' });
  assert.equal(onPhone.meta.proxy.host, 'gw.example.net');
  assert.equal(onPhone.meta.proxy.password, undefined, 'no proxy password unless opted in');

  // ---- phone edits flow to the desktop; a value the desktop normalises does not flip back ----
  ph.profiles.get('p0000011').meta = { ...onPhone.meta, title: 'Shop main (phone)', startUrls: ['shop.example/cart'], mobile: { enabled: true, region: { tzMode: 'manual', tz: 'Asia/Karachi', langMode: 'auto', geoMode: 'off', webrtcMode: 'proxy' } } };
  ph.profiles.get('p0000011').editedAt = { meta: Date.now() + 1000 };
  assert.equal((await ph.engine.syncAll()).ok, true);
  assert.equal((await sync.syncAll()).ok, true);
  const desk = syncHost.rows.get(11);
  assert.equal(desk.title, 'Shop main (phone)');
  assert.deepEqual(desk.startUrls, ['https://shop.example/cart']);
  assert.equal(desk.region.timezoneCustom, 'Europe/Berlin', 'the phone settings never touch the desktop region');
  const r3 = await sync.syncAll();
  assert.deepEqual(r3.profiles[0].uploaded, [], 'nothing flips back after the desktop normalised a value');

  // ---- desktop edit flows to the phone ----
  await syncHost.writeProfile(11, { notes: 'Edited on the PC' });
  assert.equal((await sync.syncAll()).ok, true);
  assert.equal((await ph.engine.syncAll()).ok, true);
  assert.equal(ph.profiles.get('p0000011').meta.notes, 'Edited on the PC');
  assert.equal(ph.profiles.get('p0000011').meta.title, 'Shop main (phone)');

  // ---- cookie jar via the lease ----
  const lease1 = await sync.beforeLaunch(11);
  assert.equal(lease1.synced, true);
  sync.afterLaunch(11);
  // The phone cannot open it while the PC holds it.
  const busy = await ph.engine.acquire('p0000011');
  assert.equal(busy.ok, false);
  assert.equal(busy.reason, 'in_use');
  assert.equal(busy.holder.name, 'OFFICE-PC');
  await sync.afterClose(11);
  const got = await ph.engine.acquire('p0000011');
  assert.equal(got.ok, true);
  assert.equal(got.cookiesApplied, true);
  const phoneJar = ph.jars.get('p0000011');
  assert.deepEqual(phoneJar.map((c) => [c.name, c.value, c.hostOnly, c.expires]).sort(), [['pref', 'dark', false, null], ['sid', 'desk-cookie', true, 2000000000]]);
  // While the phone holds it, the PC launch is refused with the phone's name.
  await assert.rejects(sync.beforeLaunch(11), (e) => e.code === 'IN_USE' && /Ali Pixel/.test(e.message));
  // The phone changes the jar and closes the profile: the PC gets the whole jar (replaced).
  ph.jars.set('p0000011', [{ name: 'sid', value: 'phone-cookie', domain: 'shop.example', path: '/', expires: null, secure: true, httpOnly: true, sameSite: 'lax', hostOnly: true }]);
  assert.equal((await ph.engine.release('p0000011')).ok, true);
  const lease2 = await sync.beforeLaunch(11);
  assert.equal(lease2.cookiesApplied, true);
  assert.deepEqual(syncHost.jars.get(11).map((c) => [c.name, c.value, c.domain]), [['sid', 'phone-cookie', 'shop.example']]);
  assert.equal(syncHost.snapshots.get('p0000011').length, 2, 'the old jar was kept as a snapshot first');
  await sync.afterClose(11);

  // ---- a phone profile shared with the PC is created there ----
  ph.profiles.set('pp-phone-1', { meta: { title: 'Made on the phone', origin: 'phone' }, tabs: { items: {}, active: null }, bookmarks: {}, history: {} });
  await ph.engine.enable('pp-phone-1');
  assert.equal((await ph.engine.syncAll()).ok, true);
  const r4 = await sync.syncAll();
  assert.ok(r4.added.includes('pp-phone-1'));
  const created = [...syncHost.rows.values()].find((r) => r.title === 'Made on the phone');
  assert.ok(created, 'the PC created a local profile for it');
  assert.equal((await syncHost.readIdMap())['pp-phone-1'], created.id);

  // ---- revoke: key rotation, the phone is locked out ----
  const epochBefore = sync.owner.currentEpoch();
  await pc.revokeDevice(device.deviceId);
  assert.equal(sync.owner.currentEpoch(), epochBefore + 1, 'the key rotated');
  const locked = await ph.engine.syncAll();
  assert.equal(locked.ok, false);
  assert.equal(locked.error, 'not_member');

  // The relay's blob store holds no readable profile data.
  const fs = require('node:fs');
  const path = require('node:path');
  const walk = (d) => fs.readdirSync(d).flatMap((n) => (fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
  for (const f of walk(relay.dataDir)) {
    const text = fs.readFileSync(f).toString('latin1');
    for (const canary of ['Shop main', 'desk-cookie', 'phone-cookie', 'gw.example.net', 'Made on the phone']) assert.ok(!text.includes(canary), `${canary} found in ${path.basename(f)}`);
  }
});
