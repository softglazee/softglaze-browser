'use strict';
// IPC for Settings > Phones. Like the AI channels, these are kept out of ipcHandlers' CHANNELS map:
// the preload exposes them as window.softglaze.mobile from its own constant (MOBILE_CHANNELS).
//
// Every handler needs the window's member to be the Owner, an Admin or the Super Admin (single-user
// mode counts as the Owner). A phone acts as a member: the Owner may pick anyone; an Admin picks
// themselves or members they manage, never the Owner (the rule ai:tokens-create uses).
// Event main -> renderer: mobile:changed ({ what }).
const MOBILE_CHANNELS = Object.freeze({
  STATUS: 'mobile:status',
  SET_ENABLED: 'mobile:set-enabled',
  SET_SETTINGS: 'mobile:set-settings',
  PAIR_START: 'mobile:pair-start',
  PAIR_CANCEL: 'mobile:pair-cancel',
  PAIR_CONFIRM: 'mobile:pair-confirm',
  PAIR_REJECT: 'mobile:pair-reject',
  DEVICE_RENAME: 'mobile:device-rename',
  DEVICE_UPDATE: 'mobile:device-update',
  DEVICE_REVOKE: 'mobile:device-revoke',
  RESET_KEYS: 'mobile:reset-keys',
  SYNC_SET_PROFILE: 'mobile:sync-set-profile',
  SYNC_SET_PROXY_PASSWORD: 'mobile:sync-set-proxy-password',
  SYNC_NOW: 'mobile:sync-now',
  SYNC_REMOVE_ALL: 'mobile:sync-remove-all',
  MEMBERS: 'mobile:members',
  CHANGED: 'mobile:changed'
});

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const OWNER_ROLES = new Set(['OWNER', 'SUPER_ADMIN']);

function forbidden(message) {
  const e = new Error(message);
  e.code = 'FORBIDDEN';
  return e;
}

// Who the window member may let a phone act as. Returns the member id to store (null only in
// single-user mode). Throws FORBIDDEN otherwise.
async function memberForPhone(actor, requested, host) {
  const membersExist = await host.membersExist();
  if (!membersExist) return null; // single-user mode: the phone acts as the owner
  let id = requested == null || requested === '' ? null : Number(requested);
  if (id == null) id = actor && actor.role !== 'SUPER_ADMIN' ? actor.id : await host.ownerId();
  if (!Number.isInteger(id) || id <= 0) throw forbidden('Choose the member this phone acts as.');
  const target = await host.getMember(id);
  if (!target) throw forbidden('That member does not exist.');
  if (target.status && target.status !== 'active') throw forbidden(`That member is ${target.status}.`);
  if (!actor || OWNER_ROLES.has(actor.role)) return id;
  if (id === actor.id) return id;
  if (target.role === 'OWNER') throw forbidden('Only the Owner can pair a phone that acts as the Owner.');
  const visible = await host.visibleMemberIds(actor);
  if (!visible || !visible.has(id)) throw forbidden('You can pair phones only for yourself or members you manage.');
  return id;
}

