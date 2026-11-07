'use strict';
// POST /v1/trial/start { tenantId, installId, installSecret, machineHash, email, appVersion? }
//   -> 200 { lease, exp, tier: 'enterprise', type: 'trial', trialEndsAt, currentPeriodEnd }
//      (the same signed lease format as /v1/license; asking again during the trial returns it again)
//   -> 409 { error: 'trial_used', reason: 'machine' | 'email' | 'network' }
//   other errors: 400 invalid_email, 403 email_not_verified, 409 already_licensed,
//                 + the install / machine errors in installRequest.js
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { installRequest } = require('./installRequest');
const { startTrial } = require('../trials/ledger');

const router = express.Router();

router.post('/start', asyncHandler(async (req, res) => {
  const ctx = await installRequest(req, res, { requireMachine: true });
  if (!ctx) return;
  const { status, body } = await startTrial(prisma, ctx.tenant, ctx.install, { email: (req.body || {}).email }, {
    ipHash: ctx.ipHash, ipCounts: ctx.ipCounts, settings: ctx.settings
  });
  res.status(status).json(body);
}));

module.exports = router;
