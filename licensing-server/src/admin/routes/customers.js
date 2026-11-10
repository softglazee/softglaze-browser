'use strict';
// /v1/admin/customers: list, export, import, get, create, update, soft delete, restore, erase, bulk,
// trial reset. See docs/ADMIN-API.md.
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { fail, invalid, notFound, settingsFor, own } = require('../http');
const { audit } = require('../audit');
const { buildWhere, pickFilters, orderBy, page, serializeCustomer, normalizeTags, tagIndexOf } = require('../../customers/query');
const { parseEmail } = require('../../customers/emailAddress');
const { isDisposableDomain } = require('../../customers/disposable');
const { STATUSES, effectiveStatus } = require('../../customers/state');
const { createCustomer, addEvent, recomputeCustomer } = require('../../customers/sync');
const { eraseCustomer } = require('../../customers/erase');
const { exportCsv, planImport, mergeForUpdate } = require('../../customers/csvIO');
const { resetTrials } = require('../trialReset');
const { asJson } = require('../../util/json');
const { methodsFor } = require('../../auth/accounts');

const router = express.Router();
const ADMIN_SOURCES = ['manual', 'import', 'invoice', 'website'];
const PHONE_RE = /^[0-9+()\-.\s]{3,40}$/;

// -> { data, errors }. create: email required, source defaults to manual.
function validateCustomer(b, { create }) {
  const errors = {};
  const data = {};
  const has = (k) => b[k] !== undefined;
  if (create || has('email')) {
    const p = parseEmail(b.email);
    if (!p) errors.email = 'invalid_email'; else { data.email = p.email; data.emailKey = p.emailKey; data._domain = p.domain; }
  }
  for (const [k, n] of [['name', 200], ['company', 200], ['notes', 10000], ['statusNote', 2000]]) {
    if (!has(k)) continue;
    if (b[k] === null || b[k] === '') data[k] = null;
    else if (typeof b[k] !== 'string' || b[k].length > n) errors[k] = `string, at most ${n} characters`;
    else data[k] = b[k].trim();
  }
  if (has('phone')) {
    if (b.phone === null || b.phone === '') data.phone = null;
    else if (typeof b.phone !== 'string' || !PHONE_RE.test(b.phone.trim())) errors.phone = 'digits, spaces and + ( ) - . only';
    else data.phone = b.phone.trim();
  }
  if (has('country')) {
    if (b.country === null || b.country === '') data.country = null;
    else if (typeof b.country !== 'string' || !/^[A-Za-z]{2}$/.test(b.country)) errors.country = 'ISO 3166-1 alpha-2, e.g. PK';
    else data.country = b.country.toUpperCase();
  }
  if (has('lang')) {
    if (b.lang === null || b.lang === '') data.lang = null;
    else if (typeof b.lang !== 'string' || !/^[a-z]{2}$/.test(b.lang)) errors.lang = 'two-letter language code';
    else data.lang = b.lang;
  }
  if (create || has('source')) {
    const s = b.source === undefined ? 'manual' : b.source;
    if (!ADMIN_SOURCES.includes(s)) errors.source = ADMIN_SOURCES.join(' | '); else data.source = s;
  }
  if (has('tags')) {
    if (!(Array.isArray(b.tags) || typeof b.tags === 'string')) errors.tags = 'array of strings';
    else { data.tags = normalizeTags(b.tags); data.tagIndex = tagIndexOf(data.tags); }
  }
  if (has('marketingConsent')) {
    if (typeof b.marketingConsent !== 'boolean') errors.marketingConsent = 'boolean';
    else if (b.marketingConsent && (typeof b.consentSource !== 'string' || !b.consentSource.trim() || b.consentSource.length > 40)) {
      errors.consentSource = 'say where the consent was given (e.g. "invoice form", "call 7 Nov"), at most 40 characters';
    } else data.marketingConsent = b.marketingConsent;
  }
  if (has('unsubscribed')) {
    if (typeof b.unsubscribed !== 'boolean') errors.unsubscribed = 'boolean'; else data._unsubscribed = b.unsubscribed;
  }
  if (has('statusOverride')) {
    if (b.statusOverride === null || b.statusOverride === '') data.statusOverride = null;
    else if (!STATUSES.includes(b.statusOverride)) errors.statusOverride = STATUSES.join(' | ');
    else if (!(typeof b.statusNote === 'string' && b.statusNote.trim())) errors.statusNote = 'a note is required when overriding the status';
    else data.statusOverride = b.statusOverride;
  }
  return { data, errors: Object.keys(errors).length ? errors : null };
}

// Fields changed (names only, for the audit log).
const changedKeys = (before, data) => Object.keys(data).filter((k) => !k.startsWith('_') && k !== 'tagIndex' && JSON.stringify(before[k]) !== JSON.stringify(data[k]));

