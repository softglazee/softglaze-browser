'use strict';
// /v1/admin/metrics: business metrics (definitions in src/metrics/maths.js and docs/ADMIN-API.md).
//   GET /            ?from=YYYY-MM&to=YYYY-MM&days=30  -> everything as JSON
//   GET /monthly     same range; ?format=csv for the investor month table as CSV
const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../middleware/asyncHandler');
const { invalid } = require('../http');
const { audit } = require('../audit');
const { computeMetrics, MONTHLY_COLUMNS } = require('../../metrics/compute');
const { isMonthKey } = require('../../util/time');
const { stringifyCsv } = require('../../util/csv');

const router = express.Router();

function params(q) {
  const errors = {};
  if (q.from !== undefined && !isMonthKey(q.from)) errors.from = 'YYYY-MM';
  if (q.to !== undefined && !isMonthKey(q.to)) errors.to = 'YYYY-MM';
  if (!errors.from && !errors.to && q.from && q.to && q.from > q.to) errors.from = 'must not be after to';
  const days = q.days === undefined ? 30 : Number.parseInt(q.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > 366) errors.days = '1-366';
  return { errors: Object.keys(errors).length ? errors : null, from: q.from, to: q.to, days };
}

router.get('/', asyncHandler(async (req, res) => {
  const p = params(req.query);
  if (p.errors) return invalid(res, p.errors);
  res.json(await computeMetrics(prisma, req.tenant.id, { from: p.from, to: p.to, days: p.days }));
}));

router.get('/monthly', asyncHandler(async (req, res) => {
  const p = params(req.query);
  if (p.errors) return invalid(res, p.errors);
  const m = await computeMetrics(prisma, req.tenant.id, { from: p.from, to: p.to, days: p.days });
  if (req.query.format === 'csv') {
    await audit(prisma, req, 'metrics.export', { detail: { from: p.from || null, to: p.to || null } });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="softglaze-metrics-${m.monthly.length ? m.monthly[0].month : 'none'}-to-${m.monthly.length ? m.monthly[m.monthly.length - 1].month : 'none'}.csv"`);
    return res.send('﻿' + stringifyCsv([MONTHLY_COLUMNS, ...m.monthly.map((r) => MONTHLY_COLUMNS.map((k) => r[k]))]));
  }
  res.json({ asOf: m.asOf, currency: m.currency, columns: MONTHLY_COLUMNS, rows: m.monthly });
}));

module.exports = router;
