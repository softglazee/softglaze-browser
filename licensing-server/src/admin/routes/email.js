'use strict';
// /v1/admin/email: templates, automations, custom sends (preview / test to yourself / send), outbox
// and send log, sending status.
const express = require('express');
const crypto = require('node:crypto');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { fail, invalid, notFound, settingsFor, pageParams, dateRange, csvList } = require('../http');
const { audit } = require('../audit');
const { getTemplate, ensureDefaultTemplates, BUILT_IN_KEYS, LANGS } = require('../../email/templates');
const { builtIn } = require('../../email/defaults');
const { PLACEHOLDERS, unknownPlaceholders, unsafeHtml } = require('../../email/render');
const { renderFor, enqueue, sendNow, blockReason, processOutbox, sentInLast24h } = require('../../email/outbox');
const { AUTOMATIONS } = require('../../email/automations');
const transport = require('../../email/transport');
const { updateSettings } = require('../../settings');
const { buildWhere, pickFilters } = require('../../customers/query');
const { parseEmail } = require('../../customers/emailAddress');
const { asJson } = require('../../util/json');

const router = express.Router();
const CUSTOM_CATEGORIES = ['service', 'marketing'];
const MAX_RECIPIENTS = 5000;

function checkContent({ subject, html, text }) {
  const errors = {};
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) errors.subject = 'required, at most 200 characters';
  if (typeof html !== 'string' || !html.trim() || html.length > 100000) errors.html = 'required, at most 100000 characters';
  if (typeof text !== 'string' || !text.trim() || text.length > 50000) errors.text = 'required plain-text version, at most 50000 characters';
  if (!Object.keys(errors).length) {
    const unknown = unknownPlaceholders(subject, html, text);
    if (unknown.length) errors.placeholders = `unknown: ${unknown.join(', ')}; allowed: ${PLACEHOLDERS.join(', ')}`;
    if (unsafeHtml(html)) errors.html = 'scripts, frames, forms, event handlers and javascript: links are not allowed';
  }
  return Object.keys(errors).length ? errors : null;
}

const langOf = (v) => (LANGS.includes(v) ? v : 'en');

// ---- templates -------------------------------------------------------------------------------
router.get('/templates', asyncHandler(async (req, res) => {
  await ensureDefaultTemplates(prisma, req.tenant.id);
  const items = await prisma.emailTemplate.findMany({ where: { tenantId: req.tenant.id }, orderBy: [{ key: 'asc' }, { lang: 'asc' }] });
  res.json({ items, placeholders: PLACEHOLDERS, languages: LANGS, builtInKeys: BUILT_IN_KEYS });
}));

router.get('/templates/:key', asyncHandler(async (req, res) => {
  const lang = langOf(req.query.lang);
  const row = await prisma.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId: req.tenant.id, key: req.params.key, lang } } });
  if (!row) return notFound(res, 'Template');
  res.json({ template: row });
}));

// POST { key, lang, name, category: service | marketing, subject, html, text }: a new custom template.
router.post('/templates', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const errors = {};
  if (typeof b.key !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,59}$/.test(b.key)) errors.key = '2-60 lowercase letters, digits, - or _';
  else if (BUILT_IN_KEYS.includes(b.key)) errors.key = 'that is a built-in template; edit it with PUT';
  if (b.lang !== undefined && !LANGS.includes(b.lang)) errors.lang = LANGS.join(' | ');
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120) errors.name = 'required, at most 120 characters';
  if (!CUSTOM_CATEGORIES.includes(b.category)) errors.category = CUSTOM_CATEGORIES.join(' | ');
  Object.assign(errors, checkContent(b) || {});
  if (Object.keys(errors).length) return invalid(res, errors);
  const lang = langOf(b.lang);
  const exists = await prisma.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId: req.tenant.id, key: b.key, lang } } });
  if (exists) return fail(res, 409, 'template_exists', 'This template already exists in this language; change it with PUT.');
  const row = await prisma.emailTemplate.create({
    data: { tenantId: req.tenant.id, key: b.key, lang, name: b.name.trim(), category: b.category, subject: b.subject, html: b.html, text: b.text, builtIn: false, isDefault: false, updatedBy: req.admin.actor }
  });
  await audit(prisma, req, 'email.template.create', { targetType: 'template', targetId: `${b.key}:${lang}`, detail: { category: b.category } });
  res.status(201).json({ template: row });
}));

