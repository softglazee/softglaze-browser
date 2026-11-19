'use strict';
// SyncLocal adapter (@softglaze/protocol SyncEngine) over the desktop profile store.
//
// What the desktop applies to its own profile: title, notes, tags, start pages, folder (an existing
// group with that name) and the region settings (time zone, language, location, WebRTC). What it
// keeps for the phone without changing the desktop browser (stored sealed in the Setting table, see
// host.readSidecar): the proxy as edited on a phone, the phone settings (mobile flavour, desktop
// site), and the tabs, bookmarks and history phones send. The desktop browser's own tabs,
// bookmarks and history are not read in this version.
//
// A value the PC stores in a different form than the phone sent (normalised start pages, a group
// that does not exist) would look like a local edit on the next round and flip back and forth.
// So every applied meta field keeps { value as received, signature of the desktop value after the
// write }: while the desktop value is unchanged the received value is reported; once a person
// edits it on the PC, the desktop value wins again.
//
// Cookies: the whole Chromium jar of the profile (CDP Network.getAllCookies, running or headless
// offline), replaced as a whole after a safety snapshot. Never merged.
const { wireProfileId, parseWireProfileId } = require('../protocol');
const { regionFromDesktop, regionToDesktop, proxyFromDesktop, signature, cookieFromCdp, cookieToCdp } = require('./mapping');

const NATIVE_FIELDS = ['title', 'notes', 'tags', 'startUrls', 'folder', 'region'];

// host: { readProfile(localId), writeProfile(localId, patch), createProfile({ title }) -> localId,
//         exportCookies(localId) -> CDP cookies, replaceCookies(localId, cdpParams),
//         snapshotCookies(syncId, cdpCookies), readSidecar(syncId), writeSidecar(syncId, obj),
//         readIdMap(), writeIdMap(map), syncProxyPassword(localId) -> bool }
function createDesktopSyncLocal(host) {
  async function localIdOf(syncId) {
    const direct = parseWireProfileId(syncId);
    if (direct) return direct;
    const map = (await host.readIdMap()) || {};
    return map[syncId] ? Number(map[syncId]) : null;
  }

  function desktopMeta(p, withPassword) {
    return {
      title: p.title || '',
      notes: p.notes || null,
      tags: Array.isArray(p.tags) ? p.tags : [],
      startUrls: Array.isArray(p.startUrls) ? p.startUrls : [],
      folder: p.folder || null,
      region: regionFromDesktop(p.region || {}),
      proxy: proxyFromDesktop(p.proxy, withPassword)
    };
  }

  async function read(syncId) {
    const localId = await localIdOf(syncId);
    if (!localId) return null;
    const p = await host.readProfile(localId);
    if (!p) return null;
    const side = (await host.readSidecar(syncId)) || {};
    const native = desktopMeta(p, await host.syncProxyPassword(localId));
    const overrides = side.overrides || {};
    const meta = { origin: side.origin || 'pc' };
    for (const [field, value] of Object.entries(native)) {
      const o = overrides[field];
      meta[field] = o && o.sig === signature(value) ? o.value : value;
    }
    if (side.mobile !== undefined) meta.mobile = side.mobile;
    if (side.desktopSite !== undefined) meta.desktopSite = side.desktopSite;
    return {
      meta,
      tabs: side.tabs || { items: {}, active: null },
      bookmarks: side.bookmarks || {},
      history: side.history || {},
      editedAt: { meta: Number(p.updatedAt) || undefined, ...(side.editedAt || {}) }
    };
  }

  async function apply(syncId, data, create) {
    let localId = await localIdOf(syncId);
    const side = (await host.readSidecar(syncId)) || {};
    if (!localId) {
      if (!create) return;
      const title = data.meta && typeof data.meta.title === 'string' && data.meta.title.trim() ? data.meta.title : 'Phone profile';
      localId = await host.createProfile({ title });
      if (!parseWireProfileId(syncId) || parseWireProfileId(syncId) !== localId) {
        const map = (await host.readIdMap()) || {};
        map[syncId] = localId;
        await host.writeIdMap(map);
      }
      side.origin = 'phone';
    }
    if (data.meta) {
      const patch = {};
      const touched = [];
      const current = await host.readProfile(localId);
      for (const [field, value] of Object.entries(data.meta)) {
        if (field === 'title' && typeof value === 'string' && value.trim()) { patch.title = value.trim().slice(0, 200); touched.push(field); }
        else if (field === 'notes') { patch.notes = value == null ? null : String(value).slice(0, 5000); touched.push(field); }
        else if (field === 'tags') { patch.tags = Array.isArray(value) ? value.map(String).slice(0, 50) : []; touched.push(field); }
        else if (field === 'startUrls') { patch.startUrls = Array.isArray(value) ? value.map(String).slice(0, 20) : []; touched.push(field); }
        else if (field === 'folder') { patch.folder = value == null ? null : String(value); touched.push(field); }
        else if (field === 'region') { patch.region = regionToDesktop(value, (current && current.region) || {}); touched.push(field); }
        else if (field === 'proxy') { touched.push(field); } // kept for the phone, never applied to the desktop proxy
        else if (field === 'mobile') side.mobile = value; // phone settings: never applied to the desktop fingerprint
        else if (field === 'desktopSite') side.desktopSite = value;
      }
      if (Object.keys(patch).length) await host.writeProfile(localId, patch);
      const after = await host.readProfile(localId);
      if (after) {
        const native = desktopMeta(after, await host.syncProxyPassword(localId));
        side.overrides = side.overrides || {};
        for (const field of touched) side.overrides[field] = { value: data.meta[field], sig: signature(native[field]) };
      }
    }
    if (data.tabs) side.tabs = data.tabs;
    if (data.bookmarks) side.bookmarks = data.bookmarks;
    if (data.history) side.history = data.history;
    await host.writeSidecar(syncId, side);
  }

  async function readCookies(syncId) {
    const localId = await localIdOf(syncId);
    if (!localId) return [];
    const raw = (await host.exportCookies(localId)) || [];
    return raw.map(cookieFromCdp).filter((c) => c.name && c.domain).slice(0, 5000);
  }

  async function replaceCookies(syncId, cookies) {
    const localId = await localIdOf(syncId);
    if (!localId) return;
    // Safety snapshot of the jar about to be replaced (sealed, newest only).
    try { await host.snapshotCookies(syncId, (await host.exportCookies(localId)) || []); } catch (e) { /* the replace still goes ahead */ }
    await host.replaceCookies(localId, (cookies || []).map(cookieToCdp).filter(Boolean));
  }

  return { read, apply, readCookies, replaceCookies, localIdOf, NATIVE_FIELDS };
}

// The sync id of a desktop profile (what the phone sees in the space index).
function syncIdOf(localId) { return wireProfileId(localId); }

module.exports = { createDesktopSyncLocal, syncIdOf };