// host: { getWindowMember(), membersExist(), ownerId(), getMember(id), visibleMemberIds(member),
//         listMembers(member) }
function registerMobileIpc(registerHandler, mobile, host) {
  const requireAdmin = async () => {
    const m = await host.getWindowMember();
    if (!m) return null; // single-user mode == Owner
    if (m.status === 'suspended' || m.status === 'banned') throw forbidden(m.status === 'banned' ? 'This account is banned.' : 'This member is suspended.');
    if (!ADMIN_ROLES.has(m.role)) throw forbidden('Only the Owner or an Admin can manage phones.');
    return m;
  };
  const requireOwner = async (message) => {
    const m = await requireAdmin();
    if (m && !OWNER_ROLES.has(m.role)) throw forbidden(message);
    return m;
  };
  // An Admin manages only phones of members they manage (or their own).
  const requireDeviceAccess = async (actor, deviceId) => {
    const d = await mobile.getDevice(String(deviceId || ''));
    if (!d) throw new Error('Phone not found.');
    if (!actor || OWNER_ROLES.has(actor.role) || d.memberId === actor.id) return d;
    const visible = await host.visibleMemberIds(actor);
    if (d.memberId == null || !visible || !visible.has(d.memberId)) throw forbidden('You can manage only phones of members you manage.');
    return d;
  };
  const obj = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});

  registerHandler(MOBILE_CHANNELS.STATUS, async () => { await requireAdmin(); return mobile.status(); });
  registerHandler(MOBILE_CHANNELS.SET_ENABLED, async (p) => { await requireOwner('Only the Owner can turn the phone companion on or off.'); return mobile.setEnabled(Boolean(obj(p).enabled)); });
  registerHandler(MOBILE_CHANNELS.SET_SETTINGS, async (p) => { await requireOwner('Only the Owner can change these settings.'); return mobile.setSettings(obj(p)); });
  registerHandler(MOBILE_CHANNELS.MEMBERS, async () => { const m = await requireAdmin(); return host.listMembers(m); });

  registerHandler(MOBILE_CHANNELS.PAIR_START, async () => { await requireAdmin(); return mobile.startPairing(); });
  registerHandler(MOBILE_CHANNELS.PAIR_CANCEL, async () => { await requireAdmin(); return mobile.cancelPairing(); });
  registerHandler(MOBILE_CHANNELS.PAIR_REJECT, async (p) => { await requireAdmin(); return mobile.rejectPairing(obj(p).pairingId); });
  registerHandler(MOBILE_CHANNELS.PAIR_CONFIRM, async (p) => {
    const m = await requireAdmin();
    const input = obj(p);
    const memberId = await memberForPhone(m, input.memberId, host);
    return mobile.confirmPairing({
      pairingId: String(input.pairingId || ''),
      memberId,
      scopes: Array.isArray(input.scopes) ? input.scopes : ['view'],
      name: typeof input.name === 'string' ? input.name : undefined
    });
  });

  registerHandler(MOBILE_CHANNELS.DEVICE_RENAME, async (p) => {
    const m = await requireAdmin();
    const input = obj(p);
    await requireDeviceAccess(m, input.deviceId);
    return mobile.renameDevice(String(input.deviceId), input.name);
  });
  registerHandler(MOBILE_CHANNELS.DEVICE_UPDATE, async (p) => {
    const m = await requireAdmin();
    const input = obj(p);
    await requireDeviceAccess(m, input.deviceId);
    const patch = {};
    if (input.scopes !== undefined) patch.scopes = Array.isArray(input.scopes) ? input.scopes : ['view'];
    if (input.memberId !== undefined) patch.memberId = await memberForPhone(m, input.memberId, host);
    return mobile.updateDevice(String(input.deviceId), patch);
  });
  registerHandler(MOBILE_CHANNELS.DEVICE_REVOKE, async (p) => {
    const m = await requireAdmin();
    const input = obj(p);
    await requireDeviceAccess(m, input.deviceId);
    return mobile.revokeDevice(String(input.deviceId));
  });
  registerHandler(MOBILE_CHANNELS.RESET_KEYS, async () => { await requireOwner('Only the Owner can reset the phone keys of this computer.'); return mobile.resetKeys(); });

  registerHandler(MOBILE_CHANNELS.SYNC_SET_PROFILE, async (p) => {
    await requireOwner('Only the Owner can choose which profiles sync with phones.');
    const input = obj(p);
    // Phone profile sync is part of Pro (Free plan, 1.0.27): it can only be switched off on Free.
    if (input.enabled && typeof host.assertPlanAllows === 'function') await host.assertPlanAllows('sync');
    return mobile.setProfileSync(input.profileId, Boolean(input.enabled), { removeFromCloud: Boolean(input.removeFromCloud) });
  });
  registerHandler(MOBILE_CHANNELS.SYNC_SET_PROXY_PASSWORD, async (p) => {
    await requireOwner('Only the Owner can let proxy passwords sync.');
    const input = obj(p);
    return mobile.setProxyPasswordSync(input.profileId, Boolean(input.enabled));
  });
  registerHandler(MOBILE_CHANNELS.SYNC_NOW, async () => {
    await requireAdmin();
    if (typeof host.assertPlanAllows === 'function') await host.assertPlanAllows('sync');
    return mobile.syncNow();
  });
  registerHandler(MOBILE_CHANNELS.SYNC_REMOVE_ALL, async () => { await requireOwner('Only the Owner can remove synced profiles from the cloud.'); return mobile.removeAllFromCloud(); });
}

module.exports = { MOBILE_CHANNELS, registerMobileIpc, memberForPhone };
