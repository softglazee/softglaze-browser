'use strict';
// Authenticate tenant-admin endpoints via `Authorization: Bearer <tenant api key>`.
// Only the sha256 of the key is stored, so a DB read can't recover it.
const prisma = require('../db');
const { sha256Hex } = require('../crypto/keys');

module.exports = async function tenantApiAuth(req, res, next) {
  try {
    const m = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing tenant API key.' });
    const tenant = await prisma.tenant.findFirst({ where: { apiKeyHash: sha256Hex(m[1].trim()) } });
    if (!tenant || tenant.status !== 'active') return res.status(401).json({ error: 'Invalid tenant API key.' });
    req.tenant = tenant;
    next();
  } catch (e) { next(e); }
};
