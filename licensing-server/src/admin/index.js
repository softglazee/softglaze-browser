'use strict';
// /v1/admin/* (Bearer = tenant admin key or a scoped admin key; see src/admin/auth.js). Called by the
// website admin from its server, never from a browser. Documented in docs/ADMIN-API.md.
// Mounted before the global JSON parser so imports can be up to 10 MB.
const express = require('express');
const crypto = require('node:crypto');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const adminAuth = require('./auth');
const { audit } = require('./audit');
const { fail, invalid, notFound, settingsFor, own, pageParams, dateRange, csvList } = require('./http');
const { resetTrials } = require('./trialReset');
const { getSettings, updateSettings } = require('../settings');
const { pickFilters, buildWhere } = require('../customers/query');
const { resetMachine } = require('../machineBinding');
const { asJson } = require('../util/json');
const { listInfo } = require('../customers/disposable');
const transport = require('../email/transport');
const { forwardedChain, clientIp, trustHops, isPublicIp } = require('../net/clientIp');

const router = express.Router();
router.use(express.json({ limit: '10mb' }));
router.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));
router.use(adminAuth);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.use('/customers', require('./routes/customers'));
router.use('/licenses', require('./routes/licenses'));
router.use('/payments', require('./routes/payments'));
router.use('/plans', require('./routes/plans'));
router.use('/email', require('./routes/email'));
router.use('/metrics', require('./routes/metrics'));

// ---- trials ------------------------------------------------------------------------------------
router.get('/trials', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.customerId) where.customerId = String(q.customerId);
  if (q.installId) where.installId = String(q.installId);
  if (q.active === '1' || q.active === 'true') where.endsAt = { gt: new Date() };
  if (q.active === '0' || q.active === 'false') where.endsAt = { lte: new Date() };
  if (q.converted === '1' || q.converted === 'true') where.NOT = { convertedAt: null };
  if (q.converted === '0' || q.converted === 'false') where.convertedAt = null;
  const r = dateRange(q, 'from', 'to');
  if (r.error) return invalid(res, { [r.error]: 'invalid_date' });
  if (r.range) where.startedAt = r.range;
  const p = pageParams(q);
  const [total, rows] = await Promise.all([
    prisma.trial.count({ where }),
    prisma.trial.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  const items = rows.map(({ machineLock, emailLock, emailKeyHash, machineHash, ipHash, ...t }) => ({ ...t, machineLocked: Boolean(machineLock), emailLocked: Boolean(emailLock) }));
  res.json({ items, total, page: p.page, pageSize: p.pageSize });
}));

// POST /trials/:id/reset { release: 'all' | ['machine','email','network'], reason }
router.post('/trials/:id/reset', asyncHandler(async (req, res) => {
  const t = await own('trial', req, req.params.id);
  if (!t) return notFound(res, 'Trial');
  const r = await resetTrials(prisma, req, [t], req.body || {});
  if (r.error) return invalid(res, r.error);
  res.json(r);
}));

router.get('/trial-attempts', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.outcome) where.outcome = { in: csvList(q.outcome) };
  const r = dateRange(q, 'from', 'to');
  if (r.error) return invalid(res, { [r.error]: 'invalid_date' });
  if (r.range) where.at = r.range;
  const p = pageParams(q);
  const [total, rows] = await Promise.all([
    prisma.trialAttempt.count({ where }),
    prisma.trialAttempt.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items: rows.map(({ ipHash, ...a }) => a), total, page: p.page, pageSize: p.pageSize });
}));

// ---- installs ----------------------------------------------------------------------------------
router.get('/installs', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.customerId) where.customerId = String(q.customerId);
  if (q.unlinked === '1' || q.unlinked === 'true') where.customerId = null;
  const p = pageParams(q);
  const [total, rows] = await Promise.all([
    prisma.install.count({ where }),
    prisma.install.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items: rows.map(({ secretHash, ...i }) => ({ ...i, machineBound: Boolean(i.machineHash) })), total, page: p.page, pageSize: p.pageSize });
}));

router.post('/installs/:id/reset-machine', asyncHandler(async (req, res) => {
  const { status, body } = await resetMachine(prisma, req.tenant, req.params.id);
  if (status === 200) await audit(prisma, req, 'install.reset_machine', { targetType: 'install', targetId: req.params.id });
  if (status === 404) return notFound(res, 'Install');
  res.status(status).json(body);
}));

// ---- segments ----------------------------------------------------------------------------------
router.get('/segments', asyncHandler(async (req, res) => {
  const rows = await prisma.segment.findMany({ where: { tenantId: req.tenant.id }, orderBy: { name: 'asc' } });
  res.json({ items: rows.map((s) => ({ ...s, filters: asJson(s.filters) || {} })) });
}));

