'use strict';
// PairedDevice storage. createPrismaDeviceStore() is the app's store; createMemoryDeviceStore() has
// the same contract for tests. Rows come back as plain device objects with parsed scopes and the
// pinned public keys as bytes.
const crypto = require('node:crypto');
const { P } = require('./protocol');

function parseScopes(json) {
  try { return P.parseScopes(JSON.parse(json)); } catch (e) { return ['view']; }
}

function toDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.deviceId,
    name: row.name,
    platform: row.platform || null,
    appVersion: row.appVersion || null,
    mailboxId: row.mailboxId,
    x25519Pub: row.x25519Pub,
    ed25519Pub: row.ed25519Pub,
    dhPub: P.fromBase64Url(row.x25519Pub),
    keyId: row.keyId,
    memberId: row.memberId == null ? null : Number(row.memberId),
    scopes: parseScopes(row.scopesJson),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null
  };
}

// What the renderer sees: never the keys.
function publicDevice(d) {
  if (!d) return null;
  const { dhPub, x25519Pub, ed25519Pub, keyId, ...rest } = d;
  return rest;
}

function newDeviceId() {
  return `dev_${crypto.randomBytes(9).toString('base64url')}`;
}

function rowFromPairing({ peer, name, memberId, scopes }) {
  const x25519Pub = P.toBase64Url(peer.dhPub);
  return {
    deviceId: newDeviceId(),
    name: String(name || peer.device.name || 'Phone').slice(0, 60),
    platform: peer.device.platform || null,
    appVersion: peer.device.appVersion || null,
    mailboxId: peer.mailboxId,
    x25519Pub,
    ed25519Pub: P.toBase64Url(peer.signPub),
    keyId: P.keyId(peer.dhPub),
    memberId: memberId == null ? null : Number(memberId),
    scopesJson: JSON.stringify(P.parseScopes(scopes))
  };
}

function createPrismaDeviceStore(getPrisma) {
  const t = () => getPrisma().pairedDevice;
  return {
    async list() { return (await t().findMany({ orderBy: { createdAt: 'asc' } })).map(toDevice); },
    async active() { return (await t().findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'asc' } })).map(toDevice); },
    async revokedPending() { return (await t().findMany({ where: { NOT: { revokedAt: null } } })).map(toDevice); },
    async byDeviceId(deviceId) { return toDevice(await t().findUnique({ where: { deviceId: String(deviceId) } })); },
    async byMailbox(mailboxId) { return toDevice(await t().findUnique({ where: { mailboxId: String(mailboxId) } })); },
    // A phone that pairs again replaces its old row (same mailbox).
    async create(data) {
      await t().deleteMany({ where: { mailboxId: data.mailboxId } });
      return toDevice(await t().create({ data }));
    },
    async update(deviceId, patch) {
      const data = {};
      if (patch.name !== undefined) data.name = String(patch.name).slice(0, 60);
      if (patch.memberId !== undefined) data.memberId = patch.memberId == null ? null : Number(patch.memberId);
      if (patch.scopes !== undefined) data.scopesJson = JSON.stringify(P.parseScopes(patch.scopes));
      if (patch.appVersion !== undefined) data.appVersion = patch.appVersion;
      if (patch.lastSeenAt !== undefined) data.lastSeenAt = patch.lastSeenAt ? new Date(patch.lastSeenAt) : null;
      if (patch.revokedAt !== undefined) data.revokedAt = patch.revokedAt ? new Date(patch.revokedAt) : null;
      return toDevice(await t().update({ where: { deviceId: String(deviceId) }, data }));
    },
    async remove(deviceId) { await t().deleteMany({ where: { deviceId: String(deviceId) } }); }
  };
}

function createMemoryDeviceStore() {
  const rows = new Map(); // deviceId -> row
  let nextId = 1;
  const all = () => [...rows.values()].sort((a, b) => a.id - b.id);
  return {
    rows,
    async list() { return all().map(toDevice); },
    async active() { return all().filter((r) => !r.revokedAt).map(toDevice); },
    async revokedPending() { return all().filter((r) => r.revokedAt).map(toDevice); },
    async byDeviceId(deviceId) { return toDevice(rows.get(String(deviceId)) || null); },
    async byMailbox(mailboxId) { return toDevice(all().find((r) => r.mailboxId === mailboxId) || null); },
    async create(data) {
      for (const r of all()) if (r.mailboxId === data.mailboxId) rows.delete(r.deviceId);
      const row = { id: nextId++, createdAt: new Date(), lastSeenAt: null, revokedAt: null, ...data };
      rows.set(row.deviceId, row);
      return toDevice(row);
    },
    async update(deviceId, patch) {
      const row = rows.get(String(deviceId));
      if (!row) throw new Error('Device not found.');
      if (patch.name !== undefined) row.name = String(patch.name).slice(0, 60);
      if (patch.memberId !== undefined) row.memberId = patch.memberId == null ? null : Number(patch.memberId);
      if (patch.scopes !== undefined) row.scopesJson = JSON.stringify(P.parseScopes(patch.scopes));
      if (patch.appVersion !== undefined) row.appVersion = patch.appVersion;
      if (patch.lastSeenAt !== undefined) row.lastSeenAt = patch.lastSeenAt ? new Date(patch.lastSeenAt) : null;
      if (patch.revokedAt !== undefined) row.revokedAt = patch.revokedAt ? new Date(patch.revokedAt) : null;
      return toDevice(row);
    },
    async remove(deviceId) { rows.delete(String(deviceId)); }
  };
}

module.exports = { createPrismaDeviceStore, createMemoryDeviceStore, rowFromPairing, toDevice, publicDevice, newDeviceId };
