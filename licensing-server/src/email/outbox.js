'use strict';
// The outbox is also the send log. Rows are rendered when queued (the log shows exactly what went
// out), consent is checked again just before sending, failures retry with back-off (5 min, 30 min,
// 2 h, 6 h; 5 attempts) unless the SMTP server refused permanently, and a rolling 24-hour cap limits
// what the cron sends. Essential email (sign-in codes) is sent at once and is never held by the cap,
// but it counts towards it. Codes are never stored: their log row keeps the subject only.
const { renderEmail, varsFor } = require('./render');
const { getTemplate } = require('./templates');
const { unsubscribeUrl } = require('./unsubscribe');
const transport = require('./transport');

const BACKOFF_MIN = [5, 30, 120, 360];
const STALE_SENDING_MS = 10 * 60000;
const PRIORITY = { essential: 10, lifecycle: 5, service: 3, marketing: 1 };

// Why this customer must not get an email of this category now; null = allowed.
// essential: always (if not erased); lifecycle/service: not deleted, not unsubscribed;
// marketing: also needs marketing consent.
function blockReason(customer, category) {
  if (!customer) return category === 'essential' ? null : 'no_customer';
  if (!customer.email) return 'no_email';
  if (category === 'essential') return null;
  if (customer.deletedAt) return 'deleted';
  if (customer.unsubscribedAt) return 'unsubscribed';
  if (category === 'marketing' && !customer.marketingConsent) return 'no_consent';
  return null;
}

// Renders a template (or custom { subject, html, text }) for one customer.
async function renderFor(db, tenantId, { customer, templateKey, custom, category, settings, now = Date.now(), extraVars = {}, lang }) {
  let tpl;
  if (templateKey) {
    tpl = await getTemplate(db, tenantId, templateKey, lang || (customer && customer.lang) || 'en');
    if (!tpl) { const e = new Error(`Unknown template "${templateKey}".`); e.code = 'unknown_template'; throw e; }
  } else {
    tpl = { subject: custom.subject, html: custom.html, text: custom.text, lang: lang || (customer && customer.lang) || 'en' };
  }
  const cat = category || tpl.category || 'lifecycle';
  const unsub = cat !== 'essential' && customer && customer.id ? unsubscribeUrl(customer.id) : '';
  const vars = { ...varsFor({ customer: customer || {}, settings, unsubscribeUrl: unsub, now, lang: tpl.lang }), ...extraVars };
  const out = renderEmail({ ...tpl, category: cat }, vars);
  return { ...out, category: cat, unsubscribeUrl: unsub, templateKey: templateKey || null, lang: tpl.lang };
}

// Queues one email. A repeated dedupeKey is a no-op (returns null). opts.skipReason stores a
// "skipped" row instead (so an automation that does not apply is decided once).
async function enqueue(db, tenantId, opts) {
  const data = {
    tenantId,
    customerId: opts.customer ? opts.customer.id : null,
    toEmail: opts.toEmail || (opts.customer && opts.customer.email) || '',
    templateKey: opts.templateKey || null,
    category: opts.category,
    campaignId: opts.campaignId || null,
    dedupeKey: opts.dedupeKey || null,
    subject: String(opts.subject || '').slice(0, 250),
    html: opts.skipReason ? null : opts.html,
    text: opts.skipReason ? null : opts.text,
    priority: PRIORITY[opts.category] || 0,
    status: opts.skipReason ? 'skipped' : 'queued',
    lastError: opts.skipReason || null,
    nextAttemptAt: opts.at || new Date(),
    createdBy: opts.createdBy || null
  };
  try {
    return await db.emailOutbox.create({ data });
  } catch (e) {
    if (e && e.code === 'P2002') return null;
    throw e;
  }
}

async function sentInLast24h(db, tenantId, now = Date.now()) {
  return db.emailOutbox.count({ where: { tenantId, status: 'sent', sentAt: { gte: new Date(now - 86400000) } } });
}