async function saveSegment(req, res, existing) {
  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : (existing ? existing.name : '');
  if (!name || name.length > 120) return invalid(res, { name: 'required, at most 120 characters' });
  const filters = b.filters !== undefined ? pickFilters(b.filters || {}) : asJson(existing && existing.filters) || {};
  const { errors } = buildWhere(req.tenant.id, filters);
  if (errors) return invalid(res, errors, 'Some filters are not valid.');
  const clash = await prisma.segment.findUnique({ where: { tenantId_name: { tenantId: req.tenant.id, name } } });
  if (clash && (!existing || clash.id !== existing.id)) return fail(res, 409, 'segment_exists', 'A segment with this name exists.');
  const row = existing
    ? await prisma.segment.update({ where: { id: existing.id }, data: { name, filters } })
    : await prisma.segment.create({ data: { tenantId: req.tenant.id, name, filters } });
  await audit(prisma, req, existing ? 'segment.update' : 'segment.create', { targetType: 'segment', targetId: row.id, detail: { filters } });
  return res.status(existing ? 200 : 201).json({ segment: { ...row, filters } });
}

router.post('/segments', asyncHandler(async (req, res) => saveSegment(req, res, null)));
router.patch('/segments/:id', asyncHandler(async (req, res) => {
  const s = await own('segment', req, req.params.id);
  if (!s) return notFound(res, 'Segment');
  return saveSegment(req, res, s);
}));
router.delete('/segments/:id', asyncHandler(async (req, res) => {
  const s = await own('segment', req, req.params.id);
  if (!s) return notFound(res, 'Segment');
  await prisma.segment.delete({ where: { id: s.id } });
  await audit(prisma, req, 'segment.delete', { targetType: 'segment', targetId: s.id });
  res.json({ ok: true });
}));

// ---- settings ----------------------------------------------------------------------------------
router.get('/settings', asyncHandler(async (req, res) => {
  res.json({ settings: await getSettings(prisma, req.tenant.id) });
}));

// PATCH { section: { key: value } }, e.g. { "email": { "dailyCap": 500 }, "trial": { "networkLimit": 3 } }
router.patch('/settings', asyncHandler(async (req, res) => {
  const r = await updateSettings(prisma, req.tenant.id, req.body || {}, req.admin.actor);
  if (!r.ok) return invalid(res, r.errors);
  await audit(prisma, req, 'settings.update', { detail: req.body });
  res.json({ settings: r.settings });
}));

// ---- audit log ---------------------------------------------------------------------------------
router.get('/audit', asyncHandler(async (req, res) => {
  const q = req.query;
  const where = { tenantId: req.tenant.id };
  if (q.action) where.action = { startsWith: String(q.action) };
  if (q.targetType) where.targetType = String(q.targetType);
  if (q.targetId) where.targetId = String(q.targetId);
  if (q.actor) where.actor = { contains: String(q.actor) };
  const r = dateRange(q, 'from', 'to');
  if (r.error) return invalid(res, { [r.error]: 'invalid_date' });
  if (r.range) where.at = r.range;
  const p = pageParams(q);
  const [total, items] = await Promise.all([
    prisma.adminAudit.count({ where }),
    prisma.adminAudit.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take })
  ]);
  res.json({ items: items.map((a) => ({ ...a, detail: asJson(a.detail) })), total, page: p.page, pageSize: p.pageSize });
}));

// ---- diagnostics -------------------------------------------------------------------------------
router.get('/diagnostics', asyncHandler(async (req, res) => {
  const settings = await settingsFor(req);
  const lock = await prisma.jobLock.findUnique({ where: { name: 'cron' } });
  const since = new Date(Date.now() - 30 * 86400000);
  const trials = await prisma.trial.findMany({ where: { tenantId: req.tenant.id, startedAt: { gte: since } } });
  const perNet = new Map();
  for (const t of trials) if (t.ipHash) perNet.set(t.ipHash, (perNet.get(t.ipHash) || 0) + 1);
  const busiest = [...perNet.values()].sort((a, b) => b - a).slice(0, 5);
  res.json({
    smtp: transport.publicConfig(),
    cron: lock ? { lastStartedAt: lock.lastStartedAt, lastFinishedAt: lock.lastFinishedAt, lastResult: asJson(lock.lastResult) } : null,
    disposableList: listInfo(),
    trustProxyHops: trustHops(),
    trialsLast30Days: trials.length,
    // If one network holds most trials, the client IP is probably a proxy's: check TRUST_PROXY_HOPS.
    busiestNetworksTrialCounts: busiest,
    networkLimit: settings.trial.networkLimit
  });
}));

// What the server sees for THIS request: lets the owner check TRUST_PROXY_HOPS (run.sh check-ip).
router.get('/diagnostics/request', asyncHandler(async (req, res) => {
  const ip = clientIp(req);
  res.json({
    chain: forwardedChain(req), // [socket address, then X-Forwarded-For from right to left]
    trustProxyHops: trustHops(),
    clientIp: ip,
    isPublic: isPublicIp(ip),
    requestId: crypto.randomBytes(6).toString('hex')
  });
}));

router.use((req, res) => fail(res, 404, 'not_found', 'Unknown admin endpoint.'));

module.exports = router;
