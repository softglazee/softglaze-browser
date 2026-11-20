'use strict';
// The phone app (client softglaze-mobile, redirect softglaze-mobile://auth), mounted at /v1/mobile. The contract
// is D:\SoftGlaze-Mobile\docs\features\SECURITY-VAULT.md ("Auth server contract"). JSON in and out; every error
// body is { error: <code>, message }.
//
//   GET  /v1/mobile/auth/providers                    -> { providers: ['google', 'microsoft', 'facebook', 'linkedin', 'github'], email: true, apple: false }
//   POST /v1/mobile/auth/email/start  { email, device, lang? }
//        -> 200 { challengeId, resendAfterSec, expiresAt (ms) } | 400 invalid_email | disposable_email | no_mx,
//           429 rate_limited, 503 email_unavailable, 502 email_failed
//   POST /v1/mobile/auth/email/verify { challengeId, code, device }
//        -> 200 <session> | 400 invalid_code | code_expired | invalid_request, 429 too_many_attempts, 403 phone_limit
//   GET  /v1/mobile/auth/authorize ?client_id=softglaze-mobile&redirect_uri=softglaze-mobile://auth&response_type=code
//        &scope=mobile&state&code_challenge&code_challenge_method=S256&provider=google|microsoft|facebook|linkedin|github|apple[&auth_type=rerequest]
//        -> 302 to the provider; the result comes back to redirect_uri?code=<one-time code>&state=<state> or
//           ?error=access_denied|email_not_verified|email_missing|disposable_email|failed|provider_not_configured|invalid_request
//           |rate_limited&state=<state>. Apple answers provider_not_configured until it is set up.
//   POST /v1/mobile/auth/token { grant_type: 'authorization_code', client_id, redirect_uri, code, code_verifier, device }
//        -> 200 <session> | 400 invalid_grant | unsupported_grant_type | invalid_request, 403 phone_limit |
//           email_not_verified | email_missing
//   POST /v1/mobile/auth/refresh      (Authorization: Bearer <token>) -> 200 <session> with a NEW token | 401
//   POST /v1/mobile/auth/sign-out     (Bearer) -> 204 (also when the token is already gone)
//   POST /v1/mobile/auth/sign-out-all (Bearer) -> 200 { ok, revoked }: every phone of the account
//   POST /v1/mobile/entitlement { mailbox? } (Bearer) -> 200 { token, exp, payload } | 403 no_entitlement |
//        503 entitlement_unavailable
// <session> = { token, expiresAt (ms), account: { id, email, name, tier: trial | pro | enterprise } }.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { getSettings } = require('../settings');
const { availableProviders } = require('../auth/providers');
const flow = require('../auth/flow');
const { MOBILE_CLIENT_ID } = require('../auth/tokens');
const { bearerSession, bearerOf, rotateMobile, revokeSession } = require('../auth/sessions');
const { accountTenant, signOutAll } = require('../auth/accountApi');
const mobile = require('../auth/mobile');
const { sendPage, ipHashOf, setNonceCookie, redirectTo } = require('./authHttp');

const router = express.Router();

const UNAVAILABLE = { error: 'server', message: 'Sign-in is not set up on the server.' };

async function tenantOr503(res) {
  const tenant = await accountTenant(prisma);
  if (!tenant) res.status(503).json(UNAVAILABLE);
  return tenant;
}

function send(res, { status, body }) {
  res.set('Cache-Control', 'no-store');
  if (body && body.retryAfterSec) res.set('Retry-After', String(body.retryAfterSec));
  res.status(status).json(body);
}

router.get('/auth/providers', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ providers: availableProviders(), email: true, apple: false });
});

router.post('/auth/email/start', asyncHandler(async (req, res) => {
  const tenant = await tenantOr503(res);
  if (!tenant) return;
  const b = req.body || {};
  send(res, await mobile.emailStart(prisma, tenant, { email: b.email, lang: b.lang }, { ipHash: ipHashOf(req), settings: await getSettings(prisma, tenant.id) }));
}));

router.post('/auth/email/verify', asyncHandler(async (req, res) => {
  const tenant = await tenantOr503(res);
  if (!tenant) return;
  const b = req.body || {};
  send(res, await mobile.emailVerify(prisma, tenant, b, {
    client: MOBILE_CLIENT_ID, device: mobile.cleanDevice(b.device), ipHash: ipHashOf(req), userAgent: req.get('user-agent'),
    settings: await getSettings(prisma, tenant.id)
  }));
}));

router.get('/auth/authorize', asyncHandler(async (req, res) => {
  const tenant = await accountTenant(prisma);
  const r = await flow.startClientSignIn(prisma, tenant, req.query, MOBILE_CLIENT_ID, { ipHash: ipHashOf(req) });
  if (r.ok) {
    setNonceCookie(res, r.cookie);
    return redirectTo(res, r.location);
  }
  if (r.redirect) return redirectTo(res, r.redirect);
  return sendPage(res, 400, 'invalid');
}));

router.post('/auth/token', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.grant_type !== 'authorization_code') return send(res, { status: 400, body: { error: 'unsupported_grant_type', message: 'Only authorization_code is supported.' } });
  const device = mobile.cleanDevice(b.device);
  if (!device) return send(res, { status: 400, body: { error: 'invalid_request', message: 'The device details are missing.' } });
  const tenant = await tenantOr503(res);
  if (!tenant) return;
  const got = await flow.takeClientCode(prisma, tenant, b, MOBILE_CLIENT_ID);
  if (!got.ok) return send(res, flow.INVALID_GRANT);
  send(res, await mobile.clientSignIn(prisma, tenant, got.provider, got.profile, {
    client: MOBILE_CLIENT_ID, device, ipHash: ipHashOf(req), userAgent: req.get('user-agent')
  }));
}));

const SESSION_INVALID = { status: 401, body: { error: 'session_invalid', message: 'Sign in again.' } };

router.post('/auth/refresh', asyncHandler(async (req, res) => {
  const r = await rotateMobile(prisma, bearerOf(req));
  if (!r.ok) return send(res, SESSION_INVALID);
  send(res, { status: 200, body: mobile.mobileBody(r.customer, r.token, r.expiresAt) });
}));

router.post('/auth/sign-out', asyncHandler(async (req, res) => {
  const found = await bearerSession(prisma, bearerOf(req), { kinds: ['mobile'] });
  if (found) await revokeSession(prisma, found.session);
  res.set('Cache-Control', 'no-store').status(204).end();
}));

router.post('/auth/sign-out-all', asyncHandler(async (req, res) => {
  const found = await bearerSession(prisma, bearerOf(req), { kinds: ['mobile'] });
  if (!found) return send(res, SESSION_INVALID);
  send(res, await signOutAll(prisma, found, { kinds: ['mobile'] }));
}));

router.post('/entitlement', asyncHandler(async (req, res) => {
  const found = await bearerSession(prisma, bearerOf(req), { kinds: ['mobile'] });
  if (!found) return send(res, SESSION_INVALID);
  send(res, await mobile.entitlement(prisma, found, req.body || {}, { settings: await getSettings(prisma, found.customer.tenantId) }));
}));

module.exports = router;
