'use strict';
// Small helpers shared by the /v1/admin/* routers. Every error is { error: '<code>', message, ...extra }.
const prisma = require('../db');
const { getSettings } = require('../settings');

function fail(res, status, error, message, extra = {}) {
  return res.status(status).json({ error, message, ...extra });
}

function invalid(res, fields, message = 'Some fields are not valid.') {
  return fail(res, 400, 'validation_failed', message, { fields });
}

function notFound(res, what = 'Record') {
  return fail(res, 404, 'not_found', `${what} not found.`);
}

async function settingsFor(req) {
  if (!req._settings) req._settings = await getSettings(prisma, req.tenant.id);
  return req._settings;
}

// A row of this tenant by id, or null.
async function own(model, req, id) {
  const row = await prisma[model].findUnique({ where: { id: String(id) } });
  return row && row.tenantId === req.tenant.id ? row : null;
}

function pageParams(q) {
  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(q.pageSize, 10) || 50));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function dateRange(q, fromKey, toKey) {
  const out = {};
  for (const [k, op] of [[fromKey, 'gte'], [toKey, 'lte']]) {
    if (q[k] === undefined || q[k] === '') continue;
    const d = new Date(String(q[k]));
    if (Number.isNaN(d.getTime())) return { error: k };
    out[op] = d;
  }
  return { range: Object.keys(out).length ? out : null };
}

const csvList = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);

module.exports = { fail, invalid, notFound, settingsFor, own, pageParams, dateRange, csvList };
