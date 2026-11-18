'use strict';
// Exactly-once processing for payment events (webhooks, and Safepay's return-page verification).
// The WebhookEvent insert is the lock (P2002 means another delivery owns it). prepare() makes provider
// calls outside any transaction; apply(tx) commits with marking the event processed. On failure the
// row is deleted so the provider's retry is reprocessed. Returns false for a duplicate.
const prisma = require('./db');
const { syncRecentLicences } = require('./customers/sync');

// An event row that is still unprocessed this long after it was claimed belongs to an
// attempt that died mid-way (crash, killed container); a retry may take it over.
const STALE_CLAIM_MS = 10 * 60000;

async function claimEvent(db, id, tenantId, provider, type) {
  try {
    await db.webhookEvent.create({ data: { id, tenantId, provider, type: type || '' } });
    return true;
  } catch (e) {
    if (!e || e.code !== 'P2002') throw e;
    const takeover = await db.webhookEvent.updateMany({
      where: { id, processedAt: null, receivedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      data: { receivedAt: new Date() }
    });
    return Boolean(takeover && takeover.count === 1);
  }
}

async function handleOnce(tenantId, provider, eventId, type, prepare, db = prisma) {
  const id = eventId ? String(eventId) : null;
  if (id && !(await claimEvent(db, id, tenantId, provider, type))) return false;
  try {
    const apply = await prepare();
    await db.$transaction(async (tx) => {
      if (apply) await apply(tx);
      if (id) await tx.webhookEvent.update({ where: { id }, data: { processedAt: new Date() } });
    });
  } catch (e) {
    if (id) await db.webhookEvent.delete({ where: { id } }).catch(() => {});
    throw e;
  }
  // After the commit, outside the provider's response path: bring the customer records up to date
  // (status paid, paid until). Best effort; the cron reconcile catches anything missed.
  setImmediate(() => { syncRecentLicences(db, tenantId).catch(() => {}); });
  return true;
}

module.exports = { handleOnce, STALE_CLAIM_MS };
