'use strict';
// /v1/admin/* authentication: `Authorization: Bearer <key>` where the key is either the tenant admin
// key (sgls_..., the owner's) or a scoped admin key (sgla_..., e.g. the website's). The optional
// X-Admin-Actor header names the person behind the call (the website sends its logged-in team
// member); it is recorded in the audit log next to the key that made the call.
const prisma = require('../db');
const { sha256Hex } = require('../crypto/keys');
const { asJson } = require('../util/json');

const TOUCH_MS = 5 * 60000;

function actorName(req) {
  const raw = String(req.get('x-admin-actor') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return raw ? raw.slice(0, 100) : null;
}

async function authenticate(db, bearer) {
  const hash = sha256Hex(bearer);
  const key = await db.adminKey.findUnique({ where: { keyHash: hash } });
  if (key) {
    if (key.revokedAt) return null;
    const tenant = await db.tenant.findUnique({ where: { id: key.tenantId } });
    if (!tenant || tenant.status !== 'active') return null;
    if (!key.lastUsedAt || Date.now() - new Date(key.lastUsedAt).getTime() > TOUCH_MS) {
      await db.adminKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return { tenant, keyId: key.id, keyLabel: key.label, scopes: asJson(key.scopes) || [] };
  }
  const tenant = await db.tenant.findFirst({ where: { apiKeyHash: hash } });
  if (!tenant || tenant.status !== 'active') return null;
  return { tenant, keyId: null, keyLabel: 'tenant-key', scopes: ['admin'] };
}

module.exports = function adminAuth(req, res, next) {
  (async () => {
    const m = String(req.get('authorization') || '').match(/^Bearer\s+(\S+)\s*$/i);
    if (!m) return res.status(401).json({ error: 'unauthorized', message: 'Missing admin key.' });
    const auth = await authenticate(prisma, m[1]);
    if (!auth) return res.status(401).json({ error: 'unauthorized', message: 'Invalid admin key.' });
    if (!auth.scopes.includes('admin')) return res.status(403).json({ error: 'forbidden', message: 'This key cannot use the admin API.' });
    const who = actorName(req);
    req.tenant = auth.tenant;
    req.admin = { keyId: auth.keyId, keyLabel: auth.keyLabel, actor: who ? `${auth.keyLabel}:${who}` : auth.keyLabel };
    next();
  })().catch(next);
};

module.exports.authenticate = authenticate;
