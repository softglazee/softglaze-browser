'use strict';
// Email verification by us (spec A2).
// POST /v1/account/verify/start { tenantId, installId, installSecret, email, name?, consentMarketing, lang, country?, appVersion?, channel? }
//   -> 200 { ok: true, sent: true, expiresInSec, resendAfterSec }
//   errors: 400 invalid_email | disposable_email | no_mx, 429 rate_limited { retryAfterSec },
//           503 email_unavailable, 502 email_failed, + the install errors in installRequest.js
// POST /v1/account/verify/check { tenantId, installId, installSecret, email, code }
//   -> 200 { verified: true, customerId }
//   errors: 400 invalid_email | invalid_code { attemptsLeft? }, 404 no_code, 410 code_expired,
//           429 too_many_attempts
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { installRequest } = require('./installRequest');
const { startVerification, checkVerification } = require('../account/verify');

const router = express.Router();

router.post('/verify/start', asyncHandler(async (req, res) => {
  const ctx = await installRequest(req, res);
  if (!ctx) return;
  const { status, body } = await startVerification(prisma, ctx.tenant, ctx.install, req.body || {}, { ipHash: ctx.ipHash, settings: ctx.settings });
  if (body.retryAfterSec) res.set('Retry-After', String(body.retryAfterSec));
  res.status(status).json(body);
}));

router.post('/verify/check', asyncHandler(async (req, res) => {
  const ctx = await installRequest(req, res);
  if (!ctx) return;
  const { status, body } = await checkVerification(prisma, ctx.tenant, ctx.install, req.body || {}, { settings: ctx.settings });
  res.status(status).json(body);
}));

module.exports = router;
