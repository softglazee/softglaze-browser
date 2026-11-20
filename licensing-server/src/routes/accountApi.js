'use strict';
// The signed-in account, for the web app and the phone app (Authorization: Bearer <web access token or phone
// token>). Mounted at /v1/account next to the desktop's install-authenticated /v1/account/verify/*; only the
// paths below are handled here. CORS: the origins in WEB_APP_ORIGINS.
//
//   GET  /v1/account/me                      -> { account: { id, email, name, tier, status, plan }, methods }
//   GET  /v1/account/sessions                -> { sessions: [{ id, kind, provider, client, device, userAgent,
//                                                createdAt, lastUsedAt, expiresAt, current, live }] }
//   POST /v1/account/sessions/:id/revoke     -> { ok, revoked } | 404 not_found
//   POST /v1/account/sign-out-all            -> { ok, revoked }: desktop, phone and web, this session included
//   POST /v1/account/delete-request { reason? } -> 202 { ok, requested, alreadyRequestedToday }
//   GET  /v1/account/licence                 -> { tier, status, paidUntil, trialEndsAt, complimentaryUntil, seats,
//                                                phonesAllowed, phonesUsed, licences: [...] }
// 401 session_invalid when the token is unknown, ended or (web) past its 15 minutes: refresh, then retry.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { rateLimit } = require('../middleware/rateLimit');
const { getSettings } = require('../settings');
const { bearerSession, bearerOf } = require('../auth/sessions');
const api = require('../auth/accountApi');
const { webCors } = require('./authHttp');

const router = express.Router();
const PATHS = ['/me', '/sessions', '/sessions/:id/revoke', '/sign-out-all', '/delete-request', '/licence'];
const limiter = rateLimit({ windowMs: 60000, max: Number(process.env.ACCOUNT_API_RATE_PER_MIN) || 120 });
router.use(PATHS, webCors('GET, POST, OPTIONS'), limiter);

function handler(fn) {
  return asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const found = await bearerSession(prisma, bearerOf(req), { kinds: ['web', 'mobile'] });
    if (!found) return res.status(401).json({ error: 'session_invalid', message: 'Sign in again.' });
    const { status, body } = await fn(found, req);
    res.status(status).json(body);
  });
}

router.get('/me', handler((found) => api.me(prisma, found)));
router.get('/sessions', handler((found) => api.listSessions(prisma, found)));
router.post('/sessions/:id/revoke', handler((found, req) => api.revoke(prisma, found, req.params.id)));
router.post('/sign-out-all', handler((found) => api.signOutAll(prisma, found)));
router.post('/delete-request', handler(async (found, req) => api.deleteRequest(prisma, found, req.body || {}, { settings: await getSettings(prisma, found.customer.tenantId) })));
router.get('/licence', handler((found) => api.licenceSummary(prisma, found)));

module.exports = router;