router.get('/', asyncHandler(async (req, res) => {
  const { where, errors } = buildWhere(req.tenant.id, pickFilters(req.query));
  if (errors) return invalid(res, errors, 'Some filters are not valid.');
  const p = page(req.query);
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, orderBy: orderBy(req.query.sort, req.query.order), skip: p.skip, take: p.take })
  ]);
  res.json({ items: rows.map(serializeCustomer), total, page: p.page, pageSize: p.pageSize });
}));

router.get('/export', asyncHandler(async (req, res) => {
  const filters = pickFilters(req.query);
  const { where, errors } = buildWhere(req.tenant.id, filters);
  if (errors) return invalid(res, errors, 'Some filters are not valid.');
  const rows = await prisma.customer.findMany({ where, orderBy: orderBy(req.query.sort, req.query.order) });
  await audit(prisma, req, 'customers.export', { detail: { filters, count: rows.length } });
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="customers-${day}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send('﻿' + exportCsv(rows));
}));

// POST /import { csv, dryRun = true, onExisting = 'skip' | 'update' } (or a text/csv body with ?dryRun=&onExisting=)
router.post('/import', asyncHandler(async (req, res) => {
  const isText = typeof req.body === 'string';
  const csv = isText ? req.body : req.body && req.body.csv;
  const opts = isText ? req.query : (req.body || {});
  if (typeof csv !== 'string' || !csv.trim()) return fail(res, 400, 'bad_request', 'Send the file as { "csv": "..." } or as text/csv.');
  const dryRun = !(opts.dryRun === false || opts.dryRun === 'false' || opts.dryRun === '0');
  const onExisting = opts.onExisting === 'update' ? 'update' : 'skip';
  const settings = await settingsFor(req);
  const tenantId = req.tenant.id;

  const existing = new Map((await prisma.customer.findMany({ where: { tenantId } })).map((c) => [c.emailKey, c]));
  const plan = planImport(csv, existing, { onExisting, settings });
  if (plan.error) return fail(res, 400, plan.error, 'The file could not be read as a customer CSV.', plan.max ? { max: plan.max } : {});
  if (dryRun) return res.json({ dryRun: true, onExisting, ...plan });

  const results = { created: 0, updated: 0, skipped: plan.summary.skip, errors: plan.summary.error };
  for (const it of plan.items) {
    if (it.action === 'create') {
      const { tags, ...rest } = it.data;
      try {
        const c = await createCustomer(prisma, tenantId, { ...rest, ...(tags ? { tags, tagIndex: tagIndexOf(tags) } : {}), firstSeenAt: new Date() });
        it.customerId = c.id;
        results.created += 1;
      } catch (e) {
        if (!e || e.code !== 'P2002') throw e;
        it.action = 'error'; it.errors = ['exists_now'];
        results.errors += 1;
      }
    } else if (it.action === 'update') {
      const c = existing.get(it.data.emailKey);
      const data = mergeForUpdate(c, it.data);
      if (Object.keys(data).length) {
        await prisma.customer.update({ where: { id: c.id }, data });
        await addEvent(prisma, tenantId, c.id, 'imported', { fields: Object.keys(data).filter((k) => k !== 'tagIndex') });
      }
      results.updated += 1;
    }
    delete it.data;
  }
  await audit(prisma, req, 'customers.import', { detail: { onExisting, ...results, rows: plan.summary.rows } });
  res.json({ dryRun: false, onExisting, results, items: plan.items, ignoredColumns: plan.ignoredColumns });
}));

