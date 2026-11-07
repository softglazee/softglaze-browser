'use strict';
// Retention, run by the cron:
//  - verification codes never confirmed: deleted after privacy.unverifiedRetentionDays (30);
//  - unverified sign-ups (source app, email never verified by us, created more than 30 days ago) with
//    no licence, payment or trial and nothing an admin added (notes, tags, status override): erased
//    the same way as a privacy erase;
//  - email bodies in the send log: cleared after privacy.outboxBodyRetentionDays (90); the log row
//    (to, subject, status, dates) stays;
//  - trial attempt records: deleted after privacy.trialAttemptRetentionDays (180).
const { eraseCustomer } = require('../customers/erase');

const DAY = 86400000;

async function applyRetention(db, tenant, { now = Date.now(), settings }) {
  const p = settings.privacy;
  const tenantId = tenant.id;
  const out = { codesDeleted: 0, signupsErased: 0, bodiesCleared: 0, attemptsDeleted: 0 };
  const cutoff = new Date(now - p.unverifiedRetentionDays * DAY);

  out.codesDeleted = (await db.emailVerification.deleteMany({ where: { tenantId, verifiedAt: null, createdAt: { lt: cutoff } } })).count;

  const stale = await db.customer.findMany({
    where: { tenantId, source: 'app', emailVerifiedAt: null, createdAt: { lt: cutoff }, statusOverride: null, notes: null, tagIndex: null }
  });
  for (const c of stale) {
    const [lic, pay, trial] = await Promise.all([
      db.license.count({ where: { tenantId, customerId: c.id } }),
      db.payment.count({ where: { tenantId, customerId: c.id } }),
      db.trial.count({ where: { tenantId, customerId: c.id } })
    ]);
    if (lic || pay || trial) continue;
    await eraseCustomer(db, tenantId, c.id);
    out.signupsErased += 1;
  }

  out.bodiesCleared = (await db.emailOutbox.updateMany({
    where: { tenantId, status: { in: ['sent', 'failed', 'skipped', 'cancelled'] }, createdAt: { lt: new Date(now - p.outboxBodyRetentionDays * DAY) }, NOT: { html: null } },
    data: { html: null, text: null }
  })).count;

  out.attemptsDeleted = (await db.trialAttempt.deleteMany({ where: { tenantId, at: { lt: new Date(now - p.trialAttemptRetentionDays * DAY) } } })).count;
  return out;
}

module.exports = { applyRetention };
