'use strict';
// The outbox is also the send log. Rows are rendered when queued (the log shows exactly what went
// out), consent is checked again just before sending, failures retry with back-off (5 min, 30 min,
// 2 h, 6 h; 5 attempts) unless the SMTP server refused permanently, and a rolling 24-hour cap limits
// what the cron sends. Essential email (sign-in codes) is sent at once and is never held by the cap,
// but it counts towards it. Codes are never stored: their log row keeps the subject only, except
// while a sign-in code waits for a retry after the SMTP connection dropped (its body is cleared once
// it is sent, fails or can no longer be used).
const { renderEmail, varsFor } = require('./render');
const { getTemplate } = require('./templates');
const { unsubscribeUrl } = require('./unsubscribe');
const transport = require('./transport');

const BACKOFF_MIN = [5, 30, 120, 360];
const STALE_SENDING_MS = 10 * 60000;
const PRIORITY = { essential: 10, lifecycle: 5, service: 3, marketing: 1 };
// A queued verify_code row carries this dedupe key + the EmailVerification id: it is only sent while
// that code can still be used.
const VERIFY_KEY_PREFIX = 'verify:';
const verifyIdOf = (row) => (row.dedupeKey && row.dedupeKey.startsWith(VERIFY_KEY_PREFIX) ? row.dedupeKey.slice(VERIFY_KEY_PREFIX.length) : null);

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

// Sends immediately and logs it (codes, test sends). Transient connection errors are retried at once
// (transport.sendMail with retry). Returns { ok, messageId?, error?, queued? }.
// opts.redact: store the log row without the body.
// opts.queueOnTransient: if the send still fails for a transient reason, keep the row queued and due
// now (with its body, even when redacted) for the next cron run instead of failing it -> { queued: true }.
// opts.dedupeKey: stored on the row (a verify_code uses verify:<EmailVerification id>).
async function sendNow(db, tenantId, { toEmail, customer, rendered, replyTo, createdBy, redact, campaignId, queueOnTransient, dedupeKey }) {
  const row = await db.emailOutbox.create({
    data: {
      tenantId, customerId: customer ? customer.id : null, toEmail, templateKey: rendered.templateKey || null,
      category: rendered.category, campaignId: campaignId || null, dedupeKey: dedupeKey || null, subject: rendered.subject.slice(0, 250),
      html: redact ? null : rendered.html, text: redact ? null : rendered.text,
      priority: PRIORITY[rendered.category] || 0, status: 'sending', attempts: 1, lockedAt: new Date(), createdBy: createdBy || null
    }
  });
  try {
    const info = await transport.sendMail({
      to: toEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo,
      unsubscribeUrl: rendered.category === 'essential' ? null : rendered.unsubscribeUrl
    }, { retry: true });
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), messageId: info.messageId, lockedAt: null } });
    return { ok: true, messageId: info.messageId, outboxId: row.id };
  } catch (e) {
    if (queueOnTransient && transport.isTransient(e)) {
      // Due now, so the next cron run sends it whenever it starts.
      await db.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'queued', lastError: transport.describeError(e), lockedAt: null, nextAttemptAt: new Date(), html: rendered.html, text: rendered.text }
      });
      return { ok: false, queued: true, error: e, outboxId: row.id };
    }
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'failed', lastError: transport.describeError(e), lockedAt: null } });
    return { ok: false, error: e, outboxId: row.id };
  }
}

// A queued sign-in code that can no longer be used (expired, replaced by a newer one, already
// proven) must not go out. -> reason | null
async function codeRowBlockReason(db, row, now) {
  const id = verifyIdOf(row);
  if (!id) return null;
  const v = await db.emailVerification.findUnique({ where: { id } });
  if (!v) return 'code_gone';
  if (v.verifiedAt) return 'code_used';
  if (new Date(v.expiresAt).getTime() <= now) return 'code_expired';
  return null;
}

// Sends one row this caller has already claimed (status 'sending'). -> 'sent' | 'failed' | 'retrying' | 'skipped'
// opts.immediate: someone is waiting (not the cron): transient errors are retried at once, and a row
// that still fails is due again straight away, so the next cron run sends it.
async function sendClaimed(db, row, settings, now = Date.now(), { immediate = false } = {}) {
  // Consent can change between queueing and sending.
  const customer = row.customerId ? await db.customer.findUnique({ where: { id: row.customerId } }) : null;
  const reason = (row.customerId ? blockReason(customer, row.category) : null) || await codeRowBlockReason(db, row, now);
  const isCode = Boolean(verifyIdOf(row));
  if (reason) {
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: 'skipped', lastError: reason, lockedAt: null, html: null, text: null } });
    return 'skipped';
  }
  try {
    const info = await transport.sendMail({
      to: row.toEmail, subject: row.subject, html: row.html, text: row.text, replyTo: settings.email.replyTo,
      unsubscribeUrl: row.category !== 'essential' && row.customerId ? unsubscribeUrl(row.customerId) : null
    }, { retry: immediate });
    await db.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date(now), messageId: info.messageId, attempts: row.attempts + 1, lockedAt: null, ...(isCode ? { html: null, text: null } : {}) }
    });
    return 'sent';
  } catch (e) {
    const attempts = row.attempts + 1;
    const final = transport.isPermanent(e) || attempts >= row.maxAttempts;
    // The first immediate send failing for a transient reason leaves the row due at once, so the next
    // cron run takes it (a time a few minutes ahead can land just after a cron tick and wait a whole
    // interval). Later failures back off as usual.
    const wait = immediate && attempts === 1 && transport.isTransient(e) ? 0 : BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60000;
    await db.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: final ? 'failed' : 'queued', attempts, lastError: transport.describeError(e), lockedAt: null, nextAttemptAt: new Date(now + wait),
        ...(final && isCode ? { html: null, text: null } : {})
      }
    });
    return final ? 'failed' : 'retrying';
  }
}

// Sends one queued row now, outside the cron (an activation code right after payment). Same rules as
// processOutbox (a row waiting for its retry time is left alone); a failure stays queued for the
// cron's retries. -> { status }
async function deliverQueued(db, tenantId, id, { settings, now = Date.now() } = {}) {
  if (!transport.isConfigured()) return { status: 'not_configured' };
  const claim = await db.emailOutbox.updateMany({ where: { id, tenantId, status: 'queued', nextAttemptAt: { lte: new Date(now) } }, data: { status: 'sending', lockedAt: new Date(now) } });
  if (claim.count !== 1) return { status: 'not_queued' };
  const row = await db.emailOutbox.findUnique({ where: { id } });
  return { status: await sendClaimed(db, row, settings, now, { immediate: true }) };
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
    const r = await sendClaimed(db, row, settings, now);
    if (r === 'sent') used += 1;
    out[r] += 1;
  }
  return out;
}

module.exports = { blockReason, renderFor, enqueue, sendNow, processOutbox, deliverQueued, sentInLast24h, BACKOFF_MIN, PRIORITY, VERIFY_KEY_PREFIX };