router.post('/bulk', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 5000) : null;
  if (!ids || !ids.length) return invalid(res, { ids: 'non-empty array of customer ids' });
  const action = b.action;
  if (!['addTags', 'removeTags', 'delete', 'restore'].includes(action)) return invalid(res, { action: 'addTags | removeTags | delete | restore' });
  const tags = normalizeTags(b.tags || []);
  if ((action === 'addTags' || action === 'removeTags') && !tags.length) return invalid(res, { tags: 'at least one tag' });
  const rows = await prisma.customer.findMany({ where: { tenantId: req.tenant.id, id: { in: ids } } });
  let changed = 0;
  for (const c of rows) {
    if (action === 'delete' || action === 'restore') {
      if ((action === 'delete') === Boolean(c.deletedAt)) continue;
      await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: action === 'delete' ? new Date() : null } });
      await addEvent(prisma, req.tenant.id, c.id, action === 'delete' ? 'deleted' : 'restored', { bulk: true });
      changed += 1;
      continue;
    }
    const current = asJson(c.tags) || [];
    const next = action === 'addTags' ? normalizeTags([...current, ...tags]) : current.filter((t) => !tags.includes(t));
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    await prisma.customer.update({ where: { id: c.id }, data: { tags: next, tagIndex: tagIndexOf(next) } });
    changed += 1;
  }
  await audit(prisma, req, `customers.bulk.${action}`, { detail: { requested: ids.length, found: rows.length, changed, tags } });
  res.json({ ok: true, found: rows.length, changed });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const c = await own('customer', req, req.params.id);
  if (!c) return notFound(res, 'Customer');
  const tenantId = req.tenant.id;
  const where = { tenantId, customerId: c.id };
  const [installs, trials, licenses, payments, emails, events, identities, sessions] = await Promise.all([
    prisma.install.findMany({ where, orderBy: { createdAt: 'desc' } }),
    prisma.trial.findMany({ where, orderBy: { startedAt: 'desc' } }),
    prisma.license.findMany({ where, orderBy: { createdAt: 'desc' } }),
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' } }),
    prisma.emailOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.customerEvent.findMany({ where, orderBy: { at: 'desc' }, take: 200 }),
    prisma.identity.findMany({ where, orderBy: { createdAt: 'asc' } }),
    prisma.authSession.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 })
  ]);
  const timeline = [
    ...events.map((e) => ({ at: e.at, kind: 'event', type: e.type, data: asJson(e.data) })),
    ...installs.map((i) => ({ at: i.createdAt, kind: 'install', type: 'install_registered', data: { installId: i.id, appVersion: i.appVersion } })),
    ...licenses.map((l) => ({ at: l.createdAt, kind: 'licence', type: 'licence_created', data: { licenseId: l.id, tier: l.tier, status: l.status, until: l.currentPeriodEnd, complimentary: l.complimentary } })),
    ...payments.map((p) => ({ at: p.paidAt || p.createdAt, kind: 'payment', type: `payment_${p.status}`, data: { paymentId: p.id, amount: p.amount, currency: p.currency, provider: p.provider, method: p.method } })),
    ...emails.map((m) => ({ at: m.sentAt || m.createdAt, kind: 'email', type: `email_${m.status}`, data: { outboxId: m.id, templateKey: m.templateKey, subject: m.subject, category: m.category } }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({
    customer: serializeCustomer(c),
    installs: installs.map(({ secretHash, ...i }) => i),
    trials: trials.map(({ machineLock, emailLock, emailKeyHash, ...t }) => ({ ...t, machineLocked: Boolean(machineLock), emailLocked: Boolean(emailLock) })),
    licenses,
    payments,
    emails: emails.map(({ html, text, ...m }) => m),
    // One-click sign-in (app 1.0.26): the linked methods, plus "email" when the email is verified, and the
    // latest sign-ins (never the session token, only where and when).
    signInMethods: await methodsFor(prisma, tenantId, c),
    signIns: sessions.map((s) => ({ id: s.id, provider: s.provider, installId: s.installId, at: s.createdAt, lastUsedAt: s.lastUsedAt, revokedAt: s.revokedAt })),
    identities: identities.map((i) => ({ id: i.id, provider: i.provider, email: i.email, login: i.login, emailVerified: i.emailVerified, linkedAt: i.createdAt, lastUsedAt: i.lastUsedAt })),
    timeline
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { data, errors } = validateCustomer(req.body || {}, { create: true });
  if (errors) return invalid(res, errors);
  const tenantId = req.tenant.id;
  const dup = await prisma.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: data.emailKey } } });
  if (dup) return fail(res, 409, 'customer_exists', 'A customer with this email already exists.', { customerId: dup.id, deleted: Boolean(dup.deletedAt) });
  const settings = await settingsFor(req);
  const warnings = isDisposableDomain(data._domain, { allow: settings.email.domainAllowlist, block: settings.email.domainBlocklist }) ? ['disposable_email'] : [];
  const { _domain, _unsubscribed, statusNote, ...rest } = data;
  const now = new Date();
  const c = await createCustomer(prisma, tenantId, {
    ...rest,
    ...(rest.statusOverride ? { statusNote: statusNote || null, status: rest.statusOverride } : {}),
    ...(rest.marketingConsent ? { consentAt: now, consentSource: String(req.body.consentSource).trim() } : {}),
    ...(_unsubscribed ? { unsubscribedAt: now, marketingConsent: false } : {})
  });
  await audit(prisma, req, 'customer.create', { targetType: 'customer', targetId: c.id, detail: { source: c.source, fields: Object.keys(rest).filter((k) => k !== 'tagIndex' && k !== 'emailKey') } });
  res.status(201).json({ customer: serializeCustomer(c), warnings });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const c = await own('customer', req, req.params.id);
  if (!c) return notFound(res, 'Customer');
  const { data, errors } = validateCustomer(req.body || {}, { create: false });
  if (errors) return invalid(res, errors);
  const tenantId = req.tenant.id;
  const now = new Date();
  const { _domain, _unsubscribed, ...upd } = data;
  if (upd.emailKey && upd.emailKey !== c.emailKey) {
    const dup = await prisma.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: upd.emailKey } } });
    if (dup) return fail(res, 409, 'customer_exists', 'Another customer already has this email.', { customerId: dup.id });
    upd.emailVerifiedAt = null; // a new address has not been verified by us
  }
  if (upd.marketingConsent === true && !c.marketingConsent) Object.assign(upd, { consentAt: now, consentSource: String(req.body.consentSource).trim(), unsubscribedAt: null });
  if (upd.marketingConsent === false && c.marketingConsent) Object.assign(upd, { consentAt: now, consentSource: 'admin' });
  if (upd.marketingConsent === c.marketingConsent) delete upd.marketingConsent;
  if (_unsubscribed === true && !c.unsubscribedAt) Object.assign(upd, { unsubscribedAt: now, marketingConsent: false });
  if (_unsubscribed === false && c.unsubscribedAt) upd.unsubscribedAt = null;
  if ('statusOverride' in upd) {
    upd.status = effectiveStatus({ ...c, statusOverride: upd.statusOverride });
    if (upd.statusOverride === null) upd.statusNote = null;
  }
  const changed = changedKeys(c, upd);
  if (!changed.length) return res.json({ customer: serializeCustomer(c), changed: [] });
  const updated = await prisma.customer.update({ where: { id: c.id }, data: upd });
  if (changed.includes('statusOverride')) await addEvent(prisma, tenantId, c.id, 'status_override', { to: upd.statusOverride, note: Boolean(upd.statusNote) });
  if (changed.includes('marketingConsent')) await addEvent(prisma, tenantId, c.id, 'consent', { marketing: updated.marketingConsent, source: updated.consentSource });
  if (changed.includes('unsubscribedAt')) await addEvent(prisma, tenantId, c.id, updated.unsubscribedAt ? 'unsubscribed' : 'resubscribed', { via: 'admin' });
  if (changed.includes('notes')) await addEvent(prisma, tenantId, c.id, 'notes_updated', null);
  await audit(prisma, req, 'customer.update', { targetType: 'customer', targetId: c.id, detail: { fields: changed } });
  res.json({ customer: serializeCustomer(updated), changed });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await own('customer', req, req.params.id);
  if (!c) return notFound(res, 'Customer');
  if (!c.deletedAt) {
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    await prisma.emailOutbox.updateMany({ where: { tenantId: c.tenantId, customerId: c.id, status: 'queued' }, data: { status: 'cancelled', lastError: 'customer_deleted' } });
    await addEvent(prisma, c.tenantId, c.id, 'deleted', null);
    await audit(prisma, req, 'customer.delete', { targetType: 'customer', targetId: c.id });
  }
  res.json({ ok: true, deleted: true });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const c = await own('customer', req, req.params.id);
  if (!c) return notFound(res, 'Customer');
  if (c.deletedAt) {
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: null } });
    await addEvent(prisma, c.tenantId, c.id, 'restored', { by: 'admin' });
    await audit(prisma, req, 'customer.restore', { targetType: 'customer', targetId: c.id });
  }
  const settings = await settingsFor(req);
  const fresh = await recomputeCustomer(prisma, c.tenantId, c.id, { graceDays: settings.billing.renewalGraceDays });
  res.json({ customer: serializeCustomer(fresh) });
}));

