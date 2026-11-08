'use strict';
// POST /v1/account/status { tenantId, installId, installSecret, appVersion?, channel? }
//   -> 200 { verified: true, email } | { verified: false }
// Whether this install has a customer whose email was verified on it (src/account/verify.js). The app
// (1.0.23+) asks on every start and shows "Confirm your email" while the answer is false. Mounted before
// /v1/account with the general rate limit, because every start calls it (offices share one address).
// Errors: the install errors in installRequest.js (400 bad_request, 404 unknown_tenant, 401 invalid_install).
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { installRequest } = require('./installRequest');
const { accountStatus } = require('../account/verify');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const ctx = await installRequest(req, res);
  if (!ctx) return;
  res.set('Cache-Control', 'no-store');
  res.json(await accountStatus(prisma, ctx.tenant, ctx.install));
}));

module.exports = router;
