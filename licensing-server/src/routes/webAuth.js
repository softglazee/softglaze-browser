'use strict';
// The web app (client softglaze-web), mounted at /v1/web/auth. A public client: PKCE S256, no client secret, its
// redirect is <origin>/auth/callback for an origin in WEB_APP_ORIGINS, and CORS answers only those origins.
//
//   GET  /v1/web/auth/providers                    -> { providers: ['google', 'microsoft', 'facebook', 'linkedin', 'github'], email: true }
//   GET  /v1/web/auth/authorize ?client_id=softglaze-web&redirect_uri=https://app.softglaze.com/auth/callback
//        &response_type=code&state&code_challenge&code_challenge_method=S256&provider=google|microsoft|facebook|linkedin|github[&auth_type=rerequest]
//        -> 302 to the provider, then to redirect_uri?code=..&state=.. (or ?error=..&state=..)
//   POST /v1/web/auth/token
//        { grant_type: 'authorization_code', client_id, redirect_uri, code, code_verifier }
//        { grant_type: 'refresh_token', client_id, refresh_token }
//        -> 200 { access_token, token_type: 'Bearer', expires_in (s, 900), refresh_token, refresh_expires_at (ms),
//                 account: { id, email, name, tier, status, plan } }
//        | 400 invalid_grant | unsupported_grant_type, 403 email_not_verified | email_missing
//        The refresh token rotates on every use; using an old one again ends the session.
//   POST /v1/web/auth/email/start  { email, lang? }        -> { challengeId, resendAfterSec, expiresAt }
//   POST /v1/web/auth/email/verify { challengeId, code }   -> the token answer above
//   POST /v1/web/auth/sign-out (Authorization: Bearer <access token>) -> 204
//
// Refresh token in a cookie: every token answer also sets the HttpOnly cookie sg_web_rt (SameSite=Strict,
// Path=/v1/web/auth/token, Secure on https). A client that sends `{ refresh_cookie: true }` with the grant (or the
// email verify) gets the answer WITHOUT refresh_token in the body, and refreshes with
// `{ grant_type: 'refresh_token', client_id }` and credentials: the server reads the cookie. A refresh_token in the
// body still works (older clients, tests). Sign-out and a refused refresh clear the cookie.
// The account endpoints the web app uses next are in src/routes/accountApi.js (/v1/account/*).
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { getSettings } = require('../settings');
const { availableProviders } = require('../auth/providers');
const flow = require('../auth/flow');
const { WEB_CLIENT_ID } = require('../auth/tokens');
const { bearerSession, bearerOf, refreshWeb, revokeSession } = require('../auth/sessions');
const { accountTenant } = require('../auth/accountApi');
const mobile = require('../auth/mobile');
const {
  sendPage, ipHashOf, setNonceCookie, redirectTo, webCors, setWebRefreshCookie, clearWebRefreshCookie, readWebRefreshCookie
} = require('./authHttp');

const router = express.Router();
router.use(webCors('GET, POST, OPTIONS', { credentials: true }));

function send(res, { status, body }) {
  res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache');
  if (body && body.retryAfterSec) res.set('Retry-After', String(body.retryAfterSec));
  res.status(status).json(body);
}

// A token answer: the refresh token goes into the HttpOnly cookie, and out of the body when the client asked.
function sendTokens(req, res, r) {
  if (r.status === 200 && r.body && r.body.refresh_token) {
    setWebRefreshCookie(res, r.body.refresh_token, r.body.refresh_expires_at);
    if ((req.body || {}).refresh_cookie === true) {
      const { refresh_token: _omit, ...rest } = r.body;
      return send(res, { status: 200, body: rest });
    }
  }
  return send(res, r);
}

async function tenantOr503(res) {
  const tenant = await accountTenant(prisma);
  if (!tenant) res.status(503).json({ error: 'server', message: 'Sign-in is not set up on the server.' });
  return tenant;
}

router.get('/providers', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ providers: availableProviders(), email: true });
});

router.get('/authorize', asyncHandler(async (req, res) => {
  const tenant = await accountTenant(prisma);
  const r = await flow.startClientSignIn(prisma, tenant, req.query, WEB_CLIENT_ID, { ipHash: ipHashOf(req) });
  if (r.ok) {
    setNonceCookie(res, r.cookie);
    return redirectTo(res, r.location);
  }
  if (r.redirect) return redirectTo(res, r.redirect);
  return sendPage(res, 400, 'invalid');
}));

router.post('/token', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.grant_type === 'refresh_token') {
    const fromBody = typeof b.refresh_token === 'string' && b.refresh_token;
    const r = await refreshWeb(prisma, fromBody || readWebRefreshCookie(req), { clientId: b.client_id });
    if (!r.ok) {
      if (!fromBody) clearWebRefreshCookie(res);
      return send(res, flow.INVALID_GRANT);
    }
    return sendTokens(req, res, { status: 200, body: mobile.webBody(r.customer, r) });
  }
  if (b.grant_type !== 'authorization_code') return send(res, { status: 400, body: { error: 'unsupported_grant_type', message: 'Use authorization_code or refresh_token.' } });
  const tenant = await tenantOr503(res);
  if (!tenant) return;
  const got = await flow.takeClientCode(prisma, tenant, b, WEB_CLIENT_ID);
  if (!got.ok) return send(res, flow.INVALID_GRANT);
  sendTokens(req, res, await mobile.clientSignIn(prisma, tenant, got.provider, got.profile, { client: WEB_CLIENT_ID, ipHash: ipHashOf(req), userAgent: req.get('user-agent') }));
}));

router.post('/email/start', asyncHandler(async (req, res) => {
  const tenant = await tenantOr503(res);
  if (!tenant) return;
  const b = req.body || {};
  send(res, await mobile.emailStart(prisma, tenant, { email: b.email, lang: b.lang }, { ipHash: ipHashOf(req), settings: await getSettings(prisma, tenant.id) }));
}));

router.post('/email/verify', asyncHandler(async (req, res) => {
  const tenant = await tenantOr503(res);
  if (!tenant) return;
  sendTokens(req, res, await mobile.emailVerify(prisma, tenant, req.body || {}, {
    client: WEB_CLIENT_ID, ipHash: ipHashOf(req), userAgent: req.get('user-agent'), settings: await getSettings(prisma, tenant.id)
  }));
}));

router.post('/sign-out', asyncHandler(async (req, res) => {
  const found = await bearerSession(prisma, bearerOf(req), { kinds: ['web'] });
  if (found) await revokeSession(prisma, found.session);
  clearWebRefreshCookie(res);
  res.set('Cache-Control', 'no-store').status(204).end();
}));

module.exports = router;
