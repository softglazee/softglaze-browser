'use strict';
// Phone companion service for the app: owns the PC identity, the relay connection, the companion
// (pairing, sessions, bridge) and profile sync, and is what ipc.js (Settings > Phones) and
// ipcHandlers.js (approvals, session events, launches) talk to.
//
// configure(host) is called once from ipcHandlers.registerIpcHandlers; start() after the database
// is readable. Off until the Owner or an Admin turns it on in Settings > Phones.
//
// host: { getPrisma, readSetting, writeSetting, seal, open, emit(channel, data), appVersion,
//         bridge: { resolveMember, runAs, listProfiles, startProfile, stopProfile, approvals,
//                   canAnswerApproval, logActivity },
//         sync: (sync/local.js host contract) + { closeProfile(localId), notify(event) },
//         WebSocketImpl? }
const os = require('node:os');
const config = require('./config');
const { loadOrCreateIdentity, resetIdentity } = require('./identity');
const { RelayClient } = require('./relayClient');
const { MobileCompanion } = require('./companion');
const { createPrismaDeviceStore, publicDevice } = require('./devices');
const { MobileSync, cachedStore } = require('./sync/service');
const { createDesktopSyncLocal } = require('./sync/local');
const { VENDOR } = require('./protocol');
const { qrDataUrl } = require('./qr');

const EVENT_CHANGED = 'mobile:changed';

const state = {
  host: null,
  settings: config.normalizeSettings(null),
  identity: null,
  relay: null,
  companion: null,
  sync: null,
  store: null,
  error: null,
  starting: null,
  publishTimer: null
};

function host() {
  if (!state.host) throw new Error('The phone companion is not ready yet.');
  return state.host;
}

function emitChanged(data) {
  try { if (state.host) state.host.emit(EVENT_CHANGED, data || {}); } catch (e) { /* renderer gone */ }
}

function platformName() {
  return process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'windows';
}

function pcName() {
  return state.settings.pcName || os.hostname() || 'SoftGlaze PC';
}

function configure(h) {
  state.host = h;
  state.store = createPrismaDeviceStore(h.getPrisma);
}

async function saveSettings(next) {
  state.settings = config.normalizeSettings(next);
  await host().writeSetting(config.SETTINGS_KEY, state.settings);
  return state.settings;
}

// Reads settings and, when turned on, connects. Never throws (the app keeps running).
async function start() {
  if (state.starting) return state.starting;
  state.starting = (async () => {
    try {
      state.settings = config.normalizeSettings(await host().readSetting(config.SETTINGS_KEY, null));
      if (state.settings.enabled) await connect();
    } catch (e) {
      state.error = { code: e.code || 'ERROR', message: e.message };
      emitChanged({ what: 'error' });
    } finally {
      state.starting = null;
    }
  })();
  return state.starting;
}

async function connect() {
  if (state.companion) return;
  const h = host();
  const sealer = { seal: h.seal, open: h.open };
  const { identity } = await loadOrCreateIdentity({ store: { read: h.readSetting, write: h.writeSetting }, sealer, key: config.IDENTITY_KEY });
  state.identity = identity;
  const relayUrl = config.validateRelayUrl(config.relayUrlOf(state.settings));
  const relayHost = config.relayHostOf(relayUrl);

  const sealedKeyring = await h.readSetting(config.SYNC_KEYRING_KEY, null);
  let keyringValue = null;
  if (sealedKeyring && typeof sealedKeyring.sealed === 'string') {
    const plain = h.open(sealedKeyring.sealed);
    keyringValue = plain ? JSON.parse(plain) : null;
  }
  const keyring = cachedStore(keyringValue, async (v) => h.writeSetting(config.SYNC_KEYRING_KEY, v ? { v: 1, sealed: h.seal(JSON.stringify(v)) } : null));
  const syncState = cachedStore(await h.readSetting(config.SYNC_STATE_KEY, null), async (v) => h.writeSetting(config.SYNC_STATE_KEY, v));
  state.sync = new MobileSync({
    identity,
    relayUrl,
    relayHost,
    keyring,
    state: syncState,
    local: createDesktopSyncLocal({ ...h.sync, syncProxyPassword: async (id) => state.settings.syncProxyPassword.includes(Number(id)) }),
    settings: { enabled: () => state.settings.syncProfiles, pcName },
    host: { closeProfile: h.sync.closeProfile, notify: (evt) => emitChanged({ what: 'sync', event: evt }) },
    log: (...a) => console.warn('[mobile:sync]', ...a)
  });
  state.sync.on('changed', () => emitChanged({ what: 'sync' }));

  state.relay = new RelayClient({ url: relayUrl, host: relayHost, identity, WebSocketImpl: h.WebSocketImpl, log: (...a) => console.warn('[mobile:relay]', ...a) });
  state.companion = new MobileCompanion({
    identity,
    relay: state.relay,
    relayUrl,
    store: state.store,
    host: { ...h.bridge, pcName, platform: platformName(), appVersion: h.appVersion },
    sync: state.sync,
    log: (...a) => console.warn('[mobile]', ...a)
  });
  state.companion.on('changed', (d) => emitChanged(d));
  state.companion.start();
  // Profile edits, groups and proxy checks do not raise session events: phones get them within 30 s.
  state.publishTimer = setInterval(() => { if (state.companion) state.companion.onStateChanged(); }, 30_000);
  if (state.publishTimer.unref) state.publishTimer.unref();
  state.error = null;
  if (state.settings.syncProfiles.length) {
    state.sync.onDevicesChanged(await state.store.active()).catch(() => {});
    state.sync.start();
  }
}