// PUT /:key { lang, subject, html, text, name?, category? (custom templates only) }
router.put('/templates/:key', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const key = req.params.key;
  const lang = langOf(b.lang);
  const isBuiltIn = BUILT_IN_KEYS.includes(key);
  const existing = await prisma.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId: req.tenant.id, key, lang } } });
  if (!existing && !isBuiltIn) return notFound(res, 'Template');
  const errors = checkContent(b) || {};
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120)) errors.name = 'at most 120 characters';
  if (b.category !== undefined) {
    if (isBuiltIn) { if (b.category !== builtIn(key, lang).category) errors.category = 'the category of a built-in template cannot change'; }
    else if (!CUSTOM_CATEGORIES.includes(b.category)) errors.category = CUSTOM_CATEGORIES.join(' | ');
  }
  if (Object.keys(errors).length) return invalid(res, errors);
  const base = existing || { ...builtIn(key, lang) };
  const data = {
    name: b.name !== undefined ? b.name.trim() : base.name,
    category: isBuiltIn ? builtIn(key, lang).category : (b.category || base.category),
    subject: b.subject, html: b.html, text: b.text, isDefault: false, updatedBy: req.admin.actor
  };
  const row = existing
    ? await prisma.emailTemplate.update({ where: { id: existing.id }, data })
    : await prisma.emailTemplate.create({ data: { tenantId: req.tenant.id, key, lang, builtIn: true, ...data } });
  await audit(prisma, req, 'email.template.update', { targetType: 'template', targetId: `${key}:${lang}` });
  res.json({ template: row });
}));

router.post('/templates/:key/reset', asyncHandler(async (req, res) => {
  const key = req.params.key;
  const lang = langOf((req.body || {}).lang || req.query.lang);
  if (!BUILT_IN_KEYS.includes(key)) return fail(res, 400, 'not_built_in', 'Only built-in templates can be reset.');
  const def = builtIn(key, lang);
  const data = { name: def.name, category: def.category, subject: def.subject, html: def.html, text: def.text, isDefault: true, builtIn: true, updatedBy: req.admin.actor };
  const row = await prisma.emailTemplate.upsert({
    where: { tenantId_key_lang: { tenantId: req.tenant.id, key, lang: def.lang } },
    update: data,
    create: { tenantId: req.tenant.id, key, lang: def.lang, ...data }
  });
  await audit(prisma, req, 'email.template.reset', { targetType: 'template', targetId: `${key}:${def.lang}` });
  res.json({ template: row });
}));

router.delete('/templates/:key', asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (BUILT_IN_KEYS.includes(key)) return fail(res, 400, 'built_in', 'Built-in templates cannot be deleted; reset them instead.');
  const lang = langOf(req.query.lang);
  const row = await prisma.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId: req.tenant.id, key, lang } } });
  if (!row) return notFound(res, 'Template');
  await prisma.emailTemplate.delete({ where: { id: row.id } });
  await audit(prisma, req, 'email.template.delete', { targetType: 'template', targetId: `${key}:${lang}` });
  res.json({ ok: true });
}));

const PREVIEW_ID = 'preview-only';
const SAMPLE = { id: PREVIEW_ID, name: 'Alex Example', email: 'alex@example.com', lang: 'en', tier: 'enterprise' };

// POST /:key/preview { lang?, customerId?, subject?, html?, text? } -> rendered; unsaved edits can be previewed.
router.post('/templates/:key/preview', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const lang = langOf(b.lang);
  const settings = await settingsFor(req);
  let customer = { ...SAMPLE, lang, trialEndsAt: new Date(Date.now() + 2 * 86400000) };
  if (b.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: String(b.customerId) } });
    if (!c || c.tenantId !== req.tenant.id) return notFound(res, 'Customer');
    customer = { ...c, id: PREVIEW_ID, lang };
  }
  let r;
  if (b.subject !== undefined || b.html !== undefined || b.text !== undefined) {
    const errors = checkContent(b);
    if (errors) return invalid(res, errors);
    const t = await getTemplate(prisma, req.tenant.id, req.params.key, lang);
    r = await renderFor(prisma, req.tenant.id, { customer, custom: b, category: (t && t.category) || 'service', settings, lang, extraVars: { code: '123456', codeMinutes: String(settings.verify.codeTtlMinutes) } });
  } else {
    const t = await getTemplate(prisma, req.tenant.id, req.params.key, lang);
    if (!t) return notFound(res, 'Template');
    r = await renderFor(prisma, req.tenant.id, { customer, templateKey: req.params.key, settings, lang, extraVars: { code: '123456', codeMinutes: String(settings.verify.codeTtlMinutes) } });
  }
  res.json({ subject: r.subject, html: r.html, text: r.text, category: r.category });
}));

// ---- automations -----------------------------------------------------------------------------
router.get('/automations', asyncHandler(async (req, res) => {
  const settings = await settingsFor(req);
  const items = [];
  for (const a of AUTOMATIONS) {
    const t = builtIn(a.key, 'en');
    items.push({ key: a.key, anchor: a.anchor === 'end' ? 'trialEnd' : 'trialStart', ...settings.automations[a.key], category: t.category, template: a.key, skipIfPaid: a.skipIfPaid });
  }
  res.json({ items, catchUpHours: settings.email.catchUpHours });
}));

