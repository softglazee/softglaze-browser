'use strict';
// IPC for Settings > Cloud sync. Like the mobile channels, kept out of ipcHandlers' CHANNELS map: the preload
// exposes them as window.softglaze.cloudSync from its own constant (CLOUD_SYNC_CHANNELS, must match).
// Phase 1 is for solo workspaces: only the Owner (or single-user mode) may use any of them, because the
// workspace keys open everything.
// Event main -> renderer: cloudsync:changed ({ what }).
const CLOUD_SYNC_CHANNELS = Object.freeze({
  STATUS: 'cloudsync:status',
  TURN_ON_START: 'cloudsync:turn-on-start',
  TURN_ON_CONFIRM: 'cloudsync:turn-on-confirm',
  TURN_ON_CANCEL: 'cloudsync:turn-on-cancel',
  RECOVER: 'cloudsync:recover',
  SYNC_NOW: 'cloudsync:sync-now',
  ENROL_START: 'cloudsync:enrol-start',
  ENROL_POLL: 'cloudsync:enrol-poll',
  ENROL_APPROVE: 'cloudsync:enrol-approve',
  ENROL_DENY: 'cloudsync:enrol-deny',
  ENROL_CANCEL: 'cloudsync:enrol-cancel',
  DEVICES: 'cloudsync:devices',
  DEVICE_REVOKE: 'cloudsync:device-revoke',
  REISSUE_KIT: 'cloudsync:reissue-kit',
  TURN_OFF: 'cloudsync:turn-off',
  CHANGED: 'cloudsync:changed'
});

const OWNER_ROLES = new Set(['OWNER', 'SUPER_ADMIN']);

function forbidden(message) {
  const e = new Error(message);
  e.code = 'FORBIDDEN';
  return e;
}

// host: { getWindowMember(), qrDataUrl(text) }
function registerCloudSyncIpc(registerHandler, service, host) {
  const requireOwner = async () => {
    const m = await host.getWindowMember();
    if (!m) return null; // single-user mode == Owner
    if (m.status === 'suspended' || m.status === 'banned') throw forbidden('This member cannot use cloud sync.');
    if (!OWNER_ROLES.has(m.role)) throw forbidden('Only the Owner can manage cloud sync.');
    return m;
  };
  const C = CLOUD_SYNC_CHANNELS;
  const owner = (fn) => async (payload) => {
    await requireOwner();
    return fn(payload || {});
  };
  registerHandler(C.STATUS, owner(() => service.status()));
  registerHandler(C.TURN_ON_START, owner(() => service.turnOnStart()));
  registerHandler(C.TURN_ON_CONFIRM, owner((p) => service.turnOnConfirm(p.answers || {})));
  registerHandler(C.TURN_ON_CANCEL, owner(() => service.turnOnCancel()));
  registerHandler(C.RECOVER, owner((p) => service.recover(String(p.words || ''))));
  registerHandler(C.SYNC_NOW, owner(async () => {
    const r = await service.syncNow();
    return { pulled: r.pulled, applied: r.applied, pushed: r.pushed, conflicts: r.conflicts.length, rejected: r.rejected.length };
  }));
  registerHandler(C.ENROL_START, owner(() => {
    const o = service.enrolStart();
    return { ...o, qrImage: host.qrDataUrl(o.qr) };
  }));
  registerHandler(C.ENROL_POLL, owner(() => service.enrolPoll()));
  registerHandler(C.ENROL_APPROVE, owner((p) => service.enrolApprove(String(p.id || ''))));
  registerHandler(C.ENROL_DENY, owner((p) => service.enrolDeny(String(p.id || ''))));
  registerHandler(C.ENROL_CANCEL, owner(() => service.enrolCancel()));
  registerHandler(C.DEVICES, owner(() => service.devices()));
  registerHandler(C.DEVICE_REVOKE, owner((p) => service.revokeDevice(String(p.tag || ''))));
  registerHandler(C.REISSUE_KIT, owner(() => service.reissueKit()));
  registerHandler(C.TURN_OFF, owner((p) => service.turnOff({ deleteCloud: p.deleteCloud === true })));
}

module.exports = { CLOUD_SYNC_CHANNELS, registerCloudSyncIpc };