// Privacy erase. Body: { confirm: "<the customer's email>" }.
router.post('/:id/erase', asyncHandler(async (req, res) => {
  const c = await own('customer', req, req.params.id);
  if (!c) return notFound(res, 'Customer');
  const confirm = parseEmail((req.body || {}).confirm);
  if (!confirm || confirm.emailKey !== c.emailKey) return fail(res, 400, 'confirm_mismatch', 'Type the customer\'s email address in "confirm" to erase them.');
  const kept = await eraseCustomer(prisma, req.tenant.id, c.id);
  await audit(prisma, req, 'customer.erase', { targetType: 'customer', targetId: c.id, detail: { kept } });
  res.json({ erased: true, kept });
}));

// Clear the trial locks of this customer's trials so they can start another. Body: { release, reason }.
router.post('/:id/reset-trial', asyncHandler(async (req, res) => {
  const c = await own('customer', req, req.params.id);
  if (!c) return notFound(res, 'Customer');
  const trials = await prisma.trial.findMany({ where: { tenantId: req.tenant.id, customerId: c.id } });
  if (!trials.length) return fail(res, 404, 'no_trial', 'This customer has no trial.');
  const r = await resetTrials(prisma, req, trials, req.body || {});
  if (r.error) return invalid(res, r.error);
  res.json(r);
}));

module.exports = router;