// PUT /:key { enabled?, offsetHours? }
router.put('/automations/:key', asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!AUTOMATIONS.some((a) => a.key === key)) return notFound(res, 'Automation');
  const b = req.body || {};
  const patch = {};
  if (b.enabled !== undefined) patch.enabled = b.enabled;
  if (b.offsetHours !== undefined) patch.offsetHours = b.offsetHours;
  const r = await updateSettings(prisma, req.tenant.id, { automations: { [key]: patch } }, req.admin.actor);
  if (!r.ok) return invalid(res, r.errors);
  await audit(prisma, req, 'email.automation.update', { targetType: 'automation', targetId: key, detail: patch });
  res.json({ key, ...r.settings.automations[key] });
}));

// ---- custom sends ----------------------------------------------------------------------------
async function audienceOf(req, audience) {
  const a = audience && typeof audience === 'object' ? audience : {};
  let filters = null;
  if (Array.isArray(a.customerIds)) {
    if (!a.customerIds.length || a.customerIds.length > MAX_RECIPIENTS) return { error: { 'audience.customerIds': `1-${MAX_RECIPIENTS} ids` } };
    filters = { ids: a.customerIds.map(String).join(',') };
  } else if (a.segmentId) {
    const seg = await prisma.segment.findUnique({ where: { id: String(a.segmentId) } });
    if (!seg || seg.tenantId !== req.tenant.id) return { error: { 'audience.segmentId': 'unknown segment' } };
    filters = pickFilters(asJson(seg.filters) || {});
  } else if (a.filters && typeof a.filters === 'object') {
    filters = pickFilters(a.filters);
  } else {
    return { error: { audience: 'give customerIds, segmentId or filters' } };
  }
  delete filters.deleted; // never email deleted customers
  const { where, errors } = buildWhere(req.tenant.id, filters);
  if (errors) return { error: errors };
  const matched = await prisma.customer.findMany({ where, orderBy: [{ createdAt: 'asc' }], take: MAX_RECIPIENTS + 1 });
  if (matched.length > MAX_RECIPIENTS) return { error: { audience: `more than ${MAX_RECIPIENTS} customers; narrow the filter` } };
  return { matched };
}

// POST { mode: preview | test | send, audience: { customerIds | segmentId | filters }, category: service | marketing,
//        templateKey? | { subject, html, text }, lang?, testTo? (mode test) }
router.post('/send', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const mode = b.mode || 'preview';
  if (!['preview', 'test', 'send'].includes(mode)) return invalid(res, { mode: 'preview | test | send' });
  if (!CUSTOM_CATEGORIES.includes(b.category)) return invalid(res, { category: 'service (account and product notices, no consent needed) | marketing (needs consent)' });
  let category = b.category;
  if (b.templateKey) {
    const t = await getTemplate(prisma, req.tenant.id, String(b.templateKey), langOf(b.lang));
    if (!t) return invalid(res, { templateKey: 'unknown template' });
    if (t.category === 'essential') return invalid(res, { templateKey: 'essential templates (codes) cannot be sent by hand' });
    if (t.category === 'marketing' && category !== 'marketing') return invalid(res, { category: 'this template is marketing; send it as marketing' });
  } else {
    const errors = checkContent(b);
    if (errors) return invalid(res, errors);
  }
  const aud = await audienceOf(req, b.audience);
  if (aud.error) return invalid(res, aud.error);
  const skipped = {};
  const eligible = [];
  for (const c of aud.matched) {
    const why = blockReason(c, category);
    if (why) skipped[why] = (skipped[why] || 0) + 1; else eligible.push(c);
  }
  const settings = await settingsFor(req);
  const content = b.templateKey ? { templateKey: String(b.templateKey) } : { custom: { subject: b.subject, html: b.html, text: b.text } };
  const render = (c) => renderFor(prisma, req.tenant.id, { customer: c, ...content, category, settings, lang: b.lang || c.lang });
  // Previews and tests use the first recipient's data under a dummy id, so their unsubscribe link
  // can never unsubscribe a real customer.
  const asSample = (c) => ({ ...(c || SAMPLE), id: PREVIEW_ID });
  const counts = { matched: aud.matched.length, eligible: eligible.length, skipped };

  if (mode === 'preview') {
    const sample = eligible[0] || aud.matched[0] || null;
    const r = await render(asSample(sample));
    return res.json({ mode, counts, sample: { to: sample ? sample.email : null, subject: r.subject, html: r.html, text: r.text } });
  }
  if (!transport.isConfigured()) return fail(res, 503, 'email_unavailable', 'Email sending is not set up on the server yet.');
  if (mode === 'test') {
    const to = parseEmail(b.testTo);
    if (!to) return invalid(res, { testTo: 'your own email address' });
    const r = await render(asSample(eligible[0] || aud.matched[0]));
    const sent = await sendNow(prisma, req.tenant.id, { toEmail: to.email, rendered: { ...r, subject: `[Test] ${r.subject}` }, replyTo: settings.email.replyTo, createdBy: req.admin.actor, campaignId: 'test' });
    await audit(prisma, req, 'email.test', { detail: { category, templateKey: b.templateKey || null } });
    if (!sent.ok) return fail(res, 502, 'email_failed', 'The test email could not be sent.', { outboxId: sent.outboxId });
    return res.json({ mode, sent: true, counts });
  }

  const campaignId = `cmp_${crypto.randomBytes(9).toString('base64url')}`;
  let queued = 0;
  for (const c of eligible) {
    const r = await render(c);
    const row = await enqueue(prisma, req.tenant.id, {
      customer: c, templateKey: r.templateKey, category, campaignId, dedupeKey: `campaign:${campaignId}:${c.id}`,
      subject: r.subject, html: r.html, text: r.text, createdBy: req.admin.actor
    });
    if (row) queued += 1;
  }
  await audit(prisma, req, 'email.send', { detail: { campaignId, category, templateKey: b.templateKey || null, ...counts, queued } });
  // Start sending now (the daily cap still applies); the cron finishes whatever is left.
  setImmediate(() => { processOutbox(prisma, req.tenant, { settings, limit: 100 }).catch(() => {}); });
  res.status(202).json({ mode, campaignId, queued, counts });
}));