// Sends immediately and logs it (codes, test sends). Returns { ok, messageId?, error? }.
// opts.redact: store the log row without the body.
async function sendNow(db, tenantId, { toEmail, customer, rendered, replyTo, createdBy, redact, campaignId }) {
  const row = await db.emailOutbox.create({
    data: {
      tenantId, customerId: customer ? customer.id : null, toEmail, templateKey: rendered.templateKey || null,
      category: rendered.category, campaignId: campaignId || null, subject: rendered.subject.slice(0, 250),
      html: redact ? null : rendered.html, text: redact ? null : rendered.text,
      priority: PRIORITY[rendered.category] || 0, status: 'sending', attempts: 1, lockedAt: new Date(), createdBy: createdBy || null
    }
  });
  try {
    const info = await transport.sendMail({
      to: toEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo,
      unsubscribeUrl: rendered.category === 'essential' ? null : rendered.unsubscribeUrl
    });
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), messageId: info.messageId, lockedAt: null } });
    return { ok: true, messageId: info.messageId, outboxId: row.id };
  } catch (e) {
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'failed', lastError: transport.describeError(e), lockedAt: null } });
    return { ok: false, error: e, outboxId: row.id };
  }
}

// Sends what is due. Returns counts. opts: { now, settings, limit }
async function processOutbox(db, tenant, { now = Date.now(), settings, limit = 200 } = {}) {
  const tenantId = tenant.id;
  const out = { sent: 0, failed: 0, retrying: 0, skipped: 0, heldByCap: 0, recovered: 0 };
  if (!transport.isConfigured()) return { ...out, notConfigured: true };

  // A row stuck in "sending" belongs to a run that died; put it back.
  const stale = await db.emailOutbox.updateMany({
    where: { tenantId, status: 'sending', lockedAt: { lt: new Date(now - STALE_SENDING_MS) } },
    data: { status: 'queued', lockedAt: null }
  });
  out.recovered = stale.count;

  const cap = settings.email.dailyCap;
  let used = await sentInLast24h(db, tenantId, now);
  const due = await db.emailOutbox.findMany({
    where: { tenantId, status: 'queued', nextAttemptAt: { lte: new Date(now) } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: limit
  });
  for (const row of due) {
    if (row.category !== 'essential' && used >= cap) { out.heldByCap += 1; continue; }
    const claim = await db.emailOutbox.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'sending', lockedAt: new Date(now) } });
    if (claim.count !== 1) continue;

    // Consent can change between queueing and sending.
    const customer = row.customerId ? await db.customer.findUnique({ where: { id: row.customerId } }) : null;
    const reason = row.customerId ? blockReason(customer, row.category) : null;
    if (reason) {
      await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'skipped', lastError: reason, lockedAt: null, html: null, text: null } });
      out.skipped += 1;
      continue;
    }
    try {
      const info = await transport.sendMail({
        to: row.toEmail, subject: row.subject, html: row.html, text: row.text, replyTo: settings.email.replyTo,
        unsubscribeUrl: row.category !== 'essential' && row.customerId ? unsubscribeUrl(row.customerId) : null
      });
      await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(now), messageId: info.messageId, attempts: row.attempts + 1, lockedAt: null } });
      used += 1;
      out.sent += 1;
    } catch (e) {
      const attempts = row.attempts + 1;
      const final = transport.isPermanent(e) || attempts >= row.maxAttempts;
      const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60000;
      await db.emailOutbox.update({
        where: { id: row.id },
        data: { status: final ? 'failed' : 'queued', attempts, lastError: transport.describeError(e), lockedAt: null, nextAttemptAt: new Date(now + wait) }
      });
      if (final) out.failed += 1; else out.retrying += 1;
    }
  }
  return out;
}

module.exports = { blockReason, renderFor, enqueue, sendNow, processOutbox, sentInLast24h, BACKOFF_MIN, PRIORITY };