function disconnect(byeReason = 'quit') {
  if (state.publishTimer) { clearInterval(state.publishTimer); state.publishTimer = null; }
  if (state.companion) state.companion.stop(byeReason);
  if (state.sync) state.sync.stop();
  state.companion = null;
  state.relay = null;
  state.sync = null;
}

function requireRunning() {
  if (!state.companion) {
    const e = new Error('Turn on the phone companion first.');
    e.code = 'MOBILE_OFF';
    throw e;
  }
  return state.companion;
}

// ---- for ipc.js ----
async function status() {
  const s = state.settings;
  const base = {
    enabled: s.enabled,
    pcName: pcName(),
    relayUrl: config.relayUrlOf(s),
    relayUrlFromEnv: Boolean(process.env.SG_RELAY_URL),
    defaultRelayUrl: config.DEFAULT_RELAY_URL,
    protocol: { version: VENDOR.version, sourceCommit: VENDOR.sourceCommit },
    error: state.error,
    syncProfiles: s.syncProfiles,
    syncProxyPassword: s.syncProxyPassword
  };
  if (!state.companion) {
    let devices = [];
    try { devices = (await state.store.list()).map((d) => ({ ...publicDevice(d), online: false, live: false })); } catch (e) { /* table not ready */ }
    return { ...base, relay: { state: 'off' }, pairing: null, devices, sync: null };
  }
  const st = await state.companion.status();
  return { ...base, ...st, pairing: withQr(st.pairing), sync: state.sync ? state.sync.status() : null };
}

// The QR image goes with the text (the text is shown too, for copy and paste).
function withQr(pairing) {
  if (!pairing || !pairing.qrText) return pairing;
  return { ...pairing, qrImage: qrDataUrl(pairing.qrText) };
}

async function setEnabled(on) {
  await saveSettings({ ...state.settings, enabled: Boolean(on) });
  if (on) {
    try { await connect(); } catch (e) {
      await saveSettings({ ...state.settings, enabled: false });
      state.error = { code: e.code || 'ERROR', message: e.message };
      throw e;
    }
  } else disconnect('quit');
  emitChanged({ what: 'settings' });
  return status();
}

async function setSettings(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...state.settings };
  if (p.pcName !== undefined) next.pcName = String(p.pcName || '').trim().slice(0, 60) || null;
  if (p.relayUrl !== undefined) next.relayUrl = p.relayUrl ? config.validateRelayUrl(p.relayUrl) : null;
  const relayChanged = next.relayUrl !== state.settings.relayUrl;
  await saveSettings(next);
  if (relayChanged && state.companion) { disconnect('quit'); await connect(); }
  emitChanged({ what: 'settings' });
  return status();
}

function startPairing() { return withQr(requireRunning().startPairing()); }
function cancelPairing() { return requireRunning().cancelPairing(); }
function rejectPairing(pairingId) { return requireRunning().rejectPairing(String(pairingId || '')); }
function confirmPairing(input) { return requireRunning().confirmPairing(input); }
function renameDevice(deviceId, name) { return requireRunning().renameDevice(deviceId, name); }
function updateDevice(deviceId, patch) { return requireRunning().updateDevice(deviceId, patch); }

async function revokeDevice(deviceId) {
  if (state.companion) return state.companion.revokeDevice(deviceId);
  // Off: refuse it at once; the relay is told the next time the companion connects.
  await state.store.update(deviceId, { revokedAt: new Date().toISOString() });
  emitChanged({ what: 'devices' });
  return { ok: true, pendingRelay: true };
}

async function getDevice(deviceId) { return state.store.byDeviceId(deviceId); }

