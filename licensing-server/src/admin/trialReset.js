'use strict';
// Admin trial reset: clears the chosen locks so the same machine / email / network can start one more
// trial. The trial rows stay as history (resetAt, resetReason, resetBy). A trial that is still running
// keeps running.
const { audit } = require('./audit');
const { addEvent } = require('../customers/sync');

const PARTS = ['machine', 'email', 'network'];

async function resetTrials(db, req, trials, { release = 'all', reason } = {}) {
  const parts = release === 'all' ? PARTS : (Array.isArray(release) ? release : String(release).split(',')).map((s) => String(s).trim());
  if (!parts.length || parts.some((p) => !PARTS.includes(p))) return { error: { release: `'all' or a list of ${PARTS.join(', ')}` } };
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) return { error: { reason: 'say why (3-500 characters)' } };
  const at = new Date();
  for (const t of trials) {
    const data = { resetAt: at, resetReason: reason.trim(), resetBy: req.admin.actor };
    if (parts.includes('machine')) data.machineLock = null;
    if (parts.includes('email')) data.emailLock = null;
    if (parts.includes('network')) data.networkCounted = false;
    await db.trial.update({ where: { id: t.id }, data });
    if (t.customerId) await addEvent(db, t.tenantId, t.customerId, 'trial_reset', { trialId: t.id, release: parts }, at);
    await audit(db, req, 'trial.reset', { targetType: 'trial', targetId: t.id, detail: { release: parts } });
  }
  return { ok: true, reset: trials.length, release: parts };
}

module.exports = { resetTrials, PARTS };
