'use strict';
// Admin audit log: every change made through /v1/admin/* (and every export, email send and erase),
// with the key and the person (X-Admin-Actor) behind it. Details never hold email addresses or other
// personal fields: for customer changes only the names of the changed fields are kept.

const PERSONAL = new Set(['email', 'name', 'company', 'phone', 'notes', 'statusNote', 'toEmail', 'testTo']);

function safeDetail(detail) {
  if (!detail || typeof detail !== 'object') return detail || null;
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (PERSONAL.has(k)) { out[k] = '[changed]'; continue; }
    out[k] = v;
  }
  return out;
}

async function audit(db, req, action, { targetType = null, targetId = null, detail = null } = {}) {
  await db.adminAudit.create({
    data: {
      tenantId: req.tenant.id,
      actor: req.admin ? req.admin.actor : 'unknown',
      keyId: req.admin ? req.admin.keyId : null,
      action,
      targetType,
      targetId: targetId ? String(targetId).slice(0, 64) : null,
      detail: safeDetail(detail)
    }
  });
}

module.exports = { audit, safeDetail };