// Reset: forget the PC keys and every paired phone (they must pair again).
async function resetKeys() {
  for (const d of await state.store.list()) await revokeDevice(d.deviceId).catch(() => {});
  disconnect('quit');
  const h = host();
  await resetIdentity({ store: { read: h.readSetting, write: h.writeSetting }, key: config.IDENTITY_KEY });
  await h.writeSetting(config.SYNC_KEYRING_KEY, null);
  await h.writeSetting(config.SYNC_STATE_KEY, null);
  for (const d of await state.store.list()) await state.store.remove(d.deviceId);
  if (state.settings.enabled) await connect();
  emitChanged({ what: 'devices' });
  return status();
}

// ---- profile sync ----
async function setProfileSync(localId, on, { removeFromCloud = false } = {}) {
  const id = Number(localId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Bad profile id.');
  requireRunning();
  const list = new Set(state.settings.syncProfiles);
  if (on) {
    list.add(id);
    await saveSettings({ ...state.settings, syncProfiles: [...list] });
    await state.sync.onDevicesChanged(await state.store.active());
    await state.sync.enableProfile(id);
    state.sync.start();
  } else {
    list.delete(id);
    await saveSettings({ ...state.settings, syncProfiles: [...list] });
    await state.sync.disableProfile(id, removeFromCloud);
  }
  emitChanged({ what: 'sync' });
  return status();
}

async function setProxyPasswordSync(localId, on) {
  const id = Number(localId);
  const list = new Set(state.settings.syncProxyPassword);
  if (on) list.add(id); else list.delete(id);
  await saveSettings({ ...state.settings, syncProxyPassword: [...list] });
  if (state.sync) state.sync.scheduleRound(0);
  emitChanged({ what: 'sync' });
  return status();
}

async function syncNow() {
  requireRunning();
  return state.sync.syncAll();
}

async function removeAllFromCloud() {
  requireRunning();
  await state.sync.deleteAll();
  for (const id of state.settings.syncProfiles) await state.sync.disableProfile(id, false).catch(() => {});
  await saveSettings({ ...state.settings, syncProfiles: [] });
  emitChanged({ what: 'sync' });
  return status();
}

// ---- hooks from the app ----
// Before a desktop launch: a synced profile needs the lease (refused while a phone holds it).
async function beforeLaunch(localId, opts = {}) {
  if (!state.sync || !state.settings.syncProfiles.includes(Number(localId))) return { ok: true, synced: false };
  return state.sync.beforeLaunch(Number(localId), opts);
}

// Session lifecycle from ipcHandlers.handleSessionEvent.
function onSessionEvent(evt, profileId) {
  if (!state.companion || !evt) return;
  state.companion.onStateChanged();
  if (!state.sync || profileId == null || !state.settings.syncProfiles.includes(Number(profileId))) return;
  if (evt.type === 'launched') state.sync.afterLaunch(Number(profileId));
  if ((evt.type === 'closed' && evt.reason !== 'shutdown') || evt.type === 'crashed') {
    state.sync.afterClose(Number(profileId)).catch((e) => console.warn('[mobile:sync] release failed', e && e.message));
  }
}

// AI approval events (ai/index.js onApprovalEvent).
function onApprovalEvent(channel, data) {
  if (!state.companion) return;
  if (channel === 'ai:approval-requested') state.companion.onApprovalRequested(data).catch(() => {});
  else if (channel === 'ai:approval-resolved') state.companion.onApprovalResolved(data).catch(() => {});
  else if (channel === 'ai:approvals-changed') state.companion.onStateChanged();
}

// Profiles were created, edited or deleted on the PC.
function onProfilesChanged() {
  if (state.companion) state.companion.onStateChanged();
  if (state.sync && state.settings.syncProfiles.length) state.sync.scheduleRound();
}

// powerMonitor: say "sleep" to the relay (no PC offline push), checkpoint leases; reconnect on resume.
async function onSuspend() {
  if (state.sync) await state.sync.checkpointAll().catch(() => {});
  if (state.relay && state.relay.ready) { try { state.relay._safeWrite({ t: 'bye', reason: 'sleep' }); } catch (e) { /* offline */ } }
}

function onResume() {
  if (state.relay) state.relay.reconnectNow();
}

async function shutdown() {
  if (state.sync) await state.sync.checkpointAll().catch(() => {});
  disconnect('quit');
}

function isRunning() { return Boolean(state.companion); }

module.exports = {
  EVENT_CHANGED,
  configure,
  start,
  status,
  setEnabled,
  setSettings,
  startPairing,
  cancelPairing,
  rejectPairing,
  confirmPairing,
  renameDevice,
  updateDevice,
  revokeDevice,
  getDevice,
  resetKeys,
  setProfileSync,
  setProxyPasswordSync,
  syncNow,
  removeAllFromCloud,
  beforeLaunch,
  onSessionEvent,
  onApprovalEvent,
  onProfilesChanged,
  onSuspend,
  onResume,
  shutdown,
  isRunning
};
