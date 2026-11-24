'use strict';
// Cloud sync phase 1: the encrypted workspace store (/v1/sync/*). Contract: @softglaze/protocol src/ws/api.ts.
// Bearer auth for every client kind (desktop session, phone token, web access token). CORS for WEB_APP_ORIGINS.
// Mounted in server.js BEFORE the global 256 KB JSON parser: a batch of sealed records needs a bigger body
// (this router parses up to 8 MB itself). Logic and checks: src/sync/store.js.
//
//   GET    /workspace              PUT /workspace/keyring       GET  /enrol         GET  /records?since=&limit=
//   POST   /workspace              PUT /workspace/recovery      POST /enrol         GET  /records/:rid
//   DELETE /workspace              GET/POST /devices            GET  /enrol/:id     POST /records
//                                  POST /devices/:tag/revoke    POST /enrol/:id/approve | /deny
// While CLOUD_SYNC is off (or the account is not in the beta) every route answers 404 cloud_sync_off, except
// GET /workspace, which says { enabled: false }.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { rateLimit } = require('../middleware/rateLimit');
const { bearerSession, bearerOf } = require('../auth/sessions');
const { webCors } = require('./authHttp');
const store = require('../sync/store');

const router = express.Router();
router.use(webCors('GET, POST, PUT, DELETE, OPTIONS'));
router.use(rateLimit({ windowMs: 60000, max: Number(process.env.CLOUD_SYNC_RATE_PER_MIN) || 600 }));
router.use(express.json({ limit: '8mb' }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// fn(found, ws, req) -> { status, body }. needsWorkspace: 404 no_workspace when the account has none.
function handler(fn, { needsWorkspace = true, whenOff = null } = {}) {
  return asyncHandler(async (req, res) => {
    const found = await bearerSession(prisma, bearerOf(req), { kinds: ['desktop', 'web', 'mobile'] });
    if (!found) return res.status(401).json({ error: 'session_invalid', message: 'Sign in again.' });
    if (!store.enabledFor(found.customer)) {
      if (whenOff) { const r = await whenOff(found); return res.status(r.status).json(r.body); }
      return res.status(404).json({ error: 'cloud_sync_off' });
    }
    let ws = null;
    if (needsWorkspace) {
      ws = await store.workspaceOf(prisma, found.customer);
      if (!ws) return res.status(404).json({ error: 'no_workspace' });
    }
    const { status, body } = await fn(found, ws, req);
    res.status(status).json(body);
  });
}

const c = (found) => found.customer;

router.get('/workspace', handler((found) => store.status(prisma, c(found)), { needsWorkspace: false, whenOff: (found) => store.status(prisma, c(found)) }));
router.post('/workspace', handler((found, ws, req) => store.create(prisma, c(found), req.body), { needsWorkspace: false }));
router.delete('/workspace', handler((found, ws, req) => store.remove(prisma, c(found), ws, req.body)));
router.put('/workspace/keyring', handler((found, ws, req) => store.putKeyring(prisma, c(found), ws, req.body)));
router.put('/workspace/recovery', handler((found, ws, req) => store.putRecovery(prisma, c(found), ws, req.body)));

router.get('/devices', handler((found, ws) => store.listDevices(prisma, ws)));
router.post('/devices', handler((found, ws, req) => store.addDevice(prisma, c(found), ws, req.body)));
router.post('/devices/:tag/revoke', handler((found, ws, req) => store.revokeDevice(prisma, ws, req.params.tag, req.body)));

router.post('/enrol', handler((found, ws, req) => store.enrol(prisma, c(found), ws, req.body)));
router.get('/enrol', handler((found, ws) => store.pendingEnrolments(prisma, ws)));
router.get('/enrol/:id', handler((found, ws, req) => store.enrolStatus(prisma, ws, req.params.id)));
router.post('/enrol/:id/approve', handler((found, ws, req) => store.approveEnrolment(prisma, c(found), ws, req.params.id, req.body)));
router.post('/enrol/:id/deny', handler((found, ws, req) => store.denyEnrolment(prisma, ws, req.params.id)));

router.get('/records', handler((found, ws, req) => store.changes(prisma, ws, req.query)));
router.get('/records/:rid', handler((found, ws, req) => store.getRecord(prisma, ws, req.params.rid)));
router.post('/records', handler((found, ws, req) => store.writeRecords(prisma, c(found), ws, req.body)));

router.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// Body parser errors (too large, bad JSON) as JSON, like the rest of the API.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'too_large' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid', message: 'Bad JSON.' });
  next(err);
});

module.exports = router;