// ---- outbox / log ----------------------------------------------------------------------------
const summary = ({ html, text, ...row }) => row;

router.get('/outbox', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.status) where.status = { in: csvList(q.status) };
  if (q.category) where.category = { in: csvList(q.category) };
  if (q.customerId) where.customerId = String(q.customerId);
  if (q.campaignId) where.campaignId = String(q.campaignId);
  if (q.templateKey) where.templateKey = String(q.templateKey);
  const r = dateRange(q, 'from', 'to');
  if (r.error) return invalid(res, { [r.error]: 'invalid_date' });
  if (r.range) where.createdAt = r.range;
  const p = pageParams(q);
  const [total, items] = await Promise.all([
    prisma.emailOutbox.count({ where }),
    prisma.emailOutbox.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items: items.map(summary), total, page: p.page, pageSize: p.pageSize });
}));

router.get('/outbox/:id', asyncHandler(async (req, res) => {
  const row = await prisma.emailOutbox.findUnique({ where: { id: req.params.id } });
  if (!row || row.tenantId !== req.tenant.id) return notFound(res, 'Email');
  res.json({ email: row });
}));

router.post('/outbox/:id/retry', asyncHandler(async (req, res) => {
  const row = await prisma.emailOutbox.findUnique({ where: { id: req.params.id } });
  if (!row || row.tenantId !== req.tenant.id) return notFound(res, 'Email');
  if (!['failed', 'cancelled'].includes(row.status)) return fail(res, 409, 'not_retryable', 'Only failed or cancelled emails can be retried.');
  if (!row.html && !row.text) return fail(res, 409, 'no_body', 'The body of this email is no longer stored; send it again instead.');
  const updated = await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'queued', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  await audit(prisma, req, 'email.retry', { targetType: 'email', targetId: row.id });
  res.json({ email: summary(updated) });
}));

router.post('/outbox/:id/cancel', asyncHandler(async (req, res) => {
  const row = await prisma.emailOutbox.findUnique({ where: { id: req.params.id } });
  if (!row || row.tenantId !== req.tenant.id) return notFound(res, 'Email');
  const r = await prisma.emailOutbox.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'cancelled', lastError: 'cancelled by admin' } });
  if (r.count !== 1) return fail(res, 409, 'not_queued', 'Only a queued email can be cancelled.');
  await audit(prisma, req, 'email.cancel', { targetType: 'email', targetId: row.id });
  res.json({ ok: true });
}));

router.get('/status', asyncHandler(async (req, res) => {
  const settings = await settingsFor(req);
  const tenantId = req.tenant.id;
  const day = new Date(Date.now() - 86400000);
  const [sent, queued, failed] = await Promise.all([
    sentInLast24h(prisma, tenantId),
    prisma.emailOutbox.count({ where: { tenantId, status: 'queued' } }),
    prisma.emailOutbox.count({ where: { tenantId, status: 'failed', updatedAt: { gte: day } } })
  ]);
  res.json({ smtp: transport.publicConfig(), dailyCap: settings.email.dailyCap, sentLast24h: sent, queued, failedLast24h: failed });
}));

module.exports = router;
