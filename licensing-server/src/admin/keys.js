'use strict';
// Scoped admin keys for /v1/admin/*. The website gets its own key (label "website") so its server
// can call the admin API without the owner's tenant admin key, and so it can be revoked or replaced
// without touching that key or anything else. These keys cannot call /v1/tenant/* (payment keys,
// signing-key rotation, activation codes). Only the SHA-256 of a key is stored.
const crypto = require('node:crypto');
const { sha256Hex } = require('../crypto/keys');

const SCOPES = ['admin'];

function newAdminKeyValue() { return 'sgla_' + crypto.randomBytes(32).toString('base64url'); }

async function createAdminKey(db, tenantId, { label, scopes = ['admin'] }) {
  const l = String(label || '').trim();
  if (!/^[a-z0-9][a-z0-9 _.-]{0,59}$/i.test(l)) throw new Error('Label: 1-60 letters, digits, space, _ . -');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => !SCOPES.includes(s))) throw new Error(`Scopes: ${SCOPES.join(', ')}`);
  const key = newAdminKeyValue();
  const row = await db.adminKey.create({ data: { tenantId, label: l, keyHash: sha256Hex(key), scopes } });
  return { id: row.id, key, label: row.label, scopes };
}

// Revokes every active key with this label except `exceptId`. Returns the number revoked.
async function revokeByLabel(db, tenantId, label, exceptId = null) {
  const r = await db.adminKey.updateMany({
    where: { tenantId, label, revokedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { revokedAt: new Date() }
  });
  return r.count;
}

async function listAdminKeys(db, tenantId) {
  const rows = await db.adminKey.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  return rows.map(({ keyHash, ...r }) => r);
}

module.exports = { SCOPES, createAdminKey, revokeByLabel, listAdminKeys, newAdminKeyValue };
